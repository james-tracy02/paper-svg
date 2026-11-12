/// <reference types="vite/client" />
/**
 * Snapshot tests that pin the engine's output for whole characters, so refactors can be checked
 * against it. Each case is rendered in Chromium (masks measure themselves with getBBox), left to
 * settle, then compared two ways:
 *  - the SVG markup, against `__snapshots__/<case>.svg` (a viewable SVG file), and
 *  - a screenshot, against `__screenshots__/`.
 *
 * Add a project-k character by running `exportRigFixture()` in project-k's dev console and saving
 * the file to `test/fixtures/`. Run with `npm run test:snapshots`; accept an intended change with
 * `npm run test:snapshots -- --update`. Screenshots are per platform, so this is not part of CI.
 */
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import type { CSSProperties } from "react";
import { getZoomVars, makeSprite, NodeBuilder, registerCustomSprite, Rig, SpriteBuilder, type Node, type RigProps } from "../../src";
import { upgradeFixture, type RigFixture } from "../fixtures/RigFixture";
import { buildScene, DEFAULT_POSE, STAR_SPRITE_ID, STAR_SVG } from "../../demo/puppet";

const fixtures = import.meta.glob<RigFixture>("../fixtures/*.rig.json", { eager: true, import: "default" });

const SVG_NS = "http://www.w3.org/2000/svg";
const SETTLE_START_MS = 300;
const SETTLE_POLL_MS = 100;
const SETTLE_STABLE_POLLS = 3;
const SETTLE_TIMEOUT_MS = 10_000;
const VIEW_PADDING = 20;
/**
 * Screen pixels per rig unit. `--zoom` must match it, as the app's canvas keeps it matched to its camera
 * scale: strokes inside masks scale with the view while other outlines don't, so a mismatch thickens them.
 */
const PIXELS_PER_UNIT = 2;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits until the markup stops changing: masks re-render after a deferred getBBox pass. */
const settle = async (svg: SVGSVGElement) => {
  await sleep(SETTLE_START_MS);
  const deadline = performance.now() + SETTLE_TIMEOUT_MS;
  let last = svg.innerHTML;
  let stablePolls = 0;
  while (stablePolls < SETTLE_STABLE_POLLS) {
    if (performance.now() > deadline) throw new Error("Rig did not settle");
    await sleep(SETTLE_POLL_MS);
    const now = svg.innerHTML;
    stablePolls = now === last ? stablePolls + 1 : 0;
    last = now;
  }
};

const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
});

/** Renders a rig, waits for it to settle and frames the viewBox around it. */
const renderRig = async (props: RigProps) => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  cleanups.push(() => {
    root.unmount();
    host.remove();
  });

  flushSync(() =>
    root.render(
      <svg
        xmlns={SVG_NS}
        width={800}
        height={1000}
        viewBox="-200 -250 400 500"
        style={{ background: "#fff", ...(getZoomVars(PIXELS_PER_UNIT) as CSSProperties) }}
      >
        <Rig {...props} />
      </svg>,
    ),
  );
  const svg = host.querySelector("svg")!;
  await settle(svg);

  const box = (svg.firstElementChild as SVGGraphicsElement).getBBox();
  const x = Math.floor(box.x - VIEW_PADDING);
  const y = Math.floor(box.y - VIEW_PADDING);
  const width = Math.ceil(box.x + box.width + VIEW_PADDING) - x;
  const height = Math.ceil(box.y + box.height + VIEW_PADDING) - y;
  svg.setAttribute("viewBox", `${x} ${y} ${width} ${height}`);
  svg.setAttribute("width", String(width * PIXELS_PER_UNIT));
  svg.setAttribute("height", String(height * PIXELS_PER_UNIT));
  // Anything past the viewport isn't painted, so it would silently drop out of the screenshot.
  const rect = svg.getBoundingClientRect();
  if (rect.right > window.innerWidth || rect.bottom > window.innerHeight) {
    throw new Error(`Rig (${rect.width}x${rect.height}px) does not fit the test viewport; enlarge it in vitest.config.ts`);
  }
  return svg;
};

/** Renders `first`, lets it settle, then re-renders the same rig with `next`; returns the settled markup. */
const renderRigMarkup = async (first: RigProps, next?: RigProps) => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  cleanups.push(() => {
    root.unmount();
    host.remove();
  });
  const draw = (props: RigProps) =>
    flushSync(() =>
      root.render(
        <svg xmlns={SVG_NS} width={800} height={1000} viewBox="-200 -250 400 500" style={getZoomVars(PIXELS_PER_UNIT) as CSSProperties}>
          <Rig {...props} />
        </svg>,
      ),
    );
  draw(first);
  const svg = host.querySelector("svg")!;
  await settle(svg);
  if (next) {
    draw(next);
    await settle(svg);
  }
  return formatMarkup(svg);
};

/** One element per line, so snapshot diffs point at the element that changed. */
const formatMarkup = (svg: SVGSVGElement) => svg.outerHTML.replace(/></g, ">\n<") + "\n";

const expectRigSnapshot = async (name: string, props: RigProps) => {
  const svg = await renderRig(props);
  await expect(formatMarkup(svg)).toMatchFileSnapshot(`./__snapshots__/${name}.svg`);
  await expect.element(page.elementLocator(svg)).toMatchScreenshot(name);
};

const fixtureProps = (exported: RigFixture): RigProps => {
  const fixture = upgradeFixture(exported);
  const hiddenTags = new Set(fixture.hiddenRenderGroupTags);
  return {
    body: fixture.body,
    scale: fixture.scale,
    mirror: fixture.mirror,
    idPrefix: "fixture",
    getRenderGroupOptions: (id) => fixture.renderGroupOptions[id],
    effects: {
      ...fixture.effects,
      isHidden: hiddenTags.size ? (node) => hiddenTags.has(node.renderGroupTag ?? "") : undefined,
    },
  };
};

/** A fixed, easy-to-spot recolor, standing in for scene lighting. */
const invertColor = (color: string | undefined) => {
  const hex = color?.match(/^#([0-9a-f]{6})$/i)?.[1];
  if (!hex) return color;
  return `#${(0xffffff ^ parseInt(hex, 16)).toString(16).padStart(6, "0")}`;
};

describe("fixtures", () => {
  const entries = Object.entries(fixtures);
  it.skipIf(entries.length > 0)("has no fixtures yet (add one with exportRigFixture())", () => {});

  for (const [path, fixture] of entries) {
    const name = path.split("/").pop()!.replace(/\.rig\.json$/, "");

    it(`${name}`, async () => {
      await expectRigSnapshot(name, fixtureProps(fixture));
    });

    it(`${name} posed through the pose prop draws what a rebuild with the rotations draws`, async () => {
      const rotations: Record<string, number> = { forearm_right: 35, arm_left: -20, torso: 6, head: -10, leg_right: 12 };
      const props = fixtureProps(fixture);
      const withRotations = (node: Node): Node => ({
        ...node,
        rotate: node.rotate + (rotations[node.id] ?? 0),
        joints: node.joints?.map(withRotations),
        attachments: node.attachments?.map(withRotations),
      });
      const rebuilt = await renderRigMarkup({ ...props, body: withRotations(props.body) });
      expect(rebuilt).not.toEqual(await renderRigMarkup(props));
      // Posed from the first render, and again after a pose change on the same rig.
      expect(await renderRigMarkup({ ...props, pose: { rotations } })).toEqual(rebuilt);
      expect(await renderRigMarkup(props, { ...props, pose: { rotations } })).toEqual(rebuilt);
    });

    it(`${name} with a color transform`, async () => {
      await expectRigSnapshot(`${name}-color-transform`, { ...fixtureProps(fixture), colorTransform: invertColor });
    });
  }
});

describe("demo puppet", () => {
  registerCustomSprite(makeSprite(STAR_SPRITE_ID, STAR_SVG));
  const scene = (clipSash: boolean) =>
    buildScene({ pose: DEFAULT_POSE, shirtColor: "#4f9d69", balloon: { x: 125, y: 165 }, clipSash });

  it("default", async () => {
    await expectRigSnapshot("puppet", { body: scene(false), idPrefix: "puppet" });
  });

  it("clipped sash, mirrored, with effects", async () => {
    await expectRigSnapshot("puppet-effects", {
      body: scene(true),
      idPrefix: "puppet",
      mirror: true,
      effects: { outerOutline: { color: "#2b6cb0", thickness: 4 }, glow: { color: "#ffe08a", radius: 6 } },
    });
  });
});

describe("drivers", () => {
  it("define the paths of a custom sprite a driver swaps in", async () => {
    const shape = (id: string, d: string) => ({
      id,
      colors: 1,
      strokeColors: 1,
      elements: [{ d, colorKey: "color0" }],
      translate: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotate: 0,
    });
    const open = shape("eye_open", "M 0 0 L 40 0 L 40 30 Z");
    const closed = shape("eye_closed", "M 0 0 L 40 0 L 20 6 Z");
    const body = new NodeBuilder("eye")
      .setSprite(new SpriteBuilder().setCustomSprite(open).setFill("#336699").setStroke("#000000").setStrokeWidth(1).build())
      .addDriver((p) => ({ customSprite: (p.values?.eyeOpen ?? 1) < 0.2 ? closed : undefined }))
      .build();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    cleanups.push(() => {
      root.unmount();
      host.remove();
    });
    flushSync(() =>
      root.render(
        <svg xmlns={SVG_NS} width={200} height={200} viewBox="-50 -50 100 100">
          <Rig body={body} idPrefix="eye" pose={{ values: { eyeOpen: 0.1 } }} />
        </svg>,
      ),
    );
    const svg = host.querySelector("svg")!;
    await settle(svg);
    const refs = [...svg.querySelectorAll("use")].map((use) => use.getAttribute("href") ?? use.getAttribute("xlink:href"));
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) expect(svg.querySelector(ref!), `${ref} is defined`).not.toBeNull();
    expect([...svg.querySelectorAll("defs path")].map((path) => path.getAttribute("d"))).toContain(closed.elements[0].d);
  });
});
