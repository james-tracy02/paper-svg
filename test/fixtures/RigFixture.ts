import type { Node, RenderGroupOptions, RigEffects } from "../../src";

/**
 * A character frozen as plain `Rig` input. Exported from project-k with `exportRigFixture()`
 * in the dev console (project-k/src/dev/rigFixture.ts), saved here as `<name>.rig.json`.
 */
export type RigFixture = {
  /**
   * 1: exported against paper-svg 0.1.x, with the old mask/clip field names. 2: flat `Node` fields,
   * before 0.3 grouped them. 3: mask and clip groups, before 0.4 made them regions. 4: current. See `upgradeFixture`.
   */
  version: 1 | 2 | 3 | 4;
  name: string;
  body: Node;
  scale: number;
  mirror: boolean;
  /** `getRenderGroupOptions` results for every render group in `body`. */
  renderGroupOptions: Record<string, RenderGroupOptions>;
  effects: Omit<RigEffects, "isHidden">;
  /** Nodes with one of these `renderGroupTag`s are hidden. */
  hiddenRenderGroupTags: string[];
};

/** Version 1 `Node` field names and their current names. Old and new names overlap, so map in one pass. */
const V1_NODE_FIELDS: Record<string, string> = {
  clippingGroups: "maskGroups",
  clippedBy: "maskedBy",
  outlineClippedBy: "outlineMaskedBy",
  trueClippingGroups: "clippingGroups",
  trueClippedBy: "clippedBy",
  outlineTrueClippedBy: "outlineClippedBy",
  trueClipOutsets: "clipOutsets",
};

const upgradeV1Node = (node: Record<string, unknown>): Node => {
  const upgraded: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) upgraded[V1_NODE_FIELDS[key] ?? key] = value;
  const children = (list: unknown) => (list as Record<string, unknown>[] | undefined)?.map(upgradeV1Node);
  if (node.joints) upgraded.joints = children(node.joints);
  if (node.attachments) upgraded.attachments = children(node.attachments);
  return upgraded as Node;
};

/** Version 2 (flat) `Node` fields by the group and name they have now. */
const V2_GROUPS: Record<string, [group: string, name: string]> = {
  translate: ["transform", "translate"],
  scale: ["transform", "scale"],
  rotate: ["transform", "rotate"],
  skew: ["transform", "skew"],
  matrix: ["transform", "matrix"],
  fixedRotation: ["follow", "fixedRotation"],
  fixedScale: ["follow", "fixedScale"],
  aimAt: ["follow", "aimAt"],
  pinTo: ["follow", "pinTo"],
  noSprite: ["paint", "noSprite"],
  mask: ["paint", "mask"],
  clip: ["paint", "clip"],
  opacity: ["paint", "opacity"],
  blendMode: ["paint", "blendMode"],
  patternSpace: ["paint", "patternSpace"],
  gradientSpace: ["paint", "gradientSpace"],
  renderGroup: ["paint", "renderGroup"],
  renderGroupTag: ["paint", "renderGroupTag"],
  outlineZIndex: ["outline", "zIndex"],
  maskOutline: ["outline", "masked"],
  disableOutlineHoisting: ["outline", "disableHoisting"],
  articulated: ["interaction", "articulated"],
  pointerEvents: ["interaction", "pointerEvents"],
  pointerEventsTarget: ["interaction", "target"],
};
/** Version 2 fields nothing reads any more. */
const V2_DROPPED = new Set(["fixedSize", "fixedSkew"]);

const upgradeV2Node = (node: Record<string, unknown>): Node => {
  const upgraded: Record<string, Record<string, unknown> | unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (V2_DROPPED.has(key) || value === undefined) continue;
    const grouped = V2_GROUPS[key];
    if (!grouped) {
      upgraded[key] = value;
      continue;
    }
    const [group, name] = grouped;
    ((upgraded[group] ??= {}) as Record<string, unknown>)[name] = value;
  }
  const children = (list: unknown) => (list as Record<string, unknown>[] | undefined)?.map(upgradeV2Node);
  if (node.joints) upgraded.joints = children(node.joints);
  if (node.attachments) upgraded.attachments = children(node.attachments);
  return upgraded as Node;
};

type V3Node = Record<string, unknown> & {
  paint?: Record<string, unknown>;
  outline?: Record<string, unknown>;
  maskedBy?: string[];
  clippedBy?: string[];
  outlineMaskedBy?: string[];
  outlineClippedBy?: string[];
  maskGroups?: string[];
  maskGroupModes?: Record<string, "positive" | "negative">;
  maskOutsets?: Record<string, number>;
  clippingGroups?: string[];
  clipOutsets?: Record<string, number>;
  inheritMaskingForChildren?: boolean;
  stopInheritedMasking?: boolean;
  inheritGroupsForChildren?: boolean;
  stopInheritedGroups?: boolean;
  clipMaskContribution?: boolean;
  joints?: V3Node[];
  attachments?: V3Node[];
};

/** `group` without its undefined fields, or undefined when none is left. */
const definedOnly = <T extends Record<string, unknown>>(group: T): T | undefined => {
  const entries = Object.entries(group).filter(([, value]) => value !== undefined);
  return entries.length ? (Object.fromEntries(entries) as T) : undefined;
};

/**
 * Version 3 masking fields as regions, keeping what they drew: mask groups inset their members' outlines, clip
 * groups hoist them unless the node disabled hoisting (`insetOutlines`), and a mask outline traces the node's cuts
 * or the regions it named.
 */
const upgradeV3Node = (node: V3Node): Node => {
  const {
    maskedBy, clippedBy, outlineMaskedBy, outlineClippedBy, maskGroups, maskGroupModes, maskOutsets, clippingGroups,
    clipOutsets, inheritMaskingForChildren, stopInheritedMasking, inheritGroupsForChildren, stopInheritedGroups,
    clipMaskContribution, joints, attachments, paint, outline, ...rest
  } = node;
  const joins = [
    ...(maskGroups ?? []).map((region) =>
      definedOnly({
        region,
        subtract: maskGroupModes?.[region] === "negative" || undefined,
        outset: maskOutsets?.[region] || undefined,
        inset: true,
      })!,
    ),
    ...(clippingGroups ?? []).map((region) => definedOnly({ region, outset: clipOutsets?.[region] || undefined })!),
  ];
  const cuts = [...(maskedBy ?? []), ...(clippedBy ?? [])];
  const traced = [...(outlineMaskedBy ?? []), ...(outlineClippedBy ?? [])];
  const { masked, disableHoisting, ...outlineRest } = outline ?? {};
  const { clip: _paintClip, ...paintRest } = paint ?? {};
  return {
    ...rest,
    ...(paint ? { paint: paintRest } : {}),
    outline: definedOnly({
      ...outlineRest,
      trace: masked ? (traced.length ? traced : true) : undefined,
      inset: disableHoisting || undefined,
    }),
    regions: definedOnly({
      joins: joins.length ? joins : undefined,
      cuts: cuts.length ? cuts : undefined,
      onlyWhereCut: clipMaskContribution || undefined,
      regionsForChildren: inheritGroupsForChildren || undefined,
      cutsForChildren: inheritMaskingForChildren || undefined,
      stopInheritedRegions: stopInheritedGroups || undefined,
      stopInheritedCuts: stopInheritedMasking || undefined,
    }),
    joints: joints?.map(upgradeV3Node),
    attachments: attachments?.map(upgradeV3Node),
  } as unknown as Node;
};

/** Brings an exported fixture up to the current `Node` shape. */
export const upgradeFixture = (fixture: RigFixture): RigFixture => {
  let upgraded = fixture;
  if (upgraded.version === 1) {
    upgraded = { ...upgraded, version: 2, body: upgradeV1Node(upgraded.body as unknown as Record<string, unknown>) };
  }
  if (upgraded.version === 2) {
    upgraded = { ...upgraded, version: 3, body: upgradeV2Node(upgraded.body as unknown as Record<string, unknown>) };
  }
  if (upgraded.version === 3) {
    upgraded = { ...upgraded, version: 4, body: upgradeV3Node(upgraded.body as unknown as V3Node) };
  }
  return upgraded;
};
