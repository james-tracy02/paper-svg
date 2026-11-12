import type { Sprite, SpriteGradient } from "../types/Sprite";
import { buildGradientTransform, gradientDefId, renderGradientDefinition } from "./gradient";
import { getSpriteTransform } from "./transform";
import React, { useContext } from "react";
import {
  EllipseSprite,
  FuzzySprite,
  HalfCircleSprite,
  LineSprite,
  RectSprite,
  SoftSprite,
} from "./components/SpriteShapes";
import { strokeAttributes } from "./strokeAttributes";
import type { RenderMode, SpriteStyle } from "./spriteTypes";
import { useSpriteVisuals } from "./hooks/useSpriteVisuals";
import CustomSpriteShape from "./components/CustomSpriteShape";
import ImageSprite from "./components/ImageSprite";
import { useHoistedDefs } from "./useHoistedDefs";
import { bindPose, joinRefs, PoseBindingsContext, prefixWriter, setAttr } from "./poseBindings";
import { matrixTransformToSvg } from "./transform";
import type { RenderNode } from "./RenderTree";

type SvgSpriteProps = {
  id: string;
  articulated?: boolean;
  sprite: Sprite;
  mode: RenderMode;
  pattern?: string;
  patternFills?: Record<string, string>;
  /** Draw custom sprite paths inline instead of through the shared <path> defs (SpriteDefs). */
  disableSymbols?: boolean;
  cursorOverride?: SpriteStyle["cursor"];
  fillOverride?: string;
  strokeOverride?: string;
  strokeWidthOverride?: number;
  /** Transform composed before the sprite's own, so the caller needs no wrapper <g> for it. */
  baseTransform?: string;
  /**
   * The node this sprite draws, so `Rig`'s `setPose` can move it without a render: its driven path,
   * and `baseTransform` when given, which must then be the node's `matrixTransformToSvg(matrix)`.
   */
  poseNode?: string;
};

/** A ref callback for the element carrying the sprite's transform, given the transform it rendered. */
export type BindTransform = (rendered: string | undefined) => ((element: Element | null) => void) | undefined;

const nodeTransform = (node: RenderNode) => matrixTransformToSvg(node.matrix);

const isMaskMode = (mode: RenderMode) => mode === "mask" || mode === "outline_mask" || mode === "mask_no_outline";

const getTransformForMode = (sprite: Sprite, mode: RenderMode) => {
  if (mode === "pattern") return "";
  if (isMaskMode(mode) && sprite.maskScale) {
    return getSpriteTransform({
      ...sprite,
      scale: {
        x: sprite.scale.x * sprite.maskScale.x,
        y: sprite.scale.y * sprite.maskScale.y,
      },
    });
  }
  return getSpriteTransform(sprite);
};

const supportsGradientFill = (mode: RenderMode) => mode === "default" || mode === "outer_outline";

const SvgSpriteComponent: React.FC<SvgSpriteProps> = ({
  id,
  articulated,
  sprite,
  mode,
  pattern,
  patternFills,
  cursorOverride,
  disableSymbols,
  fillOverride,
  strokeOverride,
  strokeWidthOverride,
  baseTransform,
  poseNode,
}) => {
  const bindings = useContext(PoseBindingsContext);
  const bindTransform: BindTransform | undefined =
    bindings && poseNode && baseTransform
      ? (rendered) => bindPose(bindings, poseNode, prefixWriter(poseNode, "transform", baseTransform, rendered, nodeTransform))
      : undefined;
  const mask = isMaskMode(mode);
  const transformStr = [baseTransform, getTransformForMode(sprite, mode)].filter(Boolean).join(" ");
  const lineJoin = sprite.lineJoin ?? "round";
  const lineCap = sprite.lineCap ?? "round";
  const allowSymbols = !disableSymbols;
  const {
    fill,
    stroke,
    baseFill,
    baseStroke,
    strokeWidth,
    strokePad,
    opacity,
    spriteStyle,
    zoomStrokeWidth,
    applyLightingColor,
  } = useSpriteVisuals({
    sprite,
    mode,
    articulated,
    pattern,
    cursorOverride,
    strokeOverride,
    strokeWidthOverride,
    lineJoin,
    lineCap,
  });
  const slotGradient = sprite.fillGradients?.color0;
  const primaryGradient = sprite.fillGradient;
  const hasAnyGradient = Boolean(primaryGradient) || Boolean(sprite.fillGradients);
  const gradientEnabled =
    supportsGradientFill(mode) &&
    !pattern &&
    !isMaskMode(mode) &&
    Boolean(primaryGradient ?? slotGradient) &&
    sprite.fill !== "none" &&
    sprite.fill !== undefined;
  const gradientTransform = hasAnyGradient ? buildGradientTransform(sprite) : undefined;
  // Custom sprites hoist their own (per-slot) gradients.
  const shapeGradient = !sprite.customSprite && gradientEnabled ? (primaryGradient ?? slotGradient) : undefined;
  const gradientId = shapeGradient ? gradientDefId(shapeGradient, gradientTransform) : undefined;
  const inlineDefs = useHoistedDefs(
    shapeGradient && gradientId
      ? [{ id: gradientId, node: renderGradientDefinition(shapeGradient, gradientId, gradientTransform) }]
      : [],
  );
  const withDefs = (node: React.ReactNode) =>
    inlineDefs ? (
      <>
        {inlineDefs}
        {node}
      </>
    ) : (
      node
    );
  const gradientFill = gradientId ? `url(#${gradientId})` : undefined;
  const resolvedFill = fillOverride ?? gradientFill ?? fill;
  const resolvedBaseFill = fillOverride ?? (sprite.customSprite ? baseFill : (gradientFill ?? baseFill));
  const normalizedShape = sprite.shape ?? "ellipse";
  const transform = transformStr || undefined;

  if (sprite.href) {
    return withDefs(<ImageSprite transform={transform} href={sprite.href} bindTransform={bindTransform} />);
  }

  if (sprite.dynamicPath) {
    const litFill = applyLightingColor(resolvedFill);
    const litStroke = applyLightingColor(stroke) ?? stroke;
    const bindPath = poseNode
      ? bindPose<Element>(bindings, poseNode, (element) => (get) => setAttr(element, "d", get(poseNode)?.sprite.dynamicPath))
      : undefined;
    return withDefs(
      <path
        ref={joinRefs(bindTransform?.(transform), bindPath)}
        transform={transform}
        d={sprite.dynamicPath}
        fill={litFill}
        opacity={opacity}
        {...strokeAttributes(litStroke, zoomStrokeWidth, spriteStyle)}
      />,
    );
  }

  if (sprite.customSprite) {
    return withDefs(
      <CustomSpriteShape
        key={id}
        ownerId={id}
        sprite={sprite}
        transform={transformStr}
        allowSymbols={allowSymbols}
        mode={mode}
        mask={mask}
        pattern={pattern}
        patternFills={patternFills}
        baseFill={resolvedBaseFill}
        fillOverride={fillOverride}
        gradientTransform={gradientTransform}
        gradientDefinition={primaryGradient}
        gradientMap={sprite.fillGradients}
        baseStroke={baseStroke}
        strokeWidth={strokeWidth}
        strokePad={strokePad}
        strokeOverride={strokeOverride}
        strokeWidthOverride={strokeWidthOverride}
        style={spriteStyle}
        opacity={opacity}
        applyLightingColor={applyLightingColor}
        bindTransform={bindTransform}
      />,
    );
  }

  const shapeProps = {
    transform,
    bindTransform,
    fill: resolvedFill,
    stroke,
    strokeWidth: zoomStrokeWidth,
    style: spriteStyle,
    opacity,
  };
  switch (normalizedShape) {
    case "rect":
      return withDefs(<RectSprite {...shapeProps} />);
    case "half_circle":
      return withDefs(<HalfCircleSprite {...shapeProps} />);
    case "fuzzy":
      return withDefs(
        <FuzzySprite transform={transform} bindTransform={bindTransform} fill={resolvedFill} style={spriteStyle} opacity={opacity} />,
      );
    case "soft":
      return withDefs(
        <SoftSprite transform={transform} bindTransform={bindTransform} fill={resolvedFill} style={spriteStyle} opacity={opacity} />,
      );
    case "line":
      return withDefs(<LineSprite {...shapeProps} />);
    default:
      return withDefs(<EllipseSprite {...shapeProps} />);
  }
};

// Shallow compare two small string maps (colors / strokeColors)
function shallowEqualRecord(a?: Record<string | number, string>, b?: Record<string | number, string>) {
  if (a === b) return true;
  if (!a || !b) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (a[k as any] !== b[k as any]) return false;
  }
  return true;
}

const gradientsEqual = (a?: SpriteGradient, b?: SpriteGradient) => {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.type !== b.type) return false;
  const stopsEqual = () => {
    if (a.stops.length !== b.stops.length) return false;
    for (let i = 0; i < a.stops.length; i++) {
      const sa = a.stops[i];
      const sb = b.stops[i];
      if (sa.offset !== sb.offset) return false;
      if (sa.color !== sb.color) return false;
      if ((sa.opacity ?? 1) !== (sb.opacity ?? 1)) return false;
    }
    return true;
  };
  if (a.type === "linear" && b.type === "linear") {
    return a.x1 === b.x1 && a.y1 === b.y1 && a.x2 === b.x2 && a.y2 === b.y2 && stopsEqual();
  }
  if (a.type === "radial" && b.type === "radial") {
    return a.cx === b.cx && a.cy === b.cy && a.r === b.r && a.fx === b.fx && a.fy === b.fy && stopsEqual();
  }
  return false;
};

const gradientMapsEqual = (a?: Record<string, SpriteGradient>, b?: Record<string, SpriteGradient>) => {
  if (a === b) return true;
  if (!a || !b) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!gradientsEqual(a[key], b[key])) return false;
  }
  return true;
};

// Memo comparator focused on avoiding re-renders when only object identities change for stable value content
const SvgSprite = React.memo(SvgSpriteComponent, (prev, next) => {
  if (prev.id !== next.id) return false;
  if (prev.pattern !== next.pattern) return false;
  if (!shallowEqualRecord(prev.patternFills, next.patternFills)) return false;
  if (prev.strokeOverride !== next.strokeOverride) return false;
  if (prev.strokeWidthOverride !== next.strokeWidthOverride) return false;
  if (prev.fillOverride !== next.fillOverride) return false;
  if (prev.baseTransform !== next.baseTransform) return false;
  if (prev.poseNode !== next.poseNode) return false;
  const a = prev.sprite;
  const b = next.sprite;
  if (a === b) return true; // same reference
  // Primitive props likely to affect rendering
  if (a.fill !== b.fill) return false;
  if (a.stroke !== b.stroke) return false;
  if (a.strokeWidth !== b.strokeWidth) return false;
  if (a.opacity !== b.opacity) return false;
  if (a.blur !== b.blur) return false;
  if (a.lineCap !== b.lineCap) return false;
  if (a.shape !== b.shape) return false;
  if (a.dynamicPath !== b.dynamicPath) return false;
  if (!gradientsEqual(a.fillGradient, b.fillGradient)) return false;
  if (!gradientMapsEqual(a.fillGradients, b.fillGradients)) return false;
  // Transform-affecting props
  // Compare transform-related composite fields
  const cmpVec = (va?: { x: number; y: number }, vb?: { x: number; y: number }) => {
    if (va === vb) return true;
    if (!va || !vb) return false;
    return va.x === vb.x && va.y === vb.y;
  };
  if (!cmpVec(a.translate, b.translate)) return false;
  if (!cmpVec(a.scale, b.scale)) return false;
  if (a.rotate !== b.rotate) return false;
  if (!cmpVec(a.skew, b.skew)) return false;
  if (!cmpVec(a.gradientOffset, b.gradientOffset)) return false;
  if (!cmpVec(a.gradientScale, b.gradientScale)) return false;
  // Value equality for color maps
  if (!shallowEqualRecord(a.colors, b.colors)) return false;
  if (!shallowEqualRecord(a.strokeColors, b.strokeColors)) return false;
  // Custom sprite reference or its elements length change should trigger rerender
  if (a.customSprite !== b.customSprite) return false;
  return true;
});

export default SvgSprite;
