import type { Color } from "./primitives";
import type { Transform } from "./Transform";

export type Shape = "ellipse" | "rect" | "fuzzy" | "soft" | "line" | "half_circle";
export type SpriteGradientStop = {
  offset: number;
  color: Color;
  opacity?: number;
};

export type SpriteLinearGradient = {
  type: "linear";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stops: SpriteGradientStop[];
};

export type SpriteRadialGradient = {
  type: "radial";
  cx: number;
  cy: number;
  r: number;
  fx?: number;
  fy?: number;
  stops: SpriteGradientStop[];
};

export type SpriteGradient = SpriteLinearGradient | SpriteRadialGradient;

export type Sprite = Transform & {
  fill?: Color;
  fillGradient?: SpriteGradient;
  fillGradients?: Record<string, SpriteGradient>;
  /** SVG gradientTransform used instead of one built from the sprite's bounds (set for shared gradient spaces). */
  gradientTransform?: string;
  gradientOffset?: {
    x: number;
    y: number;
  };
  gradientScale?: {
    x: number;
    y: number;
  };
  stroke?: Color;
  strokeWidth?: number;
  shape?: Shape;
  customSprite?: CustomSprite;
  colors?: Record<string, Color>;
  inheritStrokeColors?: Record<string, boolean>;
  strokeColors?: Record<string, Color>;
  opacity?: number;
  pattern?: Sprite;
  patternFills?: Record<number, Sprite>;
  dynamicPath?: string;
  href?: string;
  lineCap?: "butt" | "round" | "square";
  lineJoin?: "miter" | "round" | "bevel";
  blur?: number;
  maskScale?: {
    x: number;
    y: number;
  };
  clipPathIndices?: number[];
};

export type CustomSprite = Transform & {
  id: string;
  colors: number;
  strokeColors: number;
  elements: CustomElement[];
  /** Raster upload: rendered as an <image> instead of elements. */
  image?: {
    href: string;
    width: number;
    height: number;
  };
  offsetX?: number;
  offsetY?: number;
  size?: {
    width: number;
    height: number;
  };
  bounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  origin?: {
    x: number;
    y: number;
  };
};

export type CustomElement = {
  transform?: string;
  d?: string;
  colorKey?: string;
  strokeColorKey?: string;
  noStroke?: boolean;
  noFill?: boolean;
};
