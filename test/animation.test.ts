import { describe, expect, it } from "vitest";
import {
  continuous,
  createAnimator,
  damp,
  easeInOut,
  keyframes,
  layerPose,
  linear,
  oneShot,
  oscillate,
  runAnimator,
  wave,
  type Animation,
  type FrameScheduler,
  type Pose,
  type PoseLayer,
} from "../src";

/** An animation that returns the same layer every frame. */
const constant = (layer: PoseLayer): Animation => ({ update: () => layer });

/** A frame scheduler driven by hand: `step(ms)` runs the pending frame `ms` after the last one. */
const fakeFrames = () => {
  let pending: ((now: number) => void) | undefined;
  let now = 0;
  const frames: FrameScheduler = {
    request(callback) {
      pending = callback;
      return 1;
    },
    cancel() {
      pending = undefined;
    },
  };
  return {
    frames,
    get scheduled() {
      return pending !== undefined;
    },
    step(ms = 16) {
      now += ms;
      const run = pending;
      pending = undefined;
      run?.(now);
    },
  };
};

describe("layerPose", () => {
  const base: Pose = {
    rotations: { arm: 10 },
    translations: { head: { x: 1, y: 2 } },
    scales: { torso: { x: 2, y: 2 } },
    values: { open: 1 },
  };

  it("returns the base itself when no layer has weight", () => {
    expect(layerPose(base, [])).toBe(base);
    expect(layerPose(base, [{ layer: { rotations: { arm: 5 } }, weight: 0 }])).toBe(base);
  });

  it("adds rotations and translations by weight", () => {
    const posed = layerPose(base, [
      { layer: { rotations: { arm: 4, leg: 2 }, translations: { head: { x: 2, y: -4 } } }, weight: 0.5 },
    ]);
    expect(posed.rotations).toEqual({ arm: 12, leg: 1 });
    expect(posed.translations).toEqual({ head: { x: 2, y: 0 } });
  });

  it("multiplies scales, eased toward 1 by weight", () => {
    const posed = layerPose(base, [{ layer: { scales: { torso: { x: 1, y: 1.2 }, neck: { x: 3, y: 1 } } }, weight: 0.5 }]);
    expect(posed.scales?.torso.x).toBeCloseTo(2);
    expect(posed.scales?.torso.y).toBeCloseTo(2.2);
    expect(posed.scales?.neck).toEqual({ x: 2, y: 1 });
  });

  it("stacks layers in order", () => {
    const posed = layerPose({}, [
      { layer: { rotations: { arm: 5 } }, weight: 1 },
      { layer: { rotations: { arm: -2 } }, weight: 1 },
    ]);
    expect(posed.rotations).toEqual({ arm: 3 });
  });

  it("leaves the base untouched", () => {
    const before = structuredClone(base);
    layerPose(base, [{ layer: { rotations: { arm: 4 }, values: { open: -1 } }, weight: 1 }]);
    expect(base).toEqual(before);
  });

  it("combines values by rule", () => {
    const pose: Pose = { values: { open: 0.8, look: 0.2, tilt: 1 } };
    const layer = { values: { open: 0.2, look: 0.6, tilt: 2 } };
    const rules = { open: "min", look: "override" } as const;
    expect(layerPose(pose, [{ layer, weight: 1 }], rules).values).toEqual({ open: 0.2, look: 0.6, tilt: 3 });
    const half = layerPose(pose, [{ layer, weight: 0.5 }], rules).values!;
    expect(half.open).toBeCloseTo(0.5);
    expect(half.look).toBeCloseTo(0.4);
    expect(half.tilt).toBeCloseTo(2);
    // max keeps the larger: the pose's here.
    expect(layerPose(pose, [{ layer: { values: { open: 0.5 } }, weight: 1 }], { open: "max" }).values?.open).toBe(0.8);
  });

  it("an override later in the list wins", () => {
    const posed = layerPose(
      {},
      [
        { layer: { values: { look: 1 } }, weight: 1 },
        { layer: { values: { look: -1 } }, weight: 1 },
      ],
      { look: "override" },
    );
    expect(posed.values?.look).toBe(-1);
  });

  it("blends from a rule's rest when the pose leaves the value out", () => {
    const layers = [{ layer: { values: { open: 0 } }, weight: 0.5 }];
    expect(layerPose({}, layers, { open: { combine: "min", rest: 1 } }).values?.open).toBeCloseTo(0.5);
    // No rest to blend from: the layer's own value at any weight.
    expect(layerPose({}, layers, { open: "min" }).values?.open).toBe(0);
    expect(layerPose({}, [{ layer: { values: { tilt: 2 } }, weight: 0.5 }], { tilt: { combine: "add", rest: 1 } }).values?.tilt).toBe(2);
  });
});

describe("createAnimator", () => {
  it("plays an animation's first frame at time 0 with dt 0", () => {
    const calls: [number, number][] = [];
    const animator = createAnimator();
    animator.add("a", { update: (dt, time) => (calls.push([dt, time]), null) });
    animator.tick(1000);
    animator.tick(1016);
    expect(calls).toEqual([
      [0, 0],
      [16, 16],
    ]);
  });

  it("starts a later animation at 0 too", () => {
    const times: number[] = [];
    const animator = createAnimator();
    animator.add("a", constant({}));
    animator.tick(0);
    animator.tick(16);
    animator.add("b", { update: (_dt, time) => (times.push(time), null) });
    animator.tick(32);
    animator.tick(48);
    expect(times).toEqual([0, 16]);
  });

  it("caps a frame's step at maxDt", () => {
    const steps: number[] = [];
    const animator = createAnimator({ maxDt: 50 });
    animator.add("a", { update: (dt) => (steps.push(dt), null) });
    animator.tick(0);
    animator.tick(5000);
    expect(steps).toEqual([0, 50]);
  });

  it("returns the base itself while idle", () => {
    const animator = createAnimator();
    const base: Pose = { rotations: { arm: 1 } };
    expect(animator.idle).toBe(true);
    expect(animator.apply(base)).toBe(base);
  });

  it("fades in and out, eased, then drops the animation", () => {
    const animator = createAnimator();
    animator.add("a", constant({ rotations: { arm: 10 } }), { fadeMs: 100 });
    const arm = () => animator.apply({}).rotations?.arm ?? 0;
    animator.tick(0);
    expect(arm()).toBe(0);
    animator.tick(50);
    expect(arm()).toBeCloseTo(10 * easeInOut(0.5));
    animator.tick(100);
    expect(arm()).toBe(10);

    animator.remove("a", { fadeMs: 100 });
    expect(animator.has("a")).toBe(false);
    expect(animator.idle).toBe(false);
    animator.tick(150);
    expect(arm()).toBeCloseTo(5);
    animator.tick(200);
    expect(arm()).toBe(0);
    animator.tick(216);
    expect(animator.idle).toBe(true);
  });

  it("replacing an animation fades from the old one's weight", () => {
    const animator = createAnimator();
    animator.add("a", constant({ rotations: { arm: 10 } }));
    animator.tick(0);
    animator.remove("a", { fadeMs: 100 });
    animator.tick(50);
    animator.add("a", constant({ rotations: { arm: 10 } }), { fadeMs: 100 });
    animator.tick(66);
    // Still at the half weight the fade-out had reached.
    expect(animator.apply({}).rotations?.arm).toBeCloseTo(5);
    expect(animator.has("a")).toBe(true);
  });

  it("reweights with setWeight", () => {
    const animator = createAnimator();
    animator.add("a", constant({ rotations: { arm: 10 } }));
    animator.setWeight("a", 0.25);
    animator.tick(0);
    expect(animator.apply({}).rotations?.arm).toBeCloseTo(2.5);
  });

  it("layers in the order added, a replaced animation going last", () => {
    const animator = createAnimator({ values: { look: "override" } });
    animator.add("a", constant({ values: { look: 1 } }));
    animator.add("b", constant({ values: { look: 2 } }));
    animator.tick(0);
    expect(animator.apply({}).values?.look).toBe(2);
    animator.add("a", constant({ values: { look: 1 } }));
    animator.tick(16);
    expect(animator.apply({}).values?.look).toBe(1);
  });

  it("shows a one-shot's last frame, then drops it", () => {
    const animator = createAnimator();
    animator.add("shot", oneShot(100, (_time, progress) => ({ rotations: { arm: progress * 10 } })));
    animator.tick(0);
    animator.tick(60);
    expect(animator.apply({}).rotations?.arm).toBeCloseTo(6);
    animator.tick(160);
    expect(animator.apply({}).rotations?.arm).toBe(10);
    expect(animator.idle).toBe(false);
    animator.tick(176);
    expect(animator.idle).toBe(true);
  });

  it("notifies subscribers of changes", () => {
    const animator = createAnimator();
    let changes = 0;
    const unsubscribe = animator.subscribe(() => changes++);
    animator.add("a", constant({}));
    animator.setWeight("a", 0.5);
    animator.remove("a");
    animator.remove("missing");
    unsubscribe();
    animator.add("b", constant({}));
    expect(changes).toBe(3);
  });
});

describe("runAnimator", () => {
  it("writes a frame per tick while playing, then the base once, then sleeps", () => {
    const clock = fakeFrames();
    const animator = createAnimator();
    const base: Pose = { rotations: { arm: 1 } };
    const written: Pose[] = [];
    const stop = runAnimator(animator, { base: () => base, write: (pose) => void written.push(pose), frames: clock.frames });
    expect(clock.scheduled).toBe(false);

    animator.add("a", constant({ rotations: { arm: 2 } }));
    clock.step();
    clock.step();
    expect(written.map((pose) => pose.rotations?.arm)).toEqual([3, 3]);

    animator.remove("a");
    clock.step();
    expect(written.at(-1)).toBe(base);
    expect(clock.scheduled).toBe(false);
    stop();
  });

  it("hands a pose write couldn't show to onNeedsRender", () => {
    const clock = fakeFrames();
    const animator = createAnimator();
    const rendered: Pose[] = [];
    runAnimator(animator, {
      base: () => ({}),
      write: () => false,
      onNeedsRender: (pose) => rendered.push(pose),
      frames: clock.frames,
    });
    animator.add("a", constant({ rotations: { arm: 2 } }));
    clock.step();
    expect(rendered).toEqual([{ rotations: { arm: 2 } }]);
  });

  it("stops on request", () => {
    const clock = fakeFrames();
    const animator = createAnimator();
    let writes = 0;
    const stop = runAnimator(animator, { base: () => ({}), write: () => void writes++, frames: clock.frames });
    animator.add("a", continuous(() => ({ rotations: { arm: 1 } })));
    clock.step();
    stop();
    clock.step();
    animator.add("b", constant({}));
    clock.step();
    expect(writes).toBe(1);
    expect(clock.scheduled).toBe(false);
  });
});

describe("helpers", () => {
  it("wave starts at 0 and peaks halfway through its period", () => {
    expect(wave(0, 1000)).toBeCloseTo(0);
    expect(wave(500, 1000)).toBeCloseTo(1);
    expect(wave(1000, 1000)).toBeCloseTo(0);
    expect(wave(0, 1000, 0.5)).toBeCloseTo(1);
  });

  it("oscillate is a sine", () => {
    expect(oscillate(0, 1000)).toBeCloseTo(0);
    expect(oscillate(250, 1000)).toBeCloseTo(1);
    expect(oscillate(750, 1000)).toBeCloseTo(-1);
  });

  it("damp halves the distance every half-life, at any step size", () => {
    expect(damp(0, 10, 100, 100)).toBeCloseTo(5);
    let stepped = 0;
    for (let i = 0; i < 10; i++) stepped = damp(stepped, 10, 100, 10);
    expect(stepped).toBeCloseTo(5);
    expect(damp(0, 10, 0, 16)).toBe(10);
  });

  it("keyframes interpolate, ease and clamp", () => {
    const track = keyframes([
      { at: 100, value: 10, ease: linear },
      { at: 0, value: 0 },
      { at: 200, value: 0 },
    ]);
    expect(track.duration).toBe(200);
    expect(track(-5)).toBe(0);
    expect(track(50)).toBeCloseTo(5);
    expect(track(150)).toBeCloseTo(10 * (1 - easeInOut(0.5)));
    expect(track(500)).toBe(0);
  });

  it("oneShot clamps to its duration and reports done", () => {
    const shot = oneShot(100, (time, progress) => ({ values: { time, progress } }));
    expect(shot.update(0, 40)?.values).toEqual({ time: 40, progress: 0.4 });
    expect(shot.done).toBe(false);
    expect(shot.update(0, 130)?.values).toEqual({ time: 100, progress: 1 });
    expect(shot.done).toBe(true);
  });
});
