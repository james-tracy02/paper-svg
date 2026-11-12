import { describe, expect, it } from "vitest";
import { applyMatrixToPoint, getRenderNodes, NodeBuilder, SpriteBuilder, type Node, type RenderNode } from "../src";
import { createRig, solvePose, type Pose } from "../src/render/pose";
import { upgradeFixture, type RigFixture } from "./fixtures/RigFixture";
import exported from "./fixtures/sooz.rig.json";

const sooz = upgradeFixture(exported as unknown as RigFixture).body;

/** The tree with each posed node's rotation added, as a rebuild with those rotations would make it. */
const withRotations = (node: Node, pose: Pose): Node => ({
  ...node,
  rotate: node.rotate + (pose[node.id]?.rotate ?? 0),
  joints: node.joints?.map((child) => withRotations(child, pose)),
  attachments: node.attachments?.map((child) => withRotations(child, pose)),
});

/** Asserts the solved pose gives every render node exactly the matrices getRenderNodes gives it. */
const expectSameAsRenderNodes = (body: Node, pose: Pose = {}) => {
  const rig = createRig(body);
  const solved = solvePose(rig, pose);
  const renderNodes = getRenderNodes(withRotations(body, pose)).filter((node) => node.outlineOf === undefined);
  expect(renderNodes.length).toBe(rig.entries.length);
  for (const node of renderNodes) {
    const index = rig.indexById.get(node.id)!;
    expect({ id: node.id, matrix: solved.matrices[index] }).toEqual({ id: node.id, matrix: node.matrix });
    expect(solved.parentMatrices[index]).toEqual(node.parentMatrix);
    expect(solved.translateScales[index]).toEqual(node.translateScale);
  }
};

const part = (name: string) => new NodeBuilder(name).setSprite(new SpriteBuilder().setShape("rect").build());
const byId = (nodes: RenderNode[]) => new Map(nodes.map((node) => [node.id, node]));

describe("solvePose", () => {
  it("matches getRenderNodes on Sooz at rest", () => {
    expectSameAsRenderNodes(sooz);
  });

  it("matches getRenderNodes on Sooz with joints posed, constraints included", () => {
    expectSameAsRenderNodes(sooz, {
      forearm_right: { rotate: 35 },
      arm_left: { rotate: -20 },
      torso: { rotate: 6 },
      head: { rotate: -10 },
    });
  });

  it("adds a pose's rotation to the node's own", () => {
    const body = part("root").addJoints(part("arm").setJointPosition(10, 0).setRotation(20).build()).build();
    const rig = createRig(body);
    const turned = solvePose(rig, { arm: { rotate: 70 } }).matrices[rig.indexById.get("arm")!];

    const nodes = byId(getRenderNodes(withRotations(body, { arm: { rotate: 70 } })));
    expect(turned).toEqual(nodes.get("arm")!.matrix);
    expect(nodes.get("arm")!.matrix).not.toEqual(byId(getRenderNodes(body)).get("arm")!.matrix);
  });

  it("reads a target inside the constrained node's own subtree from an unconstrained solve, as before", () => {
    const tip = part("tip").setJointPosition(0, -40).build();
    const body = part("root")
      .addJoints(part("arm").setRotation(30).setAimAt("tip", { x: 0, y: 0 }).addJoints(tip).build())
      .build();

    expectSameAsRenderNodes(body);
  });

  it("solves a constraint's target first, so a constrained target is seen where it ends up", () => {
    // `pinned` is pinned onto `anchor`; `pointer` aims at `pinned`. getRenderNodes aims at where `pinned`
    // was before its pin; solvePose aims at where it is.
    const body = part("root")
      .addJoints(
        part("pointer").setAimAt("pinned", { x: 0, y: 0 }).build(),
        part("anchor").setJointPosition(50, 0).build(),
        part("pinned").setJointPosition(0, 80).setPinTo("anchor").build(),
      )
      .build();
    const rig = createRig(body);
    const solved = solvePose(rig);
    const at = (id: string) => solved.matrices[rig.indexById.get(id)!];

    const pinnedAt = applyMatrixToPoint(at("pinned"), { x: 0, y: 0 });
    expect(pinnedAt.x).toBeCloseTo(50);
    expect(pinnedAt.y).toBeCloseTo(80);
    // The pointer's local down axis runs from its joint toward the pinned point.
    const tipAt = applyMatrixToPoint(at("pointer"), { x: 0, y: -1 });
    expect(Math.atan2(tipAt.y, tipAt.x)).toBeCloseTo(Math.atan2(pinnedAt.y, pinnedAt.x));
    expect(byId(getRenderNodes(body)).get("pointer")!.matrix).not.toEqual(at("pointer"));
  });
});
