/// <reference types="vite/client" />
/**
 * `Rig`'s `setPose` writes poses straight to the DOM. Whatever it writes must be the markup React
 * renders for the same pose through the `pose` prop, and it must not commit a React render unless
 * the pose changes what is drawn.
 */
import { Profiler, createRef, type CSSProperties } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { getZoomVars, NodeBuilder, Rig, SpriteBuilder, type Pose, type RigHandle, type RigProps } from "../../src";
import { upgradeFixture, type RigFixture } from "../fixtures/RigFixture";

const fixtures = import.meta.glob<RigFixture>("../fixtures/*.rig.json", { eager: true, import: "default" });

const SVG_NS = "http://www.w3.org/2000/svg";

const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
});

/** Mounts a rig and returns its handle, its markup, a re-render, and how many times React committed it. */
const mount = (props: RigProps) => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  cleanups.push(() => {
    root.unmount();
    host.remove();
  });
  const handle = createRef<RigHandle>();
  let commits = 0;
  const draw = (next: RigProps) =>
    flushSync(() =>
      root.render(
        <svg xmlns={SVG_NS} width={800} height={1000} viewBox="-200 -250 400 500" style={getZoomVars(2) as CSSProperties}>
          <Profiler id="rig" onRender={() => (commits += 1)}>
            <Rig ref={handle} {...next} />
          </Profiler>
        </svg>,
      ),
    );
  draw(props);
  return {
    setPose: (pose: Pose) => flushSync(() => handle.current!.setPose(pose)),
    markup: () => host.querySelector("svg")!.outerHTML.replace(/></g, ">\n<"),
    draw,
    commits: () => commits,
  };
};

/** The markup React renders for `props` from scratch. */
const renderedMarkup = (props: RigProps) => mount(props).markup();

const fixtureProps = (exported: RigFixture): RigProps => {
  const fixture = upgradeFixture(exported);
  return {
    body: fixture.body,
    scale: fixture.scale,
    mirror: fixture.mirror,
    idPrefix: "fixture",
    getRenderGroupOptions: (id) => fixture.renderGroupOptions[id],
    effects: fixture.effects,
  };
};

const POSES: Record<string, Pose> = {
  "one forearm": { rotations: { forearm_right: 35 } },
  "eight joints": {
    rotations: {
      forearm_right: 35,
      arm_right: 20,
      forearm_left: -40,
      arm_left: -20,
      torso: 6,
      head: -10,
      leg_right: 12,
      leg_left: -8,
    },
  },
  "far reach": { rotations: { forearm_right: 120, arm_left: -60, torso: 15, head: -20, leg_right: 30 } },
};

describe("setPose", () => {
  for (const [path, fixture] of Object.entries(fixtures)) {
    const name = path.split("/").pop()!.replace(/\.rig\.json$/, "");
    const props = fixtureProps(fixture);

    it(`writes ${name}'s poses as React renders them, without a render`, () => {
      const rig = mount(props);
      const rest = rig.markup();
      for (const [label, pose] of Object.entries(POSES)) {
        expect(renderedMarkup({ ...props, pose }), `${label} moves something`).not.toEqual(rest);
        const commits = rig.commits();
        rig.setPose(pose);
        expect(rig.commits(), `${label} rendered`).toBe(commits);
        expect(rig.markup(), label).toEqual(renderedMarkup({ ...props, pose }));
      }
      // Back to the prop's pose (a cancelled drag).
      rig.setPose({});
      expect(rig.markup()).toEqual(renderedMarkup(props));
    });

    it(`shows ${name}'s pose prop again after a written pose`, () => {
      const pose = POSES["eight joints"];
      const rig = mount(props);
      rig.setPose(pose);
      // The drag ends: the app commits the pose it wrote.
      rig.draw({ ...props, pose });
      expect(rig.markup()).toEqual(renderedMarkup({ ...props, pose }));
      // A drag the app doesn't commit, then a new prop pose that only turns the head: React re-renders
      // the head alone, and the nodes the drag moved must still go back.
      rig.setPose(POSES["far reach"]);
      const headOnly = { rotations: { ...pose.rotations, head: 5 } };
      rig.draw({ ...props, pose: headOnly });
      expect(rig.markup()).toEqual(renderedMarkup({ ...props, pose: headOnly }));
    });
  }

  it("writes driven paths, and renders when a driver changes the draw order", () => {
    const sprite = (fill: string) => new SpriteBuilder().setShape("rect").setFill(fill).setStrokeWidth(0).build();
    const body = new NodeBuilder("root")
      .setSprite(sprite("#888888"))
      .addJoints(
        new NodeBuilder("arm")
          .setSprite(sprite("#aa3333"))
          .setZIndex(1)
          .addDriver((p) => ({ zIndex: (p.rotations?.arm ?? 0) > 90 ? -2 : 0 }))
          .build(),
        new NodeBuilder("hem")
          .setSprite(sprite("#3333aa"))
          .addDriver((p) => ({ path: `M 0 0 L 10 ${10 + (p.rotations?.arm ?? 0) / 10} L 0 10 Z` }))
          .build(),
      )
      .build();
    const props: RigProps = { body, idPrefix: "driven" };
    const rig = mount(props);

    rig.setPose({ rotations: { arm: 30 } });
    expect(rig.commits()).toBe(1);
    expect(rig.markup()).toEqual(renderedMarkup({ ...props, pose: { rotations: { arm: 30 } } }));

    rig.setPose({ rotations: { arm: 120 } });
    expect(rig.commits()).toBe(2);
    expect(rig.markup()).toEqual(renderedMarkup({ ...props, pose: { rotations: { arm: 120 } } }));
  });
});
