import type { Color } from "../types/primitives";
import type { RenderNode } from "./RenderTree";
import type { Sprite } from "../types/Sprite";
import SvgSprite from "./Sprite";
import SvgSpriteMask from "./SpriteMask";
import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { combineMatrixTransforms, matrixTransformToSvg, transformToMatrixWithMatrix } from "./transform";
import { maskProps } from "./maskProps";
import {
  maskBoundsCache,
  areBoundsEqual,
  serializeTransform,
  serializeMatrixTransform,
  expandBounds,
  type Bounds,
} from "./maskBoundsCache";

type MaskProps = {
  id: string;
  groupName: string;
  groups: RenderNode[];
  /**
   * "all" — fill + outline + no-outline masks (legacy combined mode).
   * "fill_only" — just the plain fill + no-outline masks; use alongside a separate
   * "outline_only" SvgMask instance (same mechanism as true-clip groups) to produce the
   * outline mask instead.
   * "outline_only" — just the outline mask (`${id}_outline`).
   */
  mode?: "all" | "outline_only" | "fill_only";
  /** Ignore member sprite opacity, like a clipPath does (true-clip fill masks; e.g. the invisible lower_body). */
  ignoreOpacity?: boolean;
  /** Fill modes: render the plain `${id}` mask. Off when no node references it. */
  withFill?: boolean;
  /** Fill modes: render the `${id}_no_outline` mask. Off when no node references it. */
  withNoOutline?: boolean;
};

const serializeColorRecord = (record?: Record<string | number, Color>) => {
  if (!record) return "";
  return Object.keys(record)
    .sort()
    .map((key) => `${key}:${record[key] ?? ""}`)
    .join(",");
};

const getSpriteSignature = (sprite: Sprite): string => {
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

const getGroupGeometryKey = (group: RenderNode) => {
  const transformKey = serializeMatrixTransform(group.matrix);
  const outsetKey = group.maskOutsets ? JSON.stringify(group.maskOutsets) : "";
  return `${group.id}:${getSpriteSignature(group.sprite)}:${transformKey}:${outsetKey}`;
};

const getGroupMaskSignature = (group: RenderNode) => {
  const maskSprite = group.mask;
  if (!maskSprite) {
    return `${group.id}:none`;
  }
  return `${group.id}:${getSpriteSignature(maskSprite)}`;
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

const getSpriteMatrixForMask = (sprite: Sprite) => {
  if (sprite.maskScale) {
    return transformToMatrixWithMatrix({
      ...sprite,
      scale: {
        x: sprite.scale.x * sprite.maskScale.x,
        y: sprite.scale.y * sprite.maskScale.y,
      },
    });
  }
  return transformToMatrixWithMatrix(sprite);
};

const SvgMask: React.FC<MaskProps> = ({
  id,
  groupName,
  groups,
  mode = "all",
  ignoreOpacity = false,
  withFill = true,
  withNoOutline = true,
}) => {
  const contentRef = useRef<SVGGElement | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const fallbackLoggedRef = useRef(false);
  const uniqueGroups = useMemo(() => {
    const seen = new Set<string>();
    return groups.filter((group) => {
      if (seen.has(group.id)) return false;
      seen.add(group.id);
      return true;
    });
  }, [groups]);
  const geometrySignature = useMemo(() => uniqueGroups.map(getGroupGeometryKey).join("||"), [uniqueGroups]);
  const [bounds, setBounds] = useState<Bounds | null>(() => maskBoundsCache.get(id)?.bounds ?? null);

  useLayoutEffect(() => {
    const cached = maskBoundsCache.get(id);
    if (cached && cached.signature === geometrySignature) {
      setBounds((prev) => (prev && areBoundsEqual(prev, cached.bounds) ? prev : cached.bounds));
      return;
    }

    let raf: number | null = null;

    const computeBoundsFromSprites = (): Bounds | null => {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const group of uniqueGroups) {
        if (group.noSprite) continue;
        const localBounds = getSpriteLocalBounds(group.sprite);
        if (!localBounds) {
          return null;
        }
        const spriteMatrix = getSpriteMatrixForMask(group.sprite);
        const worldMatrix = combineMatrixTransforms(group.matrix, spriteMatrix);
        const worldBounds = expandBounds(
          applyMatrixToBounds(localBounds, worldMatrix) as DOMRect,
          Math.max(0, group.maskOutsets?.[groupName] ?? 0),
        );
        minX = Math.min(minX, worldBounds.x);
        minY = Math.min(minY, worldBounds.y);
        maxX = Math.max(maxX, worldBounds.x + worldBounds.width);
        maxY = Math.max(maxY, worldBounds.y + worldBounds.height);
      }
      if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
        return null;
      }
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    };

    const measure = () => {
      const computed = computeBoundsFromSprites();
      if (computed) {
        const nextBounds = expandBounds(
          {
            x: computed.x,
            y: computed.y,
            width: computed.width,
            height: computed.height,
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
      if (!contentRef.current) {
        return false;
      }
      try {
        const bbox = contentRef.current.getBBox();
        if (bbox.width === 0 || bbox.height === 0) {
          return false;
        }
        if (!fallbackLoggedRef.current) {
          fallbackLoggedRef.current = true;
          console.warn("[mask-bbox-fallback]", { id });
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
          if (!measure()) {
            // still waiting for geometry; fallback bounds remain
          }
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

  const spriteMaskSignature = uniqueGroups.map(getGroupMaskSignature).join("||");

  const spriteMaskEntries = useMemo(() => {
    return uniqueGroups
      .filter((group) => !!group.mask)
      .map((group) => ({
        groupId: group.id,
        maskId: `${id}_${group.id}_sprite_mask`,
        sprite: group.mask!,
      }));
  }, [uniqueGroups, id, spriteMaskSignature]);

  const spriteMaskLookup = useMemo(() => {
    const map = new Map<string, string>();
    spriteMaskEntries.forEach((entry) => {
      map.set(entry.groupId, entry.maskId);
    });
    return map;
  }, [spriteMaskEntries]);

  // Mask ids are `${scope}${groupName}_group|_trueclip` (Body.tsx).
  const scopePrefix = id.slice(0, id.lastIndexOf(groupName));

  // Opt-in (clipMaskContribution): the member adds only its true-clipped shape. Uses the clip group's soft
  // fill mask (`${name}_trueclip`, Body.tsx), since clip-path is ignored inside <mask> content but mask isn't.
  const wrapInTrueClips = (group: RenderNode, content: React.ReactElement) =>
    group.clipMaskContribution
      ? [...new Set(group.trueClippedBy ?? [])]
          .filter((name) => name !== groupName)
          .reduce(
            (inner, name) => (
              <g key={`${group.id}_trueclip_${name}`} mask={`url(#${scopePrefix}${name}_trueclip)`}>
                {inner}
              </g>
            ),
            content,
          )
      : content;

  const renderMaskContents = (mode: "mask" | "outline_mask" | "mask_no_outline", ref?: React.Ref<SVGGElement>) => (
    <g key={`${id}_${mode}_content`} ref={ref}>
      {uniqueGroups.map((group) =>
        group.noSprite ? null : wrapInTrueClips(group, (() => {
          // maskGroupModes (positive/negative) control whether a node's shape is
          // included/excluded from the plain fill mask. The outline ring mask must
          // always use its own black-fill/white-stroke ring coloring regardless of
          // that — applying the override there would fill the whole interior white
          // instead of punching a hole, breaking the ring.
          const maskValue = mode === "outline_mask" ? undefined : group.maskGroupModes?.[groupName];
          const maskFill = maskValue === "negative" ? "black" : maskValue === "positive" ? "white" : undefined;
          // Outset: a stroke in the fill color, 2x wide, grows the shape by `outset` on every side.
          const outset = mode === "outline_mask" ? 0 : (group.maskOutsets?.[groupName] ?? 0);
          const transform = matrixTransformToSvg(group.matrix);
          const spriteMaskId = spriteMaskLookup.get(group.id);
          const sprite = (
            <SvgSprite
              key={`${group.id}_${mode}`}
              id={group.id}
              sprite={ignoreOpacity ? { ...group.sprite, opacity: undefined } : group.sprite}
              mode={mode}
              fillOverride={maskFill}
              strokeOverride={outset > 0 ? (maskFill ?? "white") : maskValue === "negative" ? maskFill : undefined}
              strokeWidthOverride={outset > 0 ? outset * 2 : undefined}
              // A sprite mask is in node space, so only then does the node transform need its own <g>.
              baseTransform={spriteMaskId ? undefined : transform}
            />
          );
          return spriteMaskId ? (
            <g key={`${group.id}_${mode}`} transform={transform} mask={`url(#${spriteMaskId})`}>
              {sprite}
            </g>
          ) : (
            sprite
          );
        })()),
      )}
    </g>
  );

  const renderOutlineMaskContents = () => (
    renderMaskContents("outline_mask")
  );

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
    <>
      {spriteMaskEntries.map((entry) => (
        <SvgSpriteMask key={entry.maskId} id={entry.maskId} sprite={entry.sprite} />
      ))}
      {mode === "all" || mode === "fill_only" ? (
        <>
          {withFill ? (
            <mask key={id} id={id} {...maskAttributes}>
              {renderMaskContents("mask", contentRef)}
            </mask>
          ) : null}
          {mode === "all" ? (
            <mask key={id + "_outline"} id={id + "_outline"} {...maskAttributes}>
              {renderOutlineMaskContents()}
            </mask>
          ) : null}
          {withNoOutline ? (
            <mask key={id + "_no_outline"} id={id + "_no_outline"} {...maskAttributes}>
              {/* Bounds fallback measures through contentRef, so it moves here when the fill mask is skipped. */}
              {renderMaskContents("mask_no_outline", withFill ? undefined : contentRef)}
            </mask>
          ) : null}
        </>
      ) : (
        <mask key={id + "_outline"} id={id + "_outline"} {...maskAttributes}>
          {renderOutlineMaskContents()}
        </mask>
      )}
    </>
  );
};

// Groups arrays are rebuilt every render; members keep identity while unchanged (see stableNodes.ts).
const areEqual = (a: MaskProps, b: MaskProps) =>
  a.id === b.id &&
  a.groupName === b.groupName &&
  a.mode === b.mode &&
  a.ignoreOpacity === b.ignoreOpacity &&
  a.withFill === b.withFill &&
  a.withNoOutline === b.withNoOutline &&
  a.groups.length === b.groups.length &&
  a.groups.every((group, index) => group === b.groups[index]);

export default React.memo(SvgMask, areEqual);
