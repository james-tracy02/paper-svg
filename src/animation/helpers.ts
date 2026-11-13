import type { Animation, PoseLayer } from "../types/Animation";

/** Maps progress from 0 to 1 onto 0 to 1. */
export type Easing = (t: number) => number;

export const linear: Easing = (t) => t;
export const easeIn: Easing = (t) => t * t;
export const easeOut: Easing = (t) => 1 - (1 - t) * (1 - t);
export const easeInOut: Easing = (t) => t * t * (3 - 2 * t);

const TAU = Math.PI * 2;

/** 0 to 1 and back once per `periodMs`, easing at both ends; 0 at `time` 0 with no phase. `phase` is in periods. */
export const wave = (time: number, periodMs: number, phase = 0) => 0.5 - 0.5 * Math.cos(TAU * (time / periodMs + phase));

/** -1 to 1 once per `periodMs`, a sine: 0 at `time` 0 with no phase, rising. `phase` is in periods. */
export const oscillate = (time: number, periodMs: number, phase = 0) => Math.sin(TAU * (time / periodMs + phase));

/**
 * Moves `current` toward `target` by `dt` ms of exponential easing: half the remaining distance every
 * `halfLifeMs`, at any frame rate. For following a target that moves (a cursor, a point to look at).
 */
export const damp = (current: number, target: number, halfLifeMs: number, dt: number) =>
  halfLifeMs <= 0 ? target : target + (current - target) * Math.pow(2, -dt / halfLifeMs);

export type Keyframe = {
  /** ms from the start of the track. */
  readonly at: number;
  readonly value: number;
  /** How the track moves into this keyframe from the one before. Default `easeInOut`. */
  readonly ease?: Easing;
};

/** A track sampled by time. Holds the first value before the first keyframe and the last after the last. */
export type Track = ((time: number) => number) & { readonly duration: number };

/** A track through `frames`, which can come in any order. */
export const keyframes = (frames: readonly Keyframe[]): Track => {
  if (!frames.length) throw new Error("keyframes: needs at least one keyframe");
  const sorted = [...frames].sort((a, b) => a.at - b.at);
  const sample = (time: number) => {
    if (time <= sorted[0].at) return sorted[0].value;
    for (let i = 1; i < sorted.length; i++) {
      const to = sorted[i];
      if (time < to.at) {
        const from = sorted[i - 1];
        const t = (time - from.at) / (to.at - from.at);
        return from.value + (to.value - from.value) * (to.ease ?? easeInOut)(t);
      }
    }
    return sorted[sorted.length - 1].value;
  };
  return Object.assign(sample, { duration: sorted[sorted.length - 1].at });
};

/**
 * An animation that plays `sample` for `durationMs` and is then done. `progress` goes from 0 to 1;
 * the last frame samples `durationMs` exactly, so a sample that ends at rest leaves the pose at rest.
 */
export const oneShot = (
  durationMs: number,
  sample: (time: number, progress: number) => PoseLayer | null,
): Animation => {
  let done = false;
  return {
    update(_dt, time) {
      const clamped = Math.min(time, durationMs);
      done = time >= durationMs;
      return sample(clamped, durationMs > 0 ? clamped / durationMs : 1);
    },
    get done() {
      return done;
    },
  };
};

/** An animation that plays `sample` until it is removed, for loops built from `wave`, `oscillate` or a track. */
export const continuous = (sample: (time: number) => PoseLayer | null): Animation => ({
  update: (_dt, time) => sample(time),
});
