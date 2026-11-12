/**
 * The per-node transform maths: a node's local transform from its own values and constraints, and
 * the frames it sets for patterns. Used by the pose solver (pose.ts); RenderTree reads the results.
 */
import type { Vector2 } from "../types/primitives";
import type { Node, NodeFollow, NodePaint } from "../types/Node";
import type { MatrixTransform, Transform } from "../types/Transform";
import { roundTo } from "../util/roundTo";
import {
  applyInverseMatrixToPoint,
  applyMatrixToPoint,
  combineMatrixTransforms,
  matrixFromScaleRotation,
  matrixToTransform,
  rigidPart,
  transformToMatrix,
} from "./transform";

/** World matrices of `aimAt`/`pinTo` targets, by node id. */
export type TargetMatrices = { get(id: string): MatrixTransform | undefined };

export const IDENTITY_MATRIX: MatrixTransform = {
  translate: { x: 0, y: 0 },
  matrix: { a: 1, b: 0, c: 0, d: 1 },
};

const makeTransform = (body: Node, scaleFactor: Vector2, fidelity: number = 4): Transform => ({
  translate: {
    x: roundTo(scaleFactor.x * body.transform.translate.x, fidelity),
    y: roundTo(scaleFactor.y * body.transform.translate.y, fidelity),
  },
  scale: {
    x: roundTo(body.transform.scale.x, fidelity),
    y: roundTo(body.transform.scale.y, fidelity),
  },
  rotate: roundTo(body.transform.rotate, fidelity),
  skew: body.transform.skew
    ? {
        x: roundTo(body.transform.skew.x, fidelity),
        y: roundTo(body.transform.skew.y, fidelity),
      }
    : undefined,
  matrix: body.transform.matrix
    ? {
        a: roundTo(body.transform.matrix.a, fidelity),
        b: roundTo(body.transform.matrix.b, fidelity),
        c: roundTo(body.transform.matrix.c, fidelity),
        d: roundTo(body.transform.matrix.d, fidelity),
      }
    : undefined,
});

/** Default node-local point that `aimAt` brings to its target: straight down the limb. */
const AIM_FROM: Vector2 = { x: 0, y: -1 };

/** Angle of a model-space vector, in the same degrees/direction as `Transform.rotate`. */
const angleOf = (v: Vector2) => Math.atan2(-v.y, v.x) * (180 / Math.PI);

/**
 * Joint position (parent space) that puts this node's joint on `pinTo.point` in the target
 * node's local space. Returns undefined when the target isn't in the tree.
 */
const resolvePinTranslate = (
  pin: NonNullable<NodeFollow["pinTo"]>,
  parentMatrix: MatrixTransform,
  targetMatrices: TargetMatrices,
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
  aim: NonNullable<NodeFollow["aimAt"]>,
  myTransform: Transform,
  parentMatrix: MatrixTransform,
  targetMatrices: TargetMatrices,
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
export const resolveArrivePath = (
  aim: NonNullable<NodeFollow["aimAt"]>,
  worldMatrix: MatrixTransform,
  targetMatrices: TargetMatrices,
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

/** A node's local transform: its own values, fixed rotation and scale, then its `pinTo` and `aimAt`. */
export const resolveNodeTransform = (
  body: Node,
  parentMatrix: MatrixTransform,
  scaleFactor: Vector2,
  targetMatrices?: TargetMatrices,
): Transform => {
  const myTransform = makeTransform(body, scaleFactor);
  const { follow } = body;

  // Adjust for fixed rotation
  if (follow?.fixedRotation?.enabled) {
    const parentRotation = matrixToTransform(parentMatrix).rotate;
    const maxCorrection =
      follow.fixedRotation.max === undefined ? Math.abs(parentRotation) : Math.abs(follow.fixedRotation.max);
    const correction = Math.max(-maxCorrection, Math.min(maxCorrection, parentRotation));
    myTransform.rotate = roundTo(body.transform.rotate - correction, 4);
  }

  // Adjust for fixed scale: cancel out the parent's accumulated scale so this
  // node's world-space scale matches its own configured scale, regardless of
  // ancestor scaling.
  if (follow?.fixedScale) {
    const parentScale = matrixToTransform(parentMatrix).scale;
    myTransform.scale = {
      x: parentScale.x ? myTransform.scale.x / parentScale.x : myTransform.scale.x,
      y: parentScale.y ? myTransform.scale.y / parentScale.y : myTransform.scale.y,
    };
  }

  // Pin the joint onto a point on another node. The node's own translate stays as an additive
  // offset. Resolved before the aim, which measures direction from this joint.
  if (follow?.pinTo && targetMatrices) {
    const pinned = resolvePinTranslate(follow.pinTo, parentMatrix, targetMatrices);
    if (pinned) {
      myTransform.translate = {
        x: roundTo(pinned.x + myTransform.translate.x, 4),
        y: roundTo(pinned.y + myTransform.translate.y, 4),
      };
    }
  }

  // Aim at a point on another node. The node's own rotation stays as an additive offset.
  if (follow?.aimAt && targetMatrices) {
    const aim = resolveAimRotation(follow.aimAt, myTransform, parentMatrix, targetMatrices);
    if (aim !== undefined) {
      myTransform.rotate = roundTo(myTransform.rotate + aim.rotation, 4);
      if (follow.aimAt.stretch) {
        myTransform.scale = { ...myTransform.scale, y: roundTo(myTransform.scale.y * aim.reach, 4) };
      }
    }
  }

  return myTransform;
};

/**
 * Frame for a `patternSpace` node: its world frame without scale, turned by `rotation`, origin moved by `offset`.
 * Under an ancestor's pattern space the frame continues that grid instead: its origin maps to the same pattern
 * coordinate in both spaces, so the two stay in phase there whatever the pattern's scale, rotation or offset.
 */
export const resolvePatternSpace = (
  space: NonNullable<NodePaint["patternSpace"]>,
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
