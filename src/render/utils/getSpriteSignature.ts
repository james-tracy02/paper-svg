import type { Color } from "../../types/primitives";
import type { Sprite } from "../../types/Sprite";
import { serializeTransform } from "../maskBoundsCache";

const serializeColorRecord = (record?: Record<string | number, Color>) => {
  if (!record) return "";
  return Object.keys(record)
    .sort()
    .map((key) => `${key}:${record[key] ?? ""}`)
    .join(",");
};

export const getSpriteSignature = (sprite: Sprite): string => {
  const spriteKey = sprite.customSprite?.id ?? sprite.href ?? sprite.shape ?? "ellipse";
  const transformKey = serializeTransform(sprite);
  const fillKey = sprite.fill ?? "";
  const strokeKey = sprite.stroke ?? "";
  const strokeWidthKey = sprite.strokeWidth ?? 0;
  const opacityKey = sprite.opacity ?? 1;
  const blurKey = sprite.blur ?? 0;
  const lineCapKey = sprite.lineCap ?? "";
  const patternKey = sprite.pattern ? `|pattern(${getSpriteSignature(sprite.pattern)})` : "";
  const colorsKey = serializeColorRecord(sprite.colors);
  const strokeColorsKey = serializeColorRecord(sprite.strokeColors);
  const outlineIndicesKey = sprite.outlineIndices ? sprite.outlineIndices.join(",") : "";
  const outlineExcludeKey = sprite.outlineExcludeIndices ? sprite.outlineExcludeIndices.join(",") : "";
  return `${spriteKey}:${transformKey}:${fillKey}:${strokeKey}:${strokeWidthKey}:${opacityKey}:${blurKey}:${lineCapKey}:${colorsKey}:${strokeColorsKey}:${outlineIndicesKey}:${outlineExcludeKey}${patternKey}`;
};
