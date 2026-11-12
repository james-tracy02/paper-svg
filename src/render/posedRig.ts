/**
 * Rendering a pose without rebuilding: the parts of rendering that depend only on a tree's structure
 * (its render nodes, which of them are drawn, the layer plan built from those) are made once per tree,
 * at rest, and again only when drivers change the draw order (`PoseSolution.zKey`). A pose then patches
 * each node's placement and shape, the only other fields a pose can change, and keeps a node's
 * identity when those didn't change, so memoized groups skip it.
 *
 * Posed nodes keep `parent`, `jointParent` and `linkedOutline` pointing at the rest-pose nodes: those
 * links identify related nodes (ids, `articulated`, stroke width), they are not read for placement.
 */
import type { Node } from "../types/Node";
import type { Pose } from "../types/Pose";
import type { MatrixTransform } from "../types/Transform";
import type { CustomSprite } from "../types/Sprite";
import type { Vector2 } from "../types/primitives";
import { createRig, solvePose, type PoseSolution, type Rig } from "./pose";
import { buildRenderTreeFromPose, flattenRenderTree, type RenderNode } from "./RenderTree";
import { resolveVisibleNodes } from "./layerPlan";
import { createNodeInterner } from "./stableNodes";

export type RigLayout = {
  readonly rig: Rig;
  /** The draw order this layout was made for (see `PoseSolution.zKey`). */
  readonly zKey: string;
  /** Render nodes at rest, sorted by z-index. */
  readonly nodes: RenderNode[];
  /** What RigLayers paints at rest (see `resolveVisibleNodes`). */
  readonly visibleNodes: RenderNode[];
};

/** Rest-pose nodes and the posed node standing in for each, for one pose. */
export type PosedRig = {
  readonly layout: RigLayout;
  /** Posed nodes, sorted by z-index, in the same order as `layout.nodes`. */
  readonly nodes: RenderNode[];
  /** Posed `layout.visibleNodes`. */
  readonly visibleNodes: RenderNode[];
  /** The posed node standing in for a node of the layout; any other node is returned as is. */
  readonly current: (node: RenderNode) => RenderNode;
};

const byZIndex = (a: RenderNode, b: RenderNode) => a.zIndex - b.zIndex;

export type LayoutInterners = {
  nodes: (nodes: RenderNode[]) => RenderNode[];
  visible: (nodes: RenderNode[]) => RenderNode[];
};

/**
 * Lays a rig out at rest, in the draw order of `drawOrder` (a solved pose; default: rest). Nodes are
 * placed at rest whatever the pose, so a new draw order leaves every node it doesn't reorder as it
 * was, and `intern` (see createNodeInterner; keep one per list across rebuilds) keeps those identical.
 */
export const createRigLayout = (
  rig: Rig,
  drawOrder?: PoseSolution,
  intern: LayoutInterners = { nodes: createNodeInterner(), visible: createNodeInterner() },
): RigLayout => {
  const rest = solvePose(rig);
  const solution = drawOrder
    ? { ...rest, zOffsets: drawOrder.zOffsets, outlineZOffsets: drawOrder.outlineZOffsets, zKey: drawOrder.zKey }
    : rest;
  const nodes = intern.nodes(flattenRenderTree(buildRenderTreeFromPose(rig, solution)).sort(byZIndex));
  return { rig, zKey: solution.zKey, nodes, visibleNodes: intern.visible(resolveVisibleNodes(nodes)) };
};

const sameVector = (a: Vector2 | undefined, b: Vector2 | undefined) => a === b || (!!a && !!b && a.x === b.x && a.y === b.y);
const sameMatrix = (a: MatrixTransform | undefined, b: MatrixTransform | undefined) =>
  a === b ||
  (!!a &&
    !!b &&
    sameVector(a.translate, b.translate) &&
    a.matrix.a === b.matrix.a &&
    a.matrix.b === b.matrix.b &&
    a.matrix.c === b.matrix.c &&
    a.matrix.d === b.matrix.d);

/** The fields of a render node a pose can change, besides its z-index (see `createRigLayout`). */
export type Placement = Pick<RenderNode, "matrix" | "parentMatrix" | "translateScale" | "patternSpace" | "hidden"> & {
  gradientTransform?: string;
  dynamicPath?: string;
  customSprite?: CustomSprite;
};

/** Where `solution` places `node`, and its shape, as a fresh walk of the posed tree would make them. */
export const placementOf = (node: RenderNode, index: number, rig: Rig, solution: PoseSolution): Placement => {
  // A pose sets these only where it computes one; otherwise the node's own sprite (as built) has them.
  const own = rig.entries[index].node.sprite;
  return {
    matrix: solution.matrices[index],
    parentMatrix: solution.parentMatrices[index],
    translateScale: solution.translateScales[index],
    // Only nodes with a pattern take a pattern space; outlines copy their owner's.
    patternSpace: node.patternSpace === undefined ? undefined : solution.patternSpaces[index],
    hidden: solution.hidden[index] || undefined,
    gradientTransform: solution.gradientTransforms[index] ?? own.gradientTransform,
    dynamicPath: solution.dynamicPaths[index] ?? own.dynamicPath,
    customSprite: solution.customSprites[index] ?? own.customSprite,
  };
};

export const isPlacedAt = (node: RenderNode, at: Placement) =>
  sameMatrix(node.matrix, at.matrix) &&
  sameMatrix(node.parentMatrix, at.parentMatrix) &&
  sameVector(node.translateScale, at.translateScale) &&
  sameMatrix(node.patternSpace, at.patternSpace) &&
  node.hidden === at.hidden &&
  node.sprite.gradientTransform === at.gradientTransform &&
  node.sprite.dynamicPath === at.dynamicPath &&
  node.sprite.customSprite === at.customSprite;

/** Whether two versions of one render node (say, in two poses) are placed and shaped alike. */
export const samePlacement = (a: RenderNode, b: RenderNode) =>
  a === b ||
  isPlacedAt(a, {
    matrix: b.matrix,
    parentMatrix: b.parentMatrix,
    translateScale: b.translateScale,
    patternSpace: b.patternSpace,
    hidden: b.hidden,
    gradientTransform: b.sprite.gradientTransform,
    dynamicPath: b.sprite.dynamicPath,
    customSprite: b.sprite.customSprite,
  });

const place = (node: RenderNode, { gradientTransform, dynamicPath, customSprite, ...at }: Placement): RenderNode => ({
  ...node,
  ...at,
  sprite:
    gradientTransform === node.sprite.gradientTransform &&
    dynamicPath === node.sprite.dynamicPath &&
    customSprite === node.sprite.customSprite
      ? node.sprite
      : { ...node.sprite, gradientTransform, dynamicPath, customSprite },
});

/**
 * Returns a function that poses layouts. A posed node is the rest node itself where the pose leaves it
 * in place, else the previous call's posed node where that one is placed the same, else a new node:
 * identities hold across poses and across layouts whose rest nodes were interned.
 */
export const createRigPoser = () => {
  let previous = new Map<RenderNode, RenderNode>();

  return (layout: RigLayout, solution: PoseSolution): PosedRig => {
    const next = new Map<RenderNode, RenderNode>();
    const poseNode = (node: RenderNode) => {
      const index = layout.rig.indexById.get(node.outlineOf ?? node.id);
      if (index === undefined) throw new Error(`No rig entry for render node "${node.id}"`);
      const at = placementOf(node, index, layout.rig, solution);
      const last = previous.get(node);
      const posed = isPlacedAt(node, at) ? node : last && isPlacedAt(last, at) ? last : place(node, at);
      next.set(node, posed);
      return posed;
    };
    const nodes = layout.nodes.map(poseNode);
    const visibleNodes = layout.visibleNodes.map(poseNode);
    previous = next;
    return { layout, nodes, visibleNodes, current: (node) => next.get(node) ?? node };
  };
};

/** Lays out and poses a tree once, without keeping identities between calls. */
export const poseTree = (body: Node, pose?: Pose): PosedRig => {
  const rig = createRig(body);
  const solution = solvePose(rig, pose);
  return createRigPoser()(createRigLayout(rig, solution), solution);
};
