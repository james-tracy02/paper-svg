import type { Color } from "./primitives";
import { getSprite } from "../sprites/loader";
import { outsetPathData } from "../render/outsetPath";
import type { Shape, Sprite, CustomSprite, SpriteGradient } from "./Sprite";
import type { ColorDerive } from "./ColorSlot";

interface BuilderState {
  fill: Color;
  fillGradient?: SpriteGradient;
  fillGradients: Record<number, SpriteGradient>;
  gradientOffsetX: number;
  gradientOffsetY: number;
  gradientScaleX: number;
  gradientScaleY: number;
  gradientStart?: number;
  stroke: Color;
  strokeWidth: number;
  offsetX: number;
  offsetY: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  skewX?: number;
  skewY?: number;
  shape?: Shape;
  customSprite?: CustomSprite;
  colors: Color[];
  opacity?: number;
  strokeColors: Color[];
  remappings: Record<number, number>;
  strokeRemappings: Record<number, number>;
  inheritStrokeColors: Record<number, boolean>;
  pattern?: Sprite;
  patternFills: Record<number, Sprite>;
  dynamicPath?: string;
  href?: string;
  shadowColorIndex?: number;
  shadowColor?: Color;
  highlightColorIndex?: number;
  highlightColor?: Color;
  defaultDerives?: (ColorDerive | null)[];
  lineCap?: "butt" | "round" | "square";
  lineJoin?: "miter" | "round" | "bevel";
  blur?: number;
  maskScaleX: number;
  maskScaleY: number;
  outsets: Record<number, number>;
  clipPathIndices?: number[];
}

const getKey = (index: number, prefix: string = "color"): string => {
  return `${prefix}${index.toString()}`;
};

/** Extend `colors` to `length` slots by repeating the last entry. No-ops if already long enough or empty. */
const padColors = (colors: Color[], length: number): Color[] => {
  if (colors.length >= length || colors.length === 0) return colors;
  const last = colors[colors.length - 1];
  const padded = [...colors];
  while (padded.length < length) padded.push(last);
  return padded;
};

/** Splice each [color, index] into `colors`, lowest index first so indices refer to final positions. */
const insertColors = (colors: Color[], inserts: [Color | undefined, number | undefined][]): Color[] => {
  const resolved = [...colors];
  inserts
    .filter((entry): entry is [Color, number] => entry[0] !== undefined && typeof entry[1] === "number" && entry[1] >= 0)
    .sort((a, b) => a[1] - b[1])
    .forEach(([color, index]) => {
      if (index <= resolved.length) resolved.splice(index, 0, color);
    });
  return resolved;
};

const buildColorMap = (
  colors: Color[],
  remappings: Record<number, number>,
  shadowColor?: Color,
  shadowColorIndex?: number,
  highlightColor?: Color,
  highlightColorIndex?: number,
  keyPrefix: string = "color",
): Record<string, Color> => {
  const resolvedColors = insertColors(colors, [
    [shadowColor, shadowColorIndex],
    [highlightColor, highlightColorIndex],
  ]);

  return resolvedColors.reduce<Record<string, Color>>((map, color, index) => {
    const mappedIndex = remappings[index] ?? index;
    map[getKey(mappedIndex, keyPrefix)] = color;
    return map;
  }, {});
};

const cloneGradient = (gradient: SpriteGradient): SpriteGradient => ({
  ...gradient,
  stops: gradient.stops.map((stop) => ({ ...stop })),
});

const buildGradientMap = (
  gradients: Record<number, SpriteGradient>,
  remappings: Record<number, number>,
  inheritSlots: Record<number, boolean>,
  customSpriteColors?: number,
  keyPrefix: string = "color",
): Record<string, SpriteGradient> => {
  const entries = Object.entries(gradients);
  if (entries.length === 0) return {};

  const totalSlots =
    typeof customSpriteColors === "number"
      ? customSpriteColors
      : Math.max(0, ...entries.map(([slot]) => Number(slot))) + 1;

  const assignableSlots: number[] = [];
  for (let slotIndex = 0; slotIndex < totalSlots; slotIndex += 1) {
    if (!inheritSlots[slotIndex]) {
      assignableSlots.push(slotIndex);
    }
  }

  return entries.reduce<Record<string, SpriteGradient>>((map, [slotKey, gradient]) => {
    const slotIndex = Number(slotKey);
    if (!Number.isFinite(slotIndex)) return map;
    const remapped = remappings[slotIndex] ?? slotIndex;
    const mappedSlot = Object.keys(inheritSlots).length ? assignableSlots[remapped] : remapped;
    if (mappedSlot === undefined) return map;
    map[getKey(mappedSlot, keyPrefix)] = cloneGradient(gradient);
    return map;
  }, {});
};

const buildInheritedColorMap = (
  colors: Color[],
  remappings: Record<number, number>,
  inheritSlots: Record<number, boolean>,
  customSpriteColors?: number,
  shadowColor?: Color,
  shadowColorIndex?: number,
  highlightColor?: Color,
  highlightColorIndex?: number,
  keyPrefix: string = "color",
): Record<string, Color> => {
  const resolvedColors = insertColors(colors, [
    [shadowColor, shadowColorIndex],
    [highlightColor, highlightColorIndex],
  ]);

  const totalSlots =
    typeof customSpriteColors === "number"
      ? customSpriteColors
      : resolvedColors.length + Object.keys(inheritSlots).length;

  const assignableSlots: number[] = [];
  for (let slotIndex = 0; slotIndex < totalSlots; slotIndex += 1) {
    if (!inheritSlots[slotIndex]) {
      assignableSlots.push(slotIndex);
    }
  }

  return resolvedColors.reduce<Record<string, Color>>((map, color, index) => {
    if (index >= assignableSlots.length) return map;
    const remappedAssignable = remappings[index] ?? index;
    const mappedSlot = assignableSlots[remappedAssignable];
    if (mappedSlot === undefined) return map;
    map[getKey(mappedSlot, keyPrefix)] = color;
    return map;
  }, {});
};

export default class SpriteBuilder {
  private readonly _state: BuilderState;

  constructor(state?: BuilderState) {
    this._state =
      state ??
      ({
        fill: "transparent",
        stroke: "black",
        strokeWidth: 1,
        offsetX: 0,
        offsetY: 0,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        colors: [],
        strokeColors: [],
        remappings: {},
        strokeRemappings: {},
        inheritStrokeColors: {},
        blur: undefined,
        fillGradient: undefined,
        fillGradients: {},
        gradientOffsetX: 0,
        gradientOffsetY: 0,
        gradientScaleX: 1,
        gradientScaleY: 1,
        maskScaleX: 1,
        maskScaleY: 1,
        outsets: {},
        patternFills: {},
        clipPathIndices: undefined,
      } satisfies BuilderState);
  }

  /** helper to create a new builder with modified state */
  private with(patch: Partial<BuilderState>): SpriteBuilder {
    return new SpriteBuilder({ ...this._state, ...patch });
  }

  setStrokeWidth(w: number): SpriteBuilder {
    return this.with({ strokeWidth: w });
  }

  setStroke(c: Color): SpriteBuilder {
    return this.with({ stroke: c });
  }

  setOffset(x: number, y: number): SpriteBuilder {
    return this.with({ offsetX: x, offsetY: y });
  }

  setScale(x: number, y: number): SpriteBuilder {
    return this.with({ scaleX: x, scaleY: y });
  }

  setGradientOffset(x: number, y: number): SpriteBuilder {
    return this.with({ gradientOffsetX: x, gradientOffsetY: y });
  }

  /** Fraction of the sprite's height (0 is the top) above which a renderer keeps a gradient at its base color. */
  setGradientStart(start: number): SpriteBuilder {
    return this.with({ gradientStart: start });
  }

  setGradientScale(x: number, y: number): SpriteBuilder {
    return this.with({ gradientScaleX: x, gradientScaleY: y });
  }

  setMaskScale(x: number, y?: number): SpriteBuilder {
    const resolvedY = typeof y === "number" ? y : x;
    return this.with({ maskScaleX: x, maskScaleY: resolvedY });
  }

  setRotation(d: number): SpriteBuilder {
    return this.with({ rotation: d });
  }

  setFill(c: Color | undefined): SpriteBuilder {
    if (!c) {
      return this;
    }
    return this.with({ fill: c });
  }

  setFillGradient(gradient?: SpriteGradient): SpriteBuilder {
    if (!gradient) {
      return this.with({ fillGradient: undefined });
    }
    return this.with({
      fillGradient: cloneGradient(gradient),
    });
  }

  setFillGradientForSlot(slotIndex: number, gradient?: SpriteGradient): SpriteBuilder {
    if (!gradient) {
      const next = { ...this._state.fillGradients };
      delete next[slotIndex];
      return this.with({ fillGradients: next });
    }
    return this.with({
      fillGradients: { ...this._state.fillGradients, [slotIndex]: cloneGradient(gradient) },
    });
  }

  setFillGradients(gradients: Record<number, SpriteGradient>): SpriteBuilder {
    const next: Record<number, SpriteGradient> = {};
    Object.entries(gradients).forEach(([slotKey, gradient]) => {
      const slotIndex = Number(slotKey);
      if (!Number.isFinite(slotIndex)) return;
      next[slotIndex] = cloneGradient(gradient);
    });
    return this.with({ fillGradients: next });
  }

  setShape(s: Shape): SpriteBuilder {
    return this.with({ shape: s });
  }

  setSkew(x: number, y: number): SpriteBuilder {
    return this.with({ skewX: x, skewY: y });
  }

  setCustomSprite(customSprite?: string | CustomSprite): SpriteBuilder {
    return this.with({
      customSprite: typeof customSprite === "string" ? getSprite(customSprite) : customSprite,
    });
  }

  setOpacity(opacity: number): SpriteBuilder {
    return this.with({ opacity });
  }

  remapColor(fromIndex: number, toIndex: number): SpriteBuilder {
    return this.with({
      remappings: { ...this._state.remappings, [fromIndex]: toIndex },
    });
  }

  remapStrokeColor(fromIndex: number, toIndex: number): SpriteBuilder {
    return this.with({
      strokeRemappings: {
        ...this._state.strokeRemappings,
        [fromIndex]: toIndex,
      },
    });
  }

  inheritStrokeColor(slotIndex: number): SpriteBuilder {
    return this.with({
      inheritStrokeColors: {
        ...this._state.inheritStrokeColors,
        [slotIndex]: true,
      },
    });
  }

  scalesWith(...n: number[]): SpriteBuilder {
    return this.scalesWithX(...n).scalesWithY(...n);
  }

  scalesWithX(...xs: number[]): SpriteBuilder {
    const newScaleX = xs.reduce((prev, curr) => prev * curr, this._state.scaleX);
    return this.with({ scaleX: newScaleX });
  }

  scalesWithY(...ys: number[]): SpriteBuilder {
    const newScaleY = ys.reduce((prev, curr) => prev * curr, this._state.scaleY);
    return this.with({ scaleY: newScaleY });
  }

  setCustomColors(...colors: Color[]): SpriteBuilder {
    return this.with({ colors: colors });
  }

  setCustomStrokeColors(...strokeColors: Color[]): SpriteBuilder {
    return this.with({ strokeColors: strokeColors });
  }

  setPattern(pattern?: Sprite): SpriteBuilder {
    return this.with({ pattern });
  }

  setPatternFill(index: number, pattern: Sprite): SpriteBuilder {
    return this.with({
      patternFills: { ...this._state.patternFills, [index]: pattern },
    });
  }

  setPatternIf(condition: boolean, pattern: Sprite): SpriteBuilder {
    if (condition) {
      return this.setPattern(pattern);
    }
    return this;
  }

  setHref(href: string): SpriteBuilder {
    return this.with({ href });
  }

  setPath(d: string): SpriteBuilder {
    return this.with({ dynamicPath: d });
  }

  translatesWithX(...xs: number[]): SpriteBuilder {
    const newOffsetX = xs.reduce((prev, curr) => prev + curr, this._state.offsetX);
    return this.with({ offsetX: newOffsetX });
  }

  translatesWithY(...ys: number[]): SpriteBuilder {
    const newOffsetY = ys.reduce((prev, curr) => prev + curr, this._state.offsetY);
    return this.with({ offsetY: newOffsetY });
  }

  setShadowColorIndex(index: number): SpriteBuilder {
    return this.with({ shadowColorIndex: index });
  }

  setShadowColor(color: Color): SpriteBuilder {
    return this.with({ shadowColor: color });
  }

  setHighlightColorIndex(index: number): SpriteBuilder {
    return this.with({ highlightColorIndex: index });
  }

  setHighlightColor(color: Color): SpriteBuilder {
    return this.with({ highlightColor: color });
  }

  /** Which user-picked colors derive from earlier ones when nothing is stored for them; null is picked. */
  setDefaultDerives(...defaultDerives: (ColorDerive | null)[]): SpriteBuilder {
    return this.with({ defaultDerives });
  }

  setLineCap(lineCap: "butt" | "round" | "square"): SpriteBuilder {
    return this.with({ lineCap });
  }

  setLineJoin(lineJoin: "miter" | "round" | "bevel"): SpriteBuilder {
    return this.with({ lineJoin });
  }

  setBlur(blur?: number): SpriteBuilder {
    if (blur === undefined) {
      return this.with({ blur: undefined });
    }
    const clamped = Math.min(5, Math.max(0, blur));
    const resolved = clamped > 0 ? clamped : undefined;
    return this.with({ blur: resolved });
  }

  rotatesWith(degrees: number): SpriteBuilder {
    const newRotation = this._state.rotation + degrees;
    return this.with({ rotation: newRotation });
  }

  setOutset(outset: number, index: number = 0): SpriteBuilder {
    if (!Number.isFinite(outset)) {
      return this;
    }
    return this.with({
      outsets: {
        ...this._state.outsets,
        [index]: outset,
      },
    });
  }

  setClipPathIndices(indices: number[]): SpriteBuilder {
    if (!Array.isArray(indices) || indices.length === 0) {
      return this.with({ clipPathIndices: undefined });
    }
    const normalized = indices.filter((index) => Number.isFinite(index)).map((index) => Math.max(0, index));
    return this.with({ clipPathIndices: normalized.length ? normalized : undefined });
  }

  addClipPathIndex(index: number = 0): SpriteBuilder {
    if (!Number.isFinite(index)) {
      return this;
    }
    const normalized = Math.max(0, index);
    const existing = this._state.clipPathIndices ?? [];
    if (existing.includes(normalized)) {
      return this;
    }
    return this.with({ clipPathIndices: [...existing, normalized] });
  }

  private _build(): Sprite {
    const s = this._state;
    const inheritStrokeColors = Object.keys(s.inheritStrokeColors).reduce<Record<string, boolean>>((map, slot) => {
      const index = Number(slot);
      if (Number.isFinite(index)) {
        map[getKey(index, "color")] = true;
      }
      return map;
    }, {});
    const inheritSlots = Object.keys(s.inheritStrokeColors).reduce<Record<number, boolean>>((map, slot) => {
      const index = Number(slot);
      if (Number.isFinite(index)) {
        map[index] = true;
      }
      return map;
    }, {});
    const hasInheritedSlots = Object.keys(inheritSlots).length > 0;
    const requiredColors = s.customSprite?.colors ?? 0;
    const paddedColors = padColors(s.colors, requiredColors);
    const customSprite = s.customSprite
      ? {
          ...s.customSprite,
          elements: s.customSprite.elements.map((el, index) => {
            const outset = s.outsets[index];
            if (!outset || !el.d) {
              return { ...el };
            }
            return {
              ...el,
              d: outsetPathData(el.d, outset),
            };
          }),
        }
      : undefined;

    return {
      translate: { x: s.offsetX, y: s.offsetY },
      scale: { x: s.scaleX, y: s.scaleY },
      rotate: s.rotation,
      fill: s.fill,
      fillGradient: s.fillGradient,
      fillGradients: Object.keys(s.fillGradients).length
        ? buildGradientMap(s.fillGradients, s.remappings, inheritSlots, s.customSprite?.colors, "color")
        : undefined,
      gradientOffset:
        s.gradientOffsetX !== 0 || s.gradientOffsetY !== 0 ? { x: s.gradientOffsetX, y: s.gradientOffsetY } : undefined,
      gradientScale:
        s.gradientScaleX !== 1 || s.gradientScaleY !== 1 ? { x: s.gradientScaleX, y: s.gradientScaleY } : undefined,
      stroke: s.stroke,
      strokeWidth: s.strokeWidth,
      shape: s.shape,
      skew: { x: s.skewX ?? 0, y: s.skewY ?? 0 },
  customSprite,
      colors: hasInheritedSlots
        ? buildInheritedColorMap(
            paddedColors,
            s.remappings,
            inheritSlots,
            s.customSprite?.colors,
            s.shadowColor,
            s.shadowColorIndex,
            s.highlightColor,
            s.highlightColorIndex,
            "color",
          )
        : buildColorMap(
            paddedColors,
            s.remappings,
            s.shadowColor,
            s.shadowColorIndex,
            s.highlightColor,
            s.highlightColorIndex,
            "color",
          ),
      inheritStrokeColors: Object.keys(inheritStrokeColors).length ? inheritStrokeColors : undefined,
      strokeColors: buildColorMap(s.strokeColors, s.strokeRemappings, undefined, undefined, undefined, undefined, "stroke_color"),
      opacity: s.opacity,
      pattern: s.pattern,
      patternFills: Object.keys(s.patternFills).length ? { ...s.patternFills } : undefined,
      dynamicPath: s.dynamicPath && s.outsets[0] ? outsetPathData(s.dynamicPath, s.outsets[0]) : s.dynamicPath,
      href: s.href,
      lineCap: s.lineCap,
      lineJoin: s.lineJoin,
      blur: s.blur,
      maskScale:
        s.maskScaleX !== 1 || s.maskScaleY !== 1
          ? {
              x: s.maskScaleX,
              y: s.maskScaleY,
            }
          : undefined,
      clipPathIndices: s.clipPathIndices,
    };
  }

  build(): Sprite {
    return this._build();
  }
}
