import type { Vector2 } from "./primitives";
import type { CSSProperties } from "react";
import type { Sprite } from "./Sprite";
import type { Transform } from "./Transform";
import type { RenderGroup } from "./RenderGroup";

export type Node = Transform & {
  id: string;
  name: string;

  zIndex?: number;
  fixedRotation?: {
    enabled: boolean;
    max?: number;
  };
  fixedScale?: boolean;
  /**
   * Makes this node's joint and rotation (not its scale) the pattern space for its own sprite and
   * every descendant's: patterns there tile in one continuous grid at world scale, so separate
   * parts of one garment line up and all share the same tile size. `rotation` (degrees) turns the
   * space further, on top of the node's own rotation, then `offset` (world units, along the turned
   * axes) moves it. Neither is mirrored for left-side nodes. Inside an ancestor's pattern space the
   * grid continues the ancestor's, matching it at this node's offset origin (see RenderTree
   * `resolvePatternSpace`), so segments stay in phase at their joints at any pattern scale.
   */
  patternSpace?: { rotation: number; offset: Vector2 };
  /**
   * Shares one gradient across separate sprites. A "define" node's own gradient frame (its sprite's
   * gradient bounds, offset and scale, at its world position) becomes the gradient space for its
   * descendants; an "inherit" descendant then draws its gradient in that frame instead of its own
   * bounds, so the gradient runs on seamlessly from one sprite into the other.
   */
  gradientSpace?: "define" | "inherit";
  /**
   * Makes this node always rotate so that `from` — a point in this node's own local space —
   * lands as close as possible to `point` on the node with id `targetId` (the target's fully
   * resolved id, including any `_left`/`_right` suffix; `point` is in the target's own local
   * space). Since only rotation is free, closest means `from` sits on the ray from this
   * node's joint toward the target point. `from` defaults to (0, -1), i.e. straight down the
   * limb, which just points the node at the target. The node's own `rotate` stays as an
   * additive offset. Resolved from the previous layout pass, so a target inside this node's
   * own subtree will lag by a frame. With `stretch`, the node's y scale is also multiplied so
   * `from` lands exactly on the target (exact when `from` lies on the y axis), e.g. a line
   * spanning two points in separate hierarchies. With `arrive`, the sprite's path is replaced
   * by a quadratic curve from the joint to `from` that ends heading along `arrive.along` (a
   * direction in the target's local space), so the line meets whatever continues from there
   * without a corner. `arrive.bend` is how far back from the end the control point sits, as a
   * fraction of the line's length.
   */
  aimAt?: {
    targetId: string;
    point: Vector2;
    from?: Vector2;
    stretch?: boolean;
    arrive?: { along: Vector2; bend: number };
  };
  /**
   * Places this node's joint on `point` (default (0, 0)) in the local space of the node with id
   * `targetId`, whatever parent chain, scale or tuning either of them sits under. This node's
   * own `translate` stays as an additive offset in its parent's space. Combine with `aimAt` to
   * make a node in a separate hierarchy track another one completely: `pinTo` matches the
   * pivot, `aimAt` matches the angle. Resolved from the previous layout pass, so a target
   * inside this node's own subtree will lag by a frame.
   */
  pinTo?: {
    targetId: string;
    point?: Vector2;
  };
  fixedSize?: boolean;
  fixedSkew?: boolean;
  articulated?: boolean;
  outlineZIndex?: number;

  joints?: Node[];
  attachments?: Node[];

  maskedBy?: string[];
  outlineMaskedBy?: string[];
  maskGroups?: string[];
  maskGroupModes?: Record<string, "positive" | "negative">;
  maskOutsets?: Record<string, number>;
  parentMaskedBy?: string[];

  clippedBy?: string[];
  /** True-clip groups for this node's mask outline instead of `clippedBy`, so the fill and outline can be clipped differently. */
  outlineClippedBy?: string[];
  clippingGroups?: string[];
  clipOutsets?: Record<string, number>;
  /**
   * When true, this node's own `maskedBy` (mask groups) and `clippedBy` (clip groups)
   * values are automatically inherited by every descendant joint and attachment, in
   * addition to whatever they already have. Unlike `parentMaskedBy` (an explicit list you
   * supply yourself), this reuses the node's own values — set once here, no need to repeat
   * them on every child.
   */
  inheritMaskingForChildren?: boolean;
  /**
   * When true, this node ignores any `maskedBy`/`clippedBy` values that were being passed
   * down from an ancestor's `inheritMaskingForChildren` — this node (and, since the break
   * happens at the propagation source, its descendants) will not receive them. Does not
   * affect this node's own explicit `maskedBy`/`clippedBy` values, only inherited ones.
   */
  stopInheritedMasking?: boolean;
  /**
   * When true, this node's own `maskGroups` (mask groups it defines/belongs to) and
   * `clippingGroups` (true clip-path groups it defines/belongs to) — along with their
   * `maskGroupModes` — are automatically inherited by every descendant joint and
   * attachment, in addition to whatever groups they already declare. This makes every
   * descendant also contribute its own geometry to those same mask/clip groups, without
   * having to repeat `addMaskGroup`/`addClippingGroups` on each child.
   */
  inheritGroupsForChildren?: boolean;
  /**
   * When true, this node ignores any `maskGroups`/`clippingGroups`/`maskGroupModes`
   * values that were being passed down from an ancestor's `inheritGroupsForChildren` — this
   * node (and its descendants, since the break happens at the propagation source) will not
   * receive them. Does not affect this node's own explicit group declarations.
   */
  stopInheritedGroups?: boolean;
  opacity?: number;
  renderGroup?: RenderGroup;
  
  sprite: Sprite;
  noSprite?: boolean;
  mask?: Sprite;
  clip?: Sprite;
  pointerEvents?: boolean;
  /**
   * When set, pointer interaction (drag-to-rotate) on this node is forwarded to the node
   * with this id instead of this node's nearest articulated ancestor. Overrides the default
   * parent/child forwarding for cases where the node that should visually respond to the
   * drag isn't an ancestor in the render tree.
   */
  pointerEventsTarget?: string;
  renderGroupTag?: string;
  blendMode?: CSSProperties["mixBlendMode"];
  zIndexMode?: "relative" | "absolute";
  maskOutline?: boolean;
  disableOutlineHoisting?: boolean;
  clipMaskContribution?: boolean;
  debugColor?: string;
};
