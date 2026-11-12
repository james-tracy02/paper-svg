import React, { useContext } from "react";
import { getSpriteTransform, matrixTransformToSvg } from "./transform";
import type { Sprite } from "../types/Sprite";
import { outsetPathData } from "./outsetPath";
import type { ClipGroup } from "./layerPlan";
import type { RenderNode } from "./RenderTree";
import { bindPose, PoseBindingsContext, prefixWriter, setAttr, type PoseBindings } from "./poseBindings";

const CLIP_PRECISION = 3;
const clipNodeTransform = (node: RenderNode) => matrixTransformToSvg(node.matrix, CLIP_PRECISION);

/** Ref callback factory for a clip shape of `node`: its transform as rendered, and its path if driven. */
type BindClip = (
  rendered: string,
  path?: (node: RenderNode) => string | undefined,
) => ((element: Element | null) => void) | undefined;

const clipBinder =
  (bindings: PoseBindings | null, node: RenderNode): BindClip =>
  (rendered, path) =>
    bindPose<Element>(bindings, node.id, (element) => {
      const writeTransform = prefixWriter(node.id, "transform", clipNodeTransform(node), rendered, clipNodeTransform)(element);
      return (get) => {
        writeTransform(get);
        const posed = path && get(node.id);
        if (posed) setAttr(element, "d", path(posed));
      };
    });

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
  outset: number | undefined,
  bind: BindClip,
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
      const d = outset ? outsetPathData(el.d, outset) : el.d;
      return <path key={`${key}_${i}`} ref={bind(t)} d={d} transform={t} />;
    });
  }
  if (sprite.dynamicPath) {
    // An outset of 0 (addClippingGroup's default) leaves the path as is, without offsetting it.
    const outsetPath = (path: string) => (outset ? outsetPathData(path, outset) : path);
    const drivenPath = (node: RenderNode) => node.sprite.dynamicPath && outsetPath(node.sprite.dynamicPath);
    return (
      <path
        key={key}
        ref={bind(combinedTransform, drivenPath)}
        d={outsetPath(sprite.dynamicPath)}
        transform={combinedTransform}
      />
    );
  }
  if (!sprite.fill || sprite.fill === "none") return null;
  if (shape === "rect") return <rect key={key} ref={bind(combinedTransform)} x={-5} y={-5} width={10} height={10} transform={combinedTransform} />;
  if (shape === "half_circle")
    return (
      <path
        key={key}
        ref={bind(combinedTransform)}
        d="M -5 0 A 5 5 0 0 0 5 0 L -5 0 Z"
        transform={combinedTransform}
      />
    );
  if (shape === "line")
    return <line key={key} ref={bind(combinedTransform)} x1={0} y1={-5} x2={0} y2={5} strokeWidth={1} stroke="black" transform={combinedTransform} />;
  return <ellipse key={key} ref={bind(combinedTransform)} rx={5} ry={5} transform={combinedTransform} />;
};

type ClipPathDefsProps = {
  clipGroups: Map<string, ClipGroup>;
  scopeId: (suffix: string) => string;
};

const ClipPathDefs: React.FC<ClipPathDefsProps> = ({ clipGroups, scopeId }) => {
  const bindings = useContext(PoseBindingsContext);
  if (clipGroups.size === 0) return null;

  return (
    <defs>
      {Array.from(clipGroups.values()).map((clipGroup) => {
        const clipId = scopeId(`${clipGroup.id}_clippath`);
        return (
          <clipPath key={clipId} id={clipId} clipPathUnits="userSpaceOnUse">
            {clipGroup.groups.map((member) => {
              const group = member.node;
              if (group.noSprite || group.hidden) return null;
              const nodeTransform = clipNodeTransform(group);
              const spriteTransform = getSpriteTransform(group.sprite, CLIP_PRECISION);
              // A mask paints every path of a member white, whatever its fill.
              const sprite = member.paintedAsMask
                ? { ...group.sprite, fill: "white", colors: {}, clipPathIndices: undefined }
                : group.sprite;
              return renderClipElement(
                sprite,
                nodeTransform,
                spriteTransform,
                group.id,
                member.outset,
                clipBinder(bindings, group),
              );
            })}
          </clipPath>
        );
      })}
    </defs>
  );
};

export default React.memo(ClipPathDefs);
