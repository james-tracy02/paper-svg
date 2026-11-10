import type { SpriteStyle } from "./spriteTypes";

export const styleOrUndefined = (style: SpriteStyle) => (Object.keys(style).length ? style : undefined);

/**
 * Stroke attributes for a leaf shape. A zero-width stroke draws nothing, so it gets none of them; `stroke` isn't set
 * anywhere above a sprite, so leaving it off means no stroke.
 */
export const strokeAttributes = (stroke: string | undefined, strokeWidth: string | number, style: SpriteStyle) =>
  strokeWidth === 0
    ? { style: styleOrUndefined(style) }
    : { stroke, style: { ...style, strokeWidth }, vectorEffect: "non-scaling-stroke" as const };
