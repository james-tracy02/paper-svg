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
import { resolveRegions, type RegionCut, type RegionMember } from "./regions";
import type { RegionJoin } from "../types/Node";

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
  /** Regions this node's shape joins (see regions.ts). */
  regions?: RegionMember[];
  /** Regions cutting this node's fill or the outline it traces. */
  cuts?: RegionCut[];
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
  /** Draws this node's outline as its own layer, tracing the outlines of the regions it's cut by (`traceOutline`). */
  traceOutline?: boolean;
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
  /** Region joins and cuts passed down by ancestors (`joinsForChildren`, `cutsForChildren`). */
  parentJoins?: RegionJoin[];
  parentCuts?: string[];
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
  const maskSig = node.paint?.mask ? getSpriteSignature(node.paint.mask) : "none";
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
  const { regions, cuts, traceOutline } = resolveRegions(body, {
    joins: [...(body.regions?.joins ?? []), ...(opts.parentJoins ?? [])],
    cuts: [...(body.regions?.cuts ?? []), ...(opts.parentCuts ?? [])],
  });
  const paint = body.paint ?? {};

  const node: RenderNode = {
    id: body.id,
    zIndex,
    sprite: solution.customSprites[index] ? { ...body.sprite, customSprite: solution.customSprites[index] } : { ...body.sprite },
    matrix: solution.matrices[index],
    parentMatrix: solution.parentMatrices[index],
    translateScale: solution.translateScales[index],
    articulated: body.interaction?.articulated ?? opts.articulated,
    draggable: opts.draggable,
    noSprite: paint.noSprite,
    hidden: solution.hidden[index] || undefined,
    mask: solution.masks[index] === undefined ? paint.mask : (solution.masks[index] ?? undefined),
    regions,
    cuts,
    pattern: body.sprite.pattern,
    patternFills: body.sprite.patternFills,
    patternSpace: body.sprite.pattern ? solution.patternSpaces[index] : undefined,
    renderGroupTag: paint.renderGroupTag,
    renderGroup: paint.renderGroup,
    blendMode: paint.blendMode,
    traceOutline,
    opacity: paint.opacity ?? opts.opacity,
    pointerEvents: body.interaction?.pointerEvents,
    pointerEventsTarget: body.interaction?.target,
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

  // `stopInheritedRegions`/`stopInheritedCuts` break the inheritance chain at this node: what was passed down is
  // dropped here, for this node and, since it isn't passed on, its descendants.
  const regionOptions = body.regions ?? {};
  const parentJoins = regionOptions.stopInheritedRegions ? undefined : opts.parentJoins;
  const parentCuts = regionOptions.stopInheritedCuts ? undefined : opts.parentCuts;
  // `regionsForChildren`/`cutsForChildren` add this node's own joins and cuts to what its descendants receive.
  // An outset belongs to the node that set it, so a passed-down join drops it.
  const childJoins = [
    ...(parentJoins ?? []),
    ...(regionOptions.regionsForChildren ? (regionOptions.joins ?? []).map(({ outset: _, ...join }) => join) : []),
  ];
  const childCuts = [...(parentCuts ?? []), ...(regionOptions.cutsForChildren ? (regionOptions.cuts ?? []) : [])];
  const nextParentJoins = childJoins.length ? childJoins : undefined;
  const nextParentCuts = childCuts.length ? childCuts : undefined;

  const zIndex = resolveZIndex(body, opts.zIndex) + ctx.solution.zOffsets[index];
  const currentNode = createRenderNode(
    body,
    index,
    ctx.solution,
    {
      ...opts,
      parentJoins,
      parentCuts,
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
    parentJoins: nextParentJoins,
    parentCuts: nextParentCuts,
  }, ctx);

  const attachments = buildTree(body.attachments, {
    zIndex: zIndex, // parent zIndex as base
    articulated: false, // attachments don't have joints
    draggable: true, // attachments can be dragged
    parent: currentNode.articulated ? currentNode : opts.parent,
    opacity: currentNode.opacity, // pass opacity down to attachments
    parentJoins: nextParentJoins,
    parentCuts: nextParentCuts,
  }, ctx);

  const outline =
    body.outline?.zIndex === undefined
      ? undefined
      : createOutlineNode(currentNode, body.outline.zIndex + ctx.solution.outlineZOffsets[index]);

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

/** Every render node of `body` in `pose`, in tree order (parents first), without React. */
export const getRenderNodes = (body: Node, pose?: Pose) => {
  const rig = createRig(body);
  return flattenRenderTree(buildRenderTreeFromPose(rig, solvePose(rig, pose)));
};

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
