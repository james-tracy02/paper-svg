import type { Sprite } from "../types/Sprite";
import type { RenderNode } from "./RenderTree";
import SvgSprite from "./Sprite";
import React, { useContext } from "react";
import { bindPose, PoseBindingsContext, setAttr } from "./poseBindings";
import {
  combineMatrixTransforms,
  getInverseScale,
  invertMatrixTransform,
  matrixToTransform,
  matrixTransformToSvg,
  spriteUserSpace,
} from "./transform";

const BASE_SIZE = 20;

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

/** The `patternTransform` that tiles `sprite` over `target` where `target` stands. */
const getPatternTransform = (sprite: Sprite, target: RenderNode) => {
  const derived = matrixToTransform(target.matrix);
  const inverseScale = getInverseScale(derived);
  const inverseSpriteScale = getInverseScale(target.sprite);
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
  return patternTransformParts.length ? patternTransformParts.join(" ") : undefined;
};

const SvgSpritePattern: React.FC<PatternProps> = ({ id, sprite, target }) => {
  const bindings = useContext(PoseBindingsContext);
  const intrinsicWidth = sprite.customSprite?.size?.width ?? BASE_SIZE;
  const intrinsicHeight = sprite.customSprite?.size?.height ?? BASE_SIZE;
  const patternTransform = getPatternTransform(sprite, target);
  const bindTransform = bindPose<Element>(bindings, target.id, (element) => (get) => {
    const posed = get(target.id);
    if (posed) setAttr(element, "patternTransform", getPatternTransform(sprite, posed));
  });

  return (
    <pattern
      ref={bindTransform}
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
