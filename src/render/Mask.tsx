import type { RenderNode } from "./RenderTree";
import SvgSprite from "./Sprite";
import SvgSpriteMask, { spriteMaskAttributes } from "./SpriteMask";
import React, { useContext, useMemo } from "react";
import { matrixTransformToSvg } from "./transform";
import { maskProps } from "./maskProps";
import { getSpriteSignature } from "./utils/getSpriteSignature";
import { fillCuts, membership } from "./regions";
import type { RegionForms, RegionShape } from "./layerPlan";
import { getMaskRegion, type Bounds } from "./spriteBounds";
import { bindPose, PoseBindingsContext, setAttr } from "./poseBindings";
import { bindNodeTransform } from "./Group";

/** A mask's region attributes: its members' bounds, or the default region when they have none. */
const maskAttributesFor = (bounds: Bounds | null) =>
  bounds
    ? {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        maskUnits: "userSpaceOnUse" as const,
        maskContentUnits: "userSpaceOnUse" as const,
      }
    : {
        x: maskProps.x,
        y: maskProps.y,
        width: maskProps.width,
        height: maskProps.height,
        maskUnits: undefined,
        maskContentUnits: "userSpaceOnUse" as const,
      };

type MaskProps = {
  id: string;
  region: string;
  /** "full": the members' shapes; "inset": the same, minus the inner half of insetting members' outlines; "outline": the members' outlines. */
  shape: RegionShape;
  nodes: RenderNode[];
  /** How every region is drawn, for members that add only where their own cuts leave them. */
  forms: RegionForms;
};

const getMemberMaskSignature = (node: RenderNode) => {
  const maskSprite = node.mask;
  if (!maskSprite) {
    return `${node.id}:none`;
  }
  return `${node.id}:${getSpriteSignature(maskSprite)}`;
};

const isStroked = (node: RenderNode) => (node.sprite.strokeWidth ?? 0) > 0 && node.sprite.stroke !== "none";

/** A region's shape as a <mask>, for what a clip-path can't draw: subtraction, inset outlines, outline rings. */
const SvgMask: React.FC<MaskProps> = ({ id, region, shape, nodes, forms }) => {
  const bindings = useContext(PoseBindingsContext);
  const members = useMemo(() => {
    const seen = new Set<string>();
    return nodes.filter((node) => {
      if (seen.has(node.id)) return false;
      seen.add(node.id);
      return true;
    });
  }, [nodes]);
  // From the members' geometry where they stand, so it is right on the first render, without measuring.
  const bounds = useMemo(() => getMaskRegion(members, region), [members, region]);

  const spriteMaskSignature = members.map(getMemberMaskSignature).join("||");

  const spriteMaskEntries = useMemo(() => {
    return members
      .filter((node) => !!node.mask)
      .map((node) => ({
        nodeId: node.id,
        maskId: `${id}_${node.id}_sprite_mask`,
        sprite: node.mask!,
      }));
  }, [members, id, spriteMaskSignature]);

  const spriteMaskLookup = useMemo(() => {
    const map = new Map<string, string>();
    spriteMaskEntries.forEach((entry) => {
      map.set(entry.nodeId, entry.maskId);
    });
    return map;
  }, [spriteMaskEntries]);

  // A member adding only where it's cut is cut here by the full shape of each region cutting it.
  const wrapInCuts = (node: RenderNode, content: React.ReactElement) =>
    membership(node, region)?.onlyWhereCut
      ? [...new Set(fillCuts(node))]
          .filter((name) => name !== region)
          .reduce((inner, name) => {
            const form = forms.get(name)?.full;
            const attributes = form?.clipId ? { clipPath: `url(#${form.clipId})` } : form?.maskId ? { mask: `url(#${form.maskId})` } : undefined;
            return attributes ? (
              <g key={`${node.id}_cut_${name}`} {...attributes}>
                {inner}
              </g>
            ) : (
              inner
            );
          }, content)
      : content;

  const renderMember = (node: RenderNode) => {
    const member = membership(node, region);
    // The outline ring keeps its own black-fill/white-stroke colouring: an add or subtract fill would break it.
    const mode =
      shape === "outline" ? "outline_mask" : shape === "inset" && member?.inset && isStroked(node) ? "mask_no_outline" : "mask";
    const maskFill = shape === "outline" ? undefined : member?.subtract ? "black" : "white";
    // Outset: a stroke in the fill color, 2x wide, grows the shape by `outset` on every side.
    const outset = shape === "outline" ? 0 : (member?.outset ?? 0);
    const transform = matrixTransformToSvg(node.matrix);
    const spriteMaskId = spriteMaskLookup.get(node.id);
    // Only the shape counts: opacity and blur don't (see regions.ts).
    const sprite = (
      <SvgSprite
        key={`${node.id}_${mode}`}
        id={node.id}
        sprite={{ ...node.sprite, opacity: undefined, blur: undefined }}
        mode={mode}
        fillOverride={maskFill}
        strokeOverride={outset > 0 ? maskFill : member?.subtract ? maskFill : undefined}
        strokeWidthOverride={outset > 0 ? outset * 2 : undefined}
        // A sprite mask is in node space, so only then does the node transform need its own <g>.
        baseTransform={spriteMaskId ? undefined : transform}
        poseNode={node.id}
      />
    );
    return spriteMaskId ? (
      <g
        key={`${node.id}_${mode}`}
        ref={bindNodeTransform(bindings, node.id)}
        transform={transform}
        {...spriteMaskAttributes(node.mask!, spriteMaskId)}
      >
        {sprite}
      </g>
    ) : (
      sprite
    );
  };

  const maskAttributes = maskAttributesFor(bounds);
  // The region follows the members, so a pose that moves one rewrites it.
  const memberIds = members.map((node) => node.id);
  const bindRegion = () =>
    bindPose<Element>(bindings, memberIds, (element) => (get) => {
      const next = maskAttributesFor(getMaskRegion(members.map((node) => get(node.id) ?? node), region));
      setAttr(element, "x", next.x);
      setAttr(element, "y", next.y);
      setAttr(element, "width", next.width);
      setAttr(element, "height", next.height);
      setAttr(element, "maskUnits", next.maskUnits);
    });

  return (
    <>
      {spriteMaskEntries.map((entry) => (
        <SvgSpriteMask key={entry.maskId} id={entry.maskId} sprite={entry.sprite} />
      ))}
      <mask ref={bindRegion()} id={id} {...maskAttributes}>
        <g>
          {members.map((node) => (node.noSprite || node.hidden ? null : wrapInCuts(node, renderMember(node))))}
        </g>
      </mask>
    </>
  );
};

// Node arrays are rebuilt every render; members keep identity while a pose leaves them in place (see posedRig.ts).
const areEqual = (a: MaskProps, b: MaskProps) =>
  a.id === b.id &&
  a.region === b.region &&
  a.shape === b.shape &&
  a.forms === b.forms &&
  a.nodes.length === b.nodes.length &&
  a.nodes.every((node, index) => node === b.nodes[index]);

export default React.memo(SvgMask, areEqual);
