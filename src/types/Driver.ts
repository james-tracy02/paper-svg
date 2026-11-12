import type { Pose } from "./Pose";
import type { CustomSprite, Sprite } from "./Sprite";

/**
 * What a driver does to its node for the current pose. Each field combines with the node's own
 * value the way the builder's `…With` methods do: `rotate`, `x`, `y`, `skewX` and `skewY` add, `scaleX`
 * and `scaleY` multiply. `visible: false` hides the node and everything hanging from it, without
 * changing the layer plan, so it can come back on the next pose at no cost.
 *
 * `zIndex` and `outlineZIndex` add to the node's own (the outline one only on nodes with
 * `setOutlineZIndex`); children placed relative to the node move with it. A z change re-plans the
 * layers, so keep it to steps (a band per threshold), not a value that changes every frame.
 *
 * `path` and `customSprite` replace the sprite's shape, for shapes that follow the pose: the path a
 * `setPath` sprite draws, or a custom sprite in place of the one set with `setCustomSprite`. The
 * sprite's colors, stroke and transform stay. Return the same `customSprite` object while it is
 * unchanged, so the node only re-renders when the shape does. When several drivers set one, the
 * last wins.
 *
 * `mask` replaces the node's own mask (`setMask`) for this pose, for masks that follow a joint; `null`
 * removes it. Like `setMask`, it is in the node's space and `buildLeft` mirrors it. Return the same
 * object while the mask is unchanged: a new one redraws the node.
 */
export type DriverOutput = {
  rotate?: number;
  x?: number;
  y?: number;
  scaleX?: number;
  scaleY?: number;
  skewX?: number;
  skewY?: number;
  visible?: boolean;
  zIndex?: number;
  outlineZIndex?: number;
  path?: string;
  customSprite?: CustomSprite;
  mask?: Sprite | null;
};

/**
 * A node value computed from the pose while it is solved, so a pose change never rebuilds the tree.
 * `evaluate` reads whatever it needs from the pose and supplies its own defaults for anything the
 * pose leaves out. Set with `NodeBuilder.addDriver`.
 */
export type NodeDriver = {
  readonly evaluate: (pose: Pose) => DriverOutput;
  /** -1 on nodes built with `buildLeft`: the output's rotation, x and skew are mirrored like builder values. */
  readonly mirror: 1 | -1;
};
