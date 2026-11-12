/**
 * Bounds of what a sprite draws, computed from its geometry rather than measured in the DOM, so a
 * mask region is right on the first render (and on the server) without a measuring pass.
 *
 * Paths are bounded by their control points, which contain the curves, and transformed boxes by
 * their transformed corners: the results can be a little larger than the drawn shape, never smaller.
 */
import { membership } from "./regions";
import svgpath from "svgpath";
import type { CustomSprite, Sprite } from "../types/Sprite";
import type { MatrixTransform } from "../types/Transform";
import type { RenderNode } from "./RenderTree";
import { combineMatrixTransforms, spriteTransformToMatrix } from "./transform";

export type Bounds = { x: number; y: number; width: number; height: number };

/** The box the primitive shapes are drawn in (see components/SpriteShapes). */
const SHAPE_SIZE = 10;
/** HalfCircleSprite's path. */
const HALF_CIRCLE_PATH = `M ${-SHAPE_SIZE / 2} 0 A ${SHAPE_SIZE / 2} ${SHAPE_SIZE / 2} 0 0 0 ${SHAPE_SIZE / 2} 0 Z`;
/** ImageSprite draws a 20x20 image centered on the origin. */
const IMAGE_SIZE = 20;

const box = (minX: number, minY: number, maxX: number, maxY: number): Bounds => ({
  x: minX,
  y: minY,
  width: maxX - minX,
  height: maxY - minY,
});

// Paths repeat across renders and poses (a driven path takes a few shapes), so their bounds are kept.
const pathBoundsCache = new Map<string, Bounds | null>();
const PATH_BOUNDS_CACHE_SIZE = 1000;

/** Bounds of an SVG path's points and control points, after `transform` (an SVG transform list). */
const pathBounds = (d: string, transform?: string): Bounds | null => {
  const key = transform ? `${transform}|${d}` : d;
  if (pathBoundsCache.has(key)) return pathBoundsCache.get(key)!;
  const bounds = measurePathBounds(d, transform);
  if (pathBoundsCache.size >= PATH_BOUNDS_CACHE_SIZE) pathBoundsCache.clear();
  pathBoundsCache.set(key, bounds);
  return bounds;
};

const measurePathBounds = (d: string, transform?: string): Bounds | null => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  let path = svgpath(d);
  if (transform) path = path.transform(transform);
  path
    .abs()
    .unarc()
    .unshort()
    .iterate((segment, _index, x, y) => {
      const command = segment[0];
      if (command === "H") add(segment[1] as number, y);
      else if (command === "V") add(x, segment[1] as number);
      else for (let i = 1; i + 1 < segment.length; i += 2) add(segment[i] as number, segment[i + 1] as number);
    });
  return Number.isFinite(minX) ? box(minX, minY, maxX, maxY) : null;
};

const union = (a: Bounds | null, b: Bounds | null): Bounds | null => {
  if (!a) return b;
  if (!b) return a;
  return box(
    Math.min(a.x, b.x),
    Math.min(a.y, b.y),
    Math.max(a.x + a.width, b.x + b.width),
    Math.max(a.y + a.height, b.y + b.height),
  );
};

/** `bounds` mapped through `transform`, as SVG applies an engine matrix (see matrixTransformToSvg). */
export const transformBounds = (bounds: Bounds, { matrix: { a, b, c, d }, translate }: MatrixTransform): Bounds => {
  const e = translate.x;
  const f = -translate.y;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const x of [bounds.x, bounds.x + bounds.width]) {
    for (const y of [bounds.y, bounds.y + bounds.height]) {
      const px = a * x + c * y + e;
      const py = b * x + d * y + f;
      minX = Math.min(minX, px);
      maxX = Math.max(maxX, px);
      minY = Math.min(minY, py);
      maxY = Math.max(maxY, py);
    }
  }
  return box(minX, minY, maxX, maxY);
};

export const expandBounds = (bounds: Bounds, by: number): Bounds =>
  box(bounds.x - by, bounds.y - by, bounds.x + bounds.width + by, bounds.y + bounds.height + by);

const customElementBounds = new WeakMap<CustomSprite, Bounds | null>();

/** A custom sprite's bounds in its own element space, before its root transform. */
const customSpriteBounds = (custom: CustomSprite): Bounds | null => {
  if (customElementBounds.has(custom)) return customElementBounds.get(custom)!;
  let bounds: Bounds | null = null;
  for (const el of custom.elements) if (el.d) bounds = union(bounds, pathBounds(el.d, el.transform));
  // An image has no elements; its bounds were set when it was made (top-left corner, y down).
  if (!bounds && custom.bounds) bounds = { ...custom.bounds };
  customElementBounds.set(custom, bounds);
  return bounds;
};

/** What `sprite` draws, in the space its own transform is applied in (its node's), unpadded. */
const spriteLocalBounds = (sprite: Sprite): { bounds: Bounds; space: MatrixTransform } | null => {
  const spriteMatrix = spriteTransformToMatrix(
    sprite.maskScale ? { ...sprite, scale: { x: sprite.scale.x * sprite.maskScale.x, y: sprite.scale.y * sprite.maskScale.y } } : sprite,
  );
  // The order SvgSprite picks what to draw in.
  if (sprite.href) return { bounds: box(-IMAGE_SIZE / 2, -IMAGE_SIZE / 2, IMAGE_SIZE / 2, IMAGE_SIZE / 2), space: spriteMatrix };
  if (sprite.dynamicPath) {
    const bounds = pathBounds(sprite.dynamicPath);
    return bounds && { bounds, space: spriteMatrix };
  }
  if (sprite.customSprite) {
    const bounds = customSpriteBounds(sprite.customSprite);
    return bounds && { bounds, space: combineMatrixTransforms(spriteMatrix, spriteTransformToMatrix(sprite.customSprite)) };
  }
  const half = SHAPE_SIZE / 2;
  switch (sprite.shape ?? "ellipse") {
    case "half_circle":
      return { bounds: pathBounds(HALF_CIRCLE_PATH)!, space: spriteMatrix };
    case "line":
      return { bounds: box(0, -half, 0, half), space: spriteMatrix };
    default:
      return { bounds: box(-half, -half, half, half), space: spriteMatrix };
  }
};

/**
 * Bounds of what `sprite` draws in a mask (mask scale applied), under `matrix` (default: its node's
 * own space). Null when it draws nothing measurable.
 */
export const getSpriteMaskBounds = (sprite: Sprite, matrix?: MatrixTransform): Bounds | null => {
  const local = spriteLocalBounds(sprite);
  if (!local) return null;
  return transformBounds(local.bounds, matrix ? combineMatrixTransforms(matrix, local.space) : local.space);
};

/** Padding around a mask's content: room for strokes, which the geometry doesn't include. */
const MASK_PADDING = 10;

/**
 * The region a group mask needs: every member's sprite where it stands, grown by its outset in the
 * group and by the stroke padding. Hidden members count too, so showing one doesn't change the
 * region. Null when no member draws anything measurable.
 */
export const getMaskRegion = (members: readonly RenderNodeLike[], groupName: string): Bounds | null => {
  let region: Bounds | null = null;
  for (const member of members) {
    if (member.noSprite) continue;
    const bounds = getSpriteMaskBounds(member.sprite, member.matrix);
    if (!bounds) return null;
    region = union(region, expandBounds(bounds, Math.max(0, membership(member, groupName, "mask")?.outset ?? 0)));
  }
  return region && expandBounds(region, MASK_PADDING);
};

/** The region a node's own sprite mask (`setMask`) needs, in the node's space. */
export const getSpriteMaskRegion = (sprite: Sprite): Bounds | null => {
  const bounds = getSpriteMaskBounds(sprite);
  return bounds && expandBounds(bounds, MASK_PADDING);
};

type RenderNodeLike = Pick<RenderNode, "noSprite" | "sprite" | "matrix" | "regions">;
