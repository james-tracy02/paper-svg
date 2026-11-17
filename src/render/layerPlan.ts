/**
 * Decides what RigLayers paints, as plain data: which nodes are drawn, which mask and clip
 * definitions they need, and in what order and under which shared wrappers the nodes paint.
 * No React here, so the rules can be tested directly; RigLayers turns the plan into SVG.
 */
import type { CSSProperties } from "react";
import { renderGroupPath, type RenderGroup, type RenderGroupOptions } from "../types/RenderGroup";
import type { RenderNode } from "./RenderTree";
import { getFillWrapTargets, listFillWrappers, type FillWrapper } from "./fillWrappers";
import { createOutlineNode } from "./outline";
import { clipCuts, fillCutRefs, fillCuts, isCut, memberOf, membership, outlineCuts } from "./regions";

type ScopeId = (suffix: string) => string;
type GetRenderGroupOptions = (id: string) => RenderGroupOptions | undefined;

/** A region and the nodes whose shapes make it, in paint order (a node joining twice is listed twice). */
export type Region = { name: string; members: RenderNode[] };

/** Every region by name, with its members (`addToRegion`). */
export const getRegions = (nodes: RenderNode[]): Map<string, Region> => {
  const map = new Map<string, Region>();
  for (const node of nodes) {
    for (const name of memberOf(node)) {
      if (!map.has(name)) map.set(name, { name, members: [] });
      map.get(name)!.members.push(node);
    }
  }
  return map;
};

/** A node made to draw another node's stroke (see createOutlineNode). */
const isOutlineNode = (node: RenderNode) => node.outlineOf !== undefined;

const isStroked = (node: RenderNode) => (node.sprite.strokeWidth ?? 0) > 0 && node.sprite.stroke !== "none";

/**
 * The members of each region that lift their outline above the nodes it clips, by region name. A region of one
 * drawn member lifts it: its outline is the region's edge. A region of several leaves outlines in place, as
 * lifting one would draw it over the others and whatever paints between them. `hoist` overrides either way.
 */
const hoistingOwners = (nodes: RenderNode[]): Map<string, string[]> => {
  const owners = new Map<string, string[]>();
  for (const region of getRegions(nodes).values()) {
    const drawn = [...new Map(region.members.filter((node) => !isOutlineNode(node) && !node.noSprite).map((node) => [node.id, node])).values()];
    const alone = drawn.length === 1;
    const lifting = drawn.filter((node) => membership(node, region.name)?.hoist ?? alone).map((node) => node.id);
    if (lifting.length) owners.set(region.name, lifting);
  }
  return owners;
};

const pushTo = <K, V>(map: Map<K, V[]>, key: K, value: V) => {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
};

/**
 * The nodes RigLayers paints, sorted by z-index: every node whose regions all exist (a node cut by a region
 * nobody defines is not drawn), plus, for each region something is clipped by, the hoisted outline of each
 * stroked member, just above the highest node the region clips. Returns copies; `nodes` is not modified.
 */
export const resolveVisibleNodes = (nodes: RenderNode[]): RenderNode[] => {
  const regions = getRegions(nodes);
  const visible = nodes
    .filter((node) => fillCuts(node).every((name) => regions.has(name)))
    .map((node) => ({ ...node, sprite: { ...node.sprite } }));

  const nodeById = new Map(visible.map((node) => [node.id, node] as const));
  const ownerIdsByRegion = hoistingOwners(visible);
  const cutByRegion = new Map<string, RenderNode[]>();
  // Only a clip lifts outlines: a mask keeps them where they are and cuts their inner half out.
  for (const node of visible) for (const name of clipCuts(node)) pushTo(cutByRegion, name, node);

  // Highest cut node's z-index per owner, in the order owners are first reached.
  const topCutZByOwnerId = new Map<string, number>();
  for (const [name, cut] of cutByRegion) {
    const topZ = Math.max(...cut.map((node) => node.zIndex));
    for (const ownerId of ownerIdsByRegion.get(name) ?? []) {
      topCutZByOwnerId.set(ownerId, Math.max(topCutZByOwnerId.get(ownerId) ?? -Infinity, topZ));
    }
  }

  const hoistedOutlines: RenderNode[] = [];
  for (const [ownerId, topZ] of topCutZByOwnerId) {
    const owner = nodeById.get(ownerId);
    if (!owner || owner.linkedOutline || !isStroked(owner)) continue;
    // Just above the highest cut node, so the outline draws over everything the owner's regions cut.
    hoistedOutlines.push(createOutlineNode(owner, Math.max(topZ, owner.zIndex) + 0.00000001));
  }

  return [...visible, ...hoistedOutlines].sort((a, b) => a.zIndex - b.zIndex);
};

/**
 * Which shape of a region a definition draws: "full" (the members' shapes), "inset" (the same, with the inner
 * half of each member's outline cut out), or "outline" (the members' outlines, for traced outlines).
 */
export type RegionShape = "full" | "inset" | "outline";

/** One <clipPath> or <mask> definition of a region's shape. */
export type RegionDef = { key: string; id: string; region: string; shape: RegionShape; nodes: RenderNode[] };

/**
 * The definitions drawn for a region, as its users need them: `clipId` for `clippedBy` (the full shape),
 * `maskId` for `maskedBy` (the inset shape), `fullMaskId` for nodes masked by it that trace its outline, and
 * `outlineMaskId` for the outline they trace.
 */
export type RegionForm = { clipId?: string; maskId?: string; fullMaskId?: string; outlineMaskId?: string };

/** The forms of each region in use, by region name. */
export type RegionForms = ReadonlyMap<string, RegionForm>;

/** Region definitions: only those some visible node uses. */
export type DefsPlan = { clips: RegionDef[]; masks: RegionDef[]; forms: RegionForms };

export type RenderGroupLayer = {
  id: string;
  opacity?: number;
  /** The region cuts applied to the whole group, outermost first. */
  wrappers: FillWrapper[];
  blendMode?: CSSProperties["mixBlendMode"];
};

/** What RigLayers paints, in paint order. */
export type PaintItem =
  /** The node's fill, without its masks and clip-paths: an enclosing `wrap` item applies them. */
  | { kind: "fill"; key: string; node: RenderNode }
  /** The node's fill with its own masks and clip-paths, then the mask outlines anchored to it. */
  | { kind: "standalone"; key: string; node: RenderNode; maskOutlines: RenderNode[] }
  /** Traced outlines (`traceOutline`) anchored to the fill painted just before. */
  | { kind: "maskOutlines"; key: string; nodes: RenderNode[] }
  /** Items sharing one mask or clip-path, applied once around all of them. */
  | { kind: "wrap"; key: string; wrapper: FillWrapper; items: PaintItem[] }
  /** A `setRenderGroup` group, composited as one layer. */
  | { kind: "renderGroup"; key: string; group: RenderGroupLayer; items: PaintItem[] };

export type LayerPlan = {
  defs: DefsPlan;
  /** Nodes that get an outer outline (RigLayers `outerOutline`), in paint order; all of them paint before the fills. */
  outerOutlines: RenderNode[];
  items: PaintItem[];
};

export type PlanLayersOptions = {
  /** Every render node, sorted by z-index: regions are drawn from these. */
  nodes: RenderNode[];
  /** The nodes to paint (see resolveVisibleNodes). */
  visibleNodes: RenderNode[];
  getRenderGroupOptions: GetRenderGroupOptions;
  scopeId: ScopeId;
};

/** A clip-path draws only added shapes, nothing cut out (see ClipPathDefs): no subtracting or `onlyWhereCut` members. */
const clipsCleanly = (region: Region) =>
  region.members.every((node) => {
    const member = membership(node, region.name);
    return node.noSprite || (!member?.subtract && !member?.onlyWhereCut);
  });

const warned = new Set<string>();
const warnOnce = (message: string) => {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(message);
};

/**
 * The definitions each region needs, as its users ask for them: a clip-path for `clippedBy` (and render groups'
 * `clip`), an inset mask for `maskedBy` (and render groups' `mask`), a full mask for masked nodes that trace the
 * region's outline, and the outline mask they trace.
 */
const planDefs = ({ nodes, visibleNodes, getRenderGroupOptions, scopeId }: PlanLayersOptions): DefsPlan => {
  const regions = getRegions(nodes);
  const uses = new Map<string, { clip: boolean; mask: boolean; fullMask: boolean; outline: boolean }>();
  const useOf = (name: string) => {
    let use = uses.get(name);
    if (!use) uses.set(name, (use = { clip: false, mask: false, fullMask: false, outline: false }));
    return use;
  };
  for (const node of visibleNodes) {
    for (const group of renderGroupPath(node.renderGroup)) {
      const options = getRenderGroupOptions(group.id);
      if (options?.mask && regions.has(options.mask)) useOf(options.mask).mask = true;
      if (options?.clip && regions.has(options.clip)) useOf(options.clip).clip = true;
    }
    if (node.noSprite) continue;
    for (const { region, mode } of fillCutRefs(node)) {
      // A node tracing the outline covers it with its fill first, so a mask takes the full shape, outlines and all.
      if (mode === "clip") useOf(region).clip = true;
      else useOf(region)[node.traceOutline ? "fullMask" : "mask"] = true;
    }
    if (node.traceOutline) for (const name of outlineCuts(node)) useOf(name).outline = true;
  }
  // A member adding only where it's cut is cut, inside its region's definition, by its own cuts.
  for (const region of regions.values()) {
    for (const node of region.members) {
      if (!membership(node, region.name)?.onlyWhereCut) continue;
      for (const { region: name, mode } of fillCutRefs(node)) {
        if (name === region.name || !regions.has(name)) continue;
        if (mode === "clip") useOf(name).clip = true;
        else useOf(name).fullMask = true;
      }
    }
  }

  const clips: RegionDef[] = [];
  const masks: RegionDef[] = [];
  const forms = new Map<string, RegionForm>();
  const define = (list: RegionDef[], region: Region, shape: RegionShape) => {
    const id = scopeId(`${region.name}_region${shape === "full" ? "" : `_${shape}`}`);
    if (!list.some((existing) => existing.id === id)) list.push({ key: id, id, region: region.name, shape, nodes: region.members });
    return id;
  };

  for (const [name, use] of uses) {
    const region = regions.get(name);
    if (!region) continue;
    const form: RegionForm = {};
    if (use.clip) {
      if (clipsCleanly(region)) {
        form.clipId = define(clips, region, "full");
      } else {
        // Drawn right rather than wrong: a full mask, the clip's shape with what the clip-path can't draw.
        warnOnce(`paper-svg: region "${name}" subtracts or has onlyWhereCut members, which a clip-path can't draw; it is masked instead. Use maskedBy.`);
        use.fullMask = true;
      }
    }
    // Without a stroked member, there's no outline to cut out: the inset shape is the full shape.
    const stroked = region.members.some((node) => !node.noSprite && isStroked(node));
    if (use.mask) form.maskId = define(masks, region, stroked ? "inset" : "full");
    if (use.fullMask) form.fullMaskId = define(masks, region, "full");
    if (use.outline) form.outlineMaskId = define(masks, region, "outline");
    forms.set(name, form);
  }

  return { clips, masks, forms };
};

/**
 * Where each mask outline paints, by the id of the node it follows: a cut node's mask outline goes after
 * the hoisted outline of its region's owner when that outline paints at or above the node, so the owner's
 * outline can't cover it; otherwise it goes after the node's own fill.
 */
const anchorMaskOutlines = (nodes: RenderNode[]): Map<string, RenderNode[]> => {
  const ownerById = new Map(nodes.filter((node) => !isOutlineNode(node)).map((node) => [node.id, node] as const));
  const ownerIdsByRegion = hoistingOwners(nodes);
  const outlineByOwnerId = new Map<string, RenderNode>();
  for (const node of nodes) if (node.outlineOf !== undefined) outlineByOwnerId.set(node.outlineOf, node);

  // The highest owner at or below the node, or failing that the highest owner.
  const findOwner = (node: RenderNode) => {
    let best: RenderNode | undefined;
    let highest: RenderNode | undefined;
    for (const name of fillCuts(node)) {
      for (const ownerId of ownerIdsByRegion.get(name) ?? []) {
        const owner = ownerById.get(ownerId);
        if (!owner) continue;
        if (owner.zIndex <= node.zIndex && owner.zIndex > (best?.zIndex ?? -Infinity)) best = owner;
        if (owner.zIndex > (highest?.zIndex ?? -Infinity)) highest = owner;
      }
    }
    return best ?? highest;
  };

  const byAnchorId = new Map<string, RenderNode[]>();
  for (const node of nodes) {
    // An outline node copies its owner's traceOutline, but the owner traces the outline already.
    if (!node.traceOutline || !isCut(node) || isOutlineNode(node)) continue;
    const owner = findOwner(node);
    const ownerOutline = owner && outlineByOwnerId.get(owner.id);
    const anchorId = ownerOutline && ownerOutline.zIndex >= node.zIndex ? ownerOutline.id : node.id;
    pushTo(byAnchorId, anchorId, node);
  }
  return byAnchorId;
};

type SequenceItem =
  | { kind: "fill"; node: RenderNode; wrappers: FillWrapper[] }
  /** Draws nothing that a wrapper changes, so it can sit inside any wrapper. */
  | { kind: "free"; item: PaintItem }
  /** Must not be wrapped with the fills around it. */
  | { kind: "barrier"; item: PaintItem };

/** The wrapper applying a region to a render group: its clip-path (`clip`), or its inset mask (`mask`). */
const groupWrapper = (form: RegionForm | undefined, mode: "clip" | "mask"): FillWrapper | undefined => {
  if (mode === "clip") {
    if (form?.clipId) return `clip:${form.clipId}`;
    if (form?.fullMaskId) return `mask:${form.fullMaskId}`;
    return undefined;
  }
  return form?.maskId ? `mask:${form.maskId}` : undefined;
};

const planPaint = (
  nodes: RenderNode[],
  getRenderGroupOptions: GetRenderGroupOptions,
  forms: RegionForms,
): { items: PaintItem[]; outerOutlines: RenderNode[] } => {
  const maskOutlinesByAnchorId = anchorMaskOutlines(nodes);
  const outerOutlines: RenderNode[] = [];

  /** Groups runs of fills that share a wrapper, so each mask or clip-path is applied once per run. */
  const planSequence = (sequence: RenderNode[], groupWrappers: FillWrapper[]): PaintItem[] => {
    const list: SequenceItem[] = [];
    for (const node of sequence) {
      const maskOutlines = maskOutlinesByAnchorId.get(node.id);
      if (node.blendMode || node.noSprite) {
        outerOutlines.push(node);
        const item: PaintItem = { kind: "standalone", key: `stack_${node.id}`, node, maskOutlines: maskOutlines ?? [] };
        // A blend mode must composite on its own; an empty node only matters for the outlines it carries.
        list.push({ kind: node.blendMode || maskOutlines ? "barrier" : "free", item });
        continue;
      }
      const wrappers = listFillWrappers(getFillWrapTargets(node, false, forms)).filter((w) => !groupWrappers.includes(w));
      list.push({ kind: "fill", node, wrappers });
      if (maskOutlines) {
        list.push({ kind: "barrier", item: { kind: "maskOutlines", key: `masks_${node.id}`, nodes: maskOutlines } });
      }
    }

    const hasWrapper = (entry: SequenceItem, wrapper: FillWrapper) =>
      entry.kind === "free" || (entry.kind === "fill" && entry.wrappers.includes(wrapper));

    const group = (entries: SequenceItem[]): PaintItem[] => {
      const out: PaintItem[] = [];
      let i = 0;
      while (i < entries.length) {
        const entry = entries[i];
        if (entry.kind !== "fill") {
          out.push(entry.item);
          i += 1;
          continue;
        }
        if (!entry.wrappers.length) {
          outerOutlines.push(entry.node);
          out.push({ kind: "fill", key: `fill_${entry.node.id}`, node: entry.node });
          i += 1;
          continue;
        }
        // The wrapper shared by the longest run starting here; runs don't end on a free item.
        let best = entry.wrappers[0];
        let bestEnd = i + 1;
        for (const wrapper of entry.wrappers) {
          let end = i + 1;
          while (end < entries.length && hasWrapper(entries[end], wrapper)) end += 1;
          if (end > bestEnd) {
            best = wrapper;
            bestEnd = end;
          }
        }
        while (entries[bestEnd - 1].kind === "free") bestEnd -= 1;
        const inner = entries
          .slice(i, bestEnd)
          .map((e): SequenceItem => (e.kind === "fill" ? { ...e, wrappers: e.wrappers.filter((w) => w !== best) } : e));
        out.push({ kind: "wrap", key: `wrap_${best}_${entry.node.id}`, wrapper: best, items: group(inner) });
        i = bestEnd;
      }
      return out;
    };

    return group(list);
  };

  const pathOf = new Map(nodes.map((node) => [node, renderGroupPath(node.renderGroup)] as const));

  // Plans `sequence` at nesting `depth`: a render group at that depth paints as one block where its last member
  // would; its members are planned the same way one level down. `outerWrappers` are the enclosing groups' cuts,
  // which the members don't apply again.
  const planGroups = (sequence: RenderNode[], depth: number, outerWrappers: FillWrapper[]): PaintItem[] => {
    const groupAt = (node: RenderNode) => pathOf.get(node)![depth] as RenderGroup | undefined;
    const lastIndexByGroupId = new Map<string, number>();
    const membersByGroupId = new Map<string, RenderNode[]>();
    sequence.forEach((node, index) => {
      const group = groupAt(node);
      if (!group) return;
      lastIndexByGroupId.set(group.id, index);
      pushTo(membersByGroupId, group.id, node);
    });

    const items: PaintItem[] = [];
    let pending: RenderNode[] = [];
    const flush = () => {
      items.push(...planSequence(pending, outerWrappers));
      pending = [];
    };
    sequence.forEach((node, index) => {
      const group = groupAt(node);
      if (!group) {
        pending.push(node);
        return;
      }
      const id = group.id;
      if (lastIndexByGroupId.get(id) !== index) return;
      flush();
      const options = getRenderGroupOptions(id);
      // A render group's `mask` cuts it by the region's inset mask, its `clip` by its clip-path.
      const groupWrappers = [
        options?.mask ? groupWrapper(forms.get(options.mask), "mask") : undefined,
        options?.clip ? groupWrapper(forms.get(options.clip), "clip") : undefined,
      ].filter((wrapper): wrapper is FillWrapper => wrapper !== undefined && !outerWrappers.includes(wrapper));
      items.push({
        kind: "renderGroup",
        key: `render_group_${id}`,
        group: {
          id,
          opacity: options?.opacity === undefined ? undefined : Math.max(0, Math.min(1, options.opacity)),
          wrappers: groupWrappers,
          blendMode: options?.blendMode ?? "normal",
        },
        items: planGroups(membersByGroupId.get(id)!, depth + 1, [...outerWrappers, ...groupWrappers]),
      });
    });
    flush();
    return items;
  };

  return { items: planGroups(nodes, 0, []), outerOutlines };
};

/** Plans the defs and paint order for `visibleNodes` (see LayerPlan). */
export const planLayers = (options: PlanLayersOptions): LayerPlan => {
  const defs = planDefs(options);
  return { defs, ...planPaint(options.visibleNodes, options.getRenderGroupOptions, defs.forms) };
};
