import React, { useContext } from "react";
import { getSpriteTransform, matrixTransformToSvg } from "./transform";
import type { Sprite } from "../types/Sprite";
import { outsetPathData } from "./outsetPath";
import { clipElements, uniteClipElements } from "./unitePaths";
import type { RegionDef } from "./layerPlan";
import { membership } from "./regions";
import type { RenderNode } from "./RenderTree";
import { bindPose, displayOf, joinRefs, PoseBindingsContext, prefixWriter, setAttr, type PoseBindings } from "./poseBindings";

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
    joinRefs<Element>(
      bindPose<Element>(bindings, node.id, (element) => {
        const writeTransform = prefixWriter(node.id, "transform", clipNodeTransform(node), rendered, clipNodeTransform)(element);
        return (get) => {
          writeTransform(get);
          const posed = path && get(node.id);
          if (posed) setAttr(element, "d", path(posed));
        };
      }),
      // A hidden member stays in the clip-path with display none, which leaves it out of the clip (see displayOf).
      (element) => element && setAttr(element, "display", displayOf(node)),
    );

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
    const { elements } = sprite.customSprite;
    const rootTransform = [combinedTransform, getSpriteTransform(sprite.customSprite, 4)].join(" ");
    const outsetPath = (d: string) => (outset ? outsetPathData(d, outset) : d);
    // Several filled elements draw as one path, merged once, so the browser never merges their shared edges.
    const united = uniteClipElements(elements, sprite.clipPathIndices);
    if (united) return <path key={key} ref={bind(rootTransform)} d={outsetPath(united)} transform={rootTransform} />;
    return clipElements(elements, sprite.clipPathIndices).map(({ element, index }) => {
      const t = [rootTransform, element.transform].filter(Boolean).join(" ");
      return <path key={`${key}_${index}`} ref={bind(t)} d={outsetPath(element.d!)} transform={t} />;
    });
  }
  if (sprite.dynamicPath) {
    // An outset of 0 leaves the path as is, without offsetting it.
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
  /** The regions to draw as clip-paths, with their members as they stand. */
  defs: RegionDef[];
};

/**
 * Region shapes as <clipPath>s: each member's shape, whatever its fill or colours (see regions.ts).
 *
 * An outline node shares its owner's shape and region joins, so both are members. A clip-path draws only shapes,
 * so the outline node is skipped when its owner is drawn too: Chromium unions a clip-path's children into one
 * path, and two exactly coincident copies of a shape make that union fail at some transforms, leaving the
 * clip-path dropping most of its area (a thigh's sock vanishing at one abdomen angle).
 */
const ClipPathDefs: React.FC<ClipPathDefsProps> = ({ defs }) => {
  const bindings = useContext(PoseBindingsContext);
  if (defs.length === 0) return null;

  return (
    <defs>
      {defs.map((def) => (
        <clipPath key={def.key} id={def.id} clipPathUnits="userSpaceOnUse">
          {def.nodes.map((node) => {
            // Hidden members stay under a Rig, so a pose can show them again without a render.
            if (node.noSprite || (node.hidden && !bindings)) return null;
            if (node.outlineOf !== undefined && def.nodes.some((owner) => owner.id === node.outlineOf)) return null;
            const nodeTransform = clipNodeTransform(node);
            const spriteTransform = getSpriteTransform(node.sprite, CLIP_PRECISION);
            const sprite = { ...node.sprite, fill: "white", colors: {} };
            return renderClipElement(
              sprite,
              nodeTransform,
              spriteTransform,
              node.id,
              membership(node, def.region)?.outset,
              clipBinder(bindings, node),
            );
          })}
        </clipPath>
      ))}
    </defs>
  );
};

export default React.memo(ClipPathDefs);
