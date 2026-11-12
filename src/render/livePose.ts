/**
 * Poses written straight to the DOM (see poseBindings.ts). A pose that only moves nodes and reshapes
 * driven paths is written; one that changes what is drawn (draw order, a node shown or hidden, a
 * swapped sprite, a gradient frame, which changes the gradient's id) needs a React render.
 *
 * A written pose doesn't make full render nodes: each node is compared where it stands, and a node
 * that moved becomes a light copy of its rest node (its prototype) with the pose's placement on top.
 */
import type { Pose } from "../types/Pose";
import { solvePose, type PoseSolution } from "./pose";
import { createRigPoser, isPlacedAt, placementOf, type Placement, type PosedRig, type RigLayout } from "./posedRig";
import { createPoseBindings, type PoseBindings } from "./poseBindings";
import type { RenderNode } from "./RenderTree";

export type LivePoser = {
  /** What the rig's elements register their writers with. */
  readonly bindings: PoseBindings;
  /**
   * React committed `posed` (undefined: nodes not laid out by `useRenderNodes`, which can't be written).
   * Rewrites the nodes written since the last commit, so the DOM shows `posed` again.
   */
  committed(posed: PosedRig | undefined): void;
  /** Writes `pose` to the DOM and returns true, or returns false when it needs a React render. */
  write(pose: Pose): boolean;
  /** The nodes as last written, sorted by z-index; undefined when nothing was written since the last commit. */
  nodes(): RenderNode[] | undefined;
};

/** Each id once: its visible copy where there is one (masks and fills may draw either; they share a placement). */
const writableNodes = new WeakMap<RigLayout, RenderNode[]>();
const getWritableNodes = (layout: RigLayout) => {
  let nodes = writableNodes.get(layout);
  if (!nodes) {
    const byId = new Map<string, RenderNode>();
    for (const node of layout.nodes) byId.set(node.id, node);
    for (const node of layout.visibleNodes) byId.set(node.id, node);
    writableNodes.set(layout, (nodes = [...byId.values()]));
  }
  return nodes;
};

/** Whether placing `node` at `at` changes more than the attributes the bindings write. */
const changesWhatIsDrawn = (node: RenderNode, at: Placement) =>
  node.hidden !== at.hidden ||
  node.sprite.customSprite !== at.customSprite ||
  node.sprite.gradientTransform !== at.gradientTransform ||
  (node.sprite.dynamicPath === undefined) !== (at.dynamicPath === undefined);

/** `node` at `at`, reading everything else from `node`. Only for writers: spreading it loses those fields. */
const placeLight = (node: RenderNode, { gradientTransform, dynamicPath, customSprite, ...fields }: Placement): RenderNode => {
  const posed: RenderNode = Object.assign(Object.create(node), fields);
  const { sprite } = node;
  if (dynamicPath !== sprite.dynamicPath || gradientTransform !== sprite.gradientTransform || customSprite !== sprite.customSprite) {
    Object.assign(posed, { sprite: { ...node.sprite, gradientTransform, dynamicPath, customSprite } });
  }
  return posed;
};

export const createLivePoser = (): LivePoser => {
  const bindings = createPoseBindings();
  let shown: { layout: RigLayout; nodes: Map<string, RenderNode> } | undefined;
  let written: { solution: PoseSolution; nodes?: RenderNode[] } | undefined;
  const poser = createRigPoser();

  return {
    bindings,
    committed(posed) {
      written = undefined;
      if (!posed) {
        shown = undefined;
        return;
      }
      const nodes = new Map<string, RenderNode>();
      for (const node of posed.nodes) nodes.set(node.id, node);
      for (const node of posed.visibleNodes) nodes.set(node.id, node);
      shown = { layout: posed.layout, nodes };
      bindings.commit(() => (id) => nodes.get(id));
    },
    write(pose) {
      if (!shown) return false;
      const { layout } = shown;
      const { rig } = layout;
      const solution = solvePose(rig, pose);
      if (solution.zKey !== layout.zKey) return false;
      const moved = new Map<string, RenderNode>();
      for (const node of getWritableNodes(layout)) {
        const at = placementOf(node, rig.indexById.get(node.outlineOf ?? node.id)!, rig, solution);
        const before = shown.nodes.get(node.id);
        if (!before || isPlacedAt(before, at)) continue;
        if (changesWhatIsDrawn(before, at)) return false;
        moved.set(node.id, placeLight(node, at));
      }
      const nodes = shown.nodes;
      moved.forEach((node, id) => nodes.set(id, node));
      bindings.write(moved.keys(), (id) => nodes.get(id));
      written = { solution };
      return true;
    },
    nodes() {
      if (!written || !shown) return undefined;
      return (written.nodes ??= poser(shown.layout, written.solution).nodes);
    },
  };
};
