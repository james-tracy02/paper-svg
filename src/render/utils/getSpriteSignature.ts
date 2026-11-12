import type { Color } from "../../types/primitives";
import type { Sprite } from "../../types/Sprite";
import type { Transform } from "../../types/Transform";
import { roundTo } from "../../util/roundTo";

const r = (value: number) => roundTo(value, 2);

const serializeTransform = (transform: Transform & { maskScale?: { x: number; y: number } }) => {
  const t = transform.translate;
  const s = transform.scale;
  const ms = transform.maskScale ?? { x: 1, y: 1 };
  const skew = transform.skew ?? { x: 0, y: 0 };
  return [r(t.x), r(t.y), r(s.x), r(s.y), r(ms.x), r(ms.y), r(transform.rotate), r(skew.x), r(skew.y)].join(",");
};

const serializeColorRecord = (record?: Record<string | number, Color>) => {
  if (!record) return "";
  return Object.keys(record)
    .sort()
    .map((key) => `${key}:${record[key] ?? ""}`)
    .join(",");
};

/** Cache key for a sprite's look: its geometry, transform and paint. */
export const getSpriteSignature = (sprite: Sprite): string => {
  const spriteKey = sprite.customSprite?.id ?? sprite.href ?? sprite.dynamicPath ?? sprite.shape ?? "ellipse";
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
  return `${spriteKey}:${transformKey}:${fillKey}:${strokeKey}:${strokeWidthKey}:${opacityKey}:${blurKey}:${lineCapKey}:${colorsKey}:${strokeColorsKey}${patternKey}`;
};
