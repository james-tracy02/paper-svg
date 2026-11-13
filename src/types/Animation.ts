import type { Vector2 } from "./primitives";

/**
 * What an animation adds to a pose for one frame. Fields use the same node ids and value names as
 * `Pose`. Rotations and translations add to the pose's, scales multiply it, and values combine by
 * each name's rule (see `ValueRules`). Like `Pose`, rotations are applied as given, so an animation
 * that turns both sides the same way on screen negates the left side's.
 */
export type PoseLayer = {
  readonly rotations?: Readonly<Record<string, number>>;
  readonly translations?: Readonly<Record<string, Readonly<Vector2>>>;
  readonly scales?: Readonly<Record<string, Readonly<Vector2>>>;
  readonly values?: Readonly<Record<string, number>>;
};

/**
 * Something that moves a pose over time. The animator calls `update` once per frame and layers what it
 * returns onto the pose. An animation can keep state between frames (a target it eases toward, when it
 * next blinks) and read input from whatever it closes over (a ref to the cursor), so one that follows
 * the user is written the same way as one that only plays.
 */
export type Animation = {
  /**
   * Advances by `dt` ms and returns this frame's layer, or null to add nothing. `time` is ms since
   * the animation was added; the first frame is at 0 with `dt` 0.
   */
  update(dt: number, time: number): PoseLayer | null;
  /** True once a one-shot animation has finished; the animator drops it after that frame. */
  readonly done?: boolean;
};

/**
 * How a layer's value meets the pose's: `add` (the default) adds to it, `min` and `max` keep the
 * smaller or larger, and `override` replaces it. A layer weighted below 1 goes only that part of
 * the way from the pose's value to the combined one.
 */
export type ValueCombine = "add" | "min" | "max" | "override";

/**
 * Each value name's rule. `rest` is the value taken when the pose leaves that name out (0 for `add`
 * when not given); without it, `min`, `max` and `override` take the layer's value at any weight.
 */
export type ValueRules = Readonly<Record<string, ValueCombine | { readonly combine: ValueCombine; readonly rest?: number }>>;

/** A layer and how much of it to apply: 1 in full, 0 not at all. */
export type WeightedLayer = { readonly layer: PoseLayer; readonly weight: number };
