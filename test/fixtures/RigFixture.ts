import type { Node, RenderGroupOptions, RigEffects } from "../../src";

/**
 * A character frozen as plain `Rig` input. Exported from project-k with `exportRigFixture()`
 * in the dev console (project-k/src/dev/rigFixture.ts), saved here as `<name>.rig.json`.
 */
export type RigFixture = {
  /** 1: exported against paper-svg 0.1.x, with the old mask/clip field names (see `upgradeFixture`). */
  version: 1 | 2;
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

/** Brings an exported fixture up to the current `Node` field names. */
export const upgradeFixture = (fixture: RigFixture): RigFixture =>
  fixture.version === 1
    ? { ...fixture, version: 2, body: upgradeV1Node(fixture.body as unknown as Record<string, unknown>) }
    : fixture;
