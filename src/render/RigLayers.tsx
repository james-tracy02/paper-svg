import { Fragment, memo, useLayoutEffect, useMemo, type ReactNode } from "react";
import type { Node } from "../types/Node";
import type { Color } from "../types/primitives";
import type { RenderGroupOptions } from "../types/RenderGroup";
import SvgMask from "./Mask";
import SvgGroup from "./Group";
import SvgGroupOutline from "./GroupOutline";
import SpriteDefs from "./SpriteDefs";
import ClipPathDefs from "./ClipPathDefs";
import type { RenderNode } from "./RenderTree";
import { RegionFormsContext, wrapWith } from "./fillWrappers";
import { isCut } from "./regions";
import { HoistedDefsProvider } from "./HoistedDefs";
import { planLayers, resolveVisibleNodes, type PaintItem, type RegionDef, type RegionForms } from "./layerPlan";
import { getPosedRig } from "./useRenderNodes";
import { PoseBindingsContext } from "./poseBindings";
import type { LivePoser } from "./livePose";

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
  /**
   * The tree's render nodes, sorted by zIndex. From `useRenderNodes`, the layers are planned once per
   * tree and a pose change only re-renders the nodes it moved.
   */
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
  /** Lets poses be written to the DOM without a render (see `RigHandle.setPose`). */
  livePose?: LivePoser;
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

const sameNode = (node: RenderNode) => node;

const renderMaskDefs = (defs: RegionDef[], forms: RegionForms, current: (node: RenderNode) => RenderNode) =>
  defs.length ? (
    <defs>
      {defs.map((def) => (
        <SvgMask key={def.key} id={def.id} region={def.region} shape={def.shape} nodes={def.nodes.map(current)} forms={forms} />
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
  livePose,
}) => {
  // Nodes from useRenderNodes come with a layout: the plan is made from it once per tree, and each node
  // in the plan is swapped for its posed version when painted.
  const posed = getPosedRig(nodes);
  const current = posed?.current ?? sameNode;
  const planNodes = posed?.layout.nodes ?? nodes;
  const visibleNodes = useMemo(
    () => posed?.layout.visibleNodes ?? resolveVisibleNodes(planNodes),
    // `posed` changes with every pose; its layout only with the tree, which `planNodes` follows.
    [planNodes],
  );
  const plan = useMemo(
    () => planLayers({ nodes: planNodes, visibleNodes, getRenderGroupOptions, scopeId }),
    [planNodes, visibleNodes, getRenderGroupOptions, scopeId],
  );
  const clipDefs = useMemo(
    () => (posed ? plan.defs.clips.map((def) => ({ ...def, nodes: def.nodes.map(current) })) : plan.defs.clips),
    [plan, posed, current],
  );

  // After each commit the DOM shows these nodes again, wherever a written pose had moved them.
  useLayoutEffect(() => livePose?.committed(posed), [livePose, posed]);

  const renderNode = (planned: RenderNode, layer: "fill" | "maskOutline", skipFillWrappers?: boolean) => {
    const g = current(planned);
    const isClipped = g.pointerEvents !== true && isCut(g);
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
            style={group.blendMode && group.blendMode !== "normal" ? { mixBlendMode: group.blendMode } : undefined}
          >
            {group.wrappers.reduceRight<ReactNode>(
              (content, wrapper, index) => wrapWith(content, wrapper, `${item.key}_cut_${index}`),
              item.items.map(renderItem),
            )}
          </g>
        );
      }
    }
  };

  return (
    <PoseBindingsContext.Provider value={livePose?.bindings ?? null}>
      <HoistedDefsProvider>
        <RegionFormsContext.Provider value={plan.defs.forms}>
          <SpriteDefs body={body} nodes={posed?.nodes} />
          {renderMaskDefs(plan.defs.masks, plan.defs.forms, current)}
          <ClipPathDefs defs={clipDefs} />
          {outerOutline
            ? plan.outerOutlines.map(current).map((g) => (
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
        </RegionFormsContext.Provider>
      </HoistedDefsProvider>
    </PoseBindingsContext.Provider>
  );
};

// Re-renders only when a prop changes, so a parent re-render with the same rig skips the whole paint tree.
export default memo(RigLayers);
