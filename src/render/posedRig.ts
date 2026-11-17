/**
 * Rendering a pose without rebuilding: the parts of rendering that depend only on a tree's structure
 * (its render nodes, which of them are drawn, the layer plan built from those) are made once per tree,
 * at rest, and again only when drivers change what the layers are planned from: draw order, a driven
 * sprite or driven cuts (`PoseSolution.layoutKey`). A pose then patches
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

export type RigLayout = {
  readonly rig: Rig;
  /** The draw order, driven sprites and driven cuts this layout was made for (see `PoseSolution.layoutKey`). */
  readonly layoutKey: string;
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

const sameFields = (a: object, b: object) => {
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const keys = Object.keys(x);
  if (keys.length !== Object.keys(y).length) return false;
  for (const key of keys) if (x[key] !== y[key]) return false;
  return true;
};

const sameCuts = (a: RenderNode["cuts"], b: RenderNode["cuts"]) =>
  a === b ||
  (!!a &&
    !!b &&
    a.length === b.length &&
    a.every((cut, i) => cut.region === b[i].region && cut.mode === b[i].mode && cut.fill === b[i].fill && cut.outline === b[i].outline));

/**
 * `nodes`, with each one `previous` (a layout of the same rig) has the same reused. For one rig, a node at
 * rest depends only on its entry, its z-index, the sprite a driver draws it with and the cuts drivers add
 * (its own or passed down), so a node alike in those is identical. Sprites are compared field by field:
 * each layout copies them. Links (`parent`, `jointParent`, `linkedOutline`) may point into the
 * previous layout; they are read only for what a layout doesn't change (ids, `articulated`, stroke width).
 */
const reuseUnmoved = (nodes: RenderNode[], previous: readonly RenderNode[] | undefined) => {
  if (!previous) return nodes;
  const before = new Map(previous.map((node) => [node.id, node]));
  return nodes.map((node) => {
    const last = before.get(node.id);
    return last &&
      last.zIndex === node.zIndex &&
      sameCuts(last.cuts, node.cuts) &&
      last.traceOutline === node.traceOutline &&
      sameFields(last.sprite, node.sprite)
      ? last
      : node;
  });
};

/**
 * Lays a rig out at rest, in the draw order of `drawOrder` (a solved pose; default: rest) and with its
 * driven sprites and cuts. Nodes are placed at rest whatever the pose, so a new layout changes only the
 * nodes those change: pass the layout it replaces as `previous`, and every other node keeps its identity.
 */
export const createRigLayout = (rig: Rig, drawOrder?: PoseSolution, previous?: RigLayout): RigLayout => {
  const rest = solvePose(rig);
  const solution = drawOrder
    ? {
        ...rest,
        zOffsets: drawOrder.zOffsets,
        outlineZOffsets: drawOrder.outlineZOffsets,
        sprites: drawOrder.sprites,
        cuts: drawOrder.cuts,
        layoutKey: drawOrder.layoutKey,
      }
    : rest;
  const same = previous?.rig === rig ? previous : undefined;
  const nodes = reuseUnmoved(flattenRenderTree(buildRenderTreeFromPose(rig, solution)).sort(byZIndex), same?.nodes);
  return { rig, layoutKey: solution.layoutKey, nodes, visibleNodes: reuseUnmoved(resolveVisibleNodes(nodes), same?.visibleNodes) };
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
export type Placement = Pick<RenderNode, "matrix" | "parentMatrix" | "translateScale" | "patternSpace" | "hidden" | "mask"> & {
  gradientTransform?: string;
  dynamicPath?: string;
  customSprite?: CustomSprite;
};

/** An entry's mask in `solution`: a driver's, else the node's own. */
const maskOf = (index: number, rig: Rig, solution: PoseSolution) => {
  const driven = solution.masks[index];
  return driven === undefined ? rig.entries[index].node.paint?.mask : (driven ?? undefined);
};

/** Where `solution` places `node`, and its shape, as a fresh walk of the posed tree would make them. */
export const placementOf = (node: RenderNode, index: number, rig: Rig, solution: PoseSolution): Placement => {
  // A pose sets these only where it computes one; otherwise the sprite the node is drawn with has them:
  // its own as built, or a driver's (the layout was made with the same, see layoutKey).
  const own = solution.sprites[index] ?? rig.entries[index].node.sprite;
  return {
    matrix: solution.matrices[index],
    parentMatrix: solution.parentMatrices[index],
    translateScale: solution.translateScales[index],
    // Only nodes with a pattern take a pattern space; outlines copy their owner's.
    patternSpace: node.patternSpace === undefined ? undefined : solution.patternSpaces[index],
    hidden: solution.hidden[index] || undefined,
    mask: maskOf(index, rig, solution),
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
  node.mask === at.mask &&
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
    mask: b.mask,
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
