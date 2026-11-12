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

type ScopeId = (suffix: string) => string;
type GetRenderGroupOptions = (id: string) => RenderGroupOptions | undefined;

export type MaskGroup = { id: string; groups: RenderNode[] };

/** `paintedAsMask`: a mask group member, drawn whole as a mask paints it (any fill, every path). */
export type ClipGroupMember = { node: RenderNode; outset?: number; paintedAsMask?: boolean };
export type ClipGroup = { id: string; groups: ClipGroupMember[] };

/** Soft-mask groups by name, with the nodes that draw into each (`addMaskGroup`). */
export const getMaskGroups = (nodes: RenderNode[]): Map<string, MaskGroup> => {
  const map = new Map<string, MaskGroup>();
  for (const node of nodes) {
    for (const name of node.maskGroups ?? []) {
      if (!map.has(name)) map.set(name, { id: name, groups: [] });
      map.get(name)!.groups.push(node);
    }
  }
  return map;
};

/** Hard-clip groups by name, with the nodes that draw into each and their outsets (`addClippingGroup`). */
export const getClippingGroups = (nodes: RenderNode[]): Map<string, ClipGroup> => {
  const map = new Map<string, ClipGroup>();
  for (const node of nodes) {
    for (const name of node.clippingGroups ?? []) {
      if (!map.has(name)) map.set(name, { id: name, groups: [] });
      map.get(name)!.groups.push({ node, outset: node.clipOutsets?.[name] });
    }
  }
  return map;
};

/** A node made to draw another node's stroke (see createOutlineNode). */
const isOutlineNode = (node: RenderNode) => node.outlineOf !== undefined;

const pushTo = <K, V>(map: Map<K, V[]>, key: K, value: V) => {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
};

/**
 * The nodes RigLayers paints, sorted by z-index: every node whose mask and clip groups all exist
 * (a node restricted to a group nobody defines is not drawn), plus an outline hoisted above the
 * dependents of each stroked clip-group owner. Returns copies; `nodes` is not modified.
 */
export const resolveVisibleNodes = (nodes: RenderNode[]): RenderNode[] => {
  const maskGroups = getMaskGroups(nodes);
  const clipGroups = getClippingGroups(nodes);
  const visible = nodes
    .filter(
      (node) =>
        (node.maskedBy ?? []).every((name) => maskGroups.has(name)) &&
        (node.clippedBy ?? []).every((name) => clipGroups.has(name)),
    )
    .map((node) => ({ ...node, sprite: { ...node.sprite } }));

  const nodeById = new Map(visible.map((node) => [node.id, node] as const));
  const ownerIdsByClipName = new Map<string, string[]>();
  const dependentsByClipName = new Map<string, RenderNode[]>();
  for (const node of visible) {
    if (!isOutlineNode(node)) node.clippingGroups?.forEach((name) => pushTo(ownerIdsByClipName, name, node.id));
    node.clippedBy?.forEach((name) => pushTo(dependentsByClipName, name, node));
  }

  // Highest dependent z-index per owner, in the order owners are first reached.
  const maxDependentZByOwnerId = new Map<string, number>();
  for (const [clipName, dependents] of dependentsByClipName) {
    const dependentZ = Math.max(...dependents.map((node) => node.zIndex));
    for (const ownerId of ownerIdsByClipName.get(clipName) ?? []) {
      maxDependentZByOwnerId.set(ownerId, Math.max(maxDependentZByOwnerId.get(ownerId) ?? -Infinity, dependentZ));
    }
  }

  const hoistedOutlines: RenderNode[] = [];
  for (const [ownerId, maxDependentZ] of maxDependentZByOwnerId) {
    const owner = nodeById.get(ownerId);
    if (!owner || owner.linkedOutline || owner.disableOutlineHoisting) continue;
    const { stroke, strokeWidth = 0 } = owner.sprite;
    if (!stroke || stroke === "none" || strokeWidth <= 0) continue;
    // Just above the highest dependent, so the outline draws over everything clipped to the owner.
    hoistedOutlines.push(createOutlineNode(owner, Math.max(maxDependentZ, owner.zIndex) + 0.00000001));
  }

  return [...visible, ...hoistedOutlines].sort((a, b) => a.zIndex - b.zIndex);
};

/** One `<mask>` definition (see SvgMask). */
export type MaskDef = {
  key: string;
  id: string;
  groupName: string;
  nodes: RenderNode[];
  mode: "fill_only" | "outline_only";
  withFill?: boolean;
  withNoOutline?: boolean;
};

/** Mask and clip definitions: only those some visible node uses. */
export type DefsPlan = {
  /**
   * Mask groups that are also drawn as a clip-path (`${name}_group_clippath`, in `clipGroups`), with the ids of
   * the nodes cut by that instead of the mask (see `drawsMaskAsClip`).
   */
  maskClips: ReadonlyMap<string, ReadonlySet<string>>;
  maskFills: MaskDef[];
  maskOutlines: MaskDef[];
  clipOutlines: MaskDef[];
  /** Clip groups by name, and the mask groups in `maskClips` by `${name}_group`. */
  clipGroups: Map<string, ClipGroup>;
};

export type RenderGroupLayer = {
  id: string;
  opacity?: number;
  maskId?: string;
  clipId?: string;
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
  /** Every render node, sorted by z-index: mask and clip groups are drawn from these. */
  nodes: RenderNode[];
  /** The nodes to paint (see resolveVisibleNodes). */
  visibleNodes: RenderNode[];
  getRenderGroupOptions: GetRenderGroupOptions;
  scopeId: ScopeId;
};

const isStroked = (node: RenderNode) => (node.sprite.strokeWidth ?? 0) > 0 && node.sprite.stroke !== "none";

/**
 * Whether a mask group's no-outline mask only cuts hard edges, so a <clipPath> of its members' shapes draws
 * the same. That mask is the members' shapes, white, minus the inner half of each stroked member's outline:
 * so every member must add (not subtract), be opaque and have no outset, mask or clip of its own, and every
 * stroked member must paint its outline above every node the mask cuts, covering the band a clip keeps.
 */
const cutsHardEdges = (name: string, members: RenderNode[], visibleNodes: RenderNode[]) => {
  const users = visibleNodes.filter((node) => node.maskedBy?.includes(name) && !node.noSprite);
  const topUserZ = Math.max(...users.map((node) => node.zIndex));
  const paintedIds = new Set(visibleNodes.map((node) => node.id));
  return members.every((node) => {
    if (node.noSprite) return true;
    const { sprite } = node;
    const plain =
      node.maskGroupModes?.[name] !== "negative" &&
      !node.maskOutsets?.[name] &&
      !node.mask &&
      !node.clipMaskContribution &&
      (sprite.opacity ?? 1) >= 1 &&
      !sprite.blur &&
      !sprite.href &&
      !sprite.customSprite?.image &&
      !sprite.maskScale &&
      sprite.shape !== "line";
    if (!plain || !isStroked(node)) return plain;
    return (
      node.zIndex > topUserZ &&
      paintedIds.has(node.id) &&
      !node.hidden &&
      !node.blendMode &&
      !node.renderGroup &&
      (node.opacity ?? 1) >= 1 &&
      !node.maskedBy?.length &&
      !node.clippedBy?.length
    );
  });
};

/**
 * Whether a node cut by a hard-edged mask group takes it as a clip-path. Not when the node is clipped already
 * (a clip group, its own mask or clip, or a render group's mask or clip): Chromium stops anti-aliasing clip-paths
 * stacked that deep, which turns edges jagged (iris edges inside an eye clip, inside the face clip). Those
 * nodes keep the mask, which draws the inner clip in its own layer.
 */
const drawsMaskAsClip = (node: RenderNode, getRenderGroupOptions: GetRenderGroupOptions) => {
  const renderGroup = node.renderGroup && getRenderGroupOptions(node.renderGroup.id);
  return !node.clippedBy?.length && !node.mask && !node.clip && !renderGroup?.clip && !renderGroup?.mask;
};

const planDefs = ({ nodes, visibleNodes, getRenderGroupOptions, scopeId }: PlanLayersOptions): DefsPlan => {
  const maskGroups = getMaskGroups(nodes);
  const clipGroups = getClippingGroups(nodes);

  // Which variants of each group's mask some visible node references.
  const fill = new Set<string>();
  const noOutline = new Set<string>();
  const outline = new Set<string>();
  const clipOutline = new Set<string>();
  const renderGroupMasks = new Set<string>();
  for (const node of visibleNodes) {
    const renderGroupMask = node.renderGroup && getRenderGroupOptions(node.renderGroup.id)?.mask;
    if (renderGroupMask) renderGroupMasks.add(renderGroupMask);
    if (renderGroupMask) noOutline.add(renderGroupMask);
    if (node.noSprite) continue;
    (node.maskedBy ?? []).forEach((name) => (node.maskOutline ? fill : noOutline).add(name));
    if (!node.maskOutline) continue;
    (node.outlineMaskedBy ?? node.maskedBy ?? []).forEach((name) => outline.add(name));
    (node.outlineClippedBy ?? node.outlineMaskedBy ?? node.clippedBy ?? []).forEach((name) => clipOutline.add(name));
  }

  const clipGroupList = Array.from(clipGroups.values());
  // Only the no-outline variant can be a clip-path (render groups name the mask itself).
  const maskClips = new Map<string, Set<string>>();
  const maskReplaced = new Set<string>();
  for (const group of maskGroups.values()) {
    const hard =
      noOutline.has(group.id) &&
      !fill.has(group.id) &&
      !outline.has(group.id) &&
      !renderGroupMasks.has(group.id) &&
      cutsHardEdges(group.id, group.groups, visibleNodes);
    if (!hard) continue;
    const users = visibleNodes.filter((node) => !node.noSprite && node.maskedBy?.includes(group.id));
    const clipUsers = users.filter((node) => drawsMaskAsClip(node, getRenderGroupOptions));
    if (clipUsers.length) maskClips.set(group.id, new Set(clipUsers.map((node) => node.id)));
    if (clipUsers.length === users.length) maskReplaced.add(group.id);
  }
  const maskGroupList = Array.from(maskGroups.values()).filter((group) => !maskReplaced.has(group.id));
  const allClipGroups = new Map(clipGroups);
  for (const name of maskClips.keys()) {
    const members = maskGroups.get(name)!.groups.map((node) => ({ node, paintedAsMask: true }));
    allClipGroups.set(`${name}_group`, { id: `${name}_group`, groups: members });
  }

  return {
    maskClips,
    maskFills: maskGroupList
      .filter((group) => fill.has(group.id) || noOutline.has(group.id))
      .map((group) => ({
        key: scopeId(`${group.id}_group`),
        id: scopeId(`${group.id}_group`),
        groupName: group.id,
        nodes: group.groups,
        mode: "fill_only",
        withFill: fill.has(group.id),
        withNoOutline: noOutline.has(group.id),
      })),
    maskOutlines: maskGroupList
      .filter((group) => outline.has(group.id))
      .map((group) => ({
        key: scopeId(`${group.id}_group_outline`),
        id: scopeId(`${group.id}_group`),
        groupName: group.id,
        nodes: group.groups,
        mode: "outline_only",
      })),
    clipOutlines: clipGroupList
      .filter((group) => clipOutline.has(group.id))
      .map((group) => ({
        key: scopeId(`${group.id}_clip_mask`),
        id: scopeId(`${group.id}_clip_mask`),
        groupName: group.id,
        nodes: group.groups.map((member) => member.node),
        mode: "outline_only",
      })),
    clipGroups: allClipGroups,
  };
};

/**
 * Where each mask outline paints, by the id of the node it follows: a clipped node's mask outline
 * goes after its clip owner's outline when that outline paints at or above the node, so the owner's
 * outline can't cover it; otherwise it goes after the node's own fill.
 */
const anchorMaskOutlines = (nodes: RenderNode[]): Map<string, RenderNode[]> => {
  const ownerById = new Map(nodes.filter((node) => !isOutlineNode(node)).map((node) => [node.id, node] as const));
  const ownerIdsByClipName = new Map<string, string[]>();
  const outlineByOwnerId = new Map<string, RenderNode>();
  for (const node of nodes) {
    if (node.outlineOf !== undefined) outlineByOwnerId.set(node.outlineOf, node);
    else node.clippingGroups?.forEach((name) => pushTo(ownerIdsByClipName, name, node.id));
  }

  // The highest owner at or below the node, or failing that the highest owner.
  const findOwner = (node: RenderNode) => {
    let best: RenderNode | undefined;
    let highest: RenderNode | undefined;
    for (const clipName of node.clippedBy ?? []) {
      for (const ownerId of ownerIdsByClipName.get(clipName) ?? []) {
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
    const isClipped = Boolean(node.clippedBy?.length);
    if (!node.maskOutline || (!isClipped && !node.maskedBy?.length)) continue;
    const owner = isClipped ? findOwner(node) : undefined;
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

const planPaint = (
  nodes: RenderNode[],
  getRenderGroupOptions: GetRenderGroupOptions,
  scopeId: ScopeId,
  maskClips: ReadonlyMap<string, ReadonlySet<string>>,
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
      const wrappers = listFillWrappers(getFillWrapTargets(node, scopeId, false, maskClips)).filter((w) => !groupWrappers.includes(w));
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
    const maskId = options?.mask ? scopeId(`${options.mask}_group_no_outline`) : undefined;
    const clipId = options?.clip ? scopeId(`${options.clip}_clippath`) : undefined;
    const groupWrappers: FillWrapper[] = [
      ...(maskId ? [`mask:${maskId}` as const] : []),
      ...(clipId ? [`clip:${clipId}` as const] : []),
    ];
    items.push({
      kind: "renderGroup",
      key: `render_group_${id}`,
      group: {
        id,
        opacity: options?.opacity === undefined ? undefined : Math.max(0, Math.min(1, options.opacity)),
        maskId,
        clipId,
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
  return { defs, ...planPaint(options.visibleNodes, options.getRenderGroupOptions, options.scopeId, defs.maskClips) };
};
