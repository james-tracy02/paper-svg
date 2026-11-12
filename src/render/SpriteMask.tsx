import SvgSprite, { getTransformForMode } from "./Sprite";
import React, { useMemo } from "react";
import type { Sprite } from "../types/Sprite";
import { maskProps } from "./maskProps";
import { getSpriteMaskRegion } from "./spriteBounds";

type MaskProps = {
  id: string;
  sprite: Sprite;
};

/**
 * Whether a sprite mask only cuts hard edges, so it can be a <clipPath> (no off-screen pass) instead of a
 * <mask>. Mask mode paints every filled part white, so only partial opacity, blur, an image or a line
 * (no area) make it soft.
 */
export const isHardSpriteMask = (sprite: Sprite) =>
  (sprite.opacity === undefined || sprite.opacity >= 1) &&
  !sprite.blur &&
  !sprite.href &&
  !sprite.customSprite?.image &&
  sprite.shape !== "line";

/** The attribute that applies sprite mask `id` (see SvgSpriteMask): clip-path when it's hard, else mask. */
export const spriteMaskAttributes = (sprite: Sprite, id: string): { mask?: string; clipPath?: string } =>
  isHardSpriteMask(sprite) ? { clipPath: `url(#${id})` } : { mask: `url(#${id})` };

/** The sprite's filled area as bare shapes, as mask mode paints it, for use inside <clipPath>. */
const renderClipShapes = (sprite: Sprite) => {
  const transform = getTransformForMode(sprite, "mask") || undefined;
  if (sprite.customSprite) {
    return sprite.customSprite.elements.map((el, i) =>
      el.d && !el.noFill ? (
        <path key={i} d={el.d} transform={[transform, el.transform].filter(Boolean).join(" ") || undefined} />
      ) : null,
    );
  }
  if (sprite.dynamicPath) return <path d={sprite.dynamicPath} transform={transform} />;
  const shape = sprite.shape ?? "ellipse";
  if (shape === "rect") return <rect x={-5} y={-5} width={10} height={10} transform={transform} />;
  if (shape === "half_circle") return <path d="M -5 0 A 5 5 0 0 0 5 0 L -5 0 Z" transform={transform} />;
  return <ellipse rx={5} ry={5} transform={transform} />;
};

/**
 * A node's own sprite mask (`setMask`), in the node's space: a <clipPath> when it only cuts hard edges
 * (apply it with `spriteMaskAttributes`), else a <mask> whose region comes from the sprite's geometry.
 */
const SvgSpriteMask: React.FC<MaskProps> = ({ id, sprite }) => {
  const hard = isHardSpriteMask(sprite);
  const region = useMemo(() => (hard ? null : getSpriteMaskRegion(sprite)), [sprite, hard]);
  if (hard) {
    return (
      <clipPath id={id} clipPathUnits="userSpaceOnUse">
        {renderClipShapes(sprite)}
      </clipPath>
    );
  }
  const maskAttributes = region
    ? { ...region, maskUnits: "userSpaceOnUse" as const, maskContentUnits: "userSpaceOnUse" as const }
    : { ...maskProps, maskContentUnits: "userSpaceOnUse" as const };

  return (
    <mask id={id} {...maskAttributes}>
      <g>
        <SvgSprite key={id} id={id} sprite={sprite} mode={"mask"} />
      </g>
    </mask>
  );
};

export default React.memo(SvgSpriteMask);
