/**
 * Regions, as the renderer reads them: the named shapes nodes join (`regions`) and are cut by (`cuts`).
 * Every masking feature resolves to these in RenderTree, so the renderer has one concept to follow.
 *
 * A region is the shapes of its members, added or subtracted, each grown by its outset; opacity and colour
 * never count. A node cut by a region stays inside the region's outline, as the node's cut asks: a clip
 * (`clippedBy`) lifts each stroked member's outline above the nodes it clips (hoisting); a mask (`maskedBy`)
 * cuts the inner half of each member's outline out of the region (inset). See layerPlan.ts.
 */
import type { Node, RegionCutMode, RegionCutRef, RegionJoin } from "../types/Node";

/** A node's shape joining a region. */
export type RegionMember = {
  region: string;
  /** Removes the node's shape from the region instead of adding it. */
  subtract?: boolean;
  /** Grows the node's shape in this region by this much on every side (world units). */
  outset?: number;
  /** Adds only the part of the node its own cuts leave (`onlyWhereCut`). */
  onlyWhereCut?: boolean;
  /** Lifts (true) or keeps (false) the node's outline for the nodes the region clips; unset, the region decides. */
  hoist?: boolean;
};

/** A region cutting a node: its fill (as a clip or a mask), the outline it traces (`traceOutline`), or both. */
export type RegionCut = {
  region: string;
  mode: RegionCutMode;
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

/** Names of the regions cutting a node's fill, in order, repeats kept. */
export const fillCuts = (node: { cuts?: RegionCut[] }) => names(node.cuts, (cut) => cut.fill);

/** Names of the regions clipping a node's fill (`clippedBy`), in order, repeats kept. */
export const clipCuts = (node: { cuts?: RegionCut[] }) => names(node.cuts, (cut) => cut.fill && cut.mode === "clip");

/** The regions cutting a node's fill, with how each cuts it, in order, repeats kept. */
export const fillCutRefs = (node: { cuts?: RegionCut[] }): RegionCut[] => node.cuts?.filter((cut) => cut.fill) ?? [];

/** Names of the regions whose outlines a node traces, in order, repeats kept. */
export const outlineCuts = (node: { cuts?: RegionCut[] }) => names(node.cuts, (cut) => cut.outline);

/** Whether any region cuts the node's fill. */
export const isCut = (node: { cuts?: RegionCut[] }) => Boolean(node.cuts?.some((cut) => cut.fill));

/** Names of the regions a node joins, in order, repeats kept. */
export const memberOf = (node: { regions?: RegionMember[] }) => names(node.regions, () => true);

/** The node's membership in region `name`, if it joins it. */
export const membership = (node: { regions?: RegionMember[] }, name: string): RegionMember | undefined =>
  node.regions?.find((member) => member.region === name);

/** A node's joins and cuts: its own, then those its ancestors pass down. */
export type ResolvedRegions = { joins: RegionJoin[]; cuts: RegionCutRef[] };

/** A node's regions as the renderer reads them: its joins, and its cuts, each tracing the outline when the node traces its cuts' outlines. */
export const resolveRegions = (
  body: Node,
  resolved: ResolvedRegions,
): { regions?: RegionMember[]; cuts?: RegionCut[]; traceOutline?: boolean } => {
  const trace = body.outline?.trace;
  if (!resolved.joins.length && !resolved.cuts.length && !trace) return {};
  const onlyWhereCut = body.regions?.onlyWhereCut;
  const regions: RegionMember[] = resolved.joins.map((join) => ({
    region: join.region,
    subtract: join.subtract || undefined,
    outset: join.outset || undefined,
    onlyWhereCut: onlyWhereCut || undefined,
    hoist: join.hoist,
  }));
  // A traced outline follows the node's cuts, unless it names the regions it traces (`traceOutlineOf`).
  const tracesCuts = trace === true;
  const cuts: RegionCut[] = [
    ...resolved.cuts.map(({ region, mode }) => ({ region, mode, fill: true, outline: tracesCuts })),
    // Traced only: the outline ring is always a mask, so the mode is moot.
    ...(Array.isArray(trace) ? trace : []).map((region) => ({ region, mode: "mask" as const, fill: false, outline: true })),
  ];
  return {
    regions: regions.length ? regions : undefined,
    cuts: cuts.length ? cuts : undefined,
    traceOutline: trace ? true : undefined,
  };
};
