import type { Sprite } from "../types/Sprite";
import type { RenderNode } from "./RenderTree";

/**
 * Scale for an outline's copy of its owner's sprite mask. The fill and the outline are cut by the
 * same mask, so their edges overlap along the cut and the outline can show through there; shrinking
 * the outline's copy pulls its cut just inside the fill's.
 */
const OUTLINE_MASK_SCALE = 0.999;

const outlineMasks = new WeakMap<Sprite, Sprite>();

/** The outline's copy of its owner's mask; the same object for the same mask, so poses keep it. */
export const outlineMaskOf = (mask: Sprite | undefined): Sprite | undefined => {
  if (!mask) return undefined;
  let copy = outlineMasks.get(mask);
  if (!copy) {
    copy = { ...mask, scale: { x: mask.scale.x * OUTLINE_MASK_SCALE, y: mask.scale.y * OUTLINE_MASK_SCALE } };
    outlineMasks.set(mask, copy);
  }
  return copy;
};

/**
 * Splits `owner`'s stroke into a separate outline node drawn at `zIndex`, for `setOutlineZIndex`
 * and for outlines hoisted above a clip group's dependents. The outline draws only the stroke;
 * the owner keeps its fill and loses its stroke.
 *
 * Mutates `owner`, so pass a node this render owns, not a shared or interned one.
 */
export const createOutlineNode = (owner: RenderNode, zIndex: number): RenderNode => {
  const strokeWidth = owner.sprite.strokeWidth ?? 0;
  const outline: RenderNode = {
    ...owner,
    id: `${owner.id}_outline`,
    outlineOf: owner.id,
    zIndex,
    pattern: undefined,
    patternFills: undefined,
    sprite: {
      ...owner.sprite,
      fill: "none",
      fillGradient: undefined,
      colors: {},
      // Below the fill, the fill covers the stroke's inner half.
      strokeWidth: strokeWidth ? strokeWidth * (zIndex < owner.zIndex ? 2 : 1) : 0,
    },
    articulated: false,
    mask: outlineMaskOf(owner.mask),
  };
  owner.linkedOutline = outline;
  owner.sprite.strokeWidth = 0;
  return outline;
};
