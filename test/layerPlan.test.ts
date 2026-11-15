import { describe, expect, it } from "vitest";
import { getRenderNodes, NodeBuilder, SpriteBuilder, type Node, type RenderGroupOptions, type RenderNode } from "../src";
import { planLayers, resolveVisibleNodes, type PaintItem } from "../src/render/layerPlan";
import { maskOutlineRuns } from "../src/render/fillWrappers";

const scopeId = (suffix: string) => `t_${suffix}`;
const sorted = (body: Node) => [...getRenderNodes(body)].sort((a, b) => a.zIndex - b.zIndex);

const plan = (body: Node, groupOptions: Record<string, RenderGroupOptions> = {}) => {
  const nodes = sorted(body);
  const visibleNodes = resolveVisibleNodes(nodes);
  return { nodes, visibleNodes, ...planLayers({ nodes, visibleNodes, getRenderGroupOptions: (id) => groupOptions[id], scopeId }) };
};

/** Paint items as ids and nested `{ wrapper: [...] }` objects, leaving out the empty root. */
const paintOrder = (items: PaintItem[]): unknown[] =>
  items
    .filter((item) => !(item.kind === "standalone" && item.node.id === "root"))
    .map((item) => {
      switch (item.kind) {
        case "fill":
          return item.node.id;
        case "standalone":
          return `standalone ${item.node.id}`;
        case "maskOutlines":
          return `mask outlines ${item.nodes.map((node) => node.id).join(", ")}`;
        case "wrap":
          return { [item.wrapper]: paintOrder(item.items) };
        case "renderGroup":
          return { [`group ${item.group.id}`]: paintOrder(item.items) };
      }
    });

const ids = (nodes: RenderNode[]) => nodes.map((node) => node.id);

const sprite = (stroked = false) =>
  new SpriteBuilder()
    .setShape("rect")
    .setFill("#abcdef")
    .setStroke("#000")
    .setStrokeWidth(stroked ? 2 : 0)
    .build();
const part = (name: string, z: number, stroked = false) =>
  new NodeBuilder(name).setSprite(sprite(stroked)).setZIndex(z, "absolute");
const root = (...children: Node[]) => new NodeBuilder("root").noSprite().addJoints(...children).build();

const SOFT = "mask:t_soft_region_inset";
const HARD = "clip:t_hard_region";

describe("resolveVisibleNodes", () => {
  it("drops nodes restricted to a mask or clip group nobody defines", () => {
    const body = root(
      part("kept", 1).build(),
      part("masked", 2).maskedBy("missing").build(),
      part("clipped", 3).clippedBy("missing").build(),
    );

    expect(ids(resolveVisibleNodes(sorted(body)))).toEqual(["root", "kept"]);
  });

  it("hoists a stroked clip owner's outline just above its highest dependent, without changing the input", () => {
    const nodes = sorted(
      root(
        part("torso", 1, true).addToRegion("hard").build(),
        part("shirt", 5).clippedBy("hard").build(),
        part("belt", 3).clippedBy("hard").build(),
      ),
    );
    const visible = resolveVisibleNodes(nodes);
    const byId = new Map(visible.map((node) => [node.id, node]));

    expect(ids(visible)).toEqual(["root", "torso", "belt", "shirt", "torso_outline"]);
    expect(byId.get("torso_outline")!.zIndex).toBeCloseTo(5);
    expect(byId.get("torso_outline")!.zIndex).toBeGreaterThan(5);
    expect(byId.get("torso")!.sprite.strokeWidth).toBe(0);
    expect(nodes.find((node) => node.id === "torso")!.sprite.strokeWidth).toBe(2);
  });

  it("treats a node named like an outline as an ordinary node", () => {
    const visible = resolveVisibleNodes(
      sorted(
        root(
          part("skirt_outline", 1, true).addToRegion("hard").build(),
          part("dependent", 2).clippedBy("hard").build(),
        ),
      ),
    );

    expect(ids(visible)).toEqual(["root", "skirt_outline", "dependent", "skirt_outline_outline"]);
    expect(visible.find((node) => node.id === "skirt_outline_outline")!.outlineOf).toBe("skirt_outline");
  });

  it("hoists outlines only for a region of one drawn member, unless a member says otherwise", () => {
    const visibleIds = (...members: Node[]) =>
      ids(resolveVisibleNodes(sorted(root(...members, part("dependent", 5).clippedBy("r").build()))));
    const member = (name: string, z: number, hoist?: boolean) =>
      part(name, z, true).addToRegion("r", hoist === undefined ? {} : { hoist }).build();

    expect(visibleIds(member("only", 1))).toEqual(["root", "only", "dependent", "only_outline"]);
    expect(visibleIds(member("a", 1), member("b", 2))).toEqual(["root", "a", "b", "dependent"]);
    expect(visibleIds(member("a", 1, true), member("b", 2))).toEqual(["root", "a", "b", "dependent", "a_outline"]);
    expect(visibleIds(member("only", 1, false))).toEqual(["root", "only", "dependent"]);
    // An empty member doesn't count: the region is still one shape.
    const empty = new NodeBuilder("empty").noSprite().addToRegion("r").build();
    expect(visibleIds(member("only", 1), empty)).toEqual(["root", "empty", "only", "dependent", "only_outline"]);
  });

  it("does not hoist an outline for an unstroked owner, or for a region that only masks", () => {
    const visible = resolveVisibleNodes(
      sorted(
        root(
          part("plain", 1).addToRegion("a").build(),
          part("masking", 2, true).addToRegion("b").build(),
          part("dependent", 3).clippedBy("a").maskedBy("b").build(),
        ),
      ),
    );

    expect(ids(visible)).toEqual(["root", "plain", "masking", "dependent"]);
  });
});

describe("planLayers paint order", () => {
  // Stroked below the nodes it masks, so the mask cuts out its outline band and stays a <mask>.
  const skin = part("skin", 1, true).addToRegion("soft").build();
  const masked = (name: string, z: number) => part(name, z).maskedBy("soft").build();

  it("wraps neighbouring fills that share a mask once", () => {
    expect(paintOrder(plan(root(skin, masked("a", 2), masked("b", 3))).items)).toEqual(["skin", { [SOFT]: ["a", "b"] }]);
  });

  it("splits the run at a fill without that mask", () => {
    const body = root(skin, masked("a", 2), part("c", 2.5).build(), masked("b", 3));

    expect(paintOrder(plan(body).items)).toEqual(["skin", { [SOFT]: ["a"] }, "c", { [SOFT]: ["b"] }]);
  });

  it("lets an empty node sit inside a run", () => {
    const body = root(skin, masked("a", 2), new NodeBuilder("empty").noSprite().setZIndex(2.5, "absolute").build(), masked("b", 3));

    expect(paintOrder(plan(body).items)).toEqual(["skin", { [SOFT]: ["a", "standalone empty", "b"] }]);
  });

  it("paints a blend-mode node on its own, splitting the run", () => {
    const body = root(skin, masked("a", 2), part("glow", 2.5).setBlendMode("multiply").build(), masked("b", 3));

    expect(paintOrder(plan(body).items)).toEqual(["skin", { [SOFT]: ["a"] }, "standalone glow", { [SOFT]: ["b"] }]);
  });

  it("paints a render group where its last member is, without the wrappers the group applies itself", () => {
    const body = root(
      part("frame", 1).addToRegion("hard").build(),
      part("a", 2).clippedBy("hard").setRenderGroup("g").build(),
      part("c", 2.5).build(),
      part("b", 3).clippedBy("hard").setRenderGroup("g").build(),
    );
    const { items } = plan(body, { g: { clip: "hard", opacity: 2 } });

    expect(paintOrder(items)).toEqual(["frame", "c", { "group g": ["a", "b"] }]);
    const group = items.find((item) => item.kind === "renderGroup");
    expect(group?.kind === "renderGroup" && group.group).toEqual({
      id: "g",
      opacity: 1,
      wrappers: ["clip:t_hard_region"],
      blendMode: "normal",
    });
  });

  it("paints a mask outline after its clip owner's outline when that outline is at or above it", () => {
    const body = root(
      part("torso", 1, true).addToRegion("hard").build(),
      part("sleeve", 3).clippedBy("hard").traceOutline(true).build(),
    );

    expect(paintOrder(plan(body).items)).toEqual([
      "torso",
      { [HARD]: ["sleeve"] },
      "torso_outline",
      "mask outlines sleeve",
    ]);
  });

  it("paints a mask outline after its own fill when the owner has no outline above it", () => {
    const body = root(
      part("torso", 1).addToRegion("hard").build(),
      part("sleeve", 3).clippedBy("hard").traceOutline(true).build(),
    );

    expect(paintOrder(plan(body).items)).toEqual(["torso", { [HARD]: ["sleeve"] }, "mask outlines sleeve"]);
  });

  it("runs traced outlines painted back to back under their shared outline mask once", () => {
    // Anchored together after the torso's hoisted outline, which paints above all of them.
    const body = root(
      part("torso", 1, true).addToRegion("hard").build(),
      part("top", 3).clippedBy("hard").traceOutline(true).build(),
      part("strap", 3).clippedBy("hard").traceOutline(true).build(),
      part("glow", 3).clippedBy("hard").traceOutline(true).setBlendMode("multiply").build(),
      part("band", 3).clippedBy("hard").traceOutline(true).build(),
    );
    const { items, defs } = plan(body);
    const outlines = items.find((item) => item.kind === "maskOutlines");
    const runs = outlines?.kind === "maskOutlines" ? maskOutlineRuns(outlines.nodes, defs.forms) : [];

    // A blend-mode outline is masked on its own, and splits the run.
    expect(runs.map((run) => ({ masks: run.masks, ids: ids(run.nodes) }))).toEqual([
      { masks: ["t_hard_region_outline"], ids: ["top", "strap"] },
      { masks: ["t_hard_region_outline"], ids: ["glow"] },
      { masks: ["t_hard_region_outline"], ids: ["band"] },
    ]);
  });

  it("traces a region's outline once for a node whose stroke is its own outline node", () => {
    const body = root(
      part("torso", 1).addToRegion("hard").build(),
      part("strap", 3, true).setOutlineZIndex(2).clippedBy("hard").traceOutline(true).build(),
    );

    expect(paintOrder(plan(body).items)).toEqual([
      "torso",
      { [HARD]: ["strap_outline", "strap"] },
      "mask outlines strap",
    ]);
  });

  it("orders outer outlines with a run's standalone nodes before its fills", () => {
    const body = root(part("a", 1).build(), new NodeBuilder("empty").noSprite().setZIndex(2, "absolute").build());

    expect(ids(plan(body).outerOutlines)).toEqual(["root", "empty", "a"]);
  });
});

describe("planLayers defs", () => {
  /** The definitions drawn for each region in use, and the ids of all clip-paths and masks. */
  const defsOf = (body: Node) => {
    const { defs } = plan(body);
    return {
      forms: Object.fromEntries([...defs.forms]),
      clips: defs.clips.map((def) => def.id),
      masks: defs.masks.map((def) => def.id),
    };
  };
  const skin = () => part("skin", 1, true).addToRegion("r").build();

  it("draws a region as a clip-path for clippedBy, whatever its members' outlines", () => {
    expect(defsOf(root(skin(), part("a", 2).clippedBy("r").build()))).toEqual({
      forms: { r: { clipId: "t_r_region" } },
      clips: ["t_r_region"],
      masks: [],
    });
  });

  it("draws a region as an inset mask for maskedBy", () => {
    expect(defsOf(root(skin(), part("a", 2).maskedBy("r").build()))).toEqual({
      forms: { r: { maskId: "t_r_region_inset" } },
      clips: [],
      masks: ["t_r_region_inset"],
    });
  });

  it("draws both when one region is clipped by one node and masked by another", () => {
    expect(defsOf(root(skin(), part("a", 2).clippedBy("r").build(), part("b", 3).maskedBy("r").build())).forms).toEqual({
      r: { clipId: "t_r_region", maskId: "t_r_region_inset" },
    });
  });

  it("cuts a node tracing its outline by the full shape, and its outline by the outline ring", () => {
    expect(defsOf(root(skin(), part("a", 2).clippedBy("r").traceOutline(true).build()))).toEqual({
      forms: { r: { clipId: "t_r_region", outlineMaskId: "t_r_region_outline" } },
      clips: ["t_r_region"],
      masks: ["t_r_region_outline"],
    });
    expect(defsOf(root(skin(), part("a", 2).maskedBy("r").traceOutline(true).build())).forms).toEqual({
      r: { fullMaskId: "t_r_region", outlineMaskId: "t_r_region_outline" },
    });
  });

  it("masks a clipped region it can't draw as a clip-path, rather than drawing it wrong", () => {
    const cut = part("cut", 2).addToRegion("r", { subtract: true }).build();
    const { defs, items } = plan(root(skin(), cut, part("a", 5).clippedBy("r").build()));

    expect(Object.fromEntries([...defs.forms])).toEqual({ r: { fullMaskId: "t_r_region" } });
    expect(paintOrder(items)).toContainEqual({ "mask:t_r_region": ["a"] });
  });

  it("draws regions from the original nodes, not the hoisted copies", () => {
    const { nodes, defs } = plan(
      root(part("torso", 1, true).addToRegion("hard").addToRegion("soft").build(), part("shirt", 2).clippedBy("hard").maskedBy("soft").build()),
    );
    const soft = defs.masks.find((def) => def.region === "soft")!;

    expect(soft.nodes[0]).toBe(nodes.find((node) => node.id === "torso"));
    expect(soft.nodes[0].sprite.strokeWidth).toBe(2);
  });

  it("hoists a member's outline above the nodes a region clips, but not the nodes it masks", () => {
    const clipped = plan(root(part("owner", 1, true).addToRegion("r").build(), part("cut", 5).clippedBy("r").build()));
    const masked = plan(root(part("owner", 1, true).addToRegion("r").build(), part("cut", 5).maskedBy("r").build()));

    expect(ids(clipped.visibleNodes)).toEqual(["root", "owner", "cut", "owner_outline"]);
    expect(ids(masked.visibleNodes)).toEqual(["root", "owner", "cut"]);
  });

  it("applies a render group's clip as the clip-path and its mask as the inset mask", () => {
    const { items } = plan(
      root(skin(), part("a", 2).setRenderGroup("g").build(), part("b", 3).setRenderGroup("h").build()),
      { g: { clip: "r" }, h: { mask: "r" } },
    );
    const groups = items.filter((item) => item.kind === "renderGroup");

    expect(groups.map((item) => item.kind === "renderGroup" && item.group.wrappers)).toEqual([["clip:t_r_region"], ["mask:t_r_region_inset"]]);
  });
});
