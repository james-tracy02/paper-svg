import { describe, expect, it } from "vitest";
import { getRenderNodes, NodeBuilder, SpriteBuilder, type Node, type Pose, type RenderNode } from "../src";
import { createRig, solvePose } from "../src/render/pose";
import { createRigLayout, createRigPoser, poseTree } from "../src/render/posedRig";
import { resolveVisibleNodes } from "../src/render/layerPlan";
import { createNodeInterner } from "../src/render/stableNodes";
import { upgradeFixture, type RigFixture } from "./fixtures/RigFixture";
import exported from "./fixtures/sooz.rig.json";

const sooz = upgradeFixture(exported as unknown as RigFixture).body;
const SOOZ_POSE: Pose = { rotations: { forearm_right: 35, arm_left: -20, torso: 6, head: -10, leg_right: 12 } };

/** Every field of every node, with links to other nodes reduced to their ids. */
const fields = (nodes: RenderNode[]) =>
  nodes.map(({ parent, jointParent, linkedOutline, ...rest }) =>
    JSON.parse(JSON.stringify({ ...rest, parent: parent?.id, jointParent: jointParent?.id, linkedOutline: linkedOutline?.id })),
  );

/** What a full rebuild at `pose` renders: its sorted nodes and the nodes RigLayers paints. */
const rebuilt = (body: Node, pose: Pose) => {
  const nodes = getRenderNodes(body, pose).sort((a, b) => a.zIndex - b.zIndex);
  return { nodes, visibleNodes: resolveVisibleNodes(nodes) };
};

const part = (name: string) => new NodeBuilder(name).setSprite(new SpriteBuilder().setShape("rect").build());

describe("posing a layout", () => {
  it("gives the nodes a rebuild at that pose gives, field for field", () => {
    const posed = poseTree(sooz, SOOZ_POSE);
    const expected = rebuilt(sooz, SOOZ_POSE);
    expect(fields(posed.nodes)).toEqual(fields(expected.nodes));
    expect(fields(posed.visibleNodes)).toEqual(fields(expected.visibleNodes));
  });

  it("matches a rebuild for driven, hidden and arrive-path nodes too", () => {
    const body = part("root")
      .addJoints(
        new NodeBuilder("arm")
          .setSprite(new SpriteBuilder().setShape("rect").setStroke("black").setStrokeWidth(1).build())
          .setOutlineZIndex(-1)
          .addJoints(part("hand").setJointPosition(0, 20).addDriver((p) => ({ visible: (p.values?.open ?? 1) > 0.5 })).build())
          .build(),
        part("cord").setAimAt("hand", { x: 0, y: 0 }, undefined, false, { along: { x: 0, y: 1 }, bend: 0.3 }).build(),
      )
      .build();
    const pose: Pose = { rotations: { arm: 50 }, values: { open: 0.2 } };
    const posed = poseTree(body, pose);
    expect(fields(posed.visibleNodes)).toEqual(fields(rebuilt(body, pose).visibleNodes));
    expect(posed.visibleNodes.find((n) => n.id === "hand")?.hidden).toBe(true);
  });

  it("keeps nodes the pose doesn't move, and moved nodes that end where they were", () => {
    const layout = createRigLayout(createRig(sooz));
    const pose = createRigPoser();
    const atRest = pose(layout, solvePose(layout.rig));
    expect(atRest.visibleNodes.every((node, i) => node === layout.visibleNodes[i])).toBe(true);

    const turned = pose(layout, solvePose(layout.rig, { rotations: { forearm_right: 35 } }));
    const changed = turned.visibleNodes.filter((node, i) => node !== atRest.visibleNodes[i]).map((node) => node.id);
    expect(changed).toContain("forearm_right");
    expect(changed).not.toContain("head");
    expect(changed.length).toBeLessThan(turned.visibleNodes.length / 4);

    const again = pose(layout, solvePose(layout.rig, { rotations: { forearm_right: 35 } }));
    expect(again.visibleNodes.every((node, i) => node === turned.visibleNodes[i])).toBe(true);
  });

  it("re-lays out when a driver changes the draw order, and still matches a rebuild", () => {
    const outlined = new SpriteBuilder().setShape("rect").setStroke("black").setStrokeWidth(1).build();
    const hemPath = (tilt: number) => `M 0 0 L 10 ${5 + tilt * 3} L -10 5 Z`;
    const body = part("torso")
      .setZIndex(100)
      .addJoints(
        new NodeBuilder("forearm")
          .setSprite(outlined)
          .setZIndex(-20)
          .setOutlineZIndex(70)
          .addDriver((p) => {
            const z = (p.rotations?.forearm ?? 0) > 150 ? 400 : 0;
            return { zIndex: z, outlineZIndex: z };
          })
          .addJoints(part("cuff").setZIndex(1).build())
          .build(),
        new NodeBuilder("hem")
          .setSprite(new SpriteBuilder().setPath(hemPath(0)).build())
          .addDriver((p) => ({ path: hemPath(p.values?.tilt ?? 0) }))
          .build(),
        part("head").setJointPosition(0, -30).build(),
      )
      .build();

    // As useRenderNodes runs it: one rig, interners and poser; a new layout only when `zKey` changes.
    const rig = createRig(body);
    const interners = { nodes: createNodeInterner(), visible: createNodeInterner() };
    const poser = createRigPoser();
    let layout = createRigLayout(rig, solvePose(rig), interners);
    const frame = (pose: Pose) => {
      const solution = solvePose(rig, pose);
      if (solution.zKey !== layout.zKey) layout = createRigLayout(rig, solution, interners);
      return poser(layout, solution);
    };

    const lowered = frame({ rotations: { forearm: 140 }, values: { tilt: 0.2 } });
    const firstLayout = layout;
    const pose: Pose = { rotations: { forearm: 160 }, values: { tilt: 0.2 } };
    const raised = frame(pose);
    expect(layout).not.toBe(firstLayout);
    expect(fields(raised.visibleNodes)).toEqual(fields(rebuilt(body, pose).visibleNodes));
    const at = (posed: typeof raised, id: string) => posed.visibleNodes.find((n) => n.id === id);
    expect(at(raised, "head")).toBe(at(lowered, "head"));
    expect(at(raised, "hem")).toBe(at(lowered, "hem"));
    expect(at(raised, "forearm")!.zIndex).toBeGreaterThan(at(raised, "torso")!.zIndex);

    // Back in the first band, with a new tilt: the hem's path follows, and the layout matches a rebuild again.
    const back: Pose = { rotations: { forearm: 20 }, values: { tilt: 0.9 } };
    const lowerAgain = frame(back);
    expect(fields(lowerAgain.visibleNodes)).toEqual(fields(rebuilt(body, back).visibleNodes));
    expect(at(lowerAgain, "hem")!.sprite.dynamicPath).toBe(hemPath(0.9));
  });

  it("maps a layout's nodes to their posed versions", () => {
    const layout = createRigLayout(createRig(sooz));
    const posed = createRigPoser()(layout, solvePose(layout.rig, SOOZ_POSE));
    layout.visibleNodes.forEach((node, i) => expect(posed.current(node)).toBe(posed.visibleNodes[i]));
    layout.nodes.forEach((node, i) => expect(posed.current(node)).toBe(posed.nodes[i]));
  });
});
