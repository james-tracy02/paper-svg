import { createContext } from "react";
import type React from "react";
import type { RegionForms } from "./layerPlan";
import type { RenderNode } from "./RenderTree";
import { fillCutRefs, outlineCuts } from "./regions";

/**
 * How the layer plan draws each region's shapes (see `planDefs`). Provided by RigLayers, so nodes that wrap
 * their own fill agree with the plan.
 */
export const RegionFormsContext = createContext<RegionForms>(new Map());

export type FillWrapTargets = {
  /** Mask ids, outermost first. */
  maskTargets: string[];
  /** Clip-path ids, outermost first, de-duped. */
  clipTargets: string[];
};

/**
 * Mask and clip-path ids a node's fill is wrapped in (see wrapFill), as each of its cuts asks: the region's
 * clip-path (`clippedBy`), or its mask (`maskedBy`): the full shape when the node traces the region's outline,
 * else the inset shape.
 */
export const getFillWrapTargets = (g: RenderNode, skipClipPaths: boolean | undefined, forms: RegionForms): FillWrapTargets => {
  const maskTargets: string[] = [];
  const clipTargets = new Set<string>();
  for (const { region, mode } of fillCutRefs(g)) {
    const form = forms.get(region);
    if (!form) continue;
    if (mode === "clip" && form.clipId) {
      if (!skipClipPaths) clipTargets.add(form.clipId);
    } else {
      // A clip the region can't draw as a clip-path falls back to its full mask (see planDefs).
      const maskId = mode === "clip" || g.traceOutline ? form.fullMaskId : form.maskId;
      if (maskId) maskTargets.push(maskId);
    }
  }
  return { maskTargets, clipTargets: [...clipTargets] };
};

/** Mask ids a node's traced outline (`traceOutline`) is cut by: the outline shapes of the regions it traces. */
export const getOutlineWrapTargets = (g: RenderNode, forms: RegionForms): string[] =>
  g.traceOutline ? outlineCuts(g).flatMap((name) => forms.get(name)?.outlineMaskId ?? []) : [];

/** Traced outlines painted back to back that share their outline masks, applied once around the run. */
export type MaskOutlineRun = { masks: string[]; nodes: RenderNode[] };

/**
 * Splits traced outlines, in paint order, into runs sharing the same outline masks, so each run is masked once
 * instead of once per node. A blend-mode outline stays alone: it composites inside its own masks.
 */
export const maskOutlineRuns = (nodes: RenderNode[], forms: RegionForms): MaskOutlineRun[] => {
  const runs: MaskOutlineRun[] = [];
  let last: { run: MaskOutlineRun; joinable: boolean } | undefined;
  for (const node of nodes) {
    const masks = getOutlineWrapTargets(node, forms);
    const joinable = masks.length > 0 && !node.blendMode;
    if (joinable && last?.joinable && last.run.masks.join(" ") === masks.join(" ")) {
      last.run.nodes.push(node);
      continue;
    }
    last = { run: { masks, nodes: [node] }, joinable };
    runs.push(last.run);
  }
  return runs;
};

/** One wrapper around a fill: `clip:<clipPath id>` or `mask:<mask id>`. */
export type FillWrapper = `clip:${string}` | `mask:${string}`;

/** A node's wrappers, outermost first (clip-paths outside masks, as in wrapFill). */
export const listFillWrappers = ({ maskTargets, clipTargets }: FillWrapTargets): FillWrapper[] => [
  ...clipTargets.map((id) => `clip:${id}` as const),
  ...maskTargets.map((id) => `mask:${id}` as const),
];

export const wrapWith = (content: React.ReactNode, wrapper: FillWrapper, key: string) =>
  wrapper.startsWith("clip:") ? (
    <g key={key} clipPath={`url(#${wrapper.slice(5)})`}>
      {content}
    </g>
  ) : (
    <g key={key} mask={`url(#${wrapper.slice(5)})`}>
      {content}
    </g>
  );

/** Wraps `content` in clip-path groups (outer) around mask groups (inner); `firstMaskStyle` goes on the outermost mask. */
export const wrapFill = (
  content: React.ReactNode,
  { maskTargets, clipTargets }: FillWrapTargets,
  keyPrefix: string,
  firstMaskStyle?: React.CSSProperties,
) => {
  const masked = maskTargets.reduceRight<React.ReactNode>(
    (acc, maskTarget, index) => (
      <g key={`${keyPrefix}_fill_clip_${index}`} mask={`url(#${maskTarget})`} style={index === 0 ? firstMaskStyle : undefined}>
        {acc}
      </g>
    ),
    content,
  );
  return clipTargets.reduceRight<React.ReactNode>(
    (acc, clipTarget, index) => (
      <g key={`${keyPrefix}_clippath_${index}`} clipPath={`url(#${clipTarget})`}>
        {acc}
      </g>
    ),
    masked,
  );
};
