import { useMemo, useState } from "react";
import type { Node } from "../types/Node";
import type { Pose } from "../types/Pose";
import { createRig, solvePose } from "./pose";
import { createRigLayout, createRigPoser, type PosedRig } from "./posedRig";
import { createNodeInterner } from "./stableNodes";

/** The posed rig each `useRenderNodes` result came from, so RigLayers can reuse its layout across poses. */
const posedRigs = new WeakMap<readonly unknown[], PosedRig>();

/** The posed rig behind a `useRenderNodes` result, if it came from one. */
export const getPosedRig = (nodes: readonly unknown[]): PosedRig | undefined => posedRigs.get(nodes);

/**
 * The tree's render nodes in `pose`, sorted by zIndex. The tree is laid out once per `body`, and again
 * only when drivers change the draw order; a new `pose` otherwise only re-places nodes, and nodes it
 * doesn't move keep their identity, as do unchanged nodes across rebuilds of `body`. Pass the same
 * `pose` object while it is unchanged.
 */
export const useRenderNodes = (body: Node, pose?: Pose) => {
  const [interners] = useState(() => ({ nodes: createNodeInterner(), visible: createNodeInterner() }));
  const [poser] = useState(createRigPoser);
  const rig = useMemo(() => createRig(body), [body]);
  const solution = useMemo(() => solvePose(rig, pose), [rig, pose]);
  // The layout only depends on the solution's draw order, which `zKey` stands for.
  const layout = useMemo(() => createRigLayout(rig, solution, interners), [rig, solution.zKey, interners]);
  return useMemo(() => {
    const posed = poser(layout, solution);
    posedRigs.set(posed.nodes, posed);
    return posed.nodes;
  }, [poser, layout, solution]);
};
