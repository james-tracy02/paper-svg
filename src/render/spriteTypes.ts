import type { CSSProperties } from "react";

export type RenderMode =
  | "default"
  | "pattern"
  | "mask"
  | "outline_mask"
  | "outline"
  | "mask_no_outline"
  | "outer_outline";

export type SpriteStyle = CSSProperties;
