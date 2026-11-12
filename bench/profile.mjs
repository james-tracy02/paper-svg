/**
 * Profiles rendering a fixture: where each frame's time goes (scripting vs style/layout vs paint vs
 * raster), and what the engine's pure steps cost on their own.
 *
 *   npm run profile            headless Chromium
 *   npm run profile -- --headed  a visible window, with the GPU (closer to the app)
 *   npm run profile -- --dev     development React, through the Vite dev server
 */
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { build, createServer, preview } from "vite";

const FRAMES = 30;
const headed = process.argv.includes("--headed");
const dev = process.argv.includes("--dev");
const root = fileURLToPath(new URL(".", import.meta.url));

/** Trace event names by DevTools category. Anything else on the main thread counts as "other". */
const CATEGORY = {
  scripting: [
    "FunctionCall", "EvaluateScript", "FireAnimationFrame", "TimerFire", "RunMicrotasks", "EventDispatch",
    "v8.compile", "v8.run", "V8.Execute", "MinorGC", "MajorGC", "V8.GCScavenger", "V8.GCFinalizeMC", "BlinkGC.AtomicPhase",
  ],
  "style + layout": ["UpdateLayoutTree", "RecalculateStyles", "Layout", "UpdateLayerTree", "HitTest", "IntersectionObserverController::computeIntersections"],
  "paint + composite": ["PrePaint", "Paint", "PaintImage", "Layerize", "Commit", "CompositeLayers", "UpdateLayer"],
};
const categoryOf = (name) =>
  Object.keys(CATEGORY).find((category) => CATEGORY[category].includes(name)) ?? "other";

/** Self time (ms) per category for the renderer's main thread, plus raster time on worker threads. */
const summarize = (trace) => {
  const events = trace.traceEvents;
  const threadNames = new Map(
    events.filter((e) => e.name === "thread_name").map((e) => [`${e.pid}:${e.tid}`, e.args.name]),
  );
  const totals = { scripting: 0, "style + layout": 0, "paint + composite": 0, other: 0, raster: 0, "gpu process": 0 };
  const byThread = new Map();
  let gpuBusyUntil = 0;
  for (const e of events) {
    if (e.ph !== "X" || !e.dur) continue;
    const thread = threadNames.get(`${e.pid}:${e.tid}`) ?? "";
    if (thread.startsWith("CompositorTileWorker") || e.name === "RasterTask") {
      if (e.name === "RasterTask") totals.raster += e.dur / 1000;
      continue;
    }
    // With GPU raster, drawing runs on the GPU process's main thread: count its busy time (outermost events).
    if (thread === "CrGpuMain") {
      if (e.ts >= gpuBusyUntil) {
        totals["gpu process"] += e.dur / 1000;
        gpuBusyUntil = e.ts + e.dur;
      }
      continue;
    }
    if (thread !== "CrRendererMain") continue;
    const key = `${e.pid}:${e.tid}`;
    if (!byThread.has(key)) byThread.set(key, []);
    byThread.get(key).push(e);
  }
  // Self time: each event's duration minus its direct children's.
  for (const list of byThread.values()) {
    list.sort((a, b) => a.ts - b.ts || b.dur - a.dur);
    const stack = [];
    const self = new Map();
    for (const e of list) {
      while (stack.length && stack.at(-1).ts + stack.at(-1).dur <= e.ts) stack.pop();
      const parent = stack.at(-1);
      if (parent) self.set(parent, (self.get(parent) ?? parent.dur) - e.dur);
      stack.push(e);
    }
    for (const e of list) totals[categoryOf(e.name)] += Math.max(0, self.get(e) ?? e.dur) / 1000;
  }
  return totals;
};

const CATEGORIES = ["devtools.timeline", "disabled-by-default-devtools.timeline", "v8.execute", "blink", "toplevel", "gpu"];

// Production React by default; `--dev` profiles the development build, which is several times slower.
const configFile = `${root}vite.config.ts`;
let server;
if (dev) {
  server = await createServer({ configFile, logLevel: "error", server: { port: 0 } });
  await server.listen();
} else {
  await build({ configFile, logLevel: "error" });
  server = await preview({ configFile, logLevel: "error", preview: { port: 0 } });
}
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ headless: !headed });
const page = await browser.newPage({ viewport: { width: 700, height: 1250 } });
await page.goto(url);
await page.waitForFunction(() => window.bench?.ready);
await page.evaluate(() => window.bench.settle());

const scenarios = {
  "pose change (rotate a forearm, rebuilt body)": {
    prepare: (n) => window.bench.prepareBodies(n, "forearm_right"),
    run: (i) => window.bench.pose(i),
  },
  "re-render, same body": { run: () => window.bench.rerender() },
  "zoom (CSS only)": { run: (i) => window.bench.zoom(i % 2 ? 2.5 : 2) },
};

const results = [];
for (const [name, scenario] of Object.entries(scenarios)) {
  if (scenario.prepare) await page.evaluate(scenario.prepare, FRAMES);
  await page.evaluate(() => window.bench.takeCommits());
  await browser.startTracing(page, { categories: CATEGORIES });
  const wall = await page.evaluate(
    async ({ frames, run }) => {
      const runFrame = new Function("i", `return (${run})(i)`);
      const start = performance.now();
      for (let i = 0; i < frames; i += 1) await runFrame(i);
      return performance.now() - start;
    },
    { frames: FRAMES, run: scenario.run.toString() },
  );
  const trace = JSON.parse((await browser.stopTracing()).toString());
  const commits = await page.evaluate(() => window.bench.takeCommits());
  const totals = summarize(trace);
  const perFrame = Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, (v / FRAMES).toFixed(2)]));
  const react = commits.reduce((sum, d) => sum + d, 0) / FRAMES;
  results.push({ scenario: name, "frame (wall)": (wall / FRAMES).toFixed(1), ...perFrame, "react render": react.toFixed(2) });
  await page.evaluate(() => window.bench.settle());
}

const steps = await page.evaluate(() => window.bench.timeSteps(20));
const nodeCount = await page.evaluate(() => window.bench.nodeCount);

console.log(
  `\n${nodeCount} render nodes, ${headed ? "headed" : "headless"} Chromium, ${dev ? "development" : "production"} React,` +
    ` ms per frame (mean of ${FRAMES}):`,
);
console.table(results);
console.log("Engine steps on their own, ms per call:");
console.table(Object.fromEntries(Object.entries(steps).map(([k, v]) => [k, { ms: v.toFixed(2) }])));

await browser.close();
await server.close();
