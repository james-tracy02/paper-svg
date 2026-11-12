import { Fragment, useCallback, useMemo, useState, type CSSProperties } from "react";
import type { Node } from "../types/Node";
import type { Color } from "../types/primitives";
import type { RenderGroupOptions } from "../types/RenderGroup";
import SvgMask from "./Mask";
import SvgGroup from "./Group";
import SvgGroupOutline from "./GroupOutline";
import SpriteDefs from "./SpriteDefs";
import TrueClipDefs, { getClippingGroups, type TrueClipGroup } from "./TrueClipDefs";
import type { RenderNode } from "./RenderTree";
import { createNodeInterner } from "./stableNodes";
import { getFillWrapTargets, listFillWrappers, wrapWith, type FillWrapper } from "./fillWrappers";
import { HoistedDefsProvider } from "./HoistedDefs";

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

type MaskGroup = { id: string; groups: RenderNode[] };

const noRenderGroupOptions = () => undefined;
const noRotate = () => () => {};
const noPartRef = () => {};

const getMaskGroups = (groups: RenderNode[]): Map<string, MaskGroup> => {
  const map = new Map<string, MaskGroup>();
  for (const g of groups) {
    for (const name of g.maskGroups ?? []) {
      if (!map.has(name)) map.set(name, { id: name, groups: [] });
      map.get(name)!.groups.push(g);
    }
  }
  return map;
};

// Pointer-event variants of a node, cached so the copy keeps its identity while the node does.
const pointerEventVariants = new WeakMap<RenderNode, { on?: RenderNode; off?: RenderNode }>();
const withPointerEvents = (g: RenderNode, pointerEvents: boolean): RenderNode => {
  const variants = pointerEventVariants.get(g) ?? {};
  pointerEventVariants.set(g, variants);
  const key = pointerEvents ? "on" : "off";
  return (variants[key] ??= { ...g, pointerEvents });
};

/**
 * Paints sorted render nodes: mask and true-clip definitions, hoisted outlines, render groups,
 * and fills that share mask and clip wrappers. Rig wraps this; use it directly to add your own
 * interaction or overlays.
 */
const RigLayers: React.FC<RigLayersProps> = ({
  body,
  nodes: sortedGroups,
  scopeId,
  getRenderGroupOptions = noRenderGroupOptions,
  onRotate = noRotate,
  setPartRef = noPartRef,
  resolveInteraction,
  outerOutline,
  isHidden,
}) => {
  const [internTrueClipNodes] = useState(createNodeInterner);

  const maskGroups = getMaskGroups(sortedGroups);
  const trueClipGroups = getClippingGroups(sortedGroups);

  const isMaskingFullyResolved = useCallback(
    (g: RenderNode) => {
      if ((g.maskedBy ?? []).some((name) => !maskGroups.has(name))) return false;
      if ((g.clippedBy ?? []).some((name) => !trueClipGroups.has(name))) return false;
      return true;
    },
    [maskGroups, trueClipGroups],
  );

  const trueClipRenderNodes = useMemo(() => {
    const baseGroups = sortedGroups.filter(isMaskingFullyResolved).map((g) => ({ ...g, sprite: { ...g.sprite } }));
    const ownerById = new Map(baseGroups.map((g) => [g.id, g] as const));

    const ownersByClipName = new Map<string, string[]>();
    for (const g of baseGroups) {
      if (g.id.endsWith("_outline")) continue;
      for (const name of g.clippingGroups ?? []) {
        if (!ownersByClipName.has(name)) ownersByClipName.set(name, []);
        ownersByClipName.get(name)!.push(g.id);
      }
    }

    const dependentsByOwnerId = new Map<string, Array<{ clipName: string; node: RenderNode }>>();
    const stagedKeysByOwnerId = new Map<string, Set<string>>();
    const dependentsByClipName = new Map<string, RenderNode[]>();
    for (const g of baseGroups) {
      for (const clipName of g.clippedBy ?? []) {
        if (!dependentsByClipName.has(clipName)) dependentsByClipName.set(clipName, []);
        dependentsByClipName.get(clipName)!.push(g);
      }
    }

    for (const [clipName, dependents] of dependentsByClipName.entries()) {
      const ownerIds = ownersByClipName.get(clipName) ?? [];
      for (const ownerId of ownerIds) {
        if (!dependentsByOwnerId.has(ownerId)) dependentsByOwnerId.set(ownerId, []);
        if (!stagedKeysByOwnerId.has(ownerId)) stagedKeysByOwnerId.set(ownerId, new Set());
        const stagedKeys = stagedKeysByOwnerId.get(ownerId)!;
        dependents.forEach((node) => {
          const dedupeKey = `${clipName}::${node.id}`;
          if (stagedKeys.has(dedupeKey)) return;
          stagedKeys.add(dedupeKey);
          dependentsByOwnerId.get(ownerId)!.push({ clipName, node });
        });
      }
    }

    const hoistedOutlines: RenderNode[] = [];
    for (const [ownerId, deps] of dependentsByOwnerId) {
      const ownerNode = ownerById.get(ownerId);
      if (!ownerNode || ownerNode.linkedOutline || ownerNode.disableOutlineHoisting) continue;
      const stroke = ownerNode.sprite.stroke;
      const strokeWidth = ownerNode.sprite.strokeWidth ?? 0;
      if (!stroke || stroke === "none" || strokeWidth <= 0) continue;
      const maxDepZ = deps.reduce((max, d) => Math.max(max, d.node.zIndex), ownerNode.zIndex);
      const hoistZ = maxDepZ + 0.00000001;
      const outline: RenderNode = {
        ...ownerNode,
        id: `${ownerNode.id}_outline`,
        zIndex: hoistZ,
        pattern: undefined,
        patternFills: undefined,
        sprite: {
          ...ownerNode.sprite,
          fill: "none",
          colors: {},
          fillGradient: undefined,
          strokeWidth: strokeWidth ? strokeWidth * (hoistZ < ownerNode.zIndex ? 2 : 1) : 0,
          stroke: ownerNode.sprite.stroke,
        },
        articulated: false,
        mask: ownerNode.mask,
      };
      ownerNode.linkedOutline = outline;
      ownerNode.sprite.strokeWidth = 0;
      hoistedOutlines.push(outline);
    }

    return internTrueClipNodes([...baseGroups, ...hoistedOutlines].sort((a, b) => a.zIndex - b.zIndex));
  }, [sortedGroups, isMaskingFullyResolved, internTrueClipNodes]);

  const usedMasks = useMemo(() => {
    const fill = new Set<string>();
    const noOutline = new Set<string>();
    const outline = new Set<string>();
    const trueClipOutline = new Set<string>();
    for (const g of trueClipRenderNodes) {
      const renderGroupMask = g.renderGroup && getRenderGroupOptions(g.renderGroup.id)?.mask;
      if (renderGroupMask) noOutline.add(renderGroupMask);
      if (g.noSprite) continue;
      (g.maskedBy ?? []).forEach((name) => (g.maskOutline ? fill : noOutline).add(name));
      if (!g.maskOutline) continue;
      (g.outlineMaskedBy ?? g.maskedBy ?? []).forEach((name) => outline.add(name));
      (g.outlineClippedBy ?? g.outlineMaskedBy ?? g.clippedBy ?? []).forEach((name) =>
        trueClipOutline.add(name),
      );
    }
    return { fill, noOutline, outline, trueClipOutline };
  }, [trueClipRenderNodes, getRenderGroupOptions]);

  const renderGroupStack = (
    g: RenderNode,
    keyPrefix: string,
    options?: { skipTrueClip?: boolean; skipFillWrappers?: boolean },
  ) => {
    const resolvedOpacity = isHidden?.(g) ? 0 : g.opacity;
    const isClipped =
      g.pointerEvents !== true &&
      Boolean((g.maskedBy && g.maskedBy.length) || (g.clippedBy && g.clippedBy.length));
    const interaction = resolveInteraction?.(g);
    const pointerEvents = interaction?.pointerEvents ?? (isClipped ? false : undefined);
    const renderGroup = pointerEvents === undefined ? g : withPointerEvents(g, pointerEvents);

    const fill = (
      <SvgGroup
        key={`${keyPrefix}_fill_${g.id}`}
        g={renderGroup}
        onRotate={onRotate}
        onSelectAttachment={interaction?.onSelect}
        clickable={interaction?.clickable}
        setPartRef={setPartRef}
        scopeId={scopeId}
        opacity={resolvedOpacity}
        layer="fill"
        skipTrueClip={options?.skipTrueClip}
        skipFillWrappers={options?.skipFillWrappers}
      />
    );

    const maskOutline = (
      <SvgGroup
        key={`${keyPrefix}_maskOutline_${g.id}`}
        g={renderGroup}
        onRotate={onRotate}
        onSelectAttachment={interaction?.onSelect}
        clickable={interaction?.clickable}
        setPartRef={setPartRef}
        scopeId={scopeId}
        opacity={resolvedOpacity}
        layer="maskOutline"
        skipTrueClip={options?.skipTrueClip}
      />
    );

    const outline = outerOutline ? (
      <SvgGroupOutline
        key={`${keyPrefix}_outline_${g.id}`}
        g={g}
        stroke={outerOutline.color}
        strokeWidth={outerOutline.thickness}
        scopeId={scopeId}
        opacity={resolvedOpacity}
      />
    ) : null;

    return { fill, maskOutline, outline } as const;
  };

  const renderGroupList = (groupsToRender: RenderNode[]) =>
    (() => {
      type RenderGroupEntry = { id: string } & RenderGroupOptions;
      type RenderEntry =
        | { type: "node"; node: RenderNode }
        | { type: "renderGroup"; key: string; group: RenderGroupEntry; nodes: RenderNode[] };

      const groupMap = new Map<string, { group: RenderGroupEntry; nodes: RenderNode[]; maxIndex: number }>();
      groupsToRender.forEach((node, index) => {
        const group = node.renderGroup;
        if (!group) return;
        const groupOpts = getRenderGroupOptions(group.id);
        const opacity = groupOpts?.opacity === undefined ? undefined : Math.max(0, Math.min(1, groupOpts.opacity));
        const entry = groupMap.get(group.id) ?? {
          group: {
            id: group.id,
            opacity,
            mask: groupOpts?.mask,
            clip: groupOpts?.clip,
            blendMode: groupOpts?.blendMode ?? "normal",
          },
          nodes: [] as RenderNode[],
          maxIndex: -1,
        };
        entry.nodes.push(node);
        entry.maxIndex = Math.max(entry.maxIndex, index);
        groupMap.set(group.id, entry);
      });

      const insertedGroups = new Set<string>();
      const entries: RenderEntry[] = [];
      groupsToRender.forEach((node, index) => {
        const group = node.renderGroup;
        const entry = group ? groupMap.get(group.id) : undefined;
        if (!group || !entry) {
          entries.push({ type: "node", node });
          return;
        }
        if (entry.maxIndex === index && !insertedGroups.has(group.id)) {
          entries.push({ type: "renderGroup", key: group.id, group: entry.group, nodes: entry.nodes });
          insertedGroups.add(group.id);
        }
      });

      type OwnerIndex = {
        ownerById: Map<string, RenderNode>;
        ownersByClipName: Map<string, string[]>;
        outlineIdByOwnerId: Map<string, string>;
        outlineZByOwnerId: Map<string, number>;
      };
      const buildOwnerIndex = (nodes: RenderNode[]): OwnerIndex => {
        const ownerById = new Map(
          nodes.filter((node) => !node.id.endsWith("_outline")).map((node) => [node.id, node] as const),
        );
        const ownersByClipName = new Map<string, string[]>();
        nodes.forEach((node) => {
          if (node.id.endsWith("_outline")) return;
          for (const name of node.clippingGroups ?? []) {
            if (!ownersByClipName.has(name)) ownersByClipName.set(name, []);
            ownersByClipName.get(name)!.push(node.id);
          }
        });
        const outlineIdByOwnerId = new Map<string, string>();
        const outlineZByOwnerId = new Map<string, number>();
        nodes.forEach((node) => {
          if (!node.id.endsWith("_outline")) return;
          const baseId = node.id.replace(/_outline$/, "");
          outlineIdByOwnerId.set(baseId, node.id);
          outlineZByOwnerId.set(baseId, node.zIndex);
        });
        return { ownerById, ownersByClipName, outlineIdByOwnerId, outlineZByOwnerId };
      };

      const selectOwnerForMask = (node: RenderNode, index: OwnerIndex) => {
        const clipNames = node.clippedBy ?? [];
        let bestOwnerId: string | undefined;
        let bestZ = Number.NEGATIVE_INFINITY;
        let fallbackOwnerId: string | undefined;
        let fallbackZ = Number.NEGATIVE_INFINITY;
        clipNames.forEach((clipName) => {
          const ownerIds = index.ownersByClipName.get(clipName) ?? [];
          ownerIds.forEach((ownerId) => {
            const owner = index.ownerById.get(ownerId);
            if (!owner) return;
            const z = owner.zIndex;
            if (z <= node.zIndex && z > bestZ) {
              bestZ = z;
              bestOwnerId = ownerId;
            }
            if (z > fallbackZ) {
              fallbackZ = z;
              fallbackOwnerId = ownerId;
            }
          });
        });
        const ownerId = bestOwnerId ?? fallbackOwnerId;
        if (!ownerId) return undefined;
        return {
          ownerId,
          outlineId: index.outlineIdByOwnerId.get(ownerId),
          outlineZ: index.outlineZByOwnerId.get(ownerId),
        };
      };

      const ownerIndex = buildOwnerIndex(groupsToRender);
      const maskOutlineByNodeId = new Map<string, React.ReactNode[]>();
      groupsToRender.forEach((node) => {
        const hasTrueClip = Boolean(node.clippedBy?.length);
        const hasMask = Boolean(node.maskedBy?.length);
        if (!node.maskOutline || (!hasTrueClip && !hasMask)) return;
        const anchorOwner = hasTrueClip ? selectOwnerForMask(node, ownerIndex) : undefined;
        const anchorId =
          anchorOwner?.outlineId && anchorOwner.outlineZ !== undefined && anchorOwner.outlineZ >= node.zIndex
            ? anchorOwner.outlineId
            : node.id;
        const { maskOutline } = renderGroupStack(node, `mask_${node.id}`);
        if (!maskOutline) return;
        const bucket = maskOutlineByNodeId.get(anchorId) ?? [];
        bucket.push(<Fragment key={`mask_${anchorId}_${node.id}`}>{maskOutline}</Fragment>);
        maskOutlineByNodeId.set(anchorId, bucket);
      });

      const outlines: React.ReactNode[] = [];
      const renderStandalone = (node: RenderNode, scope: string, stackPrefix: string) => {
        const { fill, outline } = renderGroupStack(node, stackPrefix);
        if (outline) outlines.push(<Fragment key={`stack_outline_${scope}${node.id}`}>{outline}</Fragment>);
        return (
          <Fragment key={`stack_${scope}${node.id}`}>
            {fill}
            {maskOutlineByNodeId.get(node.id) ?? []}
          </Fragment>
        );
      };

      type SequenceItem =
        | { kind: "fill"; node: RenderNode; wrappers: FillWrapper[] }
        | { kind: "free"; content: React.ReactNode }
        | { kind: "barrier"; content: React.ReactNode };

      const renderNodeSequence = (
        nodes: RenderNode[],
        scope: string,
        stackPrefix: string,
        groupWrappers: FillWrapper[] = [],
      ) => {
        const items: SequenceItem[] = [];
        nodes.forEach((node) => {
          const bucket = maskOutlineByNodeId.get(node.id);
          if (node.blendMode) {
            items.push({ kind: "barrier", content: renderStandalone(node, scope, stackPrefix) });
            return;
          }
          if (node.noSprite) {
            items.push({ kind: bucket ? "barrier" : "free", content: renderStandalone(node, scope, stackPrefix) });
            return;
          }
          const wrappers = listFillWrappers(getFillWrapTargets(node, scopeId));
          items.push({ kind: "fill", node, wrappers: wrappers.filter((wrapper) => !groupWrappers.includes(wrapper)) });
          if (bucket) {
            items.push({
              kind: "barrier",
              content: <Fragment key={`mask_bucket_${scope}${node.id}`}>{bucket}</Fragment>,
            });
          }
        });

        const renderFill = (node: RenderNode) => {
          const { fill, outline } = renderGroupStack(node, stackPrefix, { skipFillWrappers: true });
          if (outline) outlines.push(<Fragment key={`stack_outline_${scope}${node.id}`}>{outline}</Fragment>);
          return <Fragment key={`stack_${scope}${node.id}`}>{fill}</Fragment>;
        };

        const hasWrapper = (item: SequenceItem, wrapper: FillWrapper) =>
          item.kind === "free" || (item.kind === "fill" && item.wrappers.includes(wrapper));

        const build = (list: SequenceItem[]): React.ReactNode[] => {
          const out: React.ReactNode[] = [];
          let i = 0;
          while (i < list.length) {
            const item = list[i];
            if (item.kind !== "fill") {
              out.push(item.content);
              i += 1;
              continue;
            }
            if (item.wrappers.length === 0) {
              out.push(renderFill(item.node));
              i += 1;
              continue;
            }
            let best = item.wrappers[0];
            let bestEnd = i + 1;
            for (const wrapper of item.wrappers) {
              let end = i + 1;
              while (end < list.length && hasWrapper(list[end], wrapper)) end += 1;
              if (end > bestEnd) {
                best = wrapper;
                bestEnd = end;
              }
            }
            while (list[bestEnd - 1].kind === "free") bestEnd -= 1;
            const inner = list.slice(i, bestEnd).map((entry): SequenceItem =>
              entry.kind === "fill" ? { ...entry, wrappers: entry.wrappers.filter((w) => w !== best) } : entry,
            );
            out.push(wrapWith(build(inner), best, `wrap_${scope}${best}_${item.node.id}`));
            i = bestEnd;
          }
          return out;
        };

        return build(items);
      };

      const rendered: React.ReactNode[] = [];
      let pendingNodes: RenderNode[] = [];
      const flushNodes = () => {
        rendered.push(...renderNodeSequence(pendingNodes, "", "node"));
        pendingNodes = [];
      };

      entries.forEach((entry) => {
        if (entry.type === "node") {
          pendingNodes.push(entry.node);
          return;
        }
        flushNodes();
        const maskId = entry.group.mask ? scopeId(`${entry.group.mask}_group_no_outline`) : undefined;
        const clipId = entry.group.clip ? scopeId(`${entry.group.clip}_clippath`) : undefined;
        const groupWrappers: FillWrapper[] = [
          ...(maskId ? [`mask:${maskId}` as const] : []),
          ...(clipId ? [`clip:${clipId}` as const] : []),
        ];
        rendered.push(
          <g
            id={`render_group_${entry.group.id}`}
            key={`render_group_${entry.key}`}
            opacity={entry.group.opacity}
            mask={maskId ? `url(#${maskId})` : undefined}
            clipPath={clipId ? `url(#${clipId})` : undefined}
            style={
              entry.group.blendMode && entry.group.blendMode !== "normal"
                ? { mixBlendMode: entry.group.blendMode as CSSProperties["mixBlendMode"] }
                : undefined
            }
          >
            {renderNodeSequence(entry.nodes, `${entry.key}_`, `render_${entry.key}`, groupWrappers)}
          </g>,
        );
      });
      flushNodes();

      return (
        <Fragment key="group_list_with_outlines">
          {outlines}
          {rendered}
        </Fragment>
      );
    })();

  const makeMaskGroups = (groupsMap: Map<string, MaskGroup>) => (
    <defs>
      {Array.from(groupsMap.values())
        .filter((cg) => usedMasks.fill.has(cg.id) || usedMasks.noOutline.has(cg.id))
        .map((cg) => (
          <SvgMask
            key={scopeId(`${cg.id}_group`)}
            id={scopeId(`${cg.id}_group`)}
            groupName={cg.id}
            groups={cg.groups}
            mode="fill_only"
            withFill={usedMasks.fill.has(cg.id)}
            withNoOutline={usedMasks.noOutline.has(cg.id)}
          />
        ))}
    </defs>
  );

  const makeClippingOutlineMasks = (groupsMap: Map<string, MaskGroup>) => {
    if (!groupsMap.size) return null;
    return (
      <defs>
        {Array.from(groupsMap.values())
          .filter((cg) => usedMasks.outline.has(cg.id))
          .map((cg) => (
            <SvgMask
              key={scopeId(`${cg.id}_group_outline`)}
              id={scopeId(`${cg.id}_group`)}
              groupName={cg.id}
              groups={cg.groups}
              mode="outline_only"
            />
          ))}
      </defs>
    );
  };

  const makeTrueClipOutlineMasks = (groupsMap: Map<string, TrueClipGroup>) => {
    if (!groupsMap.size) return null;
    return (
      <defs>
        {Array.from(groupsMap.values())
          .filter((cg) => usedMasks.trueClipOutline.has(cg.id))
          .map((cg) => (
            <SvgMask
              key={scopeId(`${cg.id}_trueclip`)}
              id={scopeId(`${cg.id}_trueclip`)}
              groupName={cg.id}
              groups={cg.groups.map((member) => member.node)}
              mode="outline_only"
            />
          ))}
      </defs>
    );
  };

  const makeTrueClipFillMasks = (groupsMap: Map<string, TrueClipGroup>) => {
    const names = new Set(sortedGroups.filter((g) => g.clipMaskContribution).flatMap((g) => g.clippedBy ?? []));
    const used = Array.from(groupsMap.values()).filter((cg) => names.has(cg.id));
    if (!used.length) return null;
    return (
      <defs>
        {used.map((cg) => (
          <SvgMask
            key={scopeId(`${cg.id}_trueclip_fill`)}
            id={scopeId(`${cg.id}_trueclip`)}
            groupName={cg.id}
            groups={cg.groups.map((member) => member.node)}
            mode="fill_only"
            ignoreOpacity
          />
        ))}
      </defs>
    );
  };

  return (
    <HoistedDefsProvider>
      <SpriteDefs body={body} />
      {makeMaskGroups(maskGroups)}
      {makeClippingOutlineMasks(maskGroups)}
      {makeTrueClipOutlineMasks(trueClipGroups)}
      {makeTrueClipFillMasks(trueClipGroups)}
      <TrueClipDefs trueClipGroups={trueClipGroups} scopeId={scopeId} />
      {renderGroupList(trueClipRenderNodes)}
    </HoistedDefsProvider>
  );
};

export default RigLayers;
