import type { Node, RenderGroupOptions, RigEffects } from "../../src";

/**
 * A character frozen as plain `Rig` input. Exported from project-k with `exportRigFixture()`
 * in the dev console (project-k/src/dev/rigFixture.ts), saved here as `<name>.rig.json`.
 */
export type RigFixture = {
  version: 1;
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
