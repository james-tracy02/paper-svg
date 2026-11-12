import { Fragment, memo, useMemo, useState, type ReactNode } from "react";
import type { Node } from "../types/Node";
import type { Color } from "../types/primitives";
import type { RenderGroupOptions } from "../types/RenderGroup";
import SvgMask from "./Mask";
import SvgGroup from "./Group";
import SvgGroupOutline from "./GroupOutline";
import SpriteDefs from "./SpriteDefs";
import ClipPathDefs from "./ClipPathDefs";
import type { RenderNode } from "./RenderTree";
import { createNodeInterner } from "./stableNodes";
import { wrapWith } from "./fillWrappers";
import { HoistedDefsProvider } from "./HoistedDefs";
import { planLayers, resolveVisibleNodes, type MaskDef, type PaintItem } from "./layerPlan";

/** Overrides how one node responds to the pointer. */
export type RigNodeInteraction = {
  /** Forces pointer events on or off. Undefined keeps the default: off for masked or clipped nodes. */
  pointerEvents?: boolean;
  /** Adds a hit area and a pointer cursor. */
  clickable?: boolean;
  /** Pressing the node calls this instead of starting a rotation. */
  onSelect?: (event: React.PointerEvent) => void;
};

export type RigLayersProps = {
  /** Root of the node tree. Sprite definitions are collected from it. */
  body: Node;
  /** The tree's render nodes, sorted by zIndex (see useRenderNodes). */
  nodes: RenderNode[];
  /** Prefixes a generated SVG id, so several rigs can share a document. */
  scopeId: (suffix: string) => string;
  /** Per-render-group options (mask, clip, opacity, blendMode) by group id. */
  getRenderGroupOptions?: (id: string) => RenderGroupOptions | undefined;
  /** Mouse handler for pressing a node that rotates `part`. */
  onRotate?: (part: RenderNode) => (event: React.MouseEvent) => void;
  /** Receives each node's root element. */
  setPartRef?: (id: string, element: SVGGElement | null) => void;
  resolveInteraction?: (node: RenderNode) => RigNodeInteraction | undefined;
  /** A second stroke drawn around every node. */
  outerOutline?: { color: Color; thickness: number };
  /** Return true to paint a node at zero opacity. */
  isHidden?: (node: RenderNode) => boolean;
};

const noRenderGroupOptions = () => undefined;
const noRotate = () => () => {};
const noPartRef = () => {};

// Pointer-event variants of a node, cached so the copy keeps its identity while the node does.
const pointerEventVariants = new WeakMap<RenderNode, { on?: RenderNode; off?: RenderNode }>();
const withPointerEvents = (g: RenderNode, pointerEvents: boolean): RenderNode => {
  const variants = pointerEventVariants.get(g) ?? {};
  pointerEventVariants.set(g, variants);
  const key = pointerEvents ? "on" : "off";
  return (variants[key] ??= { ...g, pointerEvents });
};

const renderMaskDefs = (defs: MaskDef[]) =>
  defs.length ? (
    <defs>
      {defs.map((def) => (
        <SvgMask
          key={def.key}
          id={def.id}
          groupName={def.groupName}
          groups={def.nodes}
          mode={def.mode}
          withFill={def.withFill}
          withNoOutline={def.withNoOutline}
          ignoreOpacity={def.ignoreOpacity}
        />
      ))}
    </defs>
  ) : null;

/**
 * Paints sorted render nodes: mask and clip definitions, hoisted outlines, render groups, and fills
 * that share mask and clip wrappers. What goes where is decided by `planLayers`; this turns the plan
 * into SVG and wires up interaction. Rig wraps this; use it directly to add your own interaction or
 * overlays.
 */
const RigLayers: React.FC<RigLayersProps> = ({
  body,
  nodes,
  scopeId,
  getRenderGroupOptions = noRenderGroupOptions,
  onRotate = noRotate,
  setPartRef = noPartRef,
  resolveInteraction,
  outerOutline,
  isHidden,
}) => {
  // Unchanged nodes keep their identity across rebuilds, so memoized groups skip re-rendering.
  const [intern] = useState(createNodeInterner);
  const visibleNodes = useMemo(() => intern(resolveVisibleNodes(nodes)), [nodes, intern]);
  const plan = useMemo(
    () => planLayers({ nodes, visibleNodes, getRenderGroupOptions, scopeId }),
    [nodes, visibleNodes, getRenderGroupOptions, scopeId],
  );

  const renderNode = (g: RenderNode, layer: "fill" | "maskOutline", skipFillWrappers?: boolean) => {
    const isClipped = g.pointerEvents !== true && Boolean(g.maskedBy?.length || g.clippedBy?.length);
    const interaction = resolveInteraction?.(g);
    const pointerEvents = interaction?.pointerEvents ?? (isClipped ? false : undefined);
    return (
      <SvgGroup
        key={`${layer}_${g.id}`}
        g={pointerEvents === undefined ? g : withPointerEvents(g, pointerEvents)}
        onRotate={onRotate}
        onSelectAttachment={interaction?.onSelect}
        clickable={interaction?.clickable}
        setPartRef={setPartRef}
        scopeId={scopeId}
        opacity={isHidden?.(g) ? 0 : g.opacity}
        layer={layer}
        skipFillWrappers={skipFillWrappers}
      />
    );
  };

  const renderItem = (item: PaintItem): ReactNode => {
    switch (item.kind) {
      case "fill":
        return <Fragment key={item.key}>{renderNode(item.node, "fill", true)}</Fragment>;
      case "standalone":
        return (
          <Fragment key={item.key}>
            {renderNode(item.node, "fill")}
            {item.maskOutlines.map((node) => renderNode(node, "maskOutline"))}
          </Fragment>
        );
      case "maskOutlines":
        return <Fragment key={item.key}>{item.nodes.map((node) => renderNode(node, "maskOutline"))}</Fragment>;
      case "wrap":
        return wrapWith(item.items.map(renderItem), item.wrapper, item.key);
      case "renderGroup": {
        const { group } = item;
        return (
          <g
            id={`render_group_${group.id}`}
            key={item.key}
            opacity={group.opacity}
            mask={group.maskId ? `url(#${group.maskId})` : undefined}
            clipPath={group.clipId ? `url(#${group.clipId})` : undefined}
            style={group.blendMode && group.blendMode !== "normal" ? { mixBlendMode: group.blendMode } : undefined}
          >
            {item.items.map(renderItem)}
          </g>
        );
      }
    }
  };

  return (
    <HoistedDefsProvider>
      <SpriteDefs body={body} />
      {renderMaskDefs(plan.defs.maskFills)}
      {renderMaskDefs(plan.defs.maskOutlines)}
      {renderMaskDefs(plan.defs.clipOutlines)}
      {renderMaskDefs(plan.defs.clipFills)}
      <ClipPathDefs clipGroups={plan.defs.clipGroups} scopeId={scopeId} />
      {outerOutline
        ? plan.outerOutlines.map((g) => (
            <SvgGroupOutline
              key={`outer_${g.id}`}
              g={g}
              stroke={outerOutline.color}
              strokeWidth={outerOutline.thickness}
              scopeId={scopeId}
              opacity={isHidden?.(g) ? 0 : g.opacity}
            />
          ))
        : null}
      {plan.items.map(renderItem)}
    </HoistedDefsProvider>
  );
};

// Re-renders only when a prop changes, so a parent re-render with the same rig skips the whole paint tree.
export default memo(RigLayers);
