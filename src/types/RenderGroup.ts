import type { CSSProperties } from "react";

export type RenderGroup = {
  id: string;
}

export type RenderGroupOptions = {
  blendMode?: CSSProperties["mixBlendMode"];
  opacity?: number;
  mask?: string;
  /** True-clip group (ClippingRegions) the whole group is clipped to; cheaper than `mask` for hard edges. */
  clip?: string;
}