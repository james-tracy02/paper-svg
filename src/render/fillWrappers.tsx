import { createContext } from "react";
import type React from "react";
import type { RegionForms } from "./layerPlan";
import type { RenderNode } from "./RenderTree";
import { fillCuts } from "./regions";

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
 * Mask and clip-path ids a node's fill is wrapped in (see wrapFill): for each region cutting it, the full shape
 * when the node traces its outline (`traceOutline`), else the inset shape, as a clip-path where the plan lets
 * the node take one.
 */
export const getFillWrapTargets = (g: RenderNode, skipClipPaths: boolean | undefined, forms: RegionForms): FillWrapTargets => {
  const maskTargets: string[] = [];
  const clipTargets = new Set<string>();
  for (const name of fillCuts(g)) {
    const form = forms.get(name)?.[g.traceOutline ? "full" : "inset"];
    if (!form) continue;
    if (form.clipId && (!form.clipUsers || form.clipUsers.has(g.id))) {
      if (!skipClipPaths) clipTargets.add(form.clipId);
    } else if (form.maskId) {
      maskTargets.push(form.maskId);
    }
  }
  return { maskTargets, clipTargets: [...clipTargets] };
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
