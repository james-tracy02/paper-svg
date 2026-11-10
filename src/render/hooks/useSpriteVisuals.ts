import { useCallback, useMemo } from "react";
import type { Sprite } from "../../types/Sprite";
import { roundTo } from "../../util/roundTo";
import { useColorTransform } from "../context/ColorTransformContext";
import type { RenderMode, SpriteStyle } from "../spriteTypes";

/** Anti-aliasing padding added to mask/outline strokes; written to `--stroke-pad` wherever `--zoom` is set. */
export function getStrokePadding(zoom: number) {
  const aaKernel = 0.35 / Math.pow(zoom, 0.45);
  const filterResample = 0.55 / Math.pow(zoom, 0.95);

  // smooth blend point around zoom = 0.8
  const t = Math.min(1, Math.max(0, (0.8 - zoom) / 0.6));
  const blend = t * t * (3 - 2 * t); // smoothstep

  return aaKernel * (1 - blend) + filterResample * blend;
}

const getSpriteAttributes = (
  sprite: Sprite,
  mode: RenderMode,
  articulated?: boolean,
  pattern?: string,
) => {
  const renderMode = mode;
  const strokeWidth = roundTo(sprite.strokeWidth ?? 0, 4);

  switch (renderMode) {
    case "outline":
      return {
        fill: sprite.stroke,
        stroke: sprite.stroke ?? "black",
        strokeWidth,
        strokePad: 1,
        cursor: articulated ? "grab" : "auto",
      };
    case "outline_mask":
      return {
        fill: "black",
        stroke: "white",
        strokeWidth,
        strokePad: strokeWidth === 0 ? 0 : 0.5,
        cursor: "auto",
        opacity: sprite.opacity,
      };
    case "mask":
      return {
        fill: "white",
        stroke: "white",
        strokeWidth: 0,
        strokePad: 1,
        cursor: "auto",
        opacity: sprite.opacity,
      };
    case "mask_no_outline":
      if (strokeWidth === 0) {
        return {
          fill: "white",
          stroke: "white",
          strokeWidth: 0,
          strokePad: 1,
          cursor: "auto",
          opacity: sprite.opacity,
        };
      }
      return {
        fill: "white",
        stroke: "black",
        strokeWidth,
        strokePad: 0,
        cursor: "auto",
        opacity: sprite.opacity,
      };
    case "outer_outline":
    case "default":
    default:
      return {
        fill: pattern ? `url(#${pattern})` : (sprite.fill ?? "magenta"),
        stroke: sprite.stroke ?? "black",
        strokeWidth,
        strokePad: 0,
        cursor: articulated ? "grab" : "auto",
        opacity: sprite.opacity,
      };
  }
};

export type UseSpriteVisualsOptions = {
  sprite: Sprite;
  mode: RenderMode;
  articulated?: boolean;
  pattern?: string;
  cursorOverride?: SpriteStyle["cursor"];
  strokeOverride?: string;
  strokeWidthOverride?: number;
  lineJoin?: SpriteStyle["strokeLinejoin"];
  lineCap?: SpriteStyle["strokeLinecap"];
};

export type SpriteVisuals = {
  fill?: string;
  stroke: string;
  baseFill?: string;
  baseStroke: string;
  /** Unzoomed stroke width, before stroke padding. */
  strokeWidth: number;
  /** How many `--stroke-pad`s are added to `strokeWidth` (negative shrinks it). */
  strokePad: number;
  opacity?: number;
  spriteStyle: SpriteStyle;
  /** Zoomed, padded stroke width as a CSS value; goes in `style`, since presentation attributes can't use var(). */
  zoomStrokeWidth: string | number;
  applyLightingColor: (color?: string) => string | undefined;
};

/** Stroke defaults every sprite inherits; set on whatever contains sprites (body root, thumbnails, previews). */
export const SPRITE_ROOT_STYLE = {
  strokeLinejoin: "round",
  strokeLinecap: "round",
} as const satisfies SpriteStyle;

/** CSS vars read by sprite stroke widths; set on the svg that draws the bodies. */
export const getZoomVars = (zoom: number) => ({
  "--zoom": String(zoom),
  "--stroke-pad": `${getStrokePadding(zoom)}px`,
});

/** Fallbacks match zoom 1, for bodies drawn outside the canvas svg (which sets the vars). */
const ZOOM_VAR = "var(--zoom, 1)";
const STROKE_PAD_VAR = `var(--stroke-pad, ${getStrokePadding(1)}px)`;

/**
 * Stroke width scaled by zoom at paint time. Reading the zoom from CSS vars keeps sprites out of
 * ZoomContext, so zooming no longer re-renders every sprite.
 */
export const getZoomStrokeWidth = (strokeWidth: number, strokePad: number): string | number => {
  if (strokePad === 0) {
    return strokeWidth === 0 ? 0 : `calc(${strokeWidth}px * ${ZOOM_VAR})`;
  }
  return `calc((${strokeWidth}px + ${strokePad} * ${STROKE_PAD_VAR}) * ${ZOOM_VAR})`;
};

export const useSpriteVisuals = ({
  sprite,
  mode,
  articulated,
  pattern,
  cursorOverride,
  strokeOverride,
  strokeWidthOverride,
  lineJoin,
  lineCap,
}: UseSpriteVisualsOptions): SpriteVisuals => {
  let { fill, stroke, strokeWidth, strokePad, cursor, opacity } = getSpriteAttributes(
    sprite,
    mode,
    articulated,
    pattern,
  );
  const gradientActive =
    (Boolean(sprite.fillGradient) || Boolean(sprite.fillGradients)) &&
    !pattern &&
    (mode === "default" || mode === "outer_outline");
  const allowColorMapOverrides =
    !gradientActive && !sprite.customSprite && !pattern && (mode === "default" || mode === "pattern");
  if (allowColorMapOverrides) {
    const colorOverride = sprite.colors?.color0;
    if (colorOverride) {
      fill = colorOverride;
    }
    const strokeColorOverride = sprite.strokeColors?.stroke_color0;
    if (strokeColorOverride) {
      stroke = strokeColorOverride;
    }
  }
  if (strokeOverride) {
    stroke = strokeOverride;
  }
  if (strokeWidthOverride !== undefined) {
    strokeWidth = strokeWidthOverride;
    strokePad = 0;
  }

  const colorTransform = useColorTransform();
  const applyTransform = mode === "default" || mode === "outline";
  const applyLightingColor = useCallback(
    (color?: string) => {
      if (!applyTransform) {
        return color;
      }
      return colorTransform(color) ?? color;
    },
    [applyTransform, colorTransform],
  );

  const baseFill = fill;
  const baseStroke = stroke;
  const litFill = applyLightingColor(baseFill);
  const litStroke = applyLightingColor(baseStroke) ?? baseStroke;
  const blurRadius = typeof sprite.blur === "number" ? Math.min(5, Math.max(0, sprite.blur)) : undefined;
  const blurFilter = typeof blurRadius === "number" && blurRadius > 0 ? `blur(${blurRadius}px)` : undefined;
  // Only what differs from the inherited defaults (SPRITE_ROOT_STYLE, cursor auto) goes on the element.
  const resolvedCursor = cursorOverride ?? cursor;
  const spriteStyle = useMemo<SpriteStyle>(() => {
    const style: SpriteStyle = {};
    if (resolvedCursor !== "auto") style.cursor = resolvedCursor;
    if (lineJoin !== SPRITE_ROOT_STYLE.strokeLinejoin) style.strokeLinejoin = lineJoin;
    if (lineCap !== SPRITE_ROOT_STYLE.strokeLinecap) style.strokeLinecap = lineCap;
    if (blurFilter) style.filter = blurFilter;
    return style;
  }, [blurFilter, resolvedCursor, lineJoin, lineCap]);

  return {
    fill: litFill,
    stroke: litStroke,
    baseFill,
    baseStroke,
    strokeWidth,
    strokePad,
    opacity,
    spriteStyle,
    zoomStrokeWidth: getZoomStrokeWidth(strokeWidth, strokePad),
    applyLightingColor,
  };
};
