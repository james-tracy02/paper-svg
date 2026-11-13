import type { RenderNode } from "./RenderTree";

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
  };
  owner.linkedOutline = outline;
  owner.sprite.strokeWidth = 0;
  return outline;
};
