import type { MatrixTransform } from "../../types/Transform";

export type Matrix2x2 = { a: number; b: number; c: number; d: number };

/**
 * Converts a drag-space matrix back to canonical (stored) form by mirroring
 * across the X axis: negates the first column (a, b). Used only at commit time.
 */
export const toCanonicalMatrix = (matrix: Matrix2x2): Matrix2x2 => ({
  a: -matrix.a,
  b: -matrix.b,
  c: matrix.c,
  d: matrix.d,
});

/**
 * Mirrors a world-space MatrixTransform about the vertical axis at x = pivotX.
 * Negates the first row of the matrix (a, c) and reflects the translation.
 * Used for the preview ghost when the attachment is in mirrored drag-space.
 */
export const mirrorWorldTransform = (world: MatrixTransform, pivotX: number): MatrixTransform => ({
  translate: { x: 2 * pivotX - world.translate.x, y: world.translate.y },
  matrix: { a: -world.matrix.a, b: world.matrix.b, c: -world.matrix.c, d: world.matrix.d },
});

/**
 * Mirrors a matrix about the vertical axis: F·M·F with F = scale(-1, 1), i.e. negates the
 * off-diagonal terms. The left half of a "both" attachment pair uses this so its rotation
 * and skew reflect the right half's instead of tracking it.
 */
export const mirrorMatrixAcrossY = (matrix: Matrix2x2): Matrix2x2 => ({
  a: matrix.a,
  b: -matrix.b,
  c: -matrix.c,
  d: matrix.d,
});
