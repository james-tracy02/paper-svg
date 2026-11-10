import { describe, expect, it } from "vitest";
import {
  applyInverseMatrixToPoint,
  applyMatrixToPoint,
  combineMatrixTransforms,
  getRenderNodes,
  invertMatrixTransform,
  NodeBuilder,
  SpriteBuilder,
  transformToMatrix,
  type Node,
  type RenderNode,
  type Vector2,
} from "../src";

const byId = (root: Node) => new Map(getRenderNodes(root).map((node) => [node.id, node]));

const world = (nodes: Map<string, RenderNode>, id: string, point: Vector2 = { x: 0, y: 0 }) =>
  applyMatrixToPoint(nodes.get(id)!.matrix, point);

const expectPoint = (actual: Vector2, expected: Vector2) => {
  expect(actual.x).toBeCloseTo(expected.x, 3);
  expect(actual.y).toBeCloseTo(expected.y, 3);
};

const stroked = new SpriteBuilder().setStroke("#000").setStrokeWidth(2).build();

describe("transforms", () => {
  it("rotates clockwise with y pointing up", () => {
    const nodes = byId(new NodeBuilder("root").setRotation(90).build());

    expectPoint(world(nodes, "root", { x: 0, y: 10 }), { x: 10, y: 0 });
  });

  it("carries a joint through its parent's rotation", () => {
    const child = new NodeBuilder("child").setJointPosition(0, 10).build();
    const nodes = byId(new NodeBuilder("root").setJointPosition(5, 5).setRotation(90).addJoints(child).build());

    expectPoint(world(nodes, "child"), { x: 15, y: 5 });
  });

  it("scales a joint's position but not its size", () => {
    const child = new NodeBuilder("child").setJointPosition(10, 10).build();
    const nodes = byId(new NodeBuilder("root").setScale(2, 3).addJoints(child).build());

    expectPoint(world(nodes, "child"), { x: 20, y: 30 });
    expectPoint(world(nodes, "child", { x: 1, y: 1 }), { x: 21, y: 31 });
  });

  it("scales an attachment's position and size", () => {
    const child = new NodeBuilder("child").setJointPosition(10, 10).build();
    const nodes = byId(new NodeBuilder("root").setScale(2, 3).addAttachments(child).build());

    expectPoint(world(nodes, "child"), { x: 20, y: 30 });
    expectPoint(world(nodes, "child", { x: 1, y: 1 }), { x: 22, y: 33 });
  });

  it("inverts a matrix transform", () => {
    const matrix = transformToMatrix({ translate: { x: 3, y: -4 }, scale: { x: 2, y: 0.5 }, rotate: 37 });
    const point = { x: 7, y: 11 };

    expectPoint(applyInverseMatrixToPoint(matrix, applyMatrixToPoint(matrix, point))!, point);
    const identity = combineMatrixTransforms(matrix, invertMatrixTransform(matrix)!);
    expectPoint(applyMatrixToPoint(identity, point), point);
  });
});

describe("hierarchy", () => {
  it("adds z-index to the parent's unless absolute", () => {
    const relative = new NodeBuilder("relative").setZIndex(2).build();
    const absolute = new NodeBuilder("absolute").setZIndex(2, "absolute").build();
    const nodes = byId(new NodeBuilder("root").setZIndex(10).addJoints(relative, absolute).build());

    expect(nodes.get("relative")!.zIndex).toBe(12);
    expect(nodes.get("absolute")!.zIndex).toBe(2);
  });

  it("makes joints articulated and forwards attachments to the nearest articulated ancestor", () => {
    const attachment = new NodeBuilder("attachment").build();
    const joint = new NodeBuilder("joint").addAttachments(attachment).build();
    const nodes = byId(new NodeBuilder("root").setArticulated(false).addJoints(joint).build());

    expect(nodes.get("joint")!.articulated).toBe(true);
    expect(nodes.get("attachment")!.articulated).toBe(false);
    expect(nodes.get("attachment")!.parent?.id).toBe("joint");
    expect(nodes.get("root")!.parent).toBeUndefined();
  });

  it("draws a separate outline node when setOutlineZIndex is used", () => {
    const nodes = byId(new NodeBuilder("root").setSprite(stroked).setZIndex(5, "absolute").setOutlineZIndex(1).build());

    expect(nodes.get("root_outline")!.zIndex).toBe(1);
    expect(nodes.get("root_outline")!.sprite.fill).toBe("none");
    expect(nodes.get("root")!.sprite.strokeWidth).toBe(0);
  });
});

describe("mask inheritance", () => {
  it("passes masks to descendants until stopped", () => {
    const grandchild = new NodeBuilder("grandchild").build();
    const child = new NodeBuilder("child").addJoints(grandchild).build();
    const stopped = new NodeBuilder("stopped").stopInheritedMasking().build();
    const nodes = byId(new NodeBuilder("root").addMaskedBy("m").inheritMaskingForChildren().addJoints(child, stopped).build());

    expect(nodes.get("child")!.clippedBy).toEqual(["m"]);
    expect(nodes.get("grandchild")!.clippedBy).toEqual(["m"]);
    expect(nodes.get("stopped")!.clippedBy).toEqual([]);
  });

  it("adds descendants to their ancestor's groups", () => {
    const child = new NodeBuilder("child").build();
    const nodes = byId(new NodeBuilder("root").addMaskGroup("m").addClippingGroup("c").inheritGroupsForChildren().addJoints(child).build());

    expect(nodes.get("child")!.clippingGroups).toEqual(["m"]);
    expect(nodes.get("child")!.trueClippingGroups).toEqual(["c"]);
  });
});

describe("constraints", () => {
  const target = new NodeBuilder("target").setJointPosition(30, 40).setRotation(45).build();

  it("aims a node's local down axis at the target", () => {
    const aimed = new NodeBuilder("aimed").setAimAt("target", { x: 0, y: 0 }).build();
    const nodes = byId(new NodeBuilder("root").addJoints(target, aimed).build());
    const tip = world(nodes, "aimed", { x: 0, y: -1 });

    expectPoint(tip, { x: 30 / 50, y: 40 / 50 });
  });

  it("stretches an aimed node to reach the target", () => {
    const aimed = new NodeBuilder("aimed").setAimAt("target", { x: 0, y: 0 }, undefined, true).build();
    const nodes = byId(new NodeBuilder("root").addJoints(target, aimed).build());

    expectPoint(world(nodes, "aimed", { x: 0, y: -1 }), { x: 30, y: 40 });
  });

  it("pins a joint to a point in the target's local space", () => {
    const pinned = new NodeBuilder("pinned").setPinTo("target", { x: 0, y: 10 }).build();
    const nodes = byId(new NodeBuilder("root").addJoints(target, pinned).build());

    expectPoint(world(nodes, "pinned"), world(nodes, "target", { x: 0, y: 10 }));
  });

  it("keeps a pin on a target under a different parent", () => {
    const parent = new NodeBuilder("parent").setJointPosition(-50, 7).setRotation(20).setScale(2, 2);
    const pinned = new NodeBuilder("pinned").setPinTo("target").build();
    const nodes = byId(new NodeBuilder("root").addJoints(target, parent.addJoints(pinned).build()).build());

    expectPoint(world(nodes, "pinned"), { x: 30, y: 40 });
  });
});
