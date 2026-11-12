import { createContext } from "react";
import type React from "react";
import type { RenderNode } from "./RenderTree";

/**
 * Mask groups the layer plan also draws as a <clipPath> (`${name}_group_clippath`), as they only cut hard edges,
 * with the ids of the nodes cut by that instead of the <mask> (see `planDefs`). Provided by RigLayers, so nodes
 * that wrap their own fill agree with the plan.
 */
export const MaskClipsContext = createContext<ReadonlyMap<string, ReadonlySet<string>>>(new Map());

export type FillWrapTargets = {
  /** Soft-mask ids, outermost first. */
  maskTargets: string[];
  /** Clip group clipPath ids, outermost first, de-duped. */
  clipTargets: string[];
};

/** Mask and clip-path ids a node's fill is wrapped in (see wrapFill). */
export const getFillWrapTargets = (
  g: RenderNode,
  scopeId: (suffix: string) => string,
  skipClipPaths?: boolean,
  maskClips: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
): FillWrapTargets => {
  const maskedBy = g.maskedBy ?? [];
  const asClip = (name: string) => !g.maskOutline && Boolean(maskClips.get(name)?.has(g.id));
  return {
    maskTargets: maskedBy
      .filter((name) => !asClip(name))
      .map((name) => scopeId(`${name}_group${g.maskOutline ? "" : "_no_outline"}`)),
    clipTargets: skipClipPaths
      ? []
      : [
          ...new Set([
            ...(g.clippedBy ?? []).map((name) => scopeId(`${name}_clippath`)),
            ...maskedBy.filter(asClip).map((name) => scopeId(`${name}_group_clippath`)),
          ]),
        ],
  };
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
