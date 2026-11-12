/**
 * Decides what RigLayers paints, as plain data: which nodes are drawn, which mask and clip
 * definitions they need, and in what order and under which shared wrappers the nodes paint.
 * No React here, so the rules can be tested directly; RigLayers turns the plan into SVG.
 */
import type { CSSProperties } from "react";
import type { RenderGroupOptions } from "../types/RenderGroup";
import type { RenderNode } from "./RenderTree";
import { getFillWrapTargets, listFillWrappers, type FillWrapper } from "./fillWrappers";
import { createOutlineNode } from "./outline";
import { fillCuts, isCut, memberOf, membership, outlineCuts } from "./regions";

type ScopeId = (suffix: string) => string;
type GetRenderGroupOptions = (id: string) => RenderGroupOptions | undefined;

/** A region and the nodes whose shapes make it, in paint order (a node joining twice is listed twice). */
export type Region = { name: string; members: RenderNode[] };

/** Every region by name, with its members (`addMaskGroup`, `addClippingGroup`). */
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

/** Whether `node` lifts its outline in `region` above the nodes the region cuts, rather than insetting it. */
const hoists = (node: RenderNode, region: string) => !isOutlineNode(node) && !membership(node, region)?.inset;

const pushTo = <K, V>(map: Map<K, V[]>, key: K, value: V) => {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
};

/**
 * The nodes RigLayers paints, sorted by z-index: every node whose regions all exist (a node cut by a region
 * nobody defines is not drawn), plus the hoisted outline of each stroked member that doesn't inset, just above
 * the highest node its regions cut. Returns copies; `nodes` is not modified.
 */
export const resolveVisibleNodes = (nodes: RenderNode[]): RenderNode[] => {
  const regions = getRegions(nodes);
  const visible = nodes
    .filter((node) => fillCuts(node).every((name) => regions.has(name)))
    .map((node) => ({ ...node, sprite: { ...node.sprite } }));

  const nodeById = new Map(visible.map((node) => [node.id, node] as const));
  const ownerIdsByRegion = new Map<string, string[]>();
  const cutByRegion = new Map<string, RenderNode[]>();
  for (const node of visible) {
    for (const name of memberOf(node)) if (hoists(node, name)) pushTo(ownerIdsByRegion, name, node.id);
    for (const name of fillCuts(node)) pushTo(cutByRegion, name, node);
  }

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
 * half of each insetting member's outline cut out), or "outline" (the members' outlines, for traced outlines).
 */
export type RegionShape = "full" | "inset" | "outline";

/** One <clipPath> or <mask> definition of a region's shape. */
export type RegionDef = { key: string; id: string; region: string; shape: RegionShape; nodes: RenderNode[] };

/**
 * How a shape of a region is applied: a clip-path (for `clipUsers` only, when set), else a mask. Render groups
 * take the clip-path when `groupsClip` is set.
 */
export type RegionForm = { clipId?: string; maskId?: string; clipUsers?: ReadonlySet<string>; groupsClip?: boolean };

/** The forms of each region's shapes in use, by region name. */
export type RegionForms = ReadonlyMap<string, { full?: RegionForm; inset?: RegionForm; outlineMaskId?: string }>;

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
  /** Mask outlines (`setMaskOutline`) anchored to the fill painted just before. */
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

/**
 * Whether a node takes a hard-edged region with insetting members as a clip-path. Not when the node is clipped
 * already (another region, its own mask or clip, or a render group's mask or clip): Chromium stops
 * anti-aliasing clip-paths stacked that deep, which turns edges jagged (iris edges inside an eye clip, inside
 * the face clip). Those nodes take the mask, which draws the inner clip in its own layer. Hoisting regions,
 * which drew as clip-paths before regions, keep doing so.
 */
const takesInsetClip = (node: RenderNode, region: string, getRenderGroupOptions: GetRenderGroupOptions) => {
  const renderGroup = node.renderGroup && getRenderGroupOptions(node.renderGroup.id);
  return (
    fillCuts(node).every((name) => name === region) &&
    !node.mask &&
    !node.clip &&
    !renderGroup?.clip &&
    !renderGroup?.mask
  );
};

type ShapeUse = { nodes: RenderNode[]; renderGroups: boolean; contributions: boolean };

const planDefs = ({ nodes, visibleNodes, getRenderGroupOptions, scopeId }: PlanLayersOptions): DefsPlan => {
  const regions = getRegions(nodes);
  const paintedIds = new Set(visibleNodes.map((node) => node.id));

  // Who uses which shape of each region.
  const uses = new Map<string, { full: ShapeUse; inset: ShapeUse; outline: boolean }>();
  const useOf = (name: string) => {
    let use = uses.get(name);
    if (!use) {
      const empty = (): ShapeUse => ({ nodes: [], renderGroups: false, contributions: false });
      use = { full: empty(), inset: empty(), outline: false };
      uses.set(name, use);
    }
    return use;
  };
  for (const node of visibleNodes) {
    const options = node.renderGroup && getRenderGroupOptions(node.renderGroup.id);
    if (options?.mask && regions.has(options.mask)) useOf(options.mask).inset.renderGroups = true;
    if (options?.clip && regions.has(options.clip)) useOf(options.clip).full.renderGroups = true;
    if (node.noSprite) continue;
    for (const name of fillCuts(node)) useOf(name)[node.traceOutline ? "full" : "inset"].nodes.push(node);
    if (node.traceOutline) for (const name of outlineCuts(node)) useOf(name).outline = true;
  }
  // A member adding only where it's cut is cut, inside the region's mask, by the full shapes of its own cuts.
  for (const region of regions.values()) {
    for (const node of region.members) {
      if (!membership(node, region.name)?.onlyWhereCut) continue;
      for (const name of fillCuts(node)) if (name !== region.name && regions.has(name)) useOf(name).full.contributions = true;
    }
  }

  const clips: RegionDef[] = [];
  const masks: RegionDef[] = [];
  const forms = new Map<string, { full?: RegionForm; inset?: RegionForm; outlineMaskId?: string }>();
  const define = (list: RegionDef[], region: Region, shape: RegionShape) => {
    const id = scopeId(`${region.name}_region${shape === "full" ? "" : `_${shape}`}`);
    if (!list.some((existing) => existing.id === id)) list.push({ key: id, id, region: region.name, shape, nodes: region.members });
    return id;
  };

  for (const [name, use] of uses) {
    const region = regions.get(name);
    if (!region) continue;
    const drawn = region.members.filter((node) => !node.noSprite);
    // A clip-path can only add shapes, with nothing cut out of them, and grow only paths (see ClipPathDefs).
    const additive = drawn.every((node) => {
      const member = membership(node, name);
      const growsPath = !member?.outset || Boolean(node.sprite.customSprite || node.sprite.dynamicPath);
      return !member?.subtract && !member?.onlyWhereCut && growsPath;
    });
    const insets = region.members.some((node) => membership(node, name)?.inset);
    const bands = drawn.filter((node) => membership(node, name)?.inset && isStroked(node));

    const form = (shape: "full" | "inset", users: ShapeUse): RegionForm => {
      // The inset shape is hard only if every inset outline paints above every node it cuts, covering the band.
      const topUserZ = Math.max(...users.nodes.map((node) => node.zIndex));
      const covered = bands.every(
        (node) =>
          node.zIndex > topUserZ &&
          paintedIds.has(node.id) &&
          !node.hidden &&
          !node.blendMode &&
          !node.renderGroup &&
          (node.opacity ?? 1) >= 1 &&
          !isCut(node),
      );
      if (!additive || (shape === "inset" && (!covered || users.renderGroups))) {
        return { maskId: define(masks, region, shape) };
      }
      if (!insets) return { clipId: define(clips, region, "full"), groupsClip: true };
      const clipUsers = new Set(
        users.nodes.filter((node) => takesInsetClip(node, name, getRenderGroupOptions)).map((node) => node.id),
      );
      // A render group cut by the full shape takes the clip-path, as it did before regions; by the inset shape, the mask.
      const groupsClip = shape === "full";
      const needsMask = (users.renderGroups && !groupsClip) || clipUsers.size < users.nodes.length;
      return {
        clipId: clipUsers.size || users.contributions || (users.renderGroups && groupsClip) ? define(clips, region, "full") : undefined,
        maskId: needsMask ? define(masks, region, shape) : undefined,
        clipUsers,
        groupsClip,
      };
    };

    // Without an outline to cut out, the inset shape is the full shape.
    const fullUse: ShapeUse = bands.length
      ? use.full
      : {
          nodes: [...use.full.nodes, ...use.inset.nodes],
          renderGroups: use.full.renderGroups || use.inset.renderGroups,
          contributions: use.full.contributions,
        };
    const used = (shapeUse: ShapeUse) => shapeUse.nodes.length > 0 || shapeUse.renderGroups || shapeUse.contributions;
    const full = used(fullUse) ? form("full", fullUse) : undefined;
    const inset = !bands.length ? full : used(use.inset) ? form("inset", use.inset) : undefined;
    forms.set(name, { full, inset, outlineMaskId: use.outline ? define(masks, region, "outline") : undefined });
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
  const ownerIdsByRegion = new Map<string, string[]>();
  const outlineByOwnerId = new Map<string, RenderNode>();
  for (const node of nodes) {
    if (node.outlineOf !== undefined) outlineByOwnerId.set(node.outlineOf, node);
    else for (const name of memberOf(node)) if (hoists(node, name)) pushTo(ownerIdsByRegion, name, node.id);
  }

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
    if (!node.traceOutline || !isCut(node)) continue;
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

/** The wrapper applying a region's shape to a render group: its clip-path when every user takes it, else its mask. */
const groupWrapper = (form: RegionForm | undefined): FillWrapper | undefined => {
  if (form?.clipId && form.groupsClip) return `clip:${form.clipId}`;
  if (form?.maskId) return `mask:${form.maskId}`;
  return undefined;
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

  // A render group paints where its last member would.
  const lastIndexByGroupId = new Map<string, number>();
  const membersByGroupId = new Map<string, RenderNode[]>();
  nodes.forEach((node, index) => {
    if (!node.renderGroup) return;
    lastIndexByGroupId.set(node.renderGroup.id, index);
    pushTo(membersByGroupId, node.renderGroup.id, node);
  });

  const items: PaintItem[] = [];
  let pending: RenderNode[] = [];
  const flush = () => {
    items.push(...planSequence(pending, []));
    pending = [];
  };
  nodes.forEach((node, index) => {
    if (!node.renderGroup) {
      pending.push(node);
      return;
    }
    const id = node.renderGroup.id;
    if (lastIndexByGroupId.get(id) !== index) return;
    flush();
    const options = getRenderGroupOptions(id);
    // A render group's `mask` cuts it by the region's inset shape, its `clip` by the full shape.
    const groupWrappers = [
      groupWrapper(options?.mask ? forms.get(options.mask)?.inset : undefined),
      groupWrapper(options?.clip ? forms.get(options.clip)?.full : undefined),
    ].filter((wrapper): wrapper is FillWrapper => wrapper !== undefined);
    items.push({
      kind: "renderGroup",
      key: `render_group_${id}`,
      group: {
        id,
        opacity: options?.opacity === undefined ? undefined : Math.max(0, Math.min(1, options.opacity)),
        wrappers: groupWrappers,
        blendMode: options?.blendMode ?? "normal",
      },
      items: planSequence(membersByGroupId.get(id)!, groupWrappers),
    });
  });
  flush();

  return { items, outerOutlines };
};

/** Plans the defs and paint order for `visibleNodes` (see LayerPlan). */
export const planLayers = (options: PlanLayersOptions): LayerPlan => {
  const defs = planDefs(options);
  return { defs, ...planPaint(options.visibleNodes, options.getRenderGroupOptions, defs.forms) };
};
