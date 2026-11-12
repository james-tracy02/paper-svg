import type { RenderNode } from "./RenderTree";

/**
 * Scale for an outline's copy of its owner's sprite mask. The fill and the outline are cut by the
 * same mask, so their edges overlap along the cut and the outline can show through there; shrinking
 * the outline's copy pulls its cut just inside the fill's.
 */
const OUTLINE_MASK_SCALE = 0.999;

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
    mask: owner.mask
      ? {
          ...owner.mask,
          scale: { x: owner.mask.scale.x * OUTLINE_MASK_SCALE, y: owner.mask.scale.y * OUTLINE_MASK_SCALE },
        }
      : undefined,
  };
  owner.linkedOutline = outline;
  owner.sprite.strokeWidth = 0;
  return outline;
};
