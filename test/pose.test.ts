import { describe, expect, it } from "vitest";
import { applyMatrixToPoint, getRenderNodes, NodeBuilder, SpriteBuilder, type Node, type RenderNode } from "../src";
import type { Pose } from "../src";
import { createRig, solvePose } from "../src/render/pose";
import { buildRenderTreeFromPose, flattenRenderTree } from "../src/render/RenderTree";
import { planLayers, resolveVisibleNodes } from "../src/render/layerPlan";
import { upgradeFixture, type RigFixture } from "./fixtures/RigFixture";
import exported from "./fixtures/sooz.rig.json";

const sooz = upgradeFixture(exported as unknown as RigFixture).body;

/** The tree with each posed node's rotation added, as a rebuild with those rotations would make it. */
const withRotations = (node: Node, pose: Pose): Node => ({
  ...node,
  transform: { ...node.transform, rotate: node.transform.rotate + (pose.rotations?.[node.id] ?? 0) },
  joints: node.joints?.map((child) => withRotations(child, pose)),
  attachments: node.attachments?.map((child) => withRotations(child, pose)),
});

/** Asserts a pose gives every node exactly the matrices a rebuild with those rotations gives it. */
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
  it("poses Sooz the same as rebuilding her with the rotations, constraints included", () => {
    expectSameAsRenderNodes(sooz, { rotations: { forearm_right: 35, arm_left: -20, torso: 6, head: -10 } });
  });

  it("adds a pose's rotation to the node's own", () => {
    const body = part("root").addJoints(part("arm").moveBy(10, 0).setRotation(20).build()).build();
    const rig = createRig(body);
    const turned = solvePose(rig, { rotations: { arm: 70 } }).matrices[rig.indexById.get("arm")!];

    const nodes = byId(getRenderNodes(withRotations(body, { rotations: { arm: 70 } })));
    expect(turned).toEqual(nodes.get("arm")!.matrix);
    expect(nodes.get("arm")!.matrix).not.toEqual(byId(getRenderNodes(body)).get("arm")!.matrix);
  });

  it("moves and scales the nodes a pose names, as writing it into the built nodes would", () => {
    // Pose values apply as given, after mirroring, so the left side gets the same numbers unmirrored.
    const body = part("root")
      .addJoints(
        ...(["left", "right"] as const).map((side) =>
          part("arm").moveBy(10, 0).setRotation(15).addJoints(part("hand").moveBy(0, 20).build()).buildSide(side),
        ),
      )
      .build();
    const pose: Pose = {
      translations: { arm_left: { x: 3, y: -2 }, arm_right: { x: 3, y: -2 } },
      scales: { arm_left: { x: 1.5, y: 0.5 }, root: { x: 2, y: 2 } },
    };
    const written = (node: Node): Node => {
      const t = pose.translations?.[node.id];
      const k = pose.scales?.[node.id];
      return {
        ...node,
        transform: {
          ...node.transform,
          translate: { x: node.transform.translate.x + (t?.x ?? 0), y: node.transform.translate.y + (t?.y ?? 0) },
          scale: { x: node.transform.scale.x * (k?.x ?? 1), y: node.transform.scale.y * (k?.y ?? 1) },
        },
        joints: node.joints?.map(written),
      };
    };
    const placement = (nodes: RenderNode[]) =>
      nodes.map((n) => ({ id: n.id, matrix: n.matrix, parentMatrix: n.parentMatrix, translateScale: n.translateScale }));

    expect(placement(getRenderNodes(body, pose))).toEqual(placement(getRenderNodes(written(body))));
    expect(placement(getRenderNodes(body, pose))).not.toEqual(placement(getRenderNodes(body)));
  });

  it("solves a constraint's target first, so a constrained target is seen where it ends up", () => {
    // `pinned` is pinned onto `anchor`; `pointer` aims at `pinned`. Before the solver, targets were read from
    // a pass without constraints, so `pointer` aimed at where `pinned` was before its pin.
    const body = part("root")
      .addJoints(
        part("pointer").setAimAt("pinned", { x: 0, y: 0 }).build(),
        part("anchor").moveBy(50, 0).build(),
        part("pinned").moveBy(0, 80).setPinTo("anchor").build(),
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
  });

  it("plans the same layers for every pose, so a rig is planned once", () => {
    const rig = createRig(sooz);
    /** The plan with each render node reduced to its id: what is drawn where, not where it sits. */
    const planShape = (pose: Pose) => {
      const nodes = flattenRenderTree(buildRenderTreeFromPose(rig, solvePose(rig, pose))).sort((a, b) => a.zIndex - b.zIndex);
      const visibleNodes = resolveVisibleNodes(nodes);
      const plan = planLayers({ nodes, visibleNodes, getRenderGroupOptions: () => undefined, scopeId: (s) => s });
      const forms = [...plan.defs.forms];
      return JSON.stringify({ ...plan, defs: { ...plan.defs, forms } }, (_key, value) =>
        value && typeof value === "object" && "matrix" in value && "zIndex" in value ? (value as RenderNode).id : value,
      );
    };

    const atRest = planShape({});
    expect(atRest.match(/"fill_/g)?.length).toBeGreaterThan(200);
    expect(atRest).toContain('"forearm_right"');
    expect(planShape({ rotations: { forearm_right: 35, arm_left: -20, torso: 6 } })).toEqual(atRest);
  });
});
