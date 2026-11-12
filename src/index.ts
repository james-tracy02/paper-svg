/* ------------------------------------------------------------------ *
 * paper-svg — skeletal node-tree engine for articulated SVG rigs.
 * ------------------------------------------------------------------ */

export type { Color, Vector2 } from "./types/primitives";

/* ---- core types ---- */
export type { Node } from "./types/Node";
export type { DriverOutput, NodeDriver } from "./types/Driver";
export type { Pose } from "./types/Pose";
export type {
  Sprite,
  Shape,
  CustomSprite,
  CustomElement,
  SpriteGradient,
  SpriteLinearGradient,
  SpriteRadialGradient,
  SpriteGradientStop,
} from "./types/Sprite";
export type { Transform, Matrix2x2, MatrixTransform } from "./types/Transform";
export { mirrorTransform } from "./types/Transform";
export type { RenderGroup, RenderGroupOptions } from "./types/RenderGroup";
export type { TransformState } from "./types/TransformState";
export type { ColorSlot, ColorDerive, ColorTone } from "./types/ColorSlot";
export { BASE_SLOT } from "./types/ColorSlot";

/* ---- builders ---- */
export { default as NodeBuilder } from "./types/NodeBuilder";
export { default as SpriteBuilder } from "./types/SpriteBuilder";

/* ---- render tree (headless) ---- */
export {
  buildRenderTree,
  flattenRenderTree,
  getRenderNodes,
  buildMaskSignature,
  measureGroupBounds,
} from "./render/RenderTree";
export type { RenderNode, RenderTree, GroupBounds, MeasureGroupBoundsOptions } from "./render/RenderTree";

/* ---- transform and drag math ---- */
export * from "./render/transform";
export * from "./render/utils/dragMath";
export * from "./render/utils/dragTransforms";
export * from "./render/utils/screenToSvg";

/* ---- sprite loader ---- */
export {
  makeSprite,
  makeImageSprite,
  makeSpriteFromFile,
  registerCustomSprite,
  unregisterCustomSprite,
  getSprite,
  withPlacement,
  isSvgFile,
} from "./sprites/loader";
export type { SpritePlacement } from "./sprites/loader";

/* ---- React renderer ---- */
export { default as Rig } from "./render/Rig";
export type { RigProps, RigEffects, GlowConfig, TintConfig } from "./render/Rig";
export { default as RigLayers } from "./render/RigLayers";
export type { RigLayersProps, RigNodeInteraction } from "./render/RigLayers";
export { useRenderNodes } from "./render/useRenderNodes";
export { resolveRotationPivot } from "./render/rotationPivot";
export type { RotationPivotOptions } from "./render/rotationPivot";

/* ---- color transform (e.g. lighting) ---- */
export { ColorTransformProvider, useColorTransform } from "./render/context/ColorTransformContext";
export type { ColorTransform } from "./render/context/ColorTransformContext";

/* ---- low-level React primitives (advanced) ---- */
export { default as SvgGroup } from "./render/Group";
export { default as SvgGroupOutline } from "./render/GroupOutline";
export { default as SvgSprite } from "./render/Sprite";
export { default as SvgMask } from "./render/Mask";
export { default as SpriteDefs } from "./render/SpriteDefs";
export { default as ClipPathDefs } from "./render/ClipPathDefs";
export { getClippingGroups } from "./render/layerPlan";
export { default as Pivots } from "./render/overlays/Pivots";
export { default as GlowFilter } from "./render/filters/GlowFilter";
export { default as TintFilter } from "./render/filters/TintFilter";
export { default as BlurFilter } from "./render/filters/BlurFilter";
export { SPRITE_ROOT_STYLE, getZoomVars } from "./render/hooks/useSpriteVisuals";
