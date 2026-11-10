import type { Sprite } from "../types/Sprite";
import type { MatrixTransform } from "../types/Transform";
import type React from "react";
import { hashKey } from "./hashKey";

type GradientBounds = {
  minX: number;
  minY: number;
  width: number;
  height: number;
  radius: number;
};

const DEFAULT_GRADIENT_BOUNDS: GradientBounds = {
  minX: -5,
  minY: -5,
  width: 10,
  height: 10,
  radius: 10,
};

const getGradientBounds = (sprite: Sprite): GradientBounds => {
  const size = sprite.customSprite?.size;
  if (!size) return DEFAULT_GRADIENT_BOUNDS;
  const width = size.width;
  const height = size.height;
  const origin = sprite.customSprite?.origin ?? { x: width / 2, y: height / 2 };
  const minX = origin.x - width / 2;
  const minY = origin.y - height / 2;
  const radius = Math.min(width, height);
  return { minX, minY, width, height, radius };
};

const gradientCoordinate = (value: number | undefined, fallback: number): string => {
  const resolved = typeof value === "number" ? value : fallback;
  return `${resolved}`;
};

/** The gradient's unit square mapped into the sprite's user space, as built by `buildGradientTransform`. */
export const getGradientFrame = (sprite: Sprite): MatrixTransform => {
  const bounds = getGradientBounds(sprite);
  const offsetX = sprite.gradientOffset?.x ?? 0;
  const offsetY = sprite.gradientOffset?.y ?? 0;
  const scaleX = sprite.gradientScale?.x ?? 1;
  const scaleY = sprite.gradientScale?.y ?? 1;
  return {
    translate: { x: bounds.minX + offsetX, y: -(bounds.minY + offsetY) },
    matrix: { a: bounds.width * scaleX, b: 0, c: 0, d: bounds.height * scaleY },
  };
};

export const buildGradientTransform = (sprite: Sprite): string => {
  if (sprite.gradientTransform) return sprite.gradientTransform;
  const bounds = getGradientBounds(sprite);
  const offsetX = sprite.gradientOffset?.x ?? 0;
  const offsetY = sprite.gradientOffset?.y ?? 0;
  const scaleX = sprite.gradientScale?.x ?? 1;
  const scaleY = sprite.gradientScale?.y ?? 1;
  return `translate(${bounds.minX + offsetX}, ${bounds.minY + offsetY}) scale(${bounds.width * scaleX}, ${bounds.height * scaleY})`;
};

/** Content-hashed id, so sprites with the same gradient share one hoisted definition (see HoistedDefs). */
export const gradientDefId = (gradient: NonNullable<Sprite["fillGradient"]>, gradientTransform?: string) =>
  `grad_${hashKey(JSON.stringify([gradient, gradientTransform ?? ""]))}`;

export const renderGradientDefinition = (
  gradient: Sprite["fillGradient"],
  id: string,
  gradientTransform?: string,
): React.ReactNode | null => {
  if (!gradient) return null;
  const resolvedTransform = gradientTransform;
  const stops = gradient.stops.map((stop, index) => {
    const clampedOffset = Math.max(0, Math.min(1, stop.offset ?? 0));
    return (
      <stop
        key={`${id}_stop_${index}`}
        offset={`${clampedOffset * 100}%`}
        stopColor={stop.color}
        stopOpacity={stop.opacity ?? 1}
      />
    );
  });

  if (gradient.type === "linear") {
    return (
      <linearGradient
        key={id}
        id={id}
        x1={gradientCoordinate(gradient.x1, 0)}
        y1={gradientCoordinate(gradient.y1, 0)}
        x2={gradientCoordinate(gradient.x2, 1)}
        y2={gradientCoordinate(gradient.y2, 0)}
        gradientUnits="userSpaceOnUse"
        gradientTransform={resolvedTransform}
      >
        {stops}
      </linearGradient>
    );
  }

  return (
    <radialGradient
      key={id}
      id={id}
      cx={gradientCoordinate(gradient.cx, 0.5)}
      cy={gradientCoordinate(gradient.cy, 0.5)}
      r={gradientCoordinate(gradient.r, 0.5)}
      fx={gradient.fx !== undefined ? gradientCoordinate(gradient.fx, gradient.cx ?? 0.5) : undefined}
      fy={gradient.fy !== undefined ? gradientCoordinate(gradient.fy, gradient.cy ?? 0.5) : undefined}
      gradientUnits="userSpaceOnUse"
      gradientTransform={resolvedTransform}
    >
      {stops}
    </radialGradient>
  );
};
