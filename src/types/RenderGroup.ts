import type { CSSProperties } from "react";

export type RenderGroup = {
  id: string;
  /**
   * The render group this one sits in: it paints as one block inside its parent's block, at its last member's place
   * among the parent's other members, and inside the parent's opacity, blend mode and cuts.
   */
  parent?: RenderGroup;
}

/** `group` and its ancestors, outermost first. */
export const renderGroupPath = (group: RenderGroup | undefined): RenderGroup[] => {
  const path: RenderGroup[] = [];
  for (let g = group; g; g = g.parent) path.unshift(g);
  return path;
};

export type RenderGroupOptions = {
  blendMode?: CSSProperties["mixBlendMode"];
  opacity?: number;
  mask?: string;
  /** Clip group the whole group is clipped to; cheaper than `mask` for hard edges. */
  clip?: string;
}
