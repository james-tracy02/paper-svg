import type { Node, RenderGroupOptions, RigEffects } from "../../src";

/**
 * A character frozen as plain `Rig` input. Exported from project-k with `exportRigFixture()`
 * in the dev console (project-k/src/dev/rigFixture.ts), saved here as `<name>.rig.json`.
 */
export type RigFixture = {
  /**
   * 1: exported against paper-svg 0.1.x, with the old mask/clip field names. 2: flat `Node` fields,
   * before 0.3 grouped them. 3: current. See `upgradeFixture`.
   */
  version: 1 | 2 | 3;
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

/** Brings an exported fixture up to the current `Node` shape. */
export const upgradeFixture = (fixture: RigFixture): RigFixture => {
  let upgraded = fixture;
  if (upgraded.version === 1) {
    upgraded = { ...upgraded, version: 2, body: upgradeV1Node(upgraded.body as unknown as Record<string, unknown>) };
  }
  if (upgraded.version === 2) {
    upgraded = { ...upgraded, version: 3, body: upgradeV2Node(upgraded.body as unknown as Record<string, unknown>) };
  }
  return upgraded;
};
