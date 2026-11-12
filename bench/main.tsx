/// <reference types="vite/client" />
/**
 * Profiling page: renders a fixture with Rig and exposes `window.bench`, which bench/profile.mjs
 * drives under a Chrome trace. Each action renders synchronously and resolves after the frame paints.
 */
import { Profiler, createRef, useState, type CSSProperties } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { getRenderNodes, getZoomVars, Rig, type Node, type Pose, type RigHandle } from "paper-svg";
import { buildMaskSignature } from "../src/render/RenderTree";
import { planLayers, resolveVisibleNodes } from "../src/render/layerPlan";
import { createRig, solvePose } from "../src/render/pose";
import { createRigLayout, createRigPoser } from "../src/render/posedRig";
import { upgradeFixture, type RigFixture } from "../test/fixtures/RigFixture";
import exported from "../test/fixtures/sooz.rig.json";

const fixture = upgradeFixture(exported as unknown as RigFixture);
const PIXELS_PER_UNIT = 2;
const VIEW = { x: -147, y: -287, width: 294, height: 592 };

/** A copy of `node` with every node rebuilt (as a builder rebuild does) and `id` turned by `degrees`. */
const rebuildWithRotation = (node: Node, id: string, degrees: number): Node => ({
  ...node,
  sprite: { ...node.sprite },
  transform: { ...node.transform, rotate: node.id === id ? node.transform.rotate + degrees : node.transform.rotate },
  joints: node.joints?.map((child) => rebuildWithRotation(child, id, degrees)),
  attachments: node.attachments?.map((child) => rebuildWithRotation(child, id, degrees)),
});

type State = { body: Node; pose?: Pose; zoom: number; tick: number };
let setState: (update: (state: State) => State) => void = () => {};
const commits: number[] = [];
const rigRef = createRef<RigHandle>();

const App = () => {
  const [state, set] = useState<State>({ body: fixture.body, zoom: PIXELS_PER_UNIT, tick: 0 });
  setState = set;
  const scale = state.zoom / PIXELS_PER_UNIT;
  return (
    <svg
      width={VIEW.width * PIXELS_PER_UNIT}
      height={VIEW.height * PIXELS_PER_UNIT}
      viewBox={`${VIEW.x / scale} ${VIEW.y / scale} ${VIEW.width / scale} ${VIEW.height / scale}`}
      style={getZoomVars(state.zoom) as CSSProperties}
      data-tick={state.tick}
    >
      <Profiler id="rig" onRender={(_id, _phase, actualDuration) => commits.push(actualDuration)}>
        <Rig
          ref={rigRef}
          body={state.body}
          pose={state.pose}
          scale={fixture.scale}
          mirror={fixture.mirror}
          idPrefix="bench"
          getRenderGroupOptions={getRenderGroupOptions}
        />
      </Profiler>
    </svg>
  );
};
const getRenderGroupOptions = (id: string) => fixture.renderGroupOptions[id];

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
const update = async (fn: (state: State) => State) => {
  flushSync(() => setState(fn));
  await nextFrame();
};

/** Mean milliseconds per call of `fn` over `runs` calls. */
const time = (runs: number, fn: () => void) => {
  const start = performance.now();
  for (let i = 0; i < runs; i += 1) fn();
  return (performance.now() - start) / runs;
};

const bench = {
  ready: false,
  nodeCount: getRenderNodes(fixture.body).length,
  /** Bodies for `pose`, built up front so building them isn't measured. */
  prepareBodies(count: number, id: string) {
    let body = fixture.body;
    bench.bodies = Array.from({ length: count }, () => (body = rebuildWithRotation(body, id, 1)));
  },
  bodies: [] as Node[],
  pose: (index: number) => update((state) => ({ ...state, body: bench.bodies[index] })),
  /** Turns `joints` by `index + 1` degrees each through the pose prop, on the unchanged body. */
  posePose: (index: number, joints: string[]) =>
    update((state) => ({
      ...state,
      body: fixture.body,
      pose: { rotations: Object.fromEntries(joints.map((id) => [id, index + 1])) },
    })),
  /** Turns `joints` by `index + 1` degrees each through `setPose`, as a drag would. */
  setPose: (index: number, joints: string[]) => {
    rigRef.current!.setPose({ rotations: Object.fromEntries(joints.map((id) => [id, index + 1])) });
    return nextFrame();
  },
  resetPose: () => update((state) => ({ ...state, body: fixture.body, pose: undefined })),
  rerender: () => update((state) => ({ ...state, tick: state.tick + 1 })),
  zoom: (zoom: number) => update((state) => ({ ...state, zoom })),
  takeCommits: () => commits.splice(0),
  settle: () => new Promise((resolve) => setTimeout(resolve, 1000)),
  /** The engine's pure steps on their own, in ms per call. */
  timeSteps(runs: number) {
    const a = rebuildWithRotation(fixture.body, "forearm_right", 1);
    const nodes = getRenderNodes(a);
    const sorted = [...nodes].sort((x, y) => x.zIndex - y.zIndex);
    const visible = resolveVisibleNodes(sorted);
    return {
      buildMaskSignature: time(runs, () => buildMaskSignature(a)),
      getRenderNodes: time(runs, () => getRenderNodes(a)),
      resolveVisibleNodes: time(runs, () => resolveVisibleNodes(sorted)),
      // A pose change that keeps the draw order: solve, then re-place nodes.
      poseFrame: (() => {
        const rig = createRig(fixture.body);
        const poser = createRigPoser();
        const layout = createRigLayout(rig);
        let i = 0;
        return time(runs, () => poser(layout, solvePose(rig, { rotations: { forearm_right: (i += 1) } })));
      })(),
      // A pose change that crosses a z band: a new layout, reusing the last one's unmoved nodes, then planned.
      relayout: (() => {
        const rig = createRig(fixture.body);
        let previous = createRigLayout(rig);
        return time(runs, () => {
          const layout = (previous = createRigLayout(rig, undefined, previous));
          planLayers({ nodes: layout.nodes, visibleNodes: layout.visibleNodes, getRenderGroupOptions, scopeId: (s) => `bench_${s}` });
        });
      })(),
      planLayers: time(runs, () =>
        planLayers({ nodes: sorted, visibleNodes: visible, getRenderGroupOptions, scopeId: (s) => `bench_${s}` }),
      ),
    };
  },
};
declare global {
  interface Window {
    bench: typeof bench;
  }
}
window.bench = bench;

createRoot(document.getElementById("root")!).render(<App />);
setTimeout(() => (bench.ready = true), 1500);
