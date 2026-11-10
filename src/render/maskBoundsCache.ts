import type { MatrixTransform, Transform } from "../types/Transform";
import { roundTo } from "../util/roundTo";

export type Bounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type BoundsCacheEntry = {
  signature: string;
  bounds: Bounds;
};

export const maskBoundsCache = new Map<string, BoundsCacheEntry>();

export const areBoundsEqual = (a: Bounds, b: Bounds) =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

const SIGNATURE_PRECISION = 2;
const r = (value: number) => roundTo(value, SIGNATURE_PRECISION);

export const serializeTransform = (transform: Transform & { maskScale?: { x: number; y: number } }) => {
  const t = transform.translate;
  const s = transform.scale;
  const ms = transform.maskScale ?? { x: 1, y: 1 };
  const skew = transform.skew ?? { x: 0, y: 0 };
  return [r(t.x), r(t.y), r(s.x), r(s.y), r(ms.x), r(ms.y), r(transform.rotate), r(skew.x), r(skew.y)].join(",");
};

export const serializeMatrixTransform = (transform: MatrixTransform) => {
  const t = transform.translate;
  const m = transform.matrix;
  return [r(t.x), r(t.y), r(m.a), r(m.b), r(m.c), r(m.d)].join(",");
};

export const expandBounds = (rect: DOMRect, padding = 10): Bounds => ({
  x: rect.x - padding,
  y: rect.y - padding,
  width: rect.width + padding * 2,
  height: rect.height + padding * 2,
});
