import type { Vector2 } from "./primitives";
export type Transform = {
  translate: Vector2;
  scale: Vector2;
  rotate: number;
  skew?: Vector2;
  matrix?: Matrix2x2;
};

export const mirrorTransform = (t: Transform) => {
  return {
    translate: {
      x: t.translate.x * -1,
      y: t.translate.y,
    },
    scale: {
      x: t.scale.x * -1,
      y: t.scale.y,
    },
    rotate: t.rotate * -1,
    skew: {
      x: (t.skew?.x ?? 0) * -1,
      y: t.skew?.y ?? 0,
    },
    matrix: t.matrix,
  }
}

export type Matrix2x2 = {
  a: number;
  b: number;
  c: number;
  d: number;
};

export type MatrixTransform = {
  translate: Vector2;
  matrix: Matrix2x2;
};
