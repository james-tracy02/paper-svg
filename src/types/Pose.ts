import type { Vector2 } from "./primitives";

/**
 * What moves between frames, kept apart from the tree's structure. Solving a pose never rebuilds
 * the tree, so an animation is just a pose per frame.
 */
export type Pose = {
  /**
   * Degrees by node id, added to that node's own rotation. Like `translations` and `scales`, a value
   * moves only the node it names (and what hangs from it), and is applied as given, after `buildLeft`'s
   * mirroring rather than mirrored by it.
   */
  readonly rotations?: Readonly<Record<string, number>>;
  /** Offsets by node id, added to that node's position in its parent's space. */
  readonly translations?: Readonly<Record<string, Readonly<Vector2>>>;
  /** Factors by node id, multiplying that node's scale; joint children's positions scale with it. */
  readonly scales?: Readonly<Record<string, Readonly<Vector2>>>;
  /**
   * Named numbers such as how open an eye is or how far the face tilts. They change nothing on their
   * own; drivers (`NodeBuilder.addDriver`) read them and decide what they move.
   */
  readonly values?: Readonly<Record<string, number>>;
};
