import { describe, expect, it } from "vitest";
import { getRenderNodes, NodeBuilder, SpriteBuilder, type CustomSprite, type Node, type Pose, type RenderNode } from "../src";
import { bakePose, createRig, solvePose } from "../src/render/pose";
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
      part("arm").moveBy(10, 0).buildSide(side),
      follow(part("pad").moveBy(8, -2).addJoints(part("strap").moveBy(0, 6).build())).buildSide(side),
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
      (pad) => pad.rotateBy(o.rotate).moveBy(o.x, 0).moveBy(0, o.y).scaleBy(o.scaleX, 1).skewBy(o.skewX),
      side,
    );

    const nodes = getRenderNodes(driven, pose);
    expect(placement(nodes)).toEqual(placement(getRenderNodes(baked, pose)));
    // The driver really moved something: at rest the pad sits elsewhere.
    expect(placement(nodes)[`pad_${side}`]).not.toEqual(placement(getRenderNodes(driven))[`pad_${side}`]);
  });

  it("scale a joint's children through the driven scale, as a baked scale does", () => {
    const build = (pad: NodeBuilder) => part("torso").addJoints(pad.addJoints(part("strap").moveBy(0, 6).build()).build()).build();
    const driven = build(part("pad").addDriver((p) => ({ scaleY: 1 + (p.rotations?.arm ?? 0) / 50 })));
    const baked = build(part("pad").scaleBy(1, 1.6));
    const pose: Pose = { rotations: { arm: 30 } };
    expect(placement(getRenderNodes(driven, pose))).toEqual(placement(getRenderNodes(baked, pose)));
  });

  it("follow named values, which move nothing without a driver", () => {
    // An eye that opens with `eyeOpen` (fully open when the pose leaves it out), next to a node that shares its name.
    const face = (eye: NodeBuilder) => part("head").addJoints(eye.moveBy(4, 2).build(), part("eyeOpen").build()).build();
    const driven = face(part("eye").addDriver((p) => ({ scaleY: p.values?.eyeOpen ?? 1 })));
    const pose: Pose = { values: { eyeOpen: 0.25 } };

    expect(placement(getRenderNodes(driven, pose))).toEqual(placement(getRenderNodes(face(part("eye").scaleBy(1, 0.25)))));
    expect(placement(getRenderNodes(driven))).toEqual(placement(getRenderNodes(face(part("eye")))));
  });

  it("stack, each applying on top of the others", () => {
    const arm = (p: Pose) => p.rotations?.arm ?? 0;
    const driven = part("root")
      .addDriver((p) => ({ rotate: arm(p), scaleX: 2 }))
      .addDriver((p) => ({ rotate: arm(p) / 2, scaleX: 1.5 }))
      .build();
    const baked = part("root").rotateBy(30 + 15).scaleBy(3, 1).build();
    expect(placement(getRenderNodes(driven, { rotations: { arm: 30 } }))).toEqual(placement(getRenderNodes(baked)));
  });

  describe("draw order", () => {
    // A forearm that steps in front of the torso past 150°, with a cuff placed relative to it and its own outline.
    const forearm = (z: (p: Pose) => number) =>
      part("torso")
        .setZIndex(100)
        .addJoints(
          new NodeBuilder("forearm")
            .setSprite(new SpriteBuilder().setShape("rect").setStroke("black").setStrokeWidth(1).build())
            .setZIndex(-20)
            .setOutlineZIndex(70)
            .addDriver((p) => ({ zIndex: z(p), outlineZIndex: z(p) }))
            .addJoints(part("cuff").setZIndex(1).build())
            .build(),
        )
        .build();
    const raised = (p: Pose) => ((p.rotations?.forearm ?? 0) > 150 ? 400 : 0);
    const zIndices = (nodes: RenderNode[]) => Object.fromEntries(nodes.map((n) => [n.id, n.zIndex]));

    it("adds to the node's z-index, carrying relative children and its outline along", () => {
      const pose: Pose = { rotations: { forearm: 160 } };
      const baked = part("torso")
        .setZIndex(100)
        .addJoints(
          new NodeBuilder("forearm")
            .setSprite(new SpriteBuilder().setShape("rect").setStroke("black").setStrokeWidth(1).build())
            .setZIndex(380)
            .setOutlineZIndex(470)
            .addJoints(part("cuff").setZIndex(1).build())
            .build(),
        )
        .build();
      expect(zIndices(getRenderNodes(forearm(raised), pose))).toEqual(zIndices(getRenderNodes(baked, pose)));
      expect(zIndices(getRenderNodes(forearm(raised), pose))).toEqual({ torso: 100, forearm: 480, forearm_outline: 470, cuff: 481 });
    });

    it("gives poses in one band the same draw order, so only a band change re-plans", () => {
      const rig = createRig(forearm(raised));
      const key = (rotation: number) => solvePose(rig, { rotations: { forearm: rotation } }).zKey;
      expect(key(10)).toEqual(key(140));
      expect(key(160)).toEqual(key(170));
      expect(key(160)).not.toEqual(key(140));
    });
  });

  describe("shape", () => {
    const tile = (d: string): CustomSprite => ({
      id: `tile_${d.length}`,
      colors: 1,
      strokeColors: 1,
      elements: [{ d, colorKey: "color0" }],
      translate: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotate: 0,
    });
    const hemPath = (tilt: number) => `M 0 0 L 10 ${5 + tilt * 3} L -10 5 Z`;
    const sprite = new SpriteBuilder().setFill("#ff0000").setStroke("black").setStrokeWidth(1);

    it("draws the path a driver gives, as `setPath` with that path would", () => {
      const pose: Pose = { values: { tilt: 0.5 } };
      const driven = part("root").addJoints(new NodeBuilder("hem").setSprite(sprite.setPath(hemPath(0)).build()).addDriver((p) => ({ path: hemPath(p.values?.tilt ?? 0) })).build()).build();
      const baked = part("root").addJoints(new NodeBuilder("hem").setSprite(sprite.setPath(hemPath(0.5)).build()).build()).build();
      const sprites = (body: Node, p?: Pose) => getRenderNodes(body, p).map((n) => n.sprite);
      expect(sprites(driven, pose)).toEqual(sprites(baked));
      expect(sprites(driven)).not.toEqual(sprites(baked));
    });

    it("swaps in the custom sprite a driver gives, keeping the node's colors and stroke", () => {
      const open = tile("M 0 0 L 4 0 L 4 4 Z");
      const closed = tile("M 0 0 L 4 0 Z");
      const driven = new NodeBuilder("eye")
        .setSprite(sprite.setCustomSprite(open).build())
        .setOutlineZIndex(5)
        .addDriver((p) => ({ customSprite: (p.values?.eyeOpen ?? 1) < 0.2 ? closed : undefined }))
        .build();
      const baked = new NodeBuilder("eye").setSprite(sprite.setCustomSprite(closed).build()).setOutlineZIndex(5).build();
      const pose: Pose = { values: { eyeOpen: 0.1 } };
      const fieldsOf = (nodes: RenderNode[]) => nodes.map(({ parent, jointParent, linkedOutline, ...rest }) => rest);
      expect(fieldsOf(getRenderNodes(driven, pose))).toEqual(fieldsOf(getRenderNodes(baked)));
      expect(getRenderNodes(driven).map((n) => n.sprite.customSprite)).toEqual([open, open]);
    });
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

  describe("masks", () => {
    const mask = (y: number) => new SpriteBuilder().setShape("rect").setScale(2, y).setOffset(3, -4).build();
    const narrow = mask(0.5);
    const wide = mask(1.5);
    // Stands in for project-k's forearm mask: shaped by the forearm's angle in a range, none outside it.
    const forArm = (r: number) => (r < 15 ? null : r < 60 ? narrow : wide);
    const forearm = (configure: (b: NodeBuilder) => NodeBuilder, side: "left" | "right") =>
      part("torso")
        .addJoints(configure(part("forearm").setOutlineZIndex(5).moveBy(10, 0)).buildSide(side))
        .build();
    const masks = (nodes: RenderNode[]) => Object.fromEntries(nodes.map((n) => [n.id, n.mask]));

    it.each(["right", "left"] as const)("replace the node's own, as setMask would (%s side)", (side) => {
      const driven = forearm((b) => b.setCut(narrow).addDriver((p) => ({ mask: forArm(p.rotations?.angle ?? 0) })), side);
      for (const angle of [0, 30, 90]) {
        const baked = forearm((b) => b.setCut(forArm(angle) ?? undefined), side);
        expect(masks(getRenderNodes(driven, { rotations: { angle } }))).toEqual(masks(getRenderNodes(baked)));
      }
    });

    it("keep their identity across poses that leave them alike, outline copies included", () => {
      const driven = forearm((b) => b.addDriver((p) => ({ mask: forArm(p.rotations?.angle ?? 0) })), "left");
      const rig = createRig(driven);
      const at = (angle: number) => {
        const nodes = flattenRenderTree(buildRenderTreeFromPose(rig, solvePose(rig, { rotations: { angle } })));
        return [nodes.find((n) => n.id === "forearm_left")!.mask, nodes.find((n) => n.id === "forearm_left_outline")!.mask];
      };
      const [fill, outline] = at(20);
      expect(fill).toBeDefined();
      expect(at(40)).toEqual([fill, outline]);
      expect(at(40)[0]).toBe(fill);
      expect(at(40)[1]).toBe(outline);
      expect(outline!.scale.y).toBeCloseTo(fill!.scale.y * 0.999);
      expect(at(5)).toEqual([undefined, undefined]);
    });
  });

  it("bake into a plain tree that draws what the pose draws", () => {
    const narrow = new SpriteBuilder().setShape("rect").setScale(2, 0.5).build();
    const arm = (side: "left" | "right") =>
      part("arm")
        .moveBy(10, 0)
        .setOutlineZIndex(3)
        .addDriver((p) => ({ zIndex: (p.rotations?.[`arm_${side}`] ?? 0) > 90 ? 50 : 0, outlineZIndex: 2 }))
        .addJoints(
          part("forearm")
            .addDriver((p) => ({ mask: (p.rotations?.[`arm_${side}`] ?? 0) > 30 ? narrow : null, rotate: 5, scaleY: 1.2 }))
            .addJoints(part("hand").build())
            .build(),
        )
        .addAttachments(
          part("pad")
            .addDriver((p) => ({ visible: (p.rotations?.[`arm_${side}`] ?? 0) < 60 }))
            .addJoints(part("strap").build())
            .build(),
          part("hem")
            .setSprite(new SpriteBuilder().setPath("M 0 0 L 1 1 Z").build())
            .addDriver((p) => ({ path: `M 0 0 L ${p.rotations?.[`arm_${side}`] ?? 0} 1 Z`, skewX: 4 }))
            .build(),
        )
        .buildSide(side);
    const body = part("torso").addJoints(arm("right"), arm("left")).build();
    const drawn = (nodes: RenderNode[]) =>
      Object.fromEntries(
        nodes
          .filter((n) => !n.noSprite && !n.hidden)
          .map((n) => [n.id, { matrix: n.matrix, zIndex: n.zIndex, mask: n.mask, path: n.sprite.dynamicPath }]),
      );
    for (const pose of [{}, { rotations: { arm_right: 120, arm_left: -40 } }, { rotations: { arm_right: 45, arm_left: 100 } }]) {
      const posed = getRenderNodes(body, pose);
      const baked = bakePose(body, pose);
      expect(JSON.stringify(baked)).not.toContain("evaluate");
      expect(drawn(getRenderNodes(baked))).toEqual(drawn(posed));
      expect(Object.keys(drawn(posed)).length).toBeGreaterThan(5);
    }
  });

  it("leave a tree without drivers exactly as it was", () => {
    const body: Node = shoulder((pad) => pad, "right");
    expect(getRenderNodes(body).some((n) => n.hidden !== undefined)).toBe(false);
  });
});
