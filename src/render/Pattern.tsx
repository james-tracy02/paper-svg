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

// Room past the sprite's bounds for strokes, so a copy whose outline still reaches the tile is drawn.
const STROKE_ROOM = 2;

/** How many repeats a sprite `size` long reaches past its own when repeating every `repeat`. */
const reach = (size: number, repeat: number) => Math.max(0, Math.ceil(((size + STROKE_ROOM) / repeat - 1) / 2 - 1e-9));

/**
 * A pattern tile for `sprite`: the tile's size (its `patternRepeat`, else the custom sprite's size) and where to
 * draw the sprite inside it, relative to the tile's center. Without an overlapping repeat that is just the center;
 * with one, every neighboring repeat that reaches into the tile too, top row first and left to right, so later
 * repeats draw over earlier ones the same way in every tile.
 */
export const getPatternTile = (sprite: Sprite) => {
  const spriteWidth = sprite.customSprite?.size?.width ?? BASE_SIZE;
  const spriteHeight = sprite.customSprite?.size?.height ?? BASE_SIZE;
  const width = sprite.patternRepeat?.width ?? spriteWidth;
  const height = sprite.patternRepeat?.height ?? spriteHeight;
  const reachX = sprite.patternRepeat ? reach(spriteWidth, width) : 0;
  const reachY = sprite.patternRepeat ? reach(spriteHeight, height) : 0;
  const offsets: { x: number; y: number }[] = [];
  // `0 -` rather than `-`, so no reach starts at 0 and not -0.
  for (let ky = 0 - reachY; ky <= reachY; ky++) {
    for (let kx = 0 - reachX; kx <= reachX; kx++) {
      offsets.push({ x: kx * width, y: ky * height });
    }
  }
  return { width, height, offsets };
};

const SvgSpritePattern: React.FC<PatternProps> = ({ id, sprite, target }) => {
  const bindings = useContext(PoseBindingsContext);
  const { width: intrinsicWidth, height: intrinsicHeight, offsets } = getPatternTile(sprite);
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
      {offsets.map(({ x, y }, index) => (
        <SvgSprite
          key={`${id}_${index}`}
          id={offsets.length > 1 ? `${id}_${index}` : id}
          sprite={sprite}
          mode="pattern"
          disableSymbols
          baseTransform={`translate(${intrinsicWidth / 2 + x}, ${intrinsicHeight / 2 + y})`}
        />
      ))}
    </pattern>
  );
};

export default SvgSpritePattern;
