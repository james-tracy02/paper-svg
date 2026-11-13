/**
 * Regions, as the renderer reads them: the named shapes nodes join (`regions`) and are cut by (`cuts`).
 * Every masking feature resolves to these in RenderTree, so the renderer has one concept to follow.
 *
 * A region is the shapes of its members, added or subtracted, each grown by its outset; opacity and colour
 * never count. A node cut by a region stays inside the region's outline: each stroked member either lifts its
 * outline above the nodes the region cuts (hoisting, the default), or has the inner half of its outline cut
 * out of the region for them (`inset`). Whether a cut is drawn as a <clipPath> or a <mask> is the engine's
 * choice (see layerPlan.ts).
 */
import type { Node, RegionJoin } from "../types/Node";

/** A node's shape joining a region. */
export type RegionMember = {
  region: string;
  /** Removes the node's shape from the region instead of adding it. */
  subtract?: boolean;
  /** Grows the node's shape in this region by this much on every side (world units). */
  outset?: number;
  /** Adds only the part of the node its own cuts leave (`onlyWhereCut`). */
  onlyWhereCut?: boolean;
  /** Keeps nodes the region cuts inside this member's outline by cutting the outline out, instead of hoisting it. */
  inset?: boolean;
};

/** A region cutting a node: its fill, the outline it traces (`traceOutline`), or both. */
export type RegionCut = {
  region: string;
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
export type ResolvedRegions = { joins: RegionJoin[]; cuts: string[] };

/**
 * A node's regions as the renderer reads them: its joins (insetting its outline where the join or the node asks
 * to, `insetOutlines`), and its cuts, each tracing the outline when the node traces its cuts' outlines.
 */
export const resolveRegions = (
  body: Node,
  resolved: ResolvedRegions,
): { regions?: RegionMember[]; cuts?: RegionCut[]; traceOutline?: boolean } => {
  const trace = body.outline?.trace;
  if (!resolved.joins.length && !resolved.cuts.length && !trace) return {};
  const insetAll = body.outline?.inset;
  const onlyWhereCut = body.regions?.onlyWhereCut;
  const regions: RegionMember[] = resolved.joins.map((join) => ({
    region: join.region,
    subtract: join.subtract || undefined,
    outset: join.outset || undefined,
    onlyWhereCut: onlyWhereCut || undefined,
    inset: join.inset || insetAll || undefined,
  }));
  // A traced outline follows the node's cuts, unless it names the regions it traces (`traceOutlineOf`).
  const tracesCuts = trace === true;
  const cuts: RegionCut[] = [
    ...resolved.cuts.map((region) => ({ region, fill: true, outline: tracesCuts })),
    ...(Array.isArray(trace) ? trace : []).map((region) => ({ region, fill: false, outline: true })),
  ];
  return {
    regions: regions.length ? regions : undefined,
    cuts: cuts.length ? cuts : undefined,
    traceOutline: trace ? true : undefined,
  };
};
