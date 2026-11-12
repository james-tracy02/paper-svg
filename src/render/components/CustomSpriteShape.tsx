import React from "react";
import type { Sprite } from "../../types/Sprite";
import { gradientDefId, renderGradientDefinition } from "../gradient";
import { getSpriteTransform } from "../transform";
import type { RenderMode, SpriteStyle } from "../spriteTypes";
import { getZoomStrokeWidth } from "../hooks/useSpriteVisuals";
import { pathDefId } from "../hashKey";
import { useHoistedDefs } from "../useHoistedDefs";
import type { BindTransform } from "../Sprite";

export type CustomSpriteShapeProps = {
  ownerId: string;
  sprite: Sprite;
  transform: string;
  allowSymbols: boolean;
  mode: RenderMode;
  mask: boolean;
  pattern?: string;
  patternFills?: Record<string, string>;
  baseFill?: string;
  /** When set, overrides ALL element fills unconditionally (used for stroke-only sandwich pass). */
  fillOverride?: string;
  gradientTransform?: string;
  gradientDefinition?: Sprite["fillGradient"];
  gradientMap?: Sprite["fillGradients"];
  baseStroke: string;
  strokeWidth: number;
  /** See SpriteVisuals.strokePad. */
  strokePad: number;
  strokeOverride?: string;
  strokeWidthOverride?: number;
  style: SpriteStyle;
  opacity?: number;
  applyLightingColor: (color?: string) => string | undefined;
  /** See SvgSprite: binds the element carrying `transform` to the pose. */
  bindTransform?: BindTransform;
};

const CustomSpriteShape: React.FC<CustomSpriteShapeProps> = ({
  ownerId,
  sprite,
  transform,
  allowSymbols,
  mode,
  mask,
  pattern,
  patternFills,
  baseFill,
  fillOverride,
  gradientTransform,
  gradientDefinition,
  gradientMap,
  baseStroke,
  strokeWidth,
  strokePad,
  strokeOverride,
  strokeWidthOverride,
  style,
  opacity,
  applyLightingColor,
  bindTransform,
}) => {
  const customSprite = sprite.customSprite!;
  const customRootTransform = getSpriteTransform(customSprite);
  // One wrapper per sprite: the sprite and custom-root transforms compose on the same <g>.
  const combinedTransform = [transform, customRootTransform].filter(Boolean).join(" ");

  const gradientActive =
    (Boolean(gradientDefinition) || Boolean(gradientMap)) &&
    !pattern &&
    !mask &&
    (mode === "default" || mode === "outer_outline");

  const resolveFill = (colorKey: string | undefined, index: number, noFill?: boolean) => {
    if (noFill) return "none";
    // When fillOverride is set, force ALL element fills to that value (e.g. "none" for stroke-only pass).
    if (fillOverride !== undefined) return fillOverride;
    if (colorKey && sprite.inheritStrokeColors?.[colorKey]) return baseStroke;
    if (mode === "outline" || mask) return baseFill;
    if (pattern) return baseFill;
    const perIndexPatternId = patternFills?.[String(index)];
    if (perIndexPatternId !== undefined) return `url(#${perIndexPatternId})`;
    if (colorKey) return sprite.colors?.[colorKey] ?? baseFill;
    return baseFill;
  };

  const resolveStroke = (strokeColorKey?: string) => {
    const mappedStroke = strokeColorKey ? sprite.strokeColors?.[strokeColorKey] : undefined;
    if (mappedStroke === "none") return "none";
    if (strokeOverride) return strokeOverride;
    if (mappedStroke) return mappedStroke;
    return baseStroke;
  };

  // Gradients are hoisted to the body's defs under content-hashed ids (see HoistedDefs).
  const primaryGradientId = gradientDefinition ? gradientDefId(gradientDefinition, gradientTransform) : undefined;
  const slotGradientIds: Record<string, string> = {};
  const gradientDefs: { id: string; node: React.ReactNode }[] = [];
  if (gradientActive) {
    if (gradientDefinition && primaryGradientId) {
      gradientDefs.push({
        id: primaryGradientId,
        node: renderGradientDefinition(gradientDefinition, primaryGradientId, gradientTransform),
      });
    }
    Object.entries(gradientMap ?? {}).forEach(([key, gradient]) => {
      if (!gradient) return;
      const id = gradientDefId(gradient, gradientTransform);
      slotGradientIds[key] = id;
      gradientDefs.push({ id, node: renderGradientDefinition(gradient, id, gradientTransform) });
    });
  }
  const inlineGradientDefs = useHoistedDefs(gradientDefs);

  if (customSprite.image) {
    const { href, width, height } = customSprite.image;
    // ponytail: images get no outline and mask as their bounding rect (no per-pixel alpha)
    if (mode === "outline" || mode === "outer_outline") return null;
    return mask || mode.includes("mask") ? (
      <rect ref={bindTransform?.(combinedTransform)} transform={combinedTransform} width={width} height={height} fill={baseFill} />
    ) : (
      <image
        ref={bindTransform?.(combinedTransform)}
        transform={combinedTransform}
        href={href}
        width={width}
        height={height}
        opacity={opacity}
        preserveAspectRatio="none"
      />
    );
  }

  // Stroke width is a CSS value so it can read the zoom vars. It inherits, so it goes once on the wrapper and
  // unstroked elements just leave `stroke` off. `strokeWidth`/`strokePad` already include the override, which also
  // applies to `noStroke` elements.
  const zoomStrokeWidth = getZoomStrokeWidth(strokeWidth, strokePad);
  const stroked = zoomStrokeWidth !== 0;
  // `filter` doesn't inherit, so each element keeps its own (as before); the rest of `style` inherits.
  const { filter, ...inheritedStyle } = style;
  const leafStyle = filter ? { filter } : undefined;
  const wrapperStyle = stroked ? { ...inheritedStyle, strokeWidth: zoomStrokeWidth } : inheritedStyle;

  const leaves = customSprite.elements.map((el, index) => {
    const elSymbolId = allowSymbols && el.d ? pathDefId(el.d) : null;
    const elementGradientId = el.colorKey && slotGradientIds[el.colorKey] ? slotGradientIds[el.colorKey] : primaryGradientId;
    const resolvedFill = resolveFill(el.colorKey, index, el.noFill);
    const isPatternFill = resolvedFill?.startsWith("url(#");
    const elFill =
      !isPatternFill && gradientActive && elementGradientId && resolvedFill !== "none" && resolvedFill !== undefined
        ? `url(#${elementGradientId})`
        : resolvedFill;
    const elStroked = stroked && (!el.noStroke || strokeWidthOverride !== undefined);
    const elStrokeBase = resolveStroke(el.strokeColorKey);
    const elStroke = elStroked ? (applyLightingColor(elStrokeBase) ?? elStrokeBase) : undefined;
    const common = {
      fill: applyLightingColor(elFill),
      stroke: elStroke,
      style: leafStyle,
      opacity,
    };
    return { el, index, elSymbolId, common, elStroked };
  });

  const renderLeaf = (
    { el, index, elSymbolId, common, elStroked }: (typeof leaves)[number],
    transform: string | undefined,
    style: SpriteStyle | undefined,
    ref?: (element: Element | null) => void,
  ) =>
    elSymbolId ? (
      // The shared <path> carries vector-effect itself; it doesn't inherit through <use>.
      <use key={`${ownerId}_sprite_${index}`} ref={ref} href={`#${elSymbolId}`} transform={transform} {...common} style={style} />
    ) : (
      <path
        key={`${ownerId}_sprite_${index}`}
        ref={ref}
        transform={transform}
        d={el.d}
        {...common}
        style={style}
        vectorEffect={elStroked ? "non-scaling-stroke" : undefined}
      />
    );

  const hasStyle = (value: SpriteStyle) => Object.keys(value).length > 0;

  // A lone element takes the wrapper's transform and style itself.
  if (leaves.length === 1) {
    const leaf = leaves[0];
    const transform = [combinedTransform, leaf.el.transform].filter(Boolean).join(" ");
    const style = { ...wrapperStyle, ...leafStyle };
    return (
      <>
        {inlineGradientDefs}
        {renderLeaf(leaf, transform || undefined, hasStyle(style) ? style : undefined, bindTransform?.(transform || undefined))}
      </>
    );
  }

  return (
    <g
      ref={bindTransform?.(combinedTransform || undefined)}
      transform={combinedTransform || undefined}
      style={hasStyle(wrapperStyle) ? wrapperStyle : undefined}
    >
      {inlineGradientDefs}
      {leaves.map((leaf) => renderLeaf(leaf, leaf.el.transform, leafStyle))}
    </g>
  );
};

export default CustomSpriteShape;
