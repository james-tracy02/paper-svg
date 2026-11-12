/**
 * Regions, as the renderer reads them: the named shapes nodes join (`regions`) and are cut by (`cuts`).
 * Every masking feature resolves to these in RenderTree, so the renderer has one concept to follow.
 *
 * `kind` keeps the two meanings a region has until the builder states them (step 2.3b): "mask" regions are
 * today's mask groups (members count as painted, and a cut stops inside their outlines unless the node
 * traces them), "clip" regions are today's clip groups (members count by shape; the owner's outline is lifted
 * above what it cuts).
 */
import type { Node } from "../types/Node";

export type RegionKind = "mask" | "clip";

/** A node's shape joining a region. */
export type RegionMember = {
  region: string;
  kind: RegionKind;
  /**
   * Removes the node's shape from the region (true) instead of adding it (false). Unset on a mask group member
   * with no mode, which a mask draws a little differently from an explicit add, so it's kept apart until 2.3b.
   */
  subtract?: boolean;
  /** Grows the node's shape in this region by this much on every side (world units). */
  outset?: number;
  /** Adds only the part of the node its own clip cuts leave (`clipMaskContribution`). */
  onlyWhereCut?: boolean;
};

/** A region cutting a node: its fill, the outline it traces (`setMaskOutline`), or both. */
export type RegionCut = {
  region: string;
  kind: RegionKind;
  fill: boolean;
  outline: boolean;
};

const NONE: readonly string[] = Object.freeze([]);

/** Region names from `list` that pass `keep`, in order, repeats kept; no allocation when there are none. */
const names = <T extends { region: string }>(list: readonly T[] | undefined, keep: (item: T) => boolean): readonly string[] => {
  if (!list) return NONE;
  let out: string[] | undefined;
  for (const item of list) if (keep(item)) (out ??= []).push(item.region);
  return out ?? NONE;
};

/** Names of the regions of `kind` a node's fill is cut by, in order, repeats kept. */
export const fillCuts = (node: { cuts?: RegionCut[] }, kind: RegionKind) =>
  names(node.cuts, (cut) => cut.kind === kind && cut.fill);

/** Names of the regions of `kind` whose outlines a node traces, in order, repeats kept. */
export const outlineCuts = (node: { cuts?: RegionCut[] }, kind: RegionKind) =>
  names(node.cuts, (cut) => cut.kind === kind && cut.outline);

/** Whether any region cuts the node's fill. */
export const isCut = (node: { cuts?: RegionCut[] }) => Boolean(node.cuts?.some((cut) => cut.fill));

/** Names of the regions of `kind` a node joins, in order, repeats kept. */
export const memberOf = (node: { regions?: RegionMember[] }, kind: RegionKind) =>
  names(node.regions, (member) => member.kind === kind);

/** The node's membership in region `name` of `kind`, if it joins it. */
export const membership = (
  node: { regions?: RegionMember[] },
  name: string,
  kind: RegionKind,
): RegionMember | undefined => node.regions?.find((member) => member.region === name && member.kind === kind);

/** The masking fields a render node is resolved from: a node's own, with what its ancestors pass down. */
export type ResolvedMasking = {
  maskedBy: string[];
  clippedBy: string[];
  maskGroups: string[];
  clippingGroups: string[];
  maskGroupModes?: Record<string, "positive" | "negative">;
};

const modeToSubtract = (mode: "positive" | "negative" | undefined) =>
  mode === "negative" ? true : mode === "positive" ? false : undefined;

/** Today's masking fields on `body`, with what it inherits (`resolved`), as regions and cuts. */
export const resolveRegions = (
  body: Node,
  resolved: ResolvedMasking,
): { regions?: RegionMember[]; cuts?: RegionCut[]; traceOutline?: boolean } => {
  const traceOutline = body.outline?.masked;
  const { outlineMaskedBy, outlineClippedBy } = body;
  if (
    !resolved.maskGroups.length &&
    !resolved.clippingGroups.length &&
    !resolved.maskedBy.length &&
    !resolved.clippedBy.length &&
    !traceOutline
  ) {
    return {};
  }
  const regions: RegionMember[] = [
    ...resolved.maskGroups.map((region) => ({
      region,
      kind: "mask" as const,
      subtract: modeToSubtract(resolved.maskGroupModes?.[region]),
      outset: body.maskOutsets?.[region],
      onlyWhereCut: body.clipMaskContribution || undefined,
    })),
    ...resolved.clippingGroups.map((region) => ({ region, kind: "clip" as const, outset: body.clipOutsets?.[region] })),
  ];
  // A traced outline follows the fill's cuts unless the node names its own (outlineMaskedBy, outlineClippedBy).
  const traces = (own: string[] | undefined) => Boolean(traceOutline) && own === undefined;
  const cuts: RegionCut[] = [
    ...resolved.maskedBy.map((region) => ({ region, kind: "mask" as const, fill: true, outline: traces(outlineMaskedBy) })),
    ...(traceOutline ? (outlineMaskedBy ?? []) : []).map((region) => ({ region, kind: "mask" as const, fill: false, outline: true })),
    ...resolved.clippedBy.map((region) => ({
      region,
      kind: "clip" as const,
      fill: true,
      outline: traces(outlineClippedBy ?? outlineMaskedBy),
    })),
    ...(traceOutline ? (outlineClippedBy ?? outlineMaskedBy ?? []) : []).map((region) => ({
      region,
      kind: "clip" as const,
      fill: false,
      outline: true,
    })),
  ];
  return {
    regions: regions.length ? regions : undefined,
    cuts: cuts.length ? cuts : undefined,
    traceOutline: traceOutline || undefined,
  };
};
