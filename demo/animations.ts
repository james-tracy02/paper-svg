import { continuous, damp, keyframes, linear, oneShot, oscillate, wave, type Animation, type Vector2 } from "paper-svg";

/**
 * The puppet breathes: the head bobs, the arms sway and the ears flop, each on its own period so the
 * loop doesn't read as one motion. Pose rotations aren't mirrored, so the left side's are negated for
 * the two sides to mirror each other.
 */
export const idle: Animation = continuous((time) => {
  const breath = wave(time, 3600);
  const sway = oscillate(time, 5200);
  return {
    translations: { head: { x: 0, y: breath * 2 } },
    rotations: {
      arm_right: sway * 3,
      arm_left: -(sway * 3 - breath * 2),
      ear_right: oscillate(time, 2600) * 5,
      ear_left: -oscillate(time, 2600, 0.25) * 5,
    },
  };
});

// The left arm swings up, the forearm waves three times, and the arm comes back down.
const raise = keyframes([
  { at: 0, value: 0 },
  { at: 350, value: 145 },
  { at: 1550, value: 145 },
  { at: 1900, value: 0 },
]);
const wag = keyframes([
  { at: 350, value: 0 },
  ...[0, 1, 2].flatMap((i) => [
    { at: 500 + i * 360, value: 35 },
    { at: 680 + i * 360, value: -25 },
  ]),
  { at: 1550, value: 0, ease: linear },
]);

/** Waves with the left arm once. Made per wave, since a one-shot finishes. */
export const waveHello = (): Animation =>
  oneShot(raise.duration, (time) => ({ rotations: { arm_left: raise(time), forearm_left: -wag(time) } }));

/**
 * The head tilts toward the pointer, easing after it rather than snapping, and the ears trail behind the
 * turn. It reads the pointer through `pointer`, which the stage updates on move (x from -1 to 1 across
 * it, null when outside), and keeps its own eased angle between frames.
 */
export const followPointer = (pointer: { current: Vector2 | null }): Animation => {
  let angle = 0;
  return {
    update(dt) {
      const target = pointer.current ? pointer.current.x * 22 : 0;
      angle = damp(angle, target, 120, dt);
      return { rotations: { head: angle, ear_right: -angle * 0.4, ear_left: -angle * 0.4 } };
    },
  };
};
