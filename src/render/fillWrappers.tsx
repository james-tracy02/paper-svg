import type React from "react";
import type { RenderNode } from "./RenderTree";

export type FillWrapTargets = {
  /** Soft-mask ids, outermost first. */
  maskTargets: string[];
  /** True-clip clipPath ids, outermost first, de-duped. */
  clipTargets: string[];
};

/** Mask and clip-path ids a node's fill is wrapped in (see wrapFill). */
export const getFillWrapTargets = (
  g: RenderNode,
  scopeId: (suffix: string) => string,
  skipTrueClip?: boolean,
): FillWrapTargets => ({
  maskTargets: (g.clippedBy ?? []).map((clipId) => scopeId(`${clipId}_group${g.maskOutline ? "" : "_no_outline"}`)),
  clipTargets: skipTrueClip
    ? []
    : [...new Set((g.trueClippedBy ?? []).map((name) => scopeId(`${name}_clippath`)))],
});

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
