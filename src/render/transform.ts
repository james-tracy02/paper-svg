import type { Vector2 } from "../types/primitives";
import type { MatrixTransform, Transform } from "../types/Transform";
import type { Sprite } from "../types/Sprite";
import { roundTo } from "../util/roundTo";

const buildMatrix = (
  transform: Transform,
  order: Array<"rotate" | "skewX" | "skewY" | "scale">,
  includeScale: boolean,
): MatrixTransform["matrix"] => {
  const identity = { a: 1, b: 0, c: 0, d: 1 };
  let matrix = identity;
  order.forEach((step) => {
    if (step === "rotate" && transform.rotate) {
      matrix = multiplyMatrix(matrix, makeRotationMatrix(transform.rotate));
      return;
    }
    if (step === "skewX" && transform.skew?.x) {
      matrix = multiplyMatrix(matrix, makeSkewXMatrix(transform.skew.x));
      return;
    }
    if (step === "skewY" && transform.skew?.y) {
      matrix = multiplyMatrix(matrix, makeSkewYMatrix(transform.skew.y));
      return;
    }
    if (step === "scale" && includeScale && (transform.scale.x !== 1 || transform.scale.y !== 1)) {
      matrix = multiplyMatrix(matrix, makeScaleMatrix(transform.scale));
    }
  });
  return matrix;
};

const matrixToSvg = (matrix: MatrixTransform["matrix"], translate: Vector2, precision = 4) => {
  const e = translate.x;
  const f = -translate.y;
  return `matrix(${roundTo(matrix.a, precision)}, ${roundTo(matrix.b, precision)}, ${roundTo(
    matrix.c,
    precision,
  )}, ${roundTo(matrix.d, precision)}, ${roundTo(e, precision)}, ${roundTo(f, precision)})`;
};

const matrixTransformToSvg = (transform: MatrixTransform, precision = 4) =>
  matrixToSvg(transform.matrix, transform.translate, precision);

const getTransformExcludeScale = (transform: Transform) => {
  const matrix = buildMatrix(transform, ["rotate", "skewX", "skewY"], false);
  return matrixToSvg(matrix, transform.translate);
};

const transformToMatrixWithMatrix = (transform: Transform): MatrixTransform => {
  if (transform.matrix) {
    return { translate: { ...transform.translate }, matrix: { ...transform.matrix } };
  }
  return transformToMatrix(transform);
};

const getSpriteTransform = (transform: Transform, precision = 4) => {
  const matrix = buildMatrix(transform, ["scale", "rotate", "skewX", "skewY"], true);
  return matrixToSvg(matrix, transform.translate, precision);
};

/** Numeric form of getSpriteTransform. */
const spriteTransformToMatrix = (transform: Transform): MatrixTransform => ({
  translate: { ...transform.translate },
  matrix: buildMatrix(transform, ["scale", "rotate", "skewX", "skewY"], true),
});

/** World frame of the space a sprite's paths are drawn in: the node matrix, sprite transform and custom sprite root. */
const spriteUserSpace = (matrix: MatrixTransform, sprite: Sprite): MatrixTransform => {
  const spriteMatrix = combineMatrixTransforms(matrix, spriteTransformToMatrix(sprite));
  return sprite.customSprite ? combineMatrixTransforms(spriteMatrix, spriteTransformToMatrix(sprite.customSprite)) : spriteMatrix;
};

const getInverseScale = (transform: Transform): string => {
  const tt = [];

  if (transform.scale.x !== 1 || transform.scale.y !== 1) {
    tt.push(`scale(${roundTo(1 / transform.scale.x, 4)}, ${roundTo(1 / transform.scale.y, 4)})`);
  }
  return tt.join(" ");
};

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;

const multiplyMatrix = (a: MatrixTransform["matrix"], b: MatrixTransform["matrix"]) => ({
  a: a.a * b.a + a.c * b.b,
  b: a.b * b.a + a.d * b.b,
  c: a.a * b.c + a.c * b.d,
  d: a.b * b.c + a.d * b.d,
});

const makeRotationMatrix = (deg: number): MatrixTransform["matrix"] => {
  const r = deg * RAD;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return { a: cos, b: sin, c: -sin, d: cos };
};

const makeScaleMatrix = (scale: Vector2): MatrixTransform["matrix"] => ({
  a: scale.x,
  b: 0,
  c: 0,
  d: scale.y,
});

const makeSkewXMatrix = (deg: number): MatrixTransform["matrix"] => ({
  a: 1,
  b: 0,
  c: Math.tan(deg * RAD),
  d: 1,
});

const makeSkewYMatrix = (deg: number): MatrixTransform["matrix"] => ({
  a: 1,
  b: Math.tan(deg * RAD),
  c: 0,
  d: 1,
});

const matrixFromScaleRotation = (scale: Vector2, rotation = 0): MatrixTransform["matrix"] => {
  const rot = rotation ? makeRotationMatrix(rotation) : { a: 1, b: 0, c: 0, d: 1 };
  const sc = makeScaleMatrix(scale);
  return multiplyMatrix(rot, sc);
};

const rotateMatrix = (matrix: MatrixTransform["matrix"], rotation: number): MatrixTransform["matrix"] => {
  if (!rotation) return { ...matrix };
  return multiplyMatrix(makeRotationMatrix(rotation), matrix);
};

const rotateMatrixLocal = (matrix: MatrixTransform["matrix"], rotation: number): MatrixTransform["matrix"] => {
  if (!rotation) return { ...matrix };
  return multiplyMatrix(matrix, makeRotationMatrix(rotation));
};

const scaleMatrixLocal = (matrix: MatrixTransform["matrix"], scale: Vector2): MatrixTransform["matrix"] => {
  if (scale.x === 1 && scale.y === 1) return { ...matrix };
  return multiplyMatrix(matrix, makeScaleMatrix(scale));
};

const invertMatrix = (matrix: MatrixTransform["matrix"]) => {
  const det = matrix.a * matrix.d - matrix.b * matrix.c;
  if (!det) return null;
  return {
    a: matrix.d / det,
    b: -matrix.b / det,
    c: -matrix.c / det,
    d: matrix.a / det,
  };
};

const invertMatrixTransform = (m: MatrixTransform): MatrixTransform | null => {
  const inv = invertMatrix(m.matrix);
  if (!inv) return null;
  const e = m.translate.x;
  const f = -m.translate.y;
  return {
    translate: { x: -(inv.a * e + inv.c * f), y: inv.b * e + inv.d * f },
    matrix: inv,
  };
};

/** Same position, rotation and handedness, with scale and skew removed. */
const rigidPart = (m: MatrixTransform): MatrixTransform => {
  const { a, b, c, d } = m.matrix;
  const r = Math.atan2(b, a);
  const flip = a * d - b * c < 0 ? -1 : 1;
  return {
    translate: { ...m.translate },
    matrix: { a: Math.cos(r), b: Math.sin(r), c: -Math.sin(r) * flip, d: Math.cos(r) * flip },
  };
};

const rotateMatrixWithParentMatrix = (
  matrix: MatrixTransform["matrix"],
  rotation: number,
  parentMatrix: MatrixTransform["matrix"],
): MatrixTransform["matrix"] => {
  if (!rotation) return { ...matrix };
  const inverse = invertMatrix(parentMatrix);
  if (!inverse) {
    return rotateMatrix(matrix, rotation);
  }
  const rotated = multiplyMatrix(inverse, multiplyMatrix(makeRotationMatrix(rotation), parentMatrix));
  return multiplyMatrix(rotated, matrix);
};

const scaleMatrixWithParentMatrix = (
  matrix: MatrixTransform["matrix"],
  scale: Vector2,
  parentMatrix: MatrixTransform["matrix"],
): MatrixTransform["matrix"] => {
  if (scale.x === 1 && scale.y === 1) return { ...matrix };
  const inverse = invertMatrix(parentMatrix);
  const scaleMatrix = makeScaleMatrix(scale);
  if (!inverse) {
    return multiplyMatrix(scaleMatrix, matrix);
  }
  const scaled = multiplyMatrix(inverse, multiplyMatrix(scaleMatrix, parentMatrix));
  return multiplyMatrix(scaled, matrix);
};

const transformToMatrix = (transform: Transform): MatrixTransform => {
  const identity = { a: 1, b: 0, c: 0, d: 1 };
  let matrix = identity;
  if (transform.rotate) {
    matrix = multiplyMatrix(matrix, makeRotationMatrix(transform.rotate));
  }
  if (transform.skew?.x) {
    matrix = multiplyMatrix(matrix, makeSkewXMatrix(transform.skew.x));
  }
  if (transform.skew?.y) {
    matrix = multiplyMatrix(matrix, makeSkewYMatrix(transform.skew.y));
  }
  if (transform.scale.x !== 1 || transform.scale.y !== 1) {
    matrix = multiplyMatrix(matrix, makeScaleMatrix(transform.scale));
  }
  return {
    translate: { ...transform.translate },
    matrix,
  };
};

const matrixToTransform = (matrixTransform: MatrixTransform): Transform => {
  const { a, b, c, d } = matrixTransform.matrix ?? { a: 1, b: 0, c: 0, d: 1 };

  let rotate = 0;
  let scaleX = 1;
  let scaleY = 1;
  let skewX = 0;
  let skewY = 0;

  if (a !== 0 || b !== 0) {
    const r = Math.hypot(a, b);
    rotate = Math.atan2(b, a);
    scaleX = r;

    const cos = a / r;
    const sin = b / r;
    const c1 = cos * c + sin * d;
    const d1 = -sin * c + cos * d;

    skewX = Math.atan2(c1, d1);
    scaleY = d1 / Math.cos(skewX);
  } else if (c !== 0 || d !== 0) {
    const r = Math.hypot(c, d);
    rotate = Math.atan2(-c, d);
    scaleX = 0;
    scaleY = r;
    skewX = 0;
  }

  if (scaleX !== 0) {
    const det = a * d - b * c;
    const shear = det / (scaleX * scaleX);
    skewY = Math.atan2(-shear, 1);
  }

  return {
    translate: { ...matrixTransform.translate },
    scale: { x: scaleX || 1, y: scaleY || 1 },
    rotate: rotate * DEG || 0,
    skew: {
      x: skewX * DEG || 0,
      y: skewY * DEG || 0,
    },
  };
};

/** Applies a matrix transform to a point in model space (y-up), returning model space. */
const applyMatrixToPoint = (m: MatrixTransform, p: Vector2): Vector2 => {
  const x = m.matrix.a * p.x + m.matrix.c * -p.y + m.translate.x;
  const y = m.matrix.b * p.x + m.matrix.d * -p.y + -m.translate.y;
  return { x, y: -y };
};

/** Inverse of applyMatrixToPoint: world model-space point -> the matrix's local model space. */
const applyInverseMatrixToPoint = (m: MatrixTransform, p: Vector2): Vector2 | null => {
  const inv = invertMatrix(m.matrix);
  if (!inv) return null;
  const dx = p.x - m.translate.x;
  const dy = -(p.y - m.translate.y);
  return {
    x: inv.a * dx + inv.c * dy,
    y: -(inv.b * dx + inv.d * dy),
  };
};

const combineMatrixTransforms = (parent: MatrixTransform, child: MatrixTransform): MatrixTransform => {
  const p = parent.matrix;
  const c = child.matrix;
  const pe = parent.translate.x;
  const pf = -parent.translate.y;
  const ce = child.translate.x;
  const cf = -child.translate.y;

  const a = p.a * c.a + p.c * c.b;
  const b = p.b * c.a + p.d * c.b;
  const cNext = p.a * c.c + p.c * c.d;
  const d = p.b * c.c + p.d * c.d;
  const e = p.a * ce + p.c * cf + pe;
  const f = p.b * ce + p.d * cf + pf;

  return {
    translate: { x: e, y: -f },
    matrix: { a, b, c: cNext, d },
  };
};
export {
  matrixTransformToSvg,
  transformToMatrixWithMatrix,
  combineMatrixTransforms,
  getTransformExcludeScale,
  getSpriteTransform,
  spriteTransformToMatrix,
  spriteUserSpace,
  getInverseScale,
  invertMatrixTransform,
  rigidPart,
  matrixFromScaleRotation,
  rotateMatrix,
  rotateMatrixLocal,
  scaleMatrixLocal,
  rotateMatrixWithParentMatrix,
  scaleMatrixWithParentMatrix,
  transformToMatrix,
  matrixToTransform,
  applyMatrixToPoint,
  applyInverseMatrixToPoint,
};
