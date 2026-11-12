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
  /**
   * The node's own cut, in its own space (`setCut`): only what lies inside this shape draws. The engine draws it
   * as a clip-path when its edges are hard, else as a mask.
   */
  mask?: Sprite;
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
  /**
   * Draws the node over the outlines of regions, in its own outline colour, where it covers them (`traceOutline`):
   * true for the regions cutting the node, or the names of other regions (`traceOutlineOf`). The node's fill is
   * then cut by those regions' full shapes, outlines included.
   */
  trace?: true | string[];
  /**
   * Keeps nodes this node's regions cut inside this node's outline by cutting the outline's inner half out of
   * the regions, instead of lifting the outline above those nodes (hoisting, the default). Applies to every
   * region the node joins (`insetOutlines`).
   */
  inset?: boolean;
};

/** A node's shape joining a region (`NodeBuilder.addToRegion`). */
export type RegionJoin = {
  region: string;
  /** Removes the node's shape from the region instead of adding it. */
  subtract?: boolean;
  /** Grows the node's shape in the region by this much on every side (world units). */
  outset?: number;
  /** Insets the node's outline in this region instead of hoisting it (see `NodeOutline.inset`). */
  inset?: boolean;
};

/**
 * The regions a node joins and is cut by. A region is the shapes of its members, added or subtracted; a node
 * cut by a region draws only inside it, and inside its members' outlines (see `NodeOutline.inset`). Whether a
 * region draws as a clip-path or a mask is the engine's choice.
 */
export type NodeRegions = {
  /** Regions this node's shape joins. */
  joins?: RegionJoin[];
  /** Regions this node is cut by. */
  cuts?: string[];
  /** Adds this node to its regions only where its own cuts leave it. */
  onlyWhereCut?: boolean;
  /** Passes this node's joins down, so every descendant joins the same regions. */
  regionsForChildren?: boolean;
  /** Passes this node's cuts down, so every descendant is cut by the same regions. */
  cutsForChildren?: boolean;
  /** Ignores joins passed down from ancestors, for this node and its descendants. */
  stopInheritedRegions?: boolean;
  /** Ignores cuts passed down from ancestors, for this node and its descendants. */
  stopInheritedCuts?: boolean;
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

  regions?: NodeRegions;

  debugColor?: string;
};
