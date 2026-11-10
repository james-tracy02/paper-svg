import React from "react";
import type { RenderNode } from "./RenderTree";
import { getSpriteTransform, matrixTransformToSvg } from "./transform";
import type { Sprite } from "../types/Sprite";
import { outsetPathData } from "./outsetPath";

/**
 * Render a bare shape element for use inside <clipPath>.
 * No <g> wrappers — browsers treat <g> inside <clipPath> as empty.
 * The node's world matrix and sprite transform are concatenated
 * into a single transform string applied directly on the shape.
 *
 * Custom sprites need an extra translate(-w/2, -h/2) to re-centre
 * the path geometry, which is authored with top-left at the origin.
 */
const renderClipElement = (
  sprite: Sprite,
  nodeTransform: string,
  spriteTransform: string,
  key: string,
  outset?: number,
) => {
  const combinedTransform = `${nodeTransform} ${spriteTransform}`;
  const shape = sprite.shape ?? "ellipse";

  if (sprite.customSprite) {
    const allowed = sprite.clipPathIndices?.length ? new Set(sprite.clipPathIndices) : null;
    const customRootTransform = getSpriteTransform(sprite.customSprite, 4);
    return sprite.customSprite.elements.map((el, i) => {
      if (allowed && !allowed.has(i)) return null;
      if (!el.d) return null;
      if (el.noFill) return null;
      const resolvedFill = el.colorKey ? (sprite.colors?.[el.colorKey] ?? sprite.fill) : sprite.fill;
      if (!resolvedFill || resolvedFill === "none") return null;
      const t = [combinedTransform, customRootTransform, el.transform].filter(Boolean).join(" ");
      const d = outset != null ? outsetPathData(el.d, outset) : el.d;
      return <path key={`${key}_${i}`} d={d} transform={t} />;
    });
  }
  if (sprite.dynamicPath) {
    const d = outset != null ? outsetPathData(sprite.dynamicPath, outset) : sprite.dynamicPath;
    return <path key={key} d={d} transform={combinedTransform} />;
  }
  if (!sprite.fill || sprite.fill === "none") return null;
  if (shape === "rect") return <rect key={key} x={-5} y={-5} width={10} height={10} transform={combinedTransform} />;
  if (shape === "half_circle")
    return (
      <path
        key={key}
        d="M -5 0 A 5 5 0 0 0 5 0 L -5 0 Z"
        transform={combinedTransform}
      />
    );
  if (shape === "line")
    return <line key={key} x1={0} y1={-5} x2={0} y2={5} strokeWidth={1} stroke="black" transform={combinedTransform} />;
  return <ellipse key={key} rx={5} ry={5} transform={combinedTransform} />;
};

export type TrueClipMember = {
  node: RenderNode;
  outset?: number;
};

export type TrueClipGroup = {
  id: string;
  groups: TrueClipMember[];
};

export const getTrueClippingGroups = (groups: RenderNode[]): Map<string, TrueClipGroup> => {
  const map = new Map<string, TrueClipGroup>();
  for (const g of groups) {
    for (const groupName of g.trueClippingGroups ?? []) {
      if (!map.has(groupName)) {
        map.set(groupName, { id: groupName, groups: [] });
      }
      const entry = map.get(groupName)!;
      entry.groups.push({ node: g, outset: g.trueClipOutsets?.[groupName] });
    }
  }
  return map;
};

type TrueClipDefsProps = {
  trueClipGroups: Map<string, TrueClipGroup>;
  scopeId: (suffix: string) => string;
};

const TrueClipDefs: React.FC<TrueClipDefsProps> = ({ trueClipGroups, scopeId }) => {
  if (trueClipGroups.size === 0) return null;

  return (
    <defs>
      {Array.from(trueClipGroups.values()).map((clipGroup) => {
        const clipId = scopeId(`${clipGroup.id}_clippath`);
        return (
          <clipPath key={clipId} id={clipId} clipPathUnits="userSpaceOnUse">
            {clipGroup.groups.map((member) => {
              const group = member.node;
              if (group.noSprite) return null;
              const nodeTransform = matrixTransformToSvg(group.matrix, 3);
              const spriteTransform = getSpriteTransform(group.sprite, 3);
              return renderClipElement(group.sprite, nodeTransform, spriteTransform, group.id, member.outset);
            })}
          </clipPath>
        );
      })}
    </defs>
  );
};

export default TrueClipDefs;
