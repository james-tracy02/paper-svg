import type { Vector2 } from "../types/primitives";
import type { CSSProperties } from "react";
import type { Node } from "../types/Node";
import type { Sprite } from "../types/Sprite";
import type { MatrixTransform, Transform } from "../types/Transform";
import { roundTo } from "../util/roundTo";
import { getSpriteSignature } from "./utils/getSpriteSignature";
import {
  applyInverseMatrixToPoint,
  applyMatrixToPoint,
  combineMatrixTransforms,
  matrixToTransform,
  matrixFromScaleRotation,
  invertMatrixTransform,
  matrixTransformToSvg,
  rigidPart,
  spriteUserSpace,
  transformToMatrix,
  transformToMatrixWithMatrix,
} from "./transform";
import type { RenderGroup } from "../types/RenderGroup";
import { getGradientFrame } from "./gradient";

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
  parent?: RenderNode;
  /** For articulated nodes: the nearest articulated ancestor, whose rotation carries this one along. */
  jointParent?: RenderNode;
  mask?: Sprite;
  clip?: Sprite;
  clippedBy?: string[];
  outlineClippedBy?: string[];
  clippingGroups?: string[];
  maskGroupModes?: Record<string, "positive" | "negative">;
  maskOutsets?: Record<string, number>;
  trueClippedBy?: string[];
  outlineTrueClippedBy?: string[];
  trueClippingGroups?: string[];
  trueClipOutsets?: Record<string, number>;
  linkedOutline?: RenderNode;
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
  scaleFactor: Vector2;
  offset: Vector2;
  parent?: RenderNode;
  parentMatrix: MatrixTransform;
  opacity?: number;
  parentMaskedBy?: string[];
  parentClippedBy?: string[];
  parentClippingGroups?: string[];
  parentTrueClippingGroups?: string[];
  parentMaskGroupModes?: Record<string, "positive" | "negative">;
  /** World matrices from the previous build pass, used to resolve `aimAt`/`pinTo` targets. */
  targetMatrices?: Map<string, MatrixTransform>;
  patternSpace?: MatrixTransform;
  /** World frame of the gradient unit square set by the nearest `gradientSpace: "define"` ancestor. */
  gradientSpace?: MatrixTransform;
};

const makeTransform = (body: Node, scaleFactor: Vector2, fidelity: number = 4): Transform => ({
  translate: {
    x: roundTo(scaleFactor.x * body.translate.x, fidelity),
    y: roundTo(scaleFactor.y * body.translate.y, fidelity),
  },
  scale: {
    x: roundTo(body.scale.x, fidelity),
    y: roundTo(body.scale.y, fidelity),
  },
  rotate: roundTo(body.rotate, fidelity),
  skew: body.skew
    ? {
        x: roundTo(body.skew.x, fidelity),
        y: roundTo(body.skew.y, fidelity),
      }
    : undefined,
  matrix: body.matrix
    ? {
        a: roundTo(body.matrix.a, fidelity),
        b: roundTo(body.matrix.b, fidelity),
        c: roundTo(body.matrix.c, fidelity),
        d: roundTo(body.matrix.d, fidelity),
      }
    : undefined,
});

const IDENTITY_MATRIX: MatrixTransform = {
  translate: { x: 0, y: 0 },
  matrix: { a: 1, b: 0, c: 0, d: 1 },
};

const normalizeOpts = (opts: Partial<RenderOptions>): RenderOptions => ({
  articulated: true,
  draggable: false,
  scaleFactor: { x: 1, y: 1 },
  zIndex: 0,
  offset: { x: 0, y: 0 },
  parentMatrix: opts.parentMatrix ?? IDENTITY_MATRIX,
  ...opts,
});

const buildTree = (parts: Node[] | undefined, parentMatrix: MatrixTransform, opts: Partial<RenderOptions>) =>
  (parts ?? []).map((p) => buildRenderTreeNode(p, parentMatrix, opts));

/** Default node-local point that `aimAt` brings to its target: straight down the limb. */
const AIM_FROM: Vector2 = { x: 0, y: -1 };

/** Angle of a model-space vector, in the same degrees/direction as `Transform.rotate`. */
const angleOf = (v: Vector2) => Math.atan2(-v.y, v.x) * (180 / Math.PI);

/**
 * Joint position (parent space) that puts this node's joint on `pinTo.point` in the target
 * node's local space. Returns undefined when the target isn't in the tree.
 */
const resolvePinTranslate = (
  pin: NonNullable<Node["pinTo"]>,
  parentMatrix: MatrixTransform,
  targetMatrices: Map<string, MatrixTransform>,
): Vector2 | undefined => {
  const targetMatrix = targetMatrices.get(pin.targetId);
  if (!targetMatrix) return undefined;
  const world = applyMatrixToPoint(targetMatrix, pin.point ?? { x: 0, y: 0 });
  return applyInverseMatrixToPoint(parentMatrix, world) ?? undefined;
};

/**
 * Rotation (degrees, local) that brings `aimAt.from` (this node's local space) as close as
 * rotation alone allows to `aimAt.point` (the target node's local space) — i.e. onto the ray
 * from this node's joint toward that point — plus `reach`, the distance to the target over
 * the distance to `from`. Returns undefined when the target isn't in the tree, or when either
 * point sits on the joint itself and no rotation can help.
 */
const resolveAimRotation = (
  aim: NonNullable<Node["aimAt"]>,
  myTransform: Transform,
  parentMatrix: MatrixTransform,
  targetMatrices: Map<string, MatrixTransform>,
): { rotation: number; reach: number } | undefined => {
  const targetMatrix = targetMatrices.get(aim.targetId);
  if (!targetMatrix) return undefined;

  // Target point in world space, then in this node's parent space, then relative to the joint.
  const world = applyMatrixToPoint(targetMatrix, aim.point);
  const inParent = applyInverseMatrixToPoint(parentMatrix, world);
  if (!inParent) return undefined;
  const toTarget = { x: inParent.x - myTransform.translate.x, y: inParent.y - myTransform.translate.y };
  if (!toTarget.x && !toTarget.y) return undefined;

  // Where `from` ends up after this node's own scale/skew (which are applied after rotation),
  // so mirrored and skewed nodes aim correctly.
  const unrotated = transformToMatrix({ ...myTransform, rotate: 0, translate: { x: 0, y: 0 } });
  const from = applyMatrixToPoint(unrotated, aim.from ?? AIM_FROM);
  if (!from.x && !from.y) return undefined;

  return {
    rotation: roundTo(angleOf(toTarget) - angleOf(from), 4),
    reach: Math.hypot(toTarget.x, toTarget.y) / Math.hypot(from.x, from.y),
  };
};

/**
 * Path (sprite space, y down) for an `aimAt.arrive` line: a quad from the joint to `aim.from`
 * whose end heads along `arrive.along` in the target's space. Worked out in world space so the
 * node's stretch doesn't skew the bend, then brought back into the node's local space.
 */
const resolveArrivePath = (
  aim: NonNullable<Node["aimAt"]>,
  worldMatrix: MatrixTransform,
  targetMatrices: Map<string, MatrixTransform>,
): string | undefined => {
  const targetMatrix = targetMatrices.get(aim.targetId);
  if (!targetMatrix || !aim.arrive) return undefined;
  const from = aim.from ?? AIM_FROM;
  const start = applyMatrixToPoint(worldMatrix, { x: 0, y: 0 });
  const end = applyMatrixToPoint(worldMatrix, from);
  const alongBase = applyMatrixToPoint(targetMatrix, aim.point);
  const alongTip = applyMatrixToPoint(targetMatrix, { x: aim.point.x + aim.arrive.along.x, y: aim.point.y + aim.arrive.along.y });
  const along = { x: alongTip.x - alongBase.x, y: alongTip.y - alongBase.y };
  const alongLength = Math.hypot(along.x, along.y);
  if (!alongLength) return undefined;
  const back = (aim.arrive.bend * Math.hypot(end.x - start.x, end.y - start.y)) / alongLength;
  const control = applyInverseMatrixToPoint(worldMatrix, { x: end.x - along.x * back, y: end.y - along.y * back });
  if (!control) return undefined;
  const r = (n: number) => roundTo(n, 4);
  return `M 0 0 Q ${r(control.x)} ${r(-control.y)} ${r(from.x)} ${r(-from.y)}`;
};

const resolveNodeTransform = (
  body: Node,
  parentMatrix: MatrixTransform,
  scaleFactor: Vector2,
  targetMatrices?: Map<string, MatrixTransform>,
): Transform => {
  const myTransform = makeTransform(body, scaleFactor);

  // Adjust for fixed rotation
  if (body.fixedRotation?.enabled) {
    const parentRotation = matrixToTransform(parentMatrix).rotate;
    const maxCorrection =
      body.fixedRotation.max === undefined ? Math.abs(parentRotation) : Math.abs(body.fixedRotation.max);
    const correction = Math.max(-maxCorrection, Math.min(maxCorrection, parentRotation));
    myTransform.rotate = roundTo(body.rotate - correction, 4);
  }

  // Adjust for fixed scale: cancel out the parent's accumulated scale so this
  // node's world-space scale matches its own configured scale, regardless of
  // ancestor scaling.
  if (body.fixedScale) {
    const parentScale = matrixToTransform(parentMatrix).scale;
    myTransform.scale = {
      x: parentScale.x ? myTransform.scale.x / parentScale.x : myTransform.scale.x,
      y: parentScale.y ? myTransform.scale.y / parentScale.y : myTransform.scale.y,
    };
  }

  // Pin the joint onto a point on another node. The node's own translate stays as an additive
  // offset. Resolved before the aim, which measures direction from this joint.
  if (body.pinTo && targetMatrices) {
    const pinned = resolvePinTranslate(body.pinTo, parentMatrix, targetMatrices);
    if (pinned) {
      myTransform.translate = {
        x: roundTo(pinned.x + myTransform.translate.x, 4),
        y: roundTo(pinned.y + myTransform.translate.y, 4),
      };
    }
  }

  // Aim at a point on another node. The node's own rotation stays as an additive offset.
  if (body.aimAt && targetMatrices) {
    const aim = resolveAimRotation(body.aimAt, myTransform, parentMatrix, targetMatrices);
    if (aim !== undefined) {
      myTransform.rotate = roundTo(myTransform.rotate + aim.rotation, 4);
      if (body.aimAt.stretch) {
        myTransform.scale = { ...myTransform.scale, y: roundTo(myTransform.scale.y * aim.reach, 4) };
      }
    }
  }

  return myTransform;
};

export const buildMaskSignature = (node: Node | undefined): string => {
  if (!node) {
    return "";
  }
  const maskSig = node.mask ? getSpriteSignature(node.mask) : "none";
  const jointsSig = (node.joints ?? []).map((child) => buildMaskSignature(child)).join("|");
  const attachmentsSig = (node.attachments ?? []).map((child) => buildMaskSignature(child)).join("|");
  return `${node.id}:${maskSig}[${jointsSig}](${attachmentsSig})`;
};

const buildOutlineNode = (body: Node, currentNode: RenderNode, zIndex: number): RenderNode | undefined => {
  if (body.outlineZIndex === undefined) {
    return undefined;
  }

  const outlineIndices = currentNode.sprite.outlineIndices;
  const hasOutlineIndices = Array.isArray(outlineIndices) && outlineIndices.length > 0;

  const outline: RenderNode = {
    ...currentNode,
    id: body.id + "_outline",
    zIndex: body.outlineZIndex,
    sprite: {
      ...currentNode.sprite,
      fill: "none",
      fillGradient: undefined,
      colors: {},
      strokeWidth: body.sprite.strokeWidth ? body.sprite.strokeWidth * (body.outlineZIndex < zIndex ? 2 : 1) : 0,
      stroke: body.sprite.stroke,
      outlineIndices: hasOutlineIndices ? outlineIndices : undefined,
      outlineExcludeIndices: undefined,
    },
    articulated: false,
    mask: currentNode.mask
      ? { ...currentNode.mask, scale: { x: currentNode.mask.scale.x * 0.999, y: currentNode.mask.scale.y * 0.999 } }
      : undefined,
  };

  currentNode.linkedOutline = outline; // link to parent for later reference
  if (hasOutlineIndices) {
    currentNode.sprite.outlineExcludeIndices = outlineIndices;
    currentNode.sprite.outlineIndices = undefined;
  } else {
    currentNode.sprite.strokeWidth = 0; // stroke is handled by dynamic outline
  }
  return outline;
};

/**
 * Frame for a `patternSpace` node: its world frame without scale, turned by `rotation`, origin moved by `offset`.
 * Under an ancestor's pattern space the frame continues that grid instead: its origin maps to the same pattern
 * coordinate in both spaces, so the two stay in phase there whatever the pattern's scale, rotation or offset.
 */
const resolvePatternSpace = (
  space: NonNullable<Node["patternSpace"]>,
  worldMatrix: MatrixTransform,
  parentSpace: MatrixTransform | undefined,
): MatrixTransform => {
  const frame = combineMatrixTransforms(rigidPart(worldMatrix), {
    translate: space.offset,
    matrix: matrixFromScaleRotation({ x: 1, y: 1 }, space.rotation),
  });
  if (!parentSpace) return frame;
  const shared = applyInverseMatrixToPoint(parentSpace, frame.translate);
  if (!shared) return frame;
  const turned = applyMatrixToPoint({ translate: { x: 0, y: 0 }, matrix: frame.matrix }, shared);
  return {
    translate: { x: frame.translate.x - turned.x, y: frame.translate.y - turned.y },
    matrix: frame.matrix,
  };
};

const resolveZIndex = (body: Node, parentZIndex: number): number => {
  return body.zIndexMode === "absolute" ? (body.zIndex ?? 0) : parentZIndex + (body.zIndex ?? 0);
};

const createRenderNode = (
  body: Node,
  matrix: MatrixTransform,
  parentMatrix: MatrixTransform,
  opts: RenderOptions,
  zIndex: number,
): RenderNode => {
  const mergedClippedBy = [...(body.clippedBy ?? []), ...(body.parentMaskedBy ?? []), ...(opts.parentMaskedBy ?? [])];
  const mergedTrueClippedBy = [...(body.trueClippedBy ?? []), ...(opts.parentClippedBy ?? [])];
  const mergedClippingGroups = [...(body.clippingGroups ?? []), ...(opts.parentClippingGroups ?? [])];
  const mergedTrueClippingGroups = [...(body.trueClippingGroups ?? []), ...(opts.parentTrueClippingGroups ?? [])];
  const mergedMaskGroupModes =
    opts.parentMaskGroupModes || body.maskGroupModes
      ? { ...(opts.parentMaskGroupModes ?? {}), ...(body.maskGroupModes ?? {}) }
      : undefined;
  const resolvedRenderGroup = body.renderGroup;

  const node: RenderNode = {
    id: body.id,
    zIndex,
    sprite: { ...body.sprite },
    matrix,
    parentMatrix,
    translateScale: opts.scaleFactor,
    articulated: body.articulated ?? opts.articulated,
    draggable: opts.draggable,
    noSprite: body.noSprite,
    mask: body.mask,
    clip: body.clip,
    clippedBy: mergedClippedBy,
    outlineClippedBy: body.outlineClippedBy,
    clippingGroups: mergedClippingGroups.length ? mergedClippingGroups : undefined,
    maskGroupModes: mergedMaskGroupModes,
    trueClippedBy: mergedTrueClippedBy,
    outlineTrueClippedBy: body.outlineTrueClippedBy,
    trueClippingGroups: mergedTrueClippingGroups.length ? mergedTrueClippingGroups : undefined,
    trueClipOutsets: body.trueClipOutsets,
    maskOutsets: body.maskOutsets,
    pattern: body.sprite.pattern,
    patternFills: body.sprite.patternFills,
    patternSpace: body.sprite.pattern ? opts.patternSpace : undefined,
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

const buildRenderTreeNode = (
  body: Node,
  parentMatrix: MatrixTransform = IDENTITY_MATRIX,
  renderOpts: Partial<RenderOptions> = {},
): RenderTree => {
  const opts = normalizeOpts({ ...renderOpts, parentMatrix: renderOpts.parentMatrix ?? parentMatrix });

  // `stopInheritedMasking`/`stopInheritedGroups` break the inheritance chain at this node:
  // whatever was being passed down from an ancestor is discarded here, so neither this
  // node nor its descendants receive it (descendants stop receiving it because the break
  // happens before we compute what gets passed further down).
  const effectiveParentMaskedBy = body.stopInheritedMasking ? undefined : opts.parentMaskedBy;
  const effectiveParentClippedBy = body.stopInheritedMasking ? undefined : opts.parentClippedBy;
  const effectiveParentClippingGroups = body.stopInheritedGroups ? undefined : opts.parentClippingGroups;
  const effectiveParentTrueClippingGroups = body.stopInheritedGroups ? undefined : opts.parentTrueClippingGroups;
  const effectiveParentMaskGroupModes = body.stopInheritedGroups ? undefined : opts.parentMaskGroupModes;

  // When `inheritMaskingForChildren` is set, this node's own maskedBy/clippedBy values are
  // folded into what gets passed down to every descendant joint/attachment, on top of
  // whatever was already being inherited from further up the tree.
  const inheritedMaskedBy = body.inheritMaskingForChildren ? (body.clippedBy ?? []) : [];
  const inheritedTrueClippedBy = body.inheritMaskingForChildren ? (body.trueClippedBy ?? []) : [];
  const childParentMaskedBy = [...(effectiveParentMaskedBy ?? []), ...(body.parentMaskedBy ?? []), ...inheritedMaskedBy];
  const childParentClippedBy = [...(effectiveParentClippedBy ?? []), ...inheritedTrueClippedBy];
  const nextParentMaskedBy = childParentMaskedBy.length ? childParentMaskedBy : undefined;
  const nextParentClippedBy = childParentClippedBy.length ? childParentClippedBy : undefined;

  // When `inheritGroupsForChildren` is set, this node's own clippingGroups/trueClippingGroups
  // (and their maskGroupModes) are folded into what gets passed down to every descendant
  // joint/attachment, on top of whatever was already being inherited from further up the
  // tree — making every descendant also contribute to those same mask/clip groups.
  const inheritedClippingGroups = body.inheritGroupsForChildren ? (body.clippingGroups ?? []) : [];
  const inheritedTrueClippingGroups = body.inheritGroupsForChildren ? (body.trueClippingGroups ?? []) : [];
  const inheritedMaskGroupModes = body.inheritGroupsForChildren ? body.maskGroupModes : undefined;
  const childParentClippingGroups = [...(effectiveParentClippingGroups ?? []), ...inheritedClippingGroups];
  const childParentTrueClippingGroups = [
    ...(effectiveParentTrueClippingGroups ?? []),
    ...inheritedTrueClippingGroups,
  ];
  const childParentMaskGroupModes =
    effectiveParentMaskGroupModes || inheritedMaskGroupModes
      ? { ...(effectiveParentMaskGroupModes ?? {}), ...(inheritedMaskGroupModes ?? {}) }
      : undefined;
  const nextParentClippingGroups = childParentClippingGroups.length ? childParentClippingGroups : undefined;
  const nextParentTrueClippingGroups = childParentTrueClippingGroups.length
    ? childParentTrueClippingGroups
    : undefined;

  const myTransform = resolveNodeTransform(body, parentMatrix, opts.scaleFactor, opts.targetMatrices);
  const zIndex = resolveZIndex(body, opts.zIndex);
  const localMatrix = transformToMatrixWithMatrix(myTransform);
  const worldMatrix = combineMatrixTransforms(parentMatrix, localMatrix);
  const patternSpace = body.patternSpace
    ? resolvePatternSpace(body.patternSpace, worldMatrix, opts.patternSpace)
    : opts.patternSpace;
  const gradientSpace =
    body.gradientSpace === "define"
      ? combineMatrixTransforms(spriteUserSpace(worldMatrix, body.sprite), getGradientFrame(body.sprite))
      : opts.gradientSpace;
  const currentNode = createRenderNode(
    body,
    worldMatrix,
    parentMatrix,
    {
      ...opts,
      parentMaskedBy: effectiveParentMaskedBy,
      parentClippedBy: effectiveParentClippedBy,
      parentClippingGroups: effectiveParentClippingGroups,
      parentTrueClippingGroups: effectiveParentTrueClippingGroups,
      parentMaskGroupModes: effectiveParentMaskGroupModes,
      patternSpace,
    },
    zIndex,
  );
  if (body.gradientSpace === "inherit" && opts.gradientSpace) {
    const inverse = invertMatrixTransform(spriteUserSpace(worldMatrix, currentNode.sprite));
    if (inverse) {
      currentNode.sprite.gradientTransform = matrixTransformToSvg(combineMatrixTransforms(inverse, opts.gradientSpace), 6);
    }
  }
  if (body.aimAt?.arrive && opts.targetMatrices) {
    const path = resolveArrivePath(body.aimAt, worldMatrix, opts.targetMatrices);
    if (path) currentNode.sprite.dynamicPath = path;
  }

  // build transforms
  const unscaledTransform = { ...myTransform, scale: { x: 1, y: 1 } };
  const unscaledMatrix = transformToMatrixWithMatrix(unscaledTransform);
  const unscaledChildMatrix = combineMatrixTransforms(parentMatrix, unscaledMatrix);
  const scaledChildMatrix = worldMatrix;

  const joints = buildTree(body.joints, unscaledChildMatrix, {
    scaleFactor: body.scale, // body parts translate based on parent scales
    zIndex: zIndex, // parent zIndex as base
    parent: currentNode.articulated ? currentNode : opts.parent,
    parentMatrix: unscaledChildMatrix,
    opacity: currentNode.opacity, // pass opacity down to joints
    parentMaskedBy: nextParentMaskedBy,
    parentClippedBy: nextParentClippedBy,
    parentClippingGroups: nextParentClippingGroups,
    parentTrueClippingGroups: nextParentTrueClippingGroups,
    parentMaskGroupModes: childParentMaskGroupModes,
    targetMatrices: opts.targetMatrices,
    patternSpace,
    gradientSpace,
  });

  const attachments = buildTree(body.attachments, scaledChildMatrix, {
    zIndex: zIndex, // parent zIndex as base
    articulated: false, // attachments don't have joints
    draggable: true, // attachments can be dragged
    parent: currentNode.articulated ? currentNode : opts.parent,
    parentMatrix: scaledChildMatrix,
    opacity: currentNode.opacity, // pass opacity down to attachments
    parentMaskedBy: nextParentMaskedBy,
    parentClippedBy: nextParentClippedBy,
    parentClippingGroups: nextParentClippingGroups,
    parentTrueClippingGroups: nextParentTrueClippingGroups,
    parentMaskGroupModes: childParentMaskGroupModes,
    targetMatrices: opts.targetMatrices,
    patternSpace,
    gradientSpace,
  });

  const outline = buildOutlineNode(body, currentNode, zIndex);

  return {
    node: currentNode,
    joints,
    attachments,
    outline,
  };
};

const hasTargetConstraint = (body: Node): boolean =>
  Boolean(body.aimAt || body.pinTo) ||
  (body.joints ?? []).some(hasTargetConstraint) ||
  (body.attachments ?? []).some(hasTargetConstraint);

export const buildRenderTree = (body: Node): RenderTree => {
  const tree = buildRenderTreeNode(body, IDENTITY_MATRIX, { parentMatrix: IDENTITY_MATRIX });
  if (!hasTargetConstraint(body)) {
    return tree;
  }

  // `aimAt`/`pinTo` targets can live anywhere in the tree, so resolve them against the world
  // matrices of a first pass and rebuild.
  // ponytail: single extra pass — a node aiming at its own descendant lags one pass behind.
  const targetMatrices = new Map<string, MatrixTransform>();
  flattenRenderTree(tree).forEach((node) => targetMatrices.set(node.id, node.matrix));
  return buildRenderTreeNode(body, IDENTITY_MATRIX, { parentMatrix: IDENTITY_MATRIX, targetMatrices });
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

export const getRenderNodes = (body: Node) => flattenRenderTree(buildRenderTree(body));

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
