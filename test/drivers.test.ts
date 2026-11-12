import { describe, expect, it } from "vitest";
import { getRenderNodes, NodeBuilder, SpriteBuilder, type Node, type Pose, type RenderNode } from "../src";
import { createRig, solvePose } from "../src/render/pose";
import { flattenRenderTree, buildRenderTreeFromPose } from "../src/render/RenderTree";
import { planLayers, resolveVisibleNodes } from "../src/render/layerPlan";

const part = (name: string) => new NodeBuilder(name).setSprite(new SpriteBuilder().setShape("rect").build());

/** Where each node sits: what a driver must reproduce exactly. */
const placement = (nodes: RenderNode[]) =>
  Object.fromEntries(nodes.map((n) => [n.id, { matrix: n.matrix, parentMatrix: n.parentMatrix, translateScale: n.translateScale }]));

/**
 * A shoulder with a pad that follows the arm. `follow` adds the pad's reaction to the arm's rotation,
 * either as a driver or baked in at build time, the way project-k builds it today.
 */
const shoulder = (follow: (pad: NodeBuilder) => NodeBuilder, side: "left" | "right") =>
  part("torso")
    .addJoints(
      part("arm").setJointPosition(10, 0).buildSide(side),
      follow(part("pad").setJointPosition(8, -2).addJoints(part("strap").setJointPosition(0, 6).build())).buildSide(side),
    )
    .build();

describe("drivers", () => {
  it.each(["right", "left"] as const)("place a node exactly as baking the value in would (%s side)", (side) => {
    const arm = `arm_${side}`;
    const pose: Pose = { rotations: { [arm]: 40 } };
    const output = (r: number) => ({ rotate: r * 0.5, x: r * 0.1, y: -r * 0.05, scaleX: 1 + r / 100, skewX: r / 4 });
    const o = output(40);

    const driven = shoulder((pad) => pad.addDriver((p) => output(p.rotations?.[arm] ?? 0)), side);
    const baked = shoulder(
      (pad) => pad.rotatesWith(o.rotate).translatesWithX(o.x).translatesWithY(o.y).scalesWithX(o.scaleX).skewsWith(o.skewX),
      side,
    );

    const nodes = getRenderNodes(driven, pose);
    expect(placement(nodes)).toEqual(placement(getRenderNodes(baked, pose)));
    // The driver really moved something: at rest the pad sits elsewhere.
    expect(placement(nodes)[`pad_${side}`]).not.toEqual(placement(getRenderNodes(driven))[`pad_${side}`]);
  });

  it("scale a joint's children through the driven scale, as a baked scale does", () => {
    const build = (pad: NodeBuilder) => part("torso").addJoints(pad.addJoints(part("strap").setJointPosition(0, 6).build()).build()).build();
    const driven = build(part("pad").addDriver((p) => ({ scaleY: 1 + (p.rotations?.arm ?? 0) / 50 })));
    const baked = build(part("pad").scalesWithY(1.6));
    const pose: Pose = { rotations: { arm: 30 } };
    expect(placement(getRenderNodes(driven, pose))).toEqual(placement(getRenderNodes(baked, pose)));
  });

  it("follow named values, which move nothing without a driver", () => {
    // An eye that opens with `eyeOpen` (fully open when the pose leaves it out), next to a node that shares its name.
    const face = (eye: NodeBuilder) => part("head").addJoints(eye.setJointPosition(4, 2).build(), part("eyeOpen").build()).build();
    const driven = face(part("eye").addDriver((p) => ({ scaleY: p.values?.eyeOpen ?? 1 })));
    const pose: Pose = { values: { eyeOpen: 0.25 } };

    expect(placement(getRenderNodes(driven, pose))).toEqual(placement(getRenderNodes(face(part("eye").scalesWithY(0.25)))));
    expect(placement(getRenderNodes(driven))).toEqual(placement(getRenderNodes(face(part("eye")))));
  });

  it("stack, each applying on top of the others", () => {
    const arm = (p: Pose) => p.rotations?.arm ?? 0;
    const driven = part("root")
      .addDriver((p) => ({ rotate: arm(p), scaleX: 2 }))
      .addDriver((p) => ({ rotate: arm(p) / 2, scaleX: 1.5 }))
      .build();
    const baked = part("root").rotatesWith(30, 15).scalesWithX(3).build();
    expect(placement(getRenderNodes(driven, { rotations: { arm: 30 } }))).toEqual(placement(getRenderNodes(baked)));
  });

  describe("visibility", () => {
    // A sleeve with two cuff variants, switched when the elbow passes 90°.
    const elbow = (p: Pose) => p.rotations?.elbow ?? 0;
    const sleeve = part("sleeve")
      .addJoints(
        part("cuff_straight")
          .addDriver((p) => ({ visible: elbow(p) < 90 }))
          .addJoints(part("button").build())
          .build(),
        part("cuff_bent").addDriver((p) => ({ visible: elbow(p) >= 90 })).build(),
      )
      .build();
    const hiddenIds = (pose: Pose) => getRenderNodes(sleeve, pose).filter((n) => n.hidden).map((n) => n.id);

    it("hides a node and everything hanging from it", () => {
      expect(hiddenIds({ rotations: { elbow: 30 } })).toEqual(["cuff_bent"]);
      expect(hiddenIds({ rotations: { elbow: 120 } })).toEqual(["cuff_straight", "button"]);
    });

    it("keeps the layer plan the same, so switching variants needs no rebuild", () => {
      const rig = createRig(sleeve);
      const planIds = (pose: Pose) => {
        const nodes = flattenRenderTree(buildRenderTreeFromPose(rig, solvePose(rig, pose))).sort((a, b) => a.zIndex - b.zIndex);
        const plan = planLayers({ nodes, visibleNodes: resolveVisibleNodes(nodes), getRenderGroupOptions: () => undefined, scopeId: (s) => s });
        return JSON.stringify(plan, (_key, value) => (value && typeof value === "object" && "matrix" in value && "zIndex" in value ? (value as RenderNode).id : value));
      };
      expect(planIds({ rotations: { elbow: 120 } })).toEqual(planIds({ rotations: { elbow: 30 } }));
      expect(planIds({})).toContain('"cuff_bent"');
    });
  });

  it("leave a tree without drivers exactly as it was", () => {
    const body: Node = shoulder((pad) => pad, "right");
    expect(getRenderNodes(body).some((n) => n.hidden !== undefined)).toBe(false);
  });
});
