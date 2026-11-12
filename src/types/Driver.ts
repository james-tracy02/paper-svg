import type { Pose } from "./Pose";

/**
 * What a driver does to its node for the current pose. Each field combines with the node's own
 * value the way the builder's `…With` methods do: `rotate`, `x`, `y`, `skewX` and `skewY` add, `scaleX`
 * and `scaleY` multiply. `visible: false` hides the node and everything hanging from it, without
 * changing the layer plan, so it can come back on the next pose at no cost.
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
