import React, { useContext } from "react";
import SvgSprite from "./Sprite";
import SvgSpriteMask, { spriteMaskAttributes } from "./SpriteMask";
import type { RenderNode } from "./RenderTree";
import { matrixTransformToSvg } from "./transform";
import SvgSpritePattern from "./Pattern";
import { getFillWrapTargets, RegionFormsContext, wrapFill } from "./fillWrappers";
import { bindPose, joinRefs, PoseBindingsContext, setAttr, type PoseBindings } from "./poseBindings";
import { isCut, outlineCuts } from "./regions";

export type SvgGroupProps = {
  g: RenderNode;
  onRotate: (g: RenderNode) => (e: React.MouseEvent) => void;
  onSelectAttachment?: (event: React.PointerEvent) => void;
  setPartRef: (id: string, el: SVGGElement | null) => void;
  scopeId: (suffix: string) => string;
  opacity?: number;
  clickable?: boolean;
  layer?: "fill" | "maskOutline" | "both";
  spriteFillOverride?: string;
  spriteStrokeOverride?: string;
  /** When true, skip applying clippedBy clip-path wrappers (caller already handles clipping). */
  skipClipPaths?: boolean;
  /** When true, the fill gets no mask or clip-path wrappers; the caller wraps a run of fills sharing them. */
  skipFillWrappers?: boolean;
};

/** Binds an element whose transform is node `id`'s matrix to the pose. */
export const bindNodeTransform = (bindings: PoseBindings | null, id: string, precision?: number) =>
  bindPose<Element>(bindings, id, (element) => (get) => {
    const node = get(id);
    if (node) setAttr(element, "transform", matrixTransformToSvg(node.matrix, precision));
  });

const jointChain = (node: RenderNode) => {
  const ids: string[] = [];
  for (let joint: RenderNode | undefined = node; joint; joint = joint.jointParent) ids.push(joint.id);
  return ids.join(" ");
};

const SvgGroup: React.FC<SvgGroupProps> = ({
  g,
  onRotate,
  onSelectAttachment,
  setPartRef,
  scopeId,
  opacity,
  clickable,
  layer = "both",
  spriteFillOverride,
  spriteStrokeOverride,
  skipClipPaths,
  skipFillWrappers,
}) => {
  const bindings = useContext(PoseBindingsContext);
  const forms = useContext(RegionFormsContext);
  if (g.noSprite || g.hidden) return null;

  const transform = matrixTransformToSvg(g.matrix);
  const articulated = Boolean(g.pointerEventsTarget) || g.parent?.articulated || g.articulated;
  const rotateTarget = g.pointerEventsTarget ? { ...(g.parent ?? g), id: g.pointerEventsTarget } : (g.parent ?? g);
  const rotates = articulated && !onSelectAttachment;
  // Joints a press here rotates, directly or by being carried along (e.g. "hair_back head neck"), so other
  // features can ask whether a part moves with a given joint.
  const rotateChain = rotates ? jointChain(rotateTarget) : undefined;
  const maskId = g.mask ? scopeId(`${g.id}_mask`) : undefined;
  // The node's own cut: a clip-path when its edges are hard, else a mask.
  const spriteMask = maskId ? spriteMaskAttributes(g.mask!, maskId) : {};
  const patternId = g.pattern ? scopeId(`${g.id}_pattern`) : undefined;
  const patternFillIds: Record<string, string> | undefined = g.patternFills
    ? Object.fromEntries(Object.keys(g.patternFills).map((idx) => [idx, scopeId(`${g.id}_pattern_el${idx}`)]))
    : undefined;
  const fillWrapTargets = getFillWrapTargets(g, skipClipPaths, forms);
  // A traced outline is cut by the outlines of the regions it traces.
  const outlineWrapTargets = g.traceOutline
    ? outlineCuts(g).flatMap((name) => forms.get(name)?.outlineMaskId ?? [])
    : [];
  const outerStyle = g.blendMode ? { mixBlendMode: g.blendMode } : undefined;
  const clickableStyle = clickable ? { cursor: "pointer" } : undefined;
  // Cut nodes keep pointer events off, whether a region cuts them with a mask or a clip-path.
  const hasFillMasks = isCut(g);

  const wrapWithMasks = (content: React.ReactNode, maskIds: string[], variant: "fill" | "outline") => {
    if (!maskIds.length) {
      return content;
    }
    return maskIds.reduceRight(
      (acc, maskTarget, index) => (
        <g
          key={`${g.id}_${variant}_clip_${index}`}
          mask={`url(#${maskTarget})`}
          style={index === 0 && variant !== "outline" ? outerStyle : undefined}
        >
          {acc}
        </g>
      ),
      content,
    );
  };

  // Identity group is outermost; clip/mask wrappers go inside around the sprite content.
  const spriteContent = (
    <>
      {maskId ? <SvgSpriteMask id={maskId} sprite={g.mask!} /> : null}
      {patternId && g.pattern ? <SvgSpritePattern id={patternId} sprite={g.pattern} target={g} /> : null}
      {patternFillIds && g.patternFills
        ? Object.entries(g.patternFills).map(([idx, patternSprite]) => (
            <SvgSpritePattern key={idx} id={patternFillIds[idx]} sprite={patternSprite} target={g} />
          ))
        : null}
      {clickable ? (
        <g
          key={`${g.id}_hit`}
          transform={transform}
          ref={joinRefs<SVGGElement>((el) => setPartRef(g.id, el), bindNodeTransform(bindings, g.id))}
          onPointerDown={onSelectAttachment}
          data-render-hit={g.id}
          style={{ pointerEvents: "visiblePainted", cursor: "pointer", opacity: 0 }}
        >
          <SvgSprite
            id={`${g.id}_hit`}
            poseNode={g.id}
            articulated={false}
            sprite={g.sprite}
            mode={"default"}
            pattern={patternId}
            patternFills={patternFillIds}
            cursorOverride="pointer"
            fillOverride={spriteFillOverride}
            strokeOverride={spriteStrokeOverride}
          />
        </g>
      ) : null}
      <g
        key={g.id}
        transform={transform}
        // Opacity multiplies like the fill's masks and clip-paths, so it can sit here instead of on an outer <g>.
        opacity={outerStyle ? undefined : opacity}
        mask={spriteMask.mask}
        clipPath={spriteMask.clipPath}
        data-render-id={g.id}
        ref={joinRefs<SVGGElement>((el) => setPartRef(g.id, el), bindNodeTransform(bindings, g.id))}
        data-rotate-chain={rotateChain}
        onMouseDown={rotates ? onRotate(rotateTarget) : undefined}
        onPointerDown={onSelectAttachment}
        style={
          g.pointerEvents === false
            ? { pointerEvents: "none" as const }
            : hasFillMasks && g.pointerEvents !== true
              ? { ...(clickableStyle ?? {}) }
              : { pointerEvents: "visiblePainted", ...(clickableStyle ?? {}) }
        }
      >
        <SvgSprite
          id={g.id}
          poseNode={g.id}
          articulated={articulated}
          sprite={g.sprite}
          mode={"default"}
          pattern={patternId}
          patternFills={patternFillIds}
          cursorOverride={clickable ? "pointer" : undefined}
          fillOverride={spriteFillOverride}
          strokeOverride={spriteStrokeOverride}
        />
      </g>
    </>
  );

  // Wrap sprite content with clip-path and mask wrappers, then place inside the identity group.
  const wrappedContent = skipFillWrappers ? spriteContent : wrapFill(spriteContent, fillWrapTargets, g.id, outerStyle);

  // The node's own <g> carries pointer events, cursor and opacity; only a blend mode needs a <g> around the fill's
  // wrappers, so it blends with the backdrop rather than inside them.
  const filledGroup = outerStyle ? (
    <g key={g.id} opacity={opacity} style={outerStyle}>
      {wrappedContent}
    </g>
  ) : (
    wrappedContent
  );

  let outlineGroup: React.ReactNode = null;
  if (outlineWrapTargets.length > 0) {
    // The node's sprite mask is defined once, by the fill.
    const outlineNode = (
      <g
        key={`${g.id}_outline`}
        transform={transform}
        mask={maskId ? `url(#${maskId}_outline)` : undefined}
        data-render-id={`${g.id}_outline`}
        ref={joinRefs<SVGGElement>((el) => setPartRef(g.id, el), bindNodeTransform(bindings, g.id))}
        style={{ pointerEvents: "none" }}
      >
        <SvgSprite id={g.id} poseNode={g.id} articulated={articulated} sprite={g.sprite} mode={"outline"} />
      </g>
    );
    const baseOutlineGroup = outerStyle ? (
      <g key={`${g.id}_outline`} style={outerStyle}>
        {outlineNode}
      </g>
    ) : (
      outlineNode
    );
    outlineGroup = wrapWithMasks(baseOutlineGroup, outlineWrapTargets, "outline");
  }

  if (layer === "fill") {
    return <>{filledGroup}</>;
  }
  if (layer === "maskOutline") {
    return <>{outlineGroup}</>;
  }
  return (
    <>
      {filledGroup}
      {outlineGroup}
    </>
  );
};

const areEqual = (a: SvgGroupProps, b: SvgGroupProps) =>
  a.g === b.g &&
  a.onRotate === b.onRotate &&
  a.onSelectAttachment === b.onSelectAttachment &&
  a.setPartRef === b.setPartRef &&
  a.opacity === b.opacity &&
  a.clickable === b.clickable &&
  a.scopeId === b.scopeId &&
  a.spriteFillOverride === b.spriteFillOverride &&
  a.spriteStrokeOverride === b.spriteStrokeOverride &&
  a.skipClipPaths === b.skipClipPaths &&
  a.skipFillWrappers === b.skipFillWrappers &&
  a.layer === b.layer;
export default React.memo(SvgGroup, areEqual);
