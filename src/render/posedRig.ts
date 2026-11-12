/**
 * Rendering a pose without rebuilding: the parts of rendering that depend only on a tree's structure
 * (its render nodes, which of them are drawn, the layer plan built from those) are made once per tree,
 * at rest. A pose then patches each node's placement, the only fields a pose can change, and keeps a
 * node's identity when its placement didn't change, so memoized groups skip it.
 *
 * Posed nodes keep `parent`, `jointParent` and `linkedOutline` pointing at the rest-pose nodes: those
 * links identify related nodes (ids, `articulated`, stroke width), they are not read for placement.
 */
import type { Node } from "../types/Node";
import type { Pose } from "../types/Pose";
import type { MatrixTransform } from "../types/Transform";
import type { Vector2 } from "../types/primitives";
import { createRig, solvePose, type PoseSolution, type Rig } from "./pose";
import { buildRenderTreeFromPose, flattenRenderTree, type RenderNode } from "./RenderTree";
import { resolveVisibleNodes } from "./layerPlan";
import { createNodeInterner } from "./stableNodes";

export type RigLayout = {
  readonly rig: Rig;
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

/**
 * Builds a tree's layout. `intern` (see createNodeInterner) keeps nodes that didn't change since the
 * previous layout identical; pass one per list and keep them across rebuilds.
 */
export const createRigLayout = (
  body: Node,
  intern: { nodes: (nodes: RenderNode[]) => RenderNode[]; visible: (nodes: RenderNode[]) => RenderNode[] } = {
    nodes: createNodeInterner(),
    visible: createNodeInterner(),
  },
): RigLayout => {
  const rig = createRig(body);
  const nodes = intern.nodes(flattenRenderTree(buildRenderTreeFromPose(rig, solvePose(rig))).sort(byZIndex));
  return { rig, nodes, visibleNodes: intern.visible(resolveVisibleNodes(nodes)) };
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

/** The fields of a render node a pose can change. */
type Placement = Pick<RenderNode, "matrix" | "parentMatrix" | "translateScale" | "patternSpace" | "hidden"> & {
  gradientTransform?: string;
  dynamicPath?: string;
};

/** Where `solution` places `node`, as a fresh walk of the posed tree would place it. */
const placementOf = (node: RenderNode, index: number, solution: PoseSolution): Placement => ({
  matrix: solution.matrices[index],
  parentMatrix: solution.parentMatrices[index],
  translateScale: solution.translateScales[index],
  // Only nodes with a pattern take a pattern space; outlines copy their owner's.
  patternSpace: node.patternSpace === undefined ? undefined : solution.patternSpaces[index],
  hidden: solution.hidden[index] || undefined,
  // Set only where the pose computes one; otherwise the sprite keeps its own.
  gradientTransform: solution.gradientTransforms[index] ?? node.sprite.gradientTransform,
  dynamicPath: solution.dynamicPaths[index] ?? node.sprite.dynamicPath,
});

const isPlacedAt = (node: RenderNode, at: Placement) =>
  sameMatrix(node.matrix, at.matrix) &&
  sameMatrix(node.parentMatrix, at.parentMatrix) &&
  sameVector(node.translateScale, at.translateScale) &&
  sameMatrix(node.patternSpace, at.patternSpace) &&
  node.hidden === at.hidden &&
  node.sprite.gradientTransform === at.gradientTransform &&
  node.sprite.dynamicPath === at.dynamicPath;

const place = (node: RenderNode, { gradientTransform, dynamicPath, ...at }: Placement): RenderNode => ({
  ...node,
  ...at,
  sprite:
    gradientTransform === node.sprite.gradientTransform && dynamicPath === node.sprite.dynamicPath
      ? node.sprite
      : { ...node.sprite, gradientTransform, dynamicPath },
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
      const at = placementOf(node, index, solution);
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

/** Poses a layout once, without keeping identities between calls. */
export const poseRigLayout = (layout: RigLayout, pose?: Pose): PosedRig =>
  createRigPoser()(layout, solvePose(layout.rig, pose));
