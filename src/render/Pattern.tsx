import type { Sprite } from "../types/Sprite";
import type { RenderNode } from "./RenderTree";
import SvgSprite from "./Sprite";
import React from "react";
import {
  combineMatrixTransforms,
  getInverseScale,
  invertMatrixTransform,
  matrixToTransform,
  matrixTransformToSvg,
  spriteUserSpace,
} from "./transform";

type PatternProps = {
  id: string;
  sprite: Sprite;
  target: RenderNode;
};

/**
 * Maps the target's pattern space (position and rotation of its `patternSpace` node, at world scale)
 * into the user space the pattern is drawn in: the target's matrix, sprite transform and custom sprite root.
 */
const getPatternSpaceTransform = (target: RenderNode) => {
  if (!target.patternSpace) return undefined;
  const inverse = invertMatrixTransform(spriteUserSpace(target.matrix, target.sprite));
  if (!inverse) return undefined;
  return matrixTransformToSvg(combineMatrixTransforms(inverse, target.patternSpace), 6);
};

const SvgSpritePattern: React.FC<PatternProps> = ({ id, sprite, target }) => {
  const derived = matrixToTransform(target.matrix);
  const inverseScale = getInverseScale(derived);
  const inverseSpriteScale = getInverseScale(target.sprite);
  const baseSize = 20;
  const intrinsicWidth = sprite.customSprite?.size?.width ?? baseSize;
  const intrinsicHeight = sprite.customSprite?.size?.height ?? baseSize;
  const scaleX = sprite.scale?.x ?? 1;
  const scaleY = sprite.scale?.y ?? 1;
  const offsetX = sprite.translate?.x ?? 0;
  const offsetY = sprite.translate?.y ?? 0;
  const rotate = sprite.rotate ?? 0;
  const targetOriginX = target.sprite.customSprite?.origin?.x ?? 0;
  const targetOriginY = target.sprite.customSprite?.origin?.y ?? 0;
  const patternSpaceTransform = getPatternSpaceTransform(target);
  const patternTransformParts = [
    ...(patternSpaceTransform
      ? [patternSpaceTransform] // tile in the shared pattern space
      : [
          `translate(${targetOriginX}, ${targetOriginY})`, // move pattern to center of sprite
          inverseScale, // reverse group scale
          inverseSpriteScale, // reverse sprite scale
        ]),
    rotate ? `rotate(${rotate})` : null, // rotate pattern
    scaleX || scaleY ? `scale(${scaleX}, ${scaleY})` : null, // scale pattern
    // Offset is in tile units, so it scales and rotates with the pattern from the target's origin
    offsetX || offsetY ? `translate(${offsetX}, ${-offsetY})` : null,
  ].filter(Boolean);
  const patternTransform = patternTransformParts.length ? patternTransformParts.join(" ") : undefined;

  return (
    <pattern
      id={id}
      // Tile window centered on the origin so a tile's center lands on the target's origin
      x={-intrinsicWidth / 2}
      y={-intrinsicHeight / 2}
      width={intrinsicWidth}
      height={intrinsicHeight}
      patternUnits="userSpaceOnUse"
      patternContentUnits="userSpaceOnUse"
      patternTransform={patternTransform}
    >
      {/* Tile content is positioned from the tile's own corner, so center the sprite within it */}
      <SvgSprite
        key={id}
        id={id}
        sprite={sprite}
        mode="pattern"
        disableSymbols
        baseTransform={`translate(${intrinsicWidth / 2}, ${intrinsicHeight / 2})`}
      />
    </pattern>
  );
};

export default SvgSpritePattern;
