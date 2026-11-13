import { useEffect, useRef, useState } from "react";
import { createAnimator, type Animator, type AnimatorOptions } from "./animator";
import { runAnimator, type RunAnimatorOptions } from "./runAnimator";

export type UseAnimatorOptions = AnimatorOptions & RunAnimatorOptions;

/**
 * An animator that plays while the component is mounted (see `runAnimator`). `values` and `maxDt` are
 * read once; `base`, `write` and `onNeedsRender` can change between renders without restarting it.
 *
 * ```tsx
 * const rig = useRef<RigHandle>(null);
 * const animator = useAnimator({ base: () => pose, write: (next) => rig.current?.setPose(next) });
 * useEffect(() => animator.add("breathe", breathe, { fadeMs: 300 }), [animator]);
 * ```
 */
export const useAnimator = ({ values, maxDt, ...run }: UseAnimatorOptions): Animator => {
  const [animator] = useState(() => createAnimator({ values, maxDt }));
  const runRef = useRef(run);
  runRef.current = run;

  useEffect(
    () =>
      runAnimator(animator, {
        base: () => runRef.current.base(),
        write: (pose) => runRef.current.write(pose),
        onNeedsRender: (pose) => runRef.current.onNeedsRender?.(pose),
        frames: runRef.current.frames,
      }),
    [animator],
  );

  return animator;
};
