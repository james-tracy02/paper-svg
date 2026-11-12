import type { Vector2 } from "../types/primitives";
import type { CSSProperties } from "react";
import type { Node } from "../types/Node";
import type { Sprite } from "../types/Sprite";
import type { MatrixTransform } from "../types/Transform";
import { roundTo } from "../util/roundTo";
import { getSpriteSignature } from "./utils/getSpriteSignature";
import type { RenderGroup } from "../types/RenderGroup";
import { createOutlineNode } from "./outline";
import { createRig, solvePose, type Pose, type PoseSolution, type Rig } from "./pose";

export type RenderNode = {
  id: string;
  zIndex: number;
  sprite: Sprite;
  matrix: MatrixTransform;
  parentMatrix: MatrixTransform;
  /** Parent scale applied to this node's translate (see makeTransform). */
  translateScale?: Vector2;

  articulated?: boolean;
  draggable?: boolean;
  noSprite?: boolean;
  /** Hidden by a driver for this pose: keeps its place in the layer plan but draws nothing. */
  hidden?: boolean;
  parent?: RenderNode;
  /** For articulated nodes: the nearest articulated ancestor, whose rotation carries this one along. */
  jointParent?: RenderNode;
  mask?: Sprite;
  clip?: Sprite;
  maskedBy?: string[];
  outlineMaskedBy?: string[];
  maskGroups?: string[];
  maskGroupModes?: Record<string, "positive" | "negative">;
  maskOutsets?: Record<string, number>;
  clippedBy?: string[];
  outlineClippedBy?: string[];
  clippingGroups?: string[];
  clipOutsets?: Record<string, number>;
  /** This node's separate outline node, when its stroke is drawn as one (see `outlineOf`). */
  linkedOutline?: RenderNode;
  /** On an outline node: the id of the node whose stroke it draws. */
  outlineOf?: string;
  pattern?: Sprite;
  patternFills?: Record<number, Sprite>;
  /** Frame of the nearest `patternSpace` node (self included), scale removed; the pattern tiles in it. */
  patternSpace?: MatrixTransform;
  pointerEvents?: boolean;
  pointerEventsTarget?: string;
  renderGroupTag?: string;
  renderGroup?: RenderGroup;
  blendMode?: CSSProperties["mixBlendMode"];
  maskOutline?: boolean;
  disableOutlineHoisting?: boolean;
  clipMaskContribution?: boolean;
  opacity?: number;

  // debug
  debugColor?: string;
};

export type RenderTree = {
  node: RenderNode;
  outline?: RenderNode;
  joints: RenderTree[];
  attachments: RenderTree[];
};

export type GroupBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Outline padding added on each side; the geometry itself starts this far inside. */
  inset?: { x: number; y: number };
};

export type MeasureGroupBoundsOptions = {
  nodes: RenderNode[];
  outlineWidth: number;
  resolveOutlineMode: (node: RenderNode) => string;
  getBBox: (node: RenderNode) => GroupBounds | null;
};

type RenderOptions = {
  articulated: boolean;
  draggable: boolean;
  zIndex: number;
  parent?: RenderNode;
  opacity?: number;
  parentMaskedBy?: string[];
  parentClippedBy?: string[];
  parentMaskGroups?: string[];
  parentClippingGroups?: string[];
  parentMaskGroupModes?: Record<string, "positive" | "negative">;
};

/** The solved pose, and the rig entry the walk is at: the walk visits nodes in rig entry order. */
type WalkContext = { solution: PoseSolution; next: number };

const DEFAULT_OPTIONS: RenderOptions = { articulated: true, draggable: false, zIndex: 0 };

const buildTree = (parts: Node[] | undefined, opts: Partial<RenderOptions>, ctx: WalkContext) =>
  (parts ?? []).map((p) => buildRenderTreeNode(p, opts, ctx));

export const buildMaskSignature = (node: Node | undefined): string => {
  if (!node) {
    return "";
  }
  const maskSig = node.mask ? getSpriteSignature(node.mask) : "none";
  const jointsSig = (node.joints ?? []).map((child) => buildMaskSignature(child)).join("|");
  const attachmentsSig = (node.attachments ?? []).map((child) => buildMaskSignature(child)).join("|");
  return `${node.id}:${maskSig}[${jointsSig}](${attachmentsSig})`;
};

const resolveZIndex = (body: Node, parentZIndex: number): number => {
  return body.zIndexMode === "absolute" ? (body.zIndex ?? 0) : parentZIndex + (body.zIndex ?? 0);
};

const createRenderNode = (
  body: Node,
  index: number,
  solution: PoseSolution,
  opts: RenderOptions,
  zIndex: number,
): RenderNode => {
  const mergedMaskedBy = [...(body.maskedBy ?? []), ...(body.parentMaskedBy ?? []), ...(opts.parentMaskedBy ?? [])];
  const mergedClippedBy = [...(body.clippedBy ?? []), ...(opts.parentClippedBy ?? [])];
  const mergedMaskGroups = [...(body.maskGroups ?? []), ...(opts.parentMaskGroups ?? [])];
  const mergedClippingGroups = [...(body.clippingGroups ?? []), ...(opts.parentClippingGroups ?? [])];
  const mergedMaskGroupModes =
    opts.parentMaskGroupModes || body.maskGroupModes
      ? { ...(opts.parentMaskGroupModes ?? {}), ...(body.maskGroupModes ?? {}) }
      : undefined;
  const resolvedRenderGroup = body.renderGroup;

  const node: RenderNode = {
    id: body.id,
    zIndex,
    sprite: { ...body.sprite },
    matrix: solution.matrices[index],
    parentMatrix: solution.parentMatrices[index],
    translateScale: solution.translateScales[index],
    articulated: body.articulated ?? opts.articulated,
    draggable: opts.draggable,
    noSprite: body.noSprite,
    hidden: solution.hidden[index] || undefined,
    mask: body.mask,
    clip: body.clip,
    maskedBy: mergedMaskedBy,
    outlineMaskedBy: body.outlineMaskedBy,
    maskGroups: mergedMaskGroups.length ? mergedMaskGroups : undefined,
    maskGroupModes: mergedMaskGroupModes,
    clippedBy: mergedClippedBy,
    outlineClippedBy: body.outlineClippedBy,
    clippingGroups: mergedClippingGroups.length ? mergedClippingGroups : undefined,
    clipOutsets: body.clipOutsets,
    maskOutsets: body.maskOutsets,
    pattern: body.sprite.pattern,
    patternFills: body.sprite.patternFills,
    patternSpace: body.sprite.pattern ? solution.patternSpaces[index] : undefined,
    renderGroupTag: body.renderGroupTag,
    renderGroup: resolvedRenderGroup,
    blendMode: body.blendMode,
    maskOutline: body.maskOutline,
    disableOutlineHoisting: body.disableOutlineHoisting,
    clipMaskContribution: body.clipMaskContribution,
    opacity: body.opacity ?? opts.opacity,
    pointerEvents: body.pointerEvents,
    pointerEventsTarget: body.pointerEventsTarget,
    debugColor: body.debugColor,
  };
  node.parent = node.articulated ? node : opts.parent;
  if (node.articulated) node.jointParent = opts.parent;
  return node;
};

const buildRenderTreeNode = (body: Node, renderOpts: Partial<RenderOptions>, ctx: WalkContext): RenderTree => {
  const index = ctx.next;
  ctx.next += 1;
  const opts: RenderOptions = { ...DEFAULT_OPTIONS, ...renderOpts };

  // `stopInheritedMasking`/`stopInheritedGroups` break the inheritance chain at this node:
  // whatever was being passed down from an ancestor is discarded here, so neither this
  // node nor its descendants receive it (descendants stop receiving it because the break
  // happens before we compute what gets passed further down).
  const effectiveParentMaskedBy = body.stopInheritedMasking ? undefined : opts.parentMaskedBy;
  const effectiveParentClippedBy = body.stopInheritedMasking ? undefined : opts.parentClippedBy;
  const effectiveParentMaskGroups = body.stopInheritedGroups ? undefined : opts.parentMaskGroups;
  const effectiveParentClippingGroups = body.stopInheritedGroups ? undefined : opts.parentClippingGroups;
  const effectiveParentMaskGroupModes = body.stopInheritedGroups ? undefined : opts.parentMaskGroupModes;

  // When `inheritMaskingForChildren` is set, this node's own maskedBy/clippedBy values are
  // folded into what gets passed down to every descendant joint/attachment, on top of
  // whatever was already being inherited from further up the tree.
  const inheritedMaskedBy = body.inheritMaskingForChildren ? (body.maskedBy ?? []) : [];
  const inheritedClippedBy = body.inheritMaskingForChildren ? (body.clippedBy ?? []) : [];
  const childParentMaskedBy = [...(effectiveParentMaskedBy ?? []), ...(body.parentMaskedBy ?? []), ...inheritedMaskedBy];
  const childParentClippedBy = [...(effectiveParentClippedBy ?? []), ...inheritedClippedBy];
  const nextParentMaskedBy = childParentMaskedBy.length ? childParentMaskedBy : undefined;
  const nextParentClippedBy = childParentClippedBy.length ? childParentClippedBy : undefined;

  // When `inheritGroupsForChildren` is set, this node's own maskGroups/clippingGroups
  // (and their maskGroupModes) are folded into what gets passed down to every descendant
  // joint/attachment, on top of whatever was already being inherited from further up the
  // tree — making every descendant also contribute to those same mask/clip groups.
  const inheritedMaskGroups = body.inheritGroupsForChildren ? (body.maskGroups ?? []) : [];
  const inheritedClippingGroups = body.inheritGroupsForChildren ? (body.clippingGroups ?? []) : [];
  const inheritedMaskGroupModes = body.inheritGroupsForChildren ? body.maskGroupModes : undefined;
  const childParentMaskGroups = [...(effectiveParentMaskGroups ?? []), ...inheritedMaskGroups];
  const childParentClippingGroups = [
    ...(effectiveParentClippingGroups ?? []),
    ...inheritedClippingGroups,
  ];
  const childParentMaskGroupModes =
    effectiveParentMaskGroupModes || inheritedMaskGroupModes
      ? { ...(effectiveParentMaskGroupModes ?? {}), ...(inheritedMaskGroupModes ?? {}) }
      : undefined;
  const nextParentMaskGroups = childParentMaskGroups.length ? childParentMaskGroups : undefined;
  const nextParentClippingGroups = childParentClippingGroups.length
    ? childParentClippingGroups
    : undefined;

  const zIndex = resolveZIndex(body, opts.zIndex);
  const currentNode = createRenderNode(
    body,
    index,
    ctx.solution,
    {
      ...opts,
      parentMaskedBy: effectiveParentMaskedBy,
      parentClippedBy: effectiveParentClippedBy,
      parentMaskGroups: effectiveParentMaskGroups,
      parentClippingGroups: effectiveParentClippingGroups,
      parentMaskGroupModes: effectiveParentMaskGroupModes,
    },
    zIndex,
  );
  const gradientTransform = ctx.solution.gradientTransforms[index];
  if (gradientTransform) currentNode.sprite.gradientTransform = gradientTransform;
  const dynamicPath = ctx.solution.dynamicPaths[index];
  if (dynamicPath) currentNode.sprite.dynamicPath = dynamicPath;

  const joints = buildTree(body.joints, {
    zIndex: zIndex, // parent zIndex as base
    parent: currentNode.articulated ? currentNode : opts.parent,
    opacity: currentNode.opacity, // pass opacity down to joints
    parentMaskedBy: nextParentMaskedBy,
    parentClippedBy: nextParentClippedBy,
    parentMaskGroups: nextParentMaskGroups,
    parentClippingGroups: nextParentClippingGroups,
    parentMaskGroupModes: childParentMaskGroupModes,
  }, ctx);

  const attachments = buildTree(body.attachments, {
    zIndex: zIndex, // parent zIndex as base
    articulated: false, // attachments don't have joints
    draggable: true, // attachments can be dragged
    parent: currentNode.articulated ? currentNode : opts.parent,
    opacity: currentNode.opacity, // pass opacity down to attachments
    parentMaskedBy: nextParentMaskedBy,
    parentClippedBy: nextParentClippedBy,
    parentMaskGroups: nextParentMaskGroups,
    parentClippingGroups: nextParentClippingGroups,
    parentMaskGroupModes: childParentMaskGroupModes,
  }, ctx);

  const outline = body.outlineZIndex === undefined ? undefined : createOutlineNode(currentNode, body.outlineZIndex);

  return {
    node: currentNode,
    joints,
    attachments,
    outline,
  };
};

/** The render tree for a solved pose of `rig`: structure from the rig's nodes, transforms from the pose. */
export const buildRenderTreeFromPose = (rig: Rig, solution: PoseSolution): RenderTree =>
  buildRenderTreeNode(rig.entries[0].node, {}, { solution, next: 0 });

export const buildRenderTree = (body: Node, pose?: Pose): RenderTree => {
  const rig = createRig(body);
  return buildRenderTreeFromPose(rig, solvePose(rig, pose));
};

export const flattenRenderTree = (node: RenderTree): RenderNode[] => {
  const result: RenderNode[] = [];
  const stack: RenderTree[] = [node];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    result.push(current.node);
    if (current.outline) {
      result.push(current.outline);
    }

    for (let i = current.attachments.length - 1; i >= 0; i -= 1) {
      stack.push(current.attachments[i]);
    }
    for (let i = current.joints.length - 1; i >= 0; i -= 1) {
      stack.push(current.joints[i]);
    }
  }

  return result;
};

export const getRenderNodes = (body: Node, pose?: Pose) => flattenRenderTree(buildRenderTree(body, pose));

export const measureGroupBounds = ({
  nodes,
  outlineWidth,
  resolveOutlineMode,
  getBBox,
}: MeasureGroupBoundsOptions): Record<string, GroupBounds> => {
  const detailsStrokeWidth = roundTo(outlineWidth * 0.67, 2);
  const strokeWidthByMode: Record<string, number> = {
    fine: detailsStrokeWidth,
    regular: outlineWidth,
    super_fine: detailsStrokeWidth * 0.5,
    none: 0,
  };
  const nextBounds: Record<string, GroupBounds> = {};
  nodes.forEach((node) => {
    const bbox = getBBox(node);
    if (!bbox || !Number.isFinite(bbox.width) || !Number.isFinite(bbox.height)) return;
    const outlineMode = resolveOutlineMode(node) ?? "regular";
    const strokeWidth = strokeWidthByMode[outlineMode] ?? outlineWidth;
    // Outlines are non-scaling strokes, so divide by the node's world axis lengths to keep
    // the padding constant on screen whatever the node's scale or matrix.
    const { a, b, c, d } = node.matrix.matrix;
    const safeScaleX = Math.hypot(a, b) || 1;
    const safeScaleY = Math.hypot(c, d) || 1;
    const halfStrokeX = Number.isFinite(strokeWidth) ? strokeWidth / 4 / safeScaleX : 0;
    const halfStrokeY = Number.isFinite(strokeWidth) ? strokeWidth / 4 / safeScaleY : 0;
    nextBounds[node.id] = {
      x: bbox.x - halfStrokeX,
      y: bbox.y - halfStrokeY,
      width: bbox.width + halfStrokeX * 2,
      height: bbox.height + halfStrokeY * 2,
      inset: { x: halfStrokeX, y: halfStrokeY },
    };
  });
  return nextBounds;
};
