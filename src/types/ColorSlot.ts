import type { Color } from "./primitives";
export type ColorTone = "same" | "darker" | "lighter";

/** Takes a slot's color from an earlier slot instead of picking it. `from: BASE_SLOT` takes it from the picker's base color. */
export type ColorDerive = { from: number; tone: ColorTone };

export const BASE_SLOT = -1;

/** One entry of a color array. A derived slot keeps its last picked `color`, so turning `derive` off restores it. */
export type ColorSlot = { color: Color; derive?: ColorDerive };
