import SvgSprite from "./Sprite";
import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Sprite } from "../types/Sprite";
import { maskProps } from "./maskProps";
import { maskBoundsCache, areBoundsEqual, serializeTransform, expandBounds, type Bounds } from "./maskBoundsCache";
import { transformToMatrixWithMatrix } from "./transform";

type MaskProps = {
  id: string;
  sprite: Sprite;
};

const padding = 10;
const MEASURE_DEFER_MS = 80;
const SHAPE_BASE_SCALE = 10;

const getSpriteLocalBounds = (sprite: Sprite): Bounds | null => {
  if (sprite.customSprite?.bounds) {
    const size = sprite.customSprite.size;
    if (size) {
      return { x: -size.width / 2, y: -size.height / 2, width: size.width, height: size.height };
    }
    const b = sprite.customSprite.bounds;
    return { x: b.x, y: -(b.y + b.height), width: b.width, height: b.height };
  }
  if (!sprite.shape && !sprite.href) {
    return null;
  }
  switch (sprite.shape ?? "ellipse") {
    case "ellipse":
    case "rect":
    case "soft":
    case "fuzzy":
      return { x: -SHAPE_BASE_SCALE / 2, y: -SHAPE_BASE_SCALE / 2, width: SHAPE_BASE_SCALE, height: SHAPE_BASE_SCALE };
    case "half_circle":
      return {
        x: -SHAPE_BASE_SCALE / 2,
        y: -SHAPE_BASE_SCALE / 2,
        width: SHAPE_BASE_SCALE,
        height: SHAPE_BASE_SCALE / 2,
      };
    case "line":
      return { x: 0, y: -SHAPE_BASE_SCALE / 2, width: 0, height: SHAPE_BASE_SCALE };
    default:
      return null;
  }
};

const applyMatrixToBounds = (
  bounds: Bounds,
  transform: { matrix: { a: number; b: number; c: number; d: number }; translate: { x: number; y: number } },
) => {
  const { a, b, c, d } = transform.matrix;
  const { x: tx } = transform.translate;
  const ty = -transform.translate.y;
  const x1 = bounds.x;
  const y1 = bounds.y;
  const x2 = bounds.x + bounds.width;
  const y2 = bounds.y + bounds.height;
  const points = [
    { x: a * x1 + c * y1 + tx, y: b * x1 + d * y1 + ty },
    { x: a * x2 + c * y1 + tx, y: b * x2 + d * y1 + ty },
    { x: a * x1 + c * y2 + tx, y: b * x1 + d * y2 + ty },
    { x: a * x2 + c * y2 + tx, y: b * x2 + d * y2 + ty },
  ];
  const minX = Math.min(...points.map((p) => p.x));
  const maxX = Math.max(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y));
  const maxY = Math.max(...points.map((p) => p.y));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

const getSpriteGeometryKey = (id: string, sprite: Sprite) => {
  const spriteKey = sprite.customSprite?.id ?? sprite.href ?? sprite.shape ?? "ellipse";
  const transformKey = serializeTransform(sprite);
  return `${id}:${spriteKey}:${transformKey}`;
};

const SvgSpriteMask: React.FC<MaskProps> = ({ id, sprite }) => {
  const contentRef = useRef<SVGGElement | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const fallbackLoggedRef = useRef(false);
  const geometrySignature = useMemo(() => getSpriteGeometryKey(id, sprite), [id, sprite]);
  const [bounds, setBounds] = useState<Bounds | null>(() => maskBoundsCache.get(id)?.bounds ?? null);

  useLayoutEffect(() => {
    const cached = maskBoundsCache.get(id);
    if (cached && cached.signature === geometrySignature) {
      setBounds((prev) => (prev && areBoundsEqual(prev, cached.bounds) ? prev : cached.bounds));
      return;
    }

    let raf: number | null = null;

    const measure = () => {
      const localBounds = getSpriteLocalBounds(sprite);
      if (localBounds) {
        const spriteMatrix = transformToMatrixWithMatrix(
          sprite.maskScale
            ? {
                ...sprite,
                scale: {
                  x: sprite.scale.x * sprite.maskScale.x,
                  y: sprite.scale.y * sprite.maskScale.y,
                },
              }
            : sprite,
        );
        const transformed = applyMatrixToBounds(localBounds, spriteMatrix);
        const nextBounds = expandBounds(
          {
            x: transformed.x,
            y: transformed.y,
            width: transformed.width,
            height: transformed.height,
          } as DOMRect,
          padding,
        );
        maskBoundsCache.set(id, {
          signature: geometrySignature,
          bounds: nextBounds,
        });
        setBounds((prev) => (prev && areBoundsEqual(prev, nextBounds) ? prev : nextBounds));
        return true;
      }
      const node = contentRef.current;
      if (!node) {
        return false;
      }
      try {
        const bbox = node.getBBox();
        if (bbox.width === 0 || bbox.height === 0) {
          return false;
        }
        if (!fallbackLoggedRef.current) {
          fallbackLoggedRef.current = true;
          console.warn("[sprite-mask-bbox-fallback]", { id });
        }
        const nextBounds = expandBounds(bbox, padding);
        maskBoundsCache.set(id, {
          signature: geometrySignature,
          bounds: nextBounds,
        });
        setBounds((prev) => (prev && areBoundsEqual(prev, nextBounds) ? prev : nextBounds));
        return true;
      } catch {
        return false;
      }
    };

    if (!measure()) {
      timeoutRef.current = window.setTimeout(() => {
        raf = requestAnimationFrame(() => {
          measure();
        });
      }, MEASURE_DEFER_MS);
    }

    return () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      if (raf !== null) {
        cancelAnimationFrame(raf);
      }
    };
  }, [geometrySignature, id]);

  const maskAttributes: {
    x: number | string;
    y: number | string;
    width: number | string;
    height: number | string;
    maskUnits?: "userSpaceOnUse";
    maskContentUnits: "userSpaceOnUse";
  } = bounds
    ? {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        maskUnits: "userSpaceOnUse",
        maskContentUnits: "userSpaceOnUse",
      }
    : {
        x: maskProps.x,
        y: maskProps.y,
        width: maskProps.width,
        height: maskProps.height,
        maskContentUnits: "userSpaceOnUse",
      };

  return (
    <mask id={id} {...maskAttributes}>
      <g ref={contentRef}>
        <SvgSprite key={id} id={id} sprite={sprite} mode={"mask"} />
      </g>
    </mask>
  );
};

export default SvgSpriteMask;
