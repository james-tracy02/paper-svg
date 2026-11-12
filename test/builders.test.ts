import { describe, expect, it } from "vitest";
import { getSprite, NodeBuilder, registerCustomSprite, SpriteBuilder, unregisterCustomSprite, type CustomSprite } from "../src";

const customSprite = (id: string, colors: number): CustomSprite => ({
  id,
  colors,
  strokeColors: 0,
  elements: [{ d: "M 0 0 L 1 1 Z", colorKey: "color0" }],
  translate: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
  rotate: 0,
});

describe("NodeBuilder", () => {
  it("returns a new builder from every call, so a base can be branched", () => {
    const base = new NodeBuilder("part").setJointPosition(1, 2);
    const moved = base.setJointPosition(10, 20);

    expect(base.build().translate).toEqual({ x: 1, y: 2 });
    expect(moved.build().translate).toEqual({ x: 11, y: 22 });
  });

  it("adds joint positions, multiplies scales and adds rotatesWith", () => {
    const node = new NodeBuilder("part")
      .setJointPosition(1, 2)
      .setJointPosition(3, 4)
      .setScale(2, 3)
      .scalesWith(2)
      .rotatesWith(10)
      .rotatesWith(5)
      .build();

    expect(node.translate).toEqual({ x: 4, y: 6 });
    expect(node.scale).toEqual({ x: 4, y: 6 });
    expect(node.rotate).toBe(15);
  });

  it("replaces the rotation on setRotation", () => {
    expect(new NodeBuilder("part").setRotation(10).setRotation(20).build().rotate).toBe(20);
  });

  it("names nodes by side", () => {
    const part = new NodeBuilder("part");

    expect(part.build().id).toBe("part");
    expect(part.build("a").id).toBe("part_a");
    expect(part.buildRight().id).toBe("part_right");
    expect(part.buildLeft().id).toBe("part_left");
    expect(part.buildSide("left", "a").id).toBe("part_a_left");
  });

  it("mirrors x, rotation and the sprite on the left side only", () => {
    const sprite = new SpriteBuilder().setOffset(5, 6).setScale(2, 3).build();
    const part = new NodeBuilder("part").setJointPosition(10, 20).setRotation(30).setSprite(sprite);

    const right = part.buildRight();
    expect(right.translate).toEqual({ x: 10, y: 20 });
    expect(right.rotate).toBe(30);

    const left = part.buildLeft();
    expect(left.translate).toEqual({ x: -10, y: 20 });
    expect(left.rotate).toBe(-30);
    expect(left.sprite.translate).toEqual({ x: -5, y: 6 });
    expect(left.sprite.scale).toEqual({ x: -2, y: 3 });
  });

  it("skips undefined children and group names", () => {
    const child = new NodeBuilder("child").build();
    const node = new NodeBuilder("part").addJoints(undefined, child).addAttachments(undefined).addMaskedBy(undefined, "", "m").build();

    expect(node.joints).toEqual([child]);
    expect(node.attachments).toEqual([]);
    expect(node.maskedBy).toEqual(["m"]);
  });
});

describe("SpriteBuilder", () => {
  it("assigns custom colors to numbered slots", () => {
    expect(new SpriteBuilder().setCustomColors("#111", "#222").build().colors).toEqual({ color0: "#111", color1: "#222" });
  });

  it("remaps a color to another slot", () => {
    expect(new SpriteBuilder().setCustomColors("#111").remapColor(0, 3).build().colors).toEqual({ color3: "#111" });
  });

  it("repeats the last color to fill every slot of a custom sprite", () => {
    const sprite = new SpriteBuilder().setCustomSprite(customSprite("three", 3)).setCustomColors("#111", "#222").build();

    expect(sprite.colors).toEqual({ color0: "#111", color1: "#222", color2: "#222" });
  });

  it("resolves a registered sprite id when setCustomSprite is called", () => {
    const sprite = customSprite("registered", 1);
    registerCustomSprite(sprite);
    const builder = new SpriteBuilder().setCustomSprite("registered");
    unregisterCustomSprite("registered");

    expect(getSprite("registered")).toBeUndefined();
    expect(builder.build().customSprite?.id).toBe("registered");
  });

  it("clamps blur to 5 and treats 0 as no blur", () => {
    expect(new SpriteBuilder().setBlur(9).build().blur).toBe(5);
    expect(new SpriteBuilder().setBlur(0).build().blur).toBeUndefined();
  });

  it("does not change the builder it branched from", () => {
    const base = new SpriteBuilder().setFill("#111");
    base.setFill("#222");

    expect(base.build().fill).toBe("#111");
  });
});
