import { useMemo, useRef, useState } from "react";
import type { Node } from "../types/Node";
import type { Pose } from "../types/Pose";
import { createRig, solvePose } from "./pose";
import { createRigLayout, createRigPoser, type PosedRig, type RigLayout } from "./posedRig";

/** The posed rig each `useRenderNodes` result came from, so RigLayers can reuse its layout across poses. */
const posedRigs = new WeakMap<readonly unknown[], PosedRig>();

/** The posed rig behind a `useRenderNodes` result, if it came from one. */
export const getPosedRig = (nodes: readonly unknown[]): PosedRig | undefined => posedRigs.get(nodes);

/**
 * The tree's render nodes in `pose`, sorted by zIndex. The tree is laid out once per `body`, and again
 * only when drivers change the draw order; a new `pose` otherwise only re-places nodes, and nodes it
 * doesn't move keep their identity, as do nodes a new draw order leaves in place. A new `body` lays
 * everything out afresh. Pass the same `pose` object while it is unchanged.
 */
export const useRenderNodes = (body: Node, pose?: Pose) => {
  const [poser] = useState(createRigPoser);
  const lastLayout = useRef<RigLayout>(undefined);
  const rig = useMemo(() => createRig(body), [body]);
  const solution = useMemo(() => solvePose(rig, pose), [rig, pose]);
  // The layout only depends on the solution's draw order, which `zKey` stands for. It replaces the last
  // one, so nodes the new draw order leaves in place keep their identity.
  const layout = useMemo(
    () => (lastLayout.current = createRigLayout(rig, solution, lastLayout.current)),
    [rig, solution.zKey],
  );
  return useMemo(() => {
    const posed = poser(layout, solution);
    posedRigs.set(posed.nodes, posed);
    return posed.nodes;
  }, [poser, layout, solution]);
};
