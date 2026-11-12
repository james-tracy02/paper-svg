/**
 * Pins every field of every render node, as a hash per node, for trees that cover the engine's
 * transform features. The reference was recorded with getRenderNodes before it moved onto the pose
 * solver (pose.ts), so this proves the solver-based tree is the same, field for field.
 */
import { describe, expect, it } from "vitest";
import { getRenderNodes, NodeBuilder, SpriteBuilder, type Node, type RenderNode } from "../src";
import { upgradeFixture, type RigFixture } from "./fixtures/RigFixture";
import exported from "./fixtures/sooz.rig.json";

const sooz = upgradeFixture(exported as unknown as RigFixture).body;

const withRotations = (node: Node, rotations: Record<string, number>): Node => ({
  ...node,
  transform: { ...node.transform, rotate: node.transform.rotate + (rotations[node.id] ?? 0) },
  joints: node.joints?.map((child) => withRotations(child, rotations)),
  attachments: node.attachments?.map((child) => withRotations(child, rotations)),
});

/** A node's fields as JSON, with links to other nodes reduced to their ids (they form cycles). */
const fingerprint = async (node: RenderNode) => {
  const { parent, jointParent, linkedOutline, ...fields } = node;
  const json = JSON.stringify({ ...fields, parent: parent?.id, jointParent: jointParent?.id, linkedOutline: linkedOutline?.id });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(json));
  return Array.from(new Uint8Array(digest).subarray(0, 8), (byte) => byte.toString(16).padStart(2, "0")).join("");
};
const fingerprints = async (body: Node) => {
  const lines = await Promise.all(getRenderNodes(body).map(async (node) => `${node.id} ${await fingerprint(node)}`));
  return lines.join("\n") + "\n";
};

const part = (name: string) => new NodeBuilder(name).setSprite(new SpriteBuilder().setShape("rect").build());

describe("render nodes", () => {
  it("Sooz at rest", async () => {
    await expect(await fingerprints(sooz)).toMatchFileSnapshot("./__snapshots__/renderNodes.sooz.txt");
  });

  it("Sooz posed", async () => {
    const posed = withRotations(sooz, { forearm_right: 35, arm_left: -20, torso: 6, head: -10, leg_right: 12 });
    await expect(await fingerprints(posed)).toMatchFileSnapshot("./__snapshots__/renderNodes.sooz-posed.txt");
  });

  it("a pattern space inside another, continuing its grid", async () => {
    const tile = new SpriteBuilder().setShape("ellipse").setScale(0.2, 0.2).build();
    const patterned = new SpriteBuilder().setShape("rect").setPattern(tile).build();
    const body = part("root")
      .setPatternSpace({ rotation: 15, x: 3, y: -2 })
      .addJoints(
        new NodeBuilder("sleeve")
          .setSprite(patterned)
          .moveBy(20, -10)
          .setRotation(40)
          .setPatternSpace({ rotation: -5 })
          .addJoints(new NodeBuilder("cuff").setSprite(patterned).moveBy(0, -30).setRotation(25).build())
          .build(),
      )
      .build();
    await expect(await fingerprints(body)).toMatchFileSnapshot("./__snapshots__/renderNodes.nested-pattern-space.txt");
  });

  it("a constraint whose target sits in its own subtree", async () => {
    const body = part("root")
      .addJoints(
        part("arm")
          .setRotation(30)
          .setAimAt("tip", { x: 0, y: 0 })
          .addJoints(part("tip").moveBy(0, -40).build())
          .build(),
      )
      .build();
    await expect(await fingerprints(body)).toMatchFileSnapshot("./__snapshots__/renderNodes.subtree-target.txt");
  });
});
