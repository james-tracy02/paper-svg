import { createContext, useContext } from "react";

/**
 * Transforms a sprite color at paint time. The library applies it to fills and strokes of
 * `default`/`outline` sprites. Default is identity (returns the color unchanged). A consumer
 * (e.g. scene lighting) supplies its own via {@link ColorTransformProvider}.
 */
export type ColorTransform = (color: string | undefined) => string | undefined;

const identity: ColorTransform = (color) => color;

const ColorTransformContext = createContext<ColorTransform>(identity);

export const ColorTransformProvider = ColorTransformContext.Provider;

export const useColorTransform = (): ColorTransform => useContext(ColorTransformContext);
