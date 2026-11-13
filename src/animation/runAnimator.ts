import type { Pose } from "../types/Pose";
import type { Animator } from "./animator";

/** Schedules frames; requestAnimationFrame by default. Swap it for a fake clock in tests. */
export type FrameScheduler = {
  request(callback: (now: number) => void): number;
  cancel(handle: number): void;
};

export type RunAnimatorOptions = {
  /** The pose the animations play on top of, read every frame (e.g. from a ref to the current pose). */
  base: () => Pose;
  /**
   * Shows a frame's pose, e.g. `rigRef.current?.setPose` or a `LivePoser`'s `write`. Return false when
   * it couldn't be shown without a React render; `onNeedsRender` then gets the pose.
   */
  write: (pose: Pose) => boolean | void;
  /** Renders a pose `write` couldn't show (e.g. by setting state that feeds the rig's `pose` prop). */
  onNeedsRender?: (pose: Pose) => void;
  frames?: FrameScheduler;
};

const animationFrames: FrameScheduler = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};

/**
 * Plays `animator` one frame at a time: each frame ticks it, applies it to `base()` and writes the
 * result. Frames run only while it holds an animation. When the last one ends, one more frame writes
 * `base()` alone, so the pose goes back to rest, and the loop sleeps until the next change. Returns a
 * function that stops it.
 */
export const runAnimator = (animator: Animator, { base, write, onNeedsRender, frames = animationFrames }: RunAnimatorOptions) => {
  let handle: number | undefined;

  const frame = (now: number) => {
    handle = undefined;
    animator.tick(now);
    const pose = animator.apply(base());
    if (write(pose) === false) onNeedsRender?.(pose);
    if (!animator.idle) schedule();
  };

  const schedule = () => {
    if (handle === undefined) handle = frames.request(frame);
  };

  // Any change gets a frame, even one that leaves nothing playing: that frame writes the rest pose.
  const unsubscribe = animator.subscribe(schedule);
  if (!animator.idle) schedule();

  return () => {
    unsubscribe();
    if (handle !== undefined) frames.cancel(handle);
    handle = undefined;
  };
};
