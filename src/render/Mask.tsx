import type { RenderNode } from "./RenderTree";
import SvgSprite from "./Sprite";
import SvgSpriteMask from "./SpriteMask";
import React, { useMemo } from "react";
import { matrixTransformToSvg } from "./transform";
import { maskProps } from "./maskProps";
import { getSpriteSignature } from "./utils/getSpriteSignature";
import { getMaskRegion } from "./spriteBounds";

type MaskProps = {
  id: string;
  groupName: string;
  groups: RenderNode[];
  /**
   * "all" — fill + outline + no-outline masks (legacy combined mode).
   * "fill_only" — just the plain fill + no-outline masks; use alongside a separate
   * "outline_only" SvgMask instance (same mechanism as clip groups) to produce the
   * outline mask instead.
   * "outline_only" — just the outline mask (`${id}_outline`).
   */
  mode?: "all" | "outline_only" | "fill_only";
  /** Ignore member sprite opacity, like a clipPath does (clip group fill masks; e.g. an invisible lower body). */
  ignoreOpacity?: boolean;
  /** Fill modes: render the plain `${id}` mask. Off when no node references it. */
  withFill?: boolean;
  /** Fill modes: render the `${id}_no_outline` mask. Off when no node references it. */
  withNoOutline?: boolean;
};

const getGroupMaskSignature = (group: RenderNode) => {
  const maskSprite = group.mask;
  if (!maskSprite) {
    return `${group.id}:none`;
  }
  return `${group.id}:${getSpriteSignature(maskSprite)}`;
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
  const uniqueGroups = useMemo(() => {
    const seen = new Set<string>();
    return groups.filter((group) => {
      if (seen.has(group.id)) return false;
      seen.add(group.id);
      return true;
    });
  }, [groups]);
  // From the members' geometry where they stand, so it is right on the first render, without measuring.
  const bounds = useMemo(() => getMaskRegion(uniqueGroups, groupName), [uniqueGroups, groupName]);

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

  // Mask ids are `${scope}${groupName}_group` (mask groups) or `_clip_mask` (clip groups).
  const scopePrefix = id.slice(0, id.lastIndexOf(groupName));

  // Opt-in (clipMaskContribution): the member adds only its clipped shape. Uses the clip group's soft
  // fill mask (`${name}_clip_mask`), since clip-path is ignored inside <mask> content but mask isn't.
  const wrapInClipMasks = (group: RenderNode, content: React.ReactElement) =>
    group.clipMaskContribution
      ? [...new Set(group.clippedBy ?? [])]
          .filter((name) => name !== groupName)
          .reduce(
            (inner, name) => (
              <g key={`${group.id}_clip_mask_${name}`} mask={`url(#${scopePrefix}${name}_clip_mask)`}>
                {inner}
              </g>
            ),
            content,
          )
      : content;

  const renderMaskContents = (mode: "mask" | "outline_mask" | "mask_no_outline") => (
    <g key={`${id}_${mode}_content`}>
      {uniqueGroups.map((group) =>
        group.noSprite || group.hidden ? null : wrapInClipMasks(group, (() => {
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
              {renderMaskContents("mask")}
            </mask>
          ) : null}
          {mode === "all" ? (
            <mask key={id + "_outline"} id={id + "_outline"} {...maskAttributes}>
              {renderOutlineMaskContents()}
            </mask>
          ) : null}
          {withNoOutline ? (
            <mask key={id + "_no_outline"} id={id + "_no_outline"} {...maskAttributes}>
              {renderMaskContents("mask_no_outline")}
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
