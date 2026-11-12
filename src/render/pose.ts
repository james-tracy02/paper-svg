/**
 * A rig is a node tree flattened once; a pose is joint values applied on top of it. Solving a pose
 * computes every node's world matrix in one pass, without rebuilding the tree: a pose change costs
 * matrix maths only. The per-node maths is RenderTree's own (`resolveNodeTransform`), so a solved
 * pose matches `getRenderNodes` on the same tree with the same rotations.
 */
import type { Node } from "../types/Node";
import type { Vector2 } from "../types/primitives";
import type { MatrixTransform } from "../types/Transform";
import { IDENTITY_MATRIX, resolveNodeTransform, type TargetMatrices } from "./RenderTree";
import { combineMatrixTransforms, transformToMatrixWithMatrix } from "./transform";

/** Joint values by node id, on top of the rig's own. `rotate` (degrees) adds to the node's rotation. */
export type Pose = Record<string, { rotate?: number }>;

export type RigEntry = {
  node: Node;
  /** Index of the parent entry; -1 for the root. */
  parent: number;
  /** How the node hangs from its parent: joints move with the parent's scale, attachments are also sized by it. */
  via: "root" | "joint" | "attachment";
};

export type Rig = {
  /** Every node, parents before children (joints before attachments, as `getRenderNodes` lists them). */
  readonly entries: readonly RigEntry[];
  /** Entry index by node id. A node's outline id (`<id>_outline`) maps to the node, which it shares a matrix with. */
  readonly indexById: ReadonlyMap<string, number>;
};

export type PoseSolution = {
  /** World matrix per rig entry, in `rig.entries` order. */
  matrices: MatrixTransform[];
  /** The matrix each entry hangs from: its parent's world matrix, or for a joint the parent's without its scale. */
  parentMatrices: MatrixTransform[];
  /** Parent scale applied to each entry's position (see RenderNode.translateScale). */
  translateScales: Vector2[];
};

const UNIT_SCALE: Vector2 = { x: 1, y: 1 };

/** Flattens `root` into a rig. Build it once per structure; pose it with `solvePose`. */
export const createRig = (root: Node): Rig => {
  const entries: RigEntry[] = [];
  const indexById = new Map<string, number>();
  const add = (node: Node, parent: number, via: RigEntry["via"]) => {
    const index = entries.push({ node, parent, via }) - 1;
    indexById.set(node.id, index);
    if (node.outlineZIndex !== undefined) indexById.set(`${node.id}_outline`, index);
    node.joints?.forEach((child) => add(child, index, "joint"));
    node.attachments?.forEach((child) => add(child, index, "attachment"));
  };
  add(root, -1, "root");
  return { entries, indexById };
};

const hasConstraint = (node: Node) => Boolean(node.aimAt || node.pinTo);

/** Thrown when a constraint's target can't be solved first: it depends on the constrained node itself. */
const CYCLE = Symbol("cycle");

/**
 * World matrices for `rig` in `pose`. Each `aimAt`/`pinTo` target is solved before the node that
 * uses it, so constraints see the target where it ends up. A target that depends on its own
 * constrained node (inside its subtree, or a cycle) can't come first; it is read from a solve
 * without constraints instead, as `getRenderNodes` reads every target.
 */
export const solvePose = (rig: Rig, pose: Pose = {}): PoseSolution => {
  const count = rig.entries.length;
  const matrices: MatrixTransform[] = new Array(count);
  const parentMatrices: MatrixTransform[] = new Array(count);
  const translateScales: Vector2[] = new Array(count);
  // The matrix a joint child hangs from: the entry's world matrix without its own scale.
  const jointBases: MatrixTransform[] = new Array(count);
  const solving = new Uint8Array(count);
  let unconstrained: MatrixTransform[] | undefined;

  const posed = (node: Node): Node => {
    const rotate = pose[node.id]?.rotate;
    return rotate ? { ...node, rotate: node.rotate + rotate } : node;
  };

  /** One entry's matrices, given what it hangs from. */
  const solveEntry = (i: number, parentMatrix: MatrixTransform, targets: TargetMatrices | undefined) => {
    const { node, parent, via } = rig.entries[i];
    const scaleFactor = via === "joint" ? rig.entries[parent].node.scale : UNIT_SCALE;
    const transform = resolveNodeTransform(posed(node), parentMatrix, scaleFactor, targets);
    return {
      world: combineMatrixTransforms(parentMatrix, transformToMatrixWithMatrix(transform)),
      jointBase: combineMatrixTransforms(parentMatrix, transformToMatrixWithMatrix({ ...transform, scale: UNIT_SCALE })),
      scaleFactor,
    };
  };

  const hangsFrom = (i: number, worlds: MatrixTransform[], bases: MatrixTransform[]) => {
    const { parent, via } = rig.entries[i];
    if (parent < 0) return IDENTITY_MATRIX;
    return via === "joint" ? bases[parent] : worlds[parent];
  };

  /** Every entry without constraints, in entry order (parents come first). */
  const solveUnconstrained = () => {
    const worlds: MatrixTransform[] = new Array(count);
    const bases: MatrixTransform[] = new Array(count);
    for (let i = 0; i < count; i += 1) {
      const solved = solveEntry(i, hangsFrom(i, worlds, bases), undefined);
      worlds[i] = solved.world;
      bases[i] = solved.jointBase;
    }
    return worlds;
  };

  const targetsFor = (): TargetMatrices => ({
    get: (id) => {
      const index = rig.indexById.get(id);
      if (index === undefined) return undefined;
      try {
        return solve(index);
      } catch (error) {
        if (error !== CYCLE) throw error;
        unconstrained ??= solveUnconstrained();
        return unconstrained[index];
      }
    },
  });

  const solve = (i: number): MatrixTransform => {
    if (matrices[i]) return matrices[i];
    if (solving[i]) throw CYCLE;
    solving[i] = 1;
    try {
      const { node, parent } = rig.entries[i];
      if (parent >= 0) solve(parent);
      const parentMatrix = hangsFrom(i, matrices, jointBases);
      const solved = solveEntry(i, parentMatrix, hasConstraint(node) ? targetsFor() : undefined);
      matrices[i] = solved.world;
      jointBases[i] = solved.jointBase;
      parentMatrices[i] = parentMatrix;
      translateScales[i] = solved.scaleFactor;
      return solved.world;
    } finally {
      solving[i] = 0;
    }
  };

  for (let i = 0; i < count; i += 1) solve(i);
  return { matrices, parentMatrices, translateScales };
};
