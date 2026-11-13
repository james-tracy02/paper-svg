import type { Animation, PoseLayer, ValueRules, WeightedLayer } from "../types/Animation";
import type { Pose } from "../types/Pose";
import { easeInOut } from "./helpers";
import { layerPose } from "./layerPose";

export type AnimatorOptions = {
  /** How each pose value combines across layers (see `ValueRules`). */
  values?: ValueRules;
  /**
   * The longest step one frame advances, in ms, so a frame after a stall (a background tab, a
   * breakpoint) doesn't jump. Default 100.
   */
  maxDt?: number;
};

export type FadeOptions = {
  /** How long the weight takes to get there, in ms, eased in and out. 0 (the default) is at once. */
  fadeMs?: number;
};

export type AddOptions = FadeOptions & {
  /** The weight to fade to. Default 1. */
  weight?: number;
};

/**
 * Plays animations onto a pose. It holds no clock and touches no DOM: `tick` advances it to a time,
 * and `apply` layers what it holds onto a pose. `runAnimator` (or `useAnimator`) drives it per frame.
 */
export type Animator = {
  /**
   * Starts `animation` under `id`, last in the layer order. An animation already under `id` is
   * replaced, and the new one fades from the weight the old one had, so restarting doesn't jump.
   */
  add(id: string, animation: Animation, options?: AddOptions): void;
  /** Fades the animation under `id` out and drops it. */
  remove(id: string, options?: FadeOptions): void;
  /** Fades the animation under `id` to `weight`. */
  setWeight(id: string, weight: number, options?: FadeOptions): void;
  /** Whether an animation is under `id` and not fading out to be dropped. */
  has(id: string): boolean;
  /** Drops every animation at once. */
  clear(): void;
  /** Advances every animation to `now` (ms, e.g. a requestAnimationFrame timestamp). */
  tick(now: number): void;
  /** `base` with the current frame's layers applied; `base` itself while nothing adds anything. */
  apply(base: Pose): Pose;
  /** True while no animation is held: nothing moves until one is added. */
  readonly idle: boolean;
  /** Calls `listener` whenever an animation is added, removed or reweighted. Returns an unsubscribe. */
  subscribe(listener: () => void): () => void;
};

type Entry = {
  animation: Animation;
  /** ms since added; undefined until the first tick, which plays it at 0. */
  time: number | undefined;
  layer: PoseLayer | null;
  from: number;
  to: number;
  fadeMs: number;
  fadeElapsed: number;
  /** Dropped once the weight reaches 0. */
  removing: boolean;
  /** Done or faded out: its last frame shows, and the next tick drops it. */
  finished: boolean;
};

const weightOf = (entry: Entry) =>
  entry.fadeMs <= 0 || entry.fadeElapsed >= entry.fadeMs
    ? entry.to
    : entry.from + (entry.to - entry.from) * easeInOut(entry.fadeElapsed / entry.fadeMs);

export const createAnimator = ({ values = {}, maxDt = 100 }: AnimatorOptions = {}): Animator => {
  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  let last: number | undefined;

  const notify = () => listeners.forEach((listener) => listener());

  const fadeTo = (entry: Entry, weight: number, fadeMs = 0) => {
    entry.from = weightOf(entry);
    entry.to = weight;
    entry.fadeMs = fadeMs;
    entry.fadeElapsed = 0;
  };

  return {
    add(id, animation, { weight = 1, fadeMs = 0 } = {}) {
      const previous = entries.get(id);
      const from = previous ? weightOf(previous) : fadeMs > 0 ? 0 : weight;
      // Re-inserted, so it goes last in the layer order.
      entries.delete(id);
      entries.set(id, { animation, time: undefined, layer: null, from, to: weight, fadeMs, fadeElapsed: 0, removing: false, finished: false });
      notify();
    },
    remove(id, { fadeMs = 0 } = {}) {
      const entry = entries.get(id);
      if (!entry) return;
      if (fadeMs <= 0) entries.delete(id);
      else {
        fadeTo(entry, 0, fadeMs);
        entry.removing = true;
      }
      notify();
    },
    setWeight(id, weight, { fadeMs = 0 } = {}) {
      const entry = entries.get(id);
      if (!entry) return;
      fadeTo(entry, weight, fadeMs);
      entry.removing = false;
      notify();
    },
    has: (id) => {
      const entry = entries.get(id);
      return entry !== undefined && !entry.removing;
    },
    clear() {
      if (!entries.size) return;
      entries.clear();
      notify();
    },
    tick(now) {
      const dt = last === undefined ? 0 : Math.min(Math.max(now - last, 0), maxDt);
      for (const [id, entry] of entries) {
        if (entry.finished) {
          entries.delete(id);
          continue;
        }
        const step = entry.time === undefined ? 0 : dt;
        entry.time = (entry.time ?? 0) + step;
        entry.fadeElapsed += step;
        entry.layer = entry.animation.update(step, entry.time);
        entry.finished = Boolean(entry.animation.done) || (entry.removing && weightOf(entry) <= 0);
      }
      // Idle until the next add: that frame starts fresh rather than counting the time in between.
      last = entries.size ? now : undefined;
    },
    apply(base) {
      if (!entries.size) return base;
      const layers: WeightedLayer[] = [];
      for (const entry of entries.values()) {
        if (entry.layer) layers.push({ layer: entry.layer, weight: weightOf(entry) });
      }
      return layerPose(base, layers, values);
    },
    get idle() {
      return entries.size === 0;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};
