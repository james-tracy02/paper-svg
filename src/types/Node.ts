import type { Vector2 } from "./primitives";
import type { CSSProperties } from "react";
import type { Sprite } from "./Sprite";
import type { Transform } from "./Transform";
import type { RenderGroup } from "./RenderGroup";
import type { NodeDriver } from "./Driver";

/** How a node follows its parent and other nodes, beyond hanging from its joint. */
export type NodeFollow = {
  /** Keeps the node's world rotation instead of turning with its parent (up to `max` degrees when set). */
  fixedRotation?: { enabled: boolean; max?: number };
  /** Keeps the node's world scale instead of scaling with its parent. */
  fixedScale?: boolean;
  /**
   * Makes this node always rotate so that `from` — a point in this node's own local space —
   * lands as close as possible to `point` on the node with id `targetId` (the target's fully
   * resolved id, including any `_left`/`_right` suffix; `point` is in the target's own local
   * space). Since only rotation is free, closest means `from` sits on the ray from this
   * node's joint toward the target point. `from` defaults to (0, -1), i.e. straight down the
   * limb, which just points the node at the target. The node's own rotation stays as an
   * additive offset. The target is solved first, so it is seen where it ends up; a target inside
   * this node's own subtree is read from a solve without constraints. With `stretch`, the node's y
   * scale is also multiplied so `from` lands exactly on the target (exact when `from` lies on the
   * y axis), e.g. a line spanning two points in separate hierarchies. With `arrive`, the sprite's
   * path is replaced by a quadratic curve from the joint to `from` that ends heading along
   * `arrive.along` (a direction in the target's local space), so the line meets whatever
   * continues from there without a corner. `arrive.bend` is how far back from the end the control
   * point sits, as a fraction of the line's length.
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
   * own position stays as an additive offset in its parent's space. Combine with `aimAt` to
   * make a node in a separate hierarchy track another one completely: `pinTo` matches the
   * pivot, `aimAt` matches the angle.
   */
  pinTo?: { targetId: string; point?: Vector2 };
};

/** How a node's sprite is painted and composited. */
export type NodePaint = {
  /** Draws nothing for this node; its children still draw. */
  noSprite?: boolean;
  /** A soft mask in the node's own space. */
  mask?: Sprite;
  /** A hard clip in the node's own space. */
  clip?: Sprite;
  /** Multiplies this node's and its descendants' opacity. */
  opacity?: number;
  blendMode?: CSSProperties["mixBlendMode"];
  /**
   * Makes this node's joint and rotation (not its scale) the pattern space for its own sprite and
   * every descendant's: patterns there tile in one continuous grid at world scale, so separate
   * parts of one garment line up and all share the same tile size. `rotation` (degrees) turns the
   * space further, on top of the node's own rotation, then `offset` (world units, along the turned
   * axes) moves it. Neither is mirrored for left-side nodes. Inside an ancestor's pattern space the
   * grid continues the ancestor's, matching it at this node's offset origin (see
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
  /** Composites this node with the others in the same group as one layer. */
  renderGroup?: RenderGroup;
  /** A label the app can read off render nodes (e.g. to hide a set of them). */
  renderGroupTag?: string;
};

/** A node's outline: its sprite's stroke, when drawn apart from its fill. */
export type NodeOutline = {
  /** Draws the outline as its own layer at this z-index, instead of with the fill. */
  zIndex?: number;
  /** Cuts the outline by the node's mask groups (or `outlineMaskedBy`) as its own layer. */
  masked?: boolean;
  /** Keeps the outline from being drawn over the nodes clipped to this one. */
  disableHoisting?: boolean;
};

/** How a node responds to the pointer. */
export type NodeInteraction = {
  /** Whether pressing this node rotates it. Defaults to true for joints, false for attachments. */
  articulated?: boolean;
  /** Forces pointer events on or off. */
  pointerEvents?: boolean;
  /**
   * When set, pointer interaction (drag-to-rotate) on this node is forwarded to the node
   * with this id instead of this node's nearest articulated ancestor. Overrides the default
   * parent/child forwarding for cases where the node that should visually respond to the
   * drag isn't an ancestor in the render tree.
   */
  target?: string;
};

export type Node = {
  id: string;
  name: string;

  /** The node's rest transform in its parent's space: position of its joint, rotation, scale and skew. */
  transform: Transform;
  follow?: NodeFollow;
  /** Values computed from the pose while a pose is solved (see `NodeBuilder.addDriver`). */
  drivers?: NodeDriver[];

  joints?: Node[];
  attachments?: Node[];

  /** Draw order: added to the parent's (relative, the default) or used as is (absolute). */
  zIndex?: number;
  zIndexMode?: "relative" | "absolute";

  sprite: Sprite;
  paint?: NodePaint;
  outline?: NodeOutline;
  interaction?: NodeInteraction;

  // Masking stays flat until regions replace it (Phase 2).
  maskedBy?: string[];
  outlineMaskedBy?: string[];
  maskGroups?: string[];
  maskGroupModes?: Record<string, "positive" | "negative">;
  maskOutsets?: Record<string, number>;
  parentMaskedBy?: string[];

  clippedBy?: string[];
  /** Clip groups for this node's mask outline instead of `clippedBy`, so the fill and outline can be clipped differently. */
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
   * `clippingGroups` (clip groups it defines/belongs to) — along with their
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
  clipMaskContribution?: boolean;

  debugColor?: string;
};
