import { describe, expect, it } from "vitest";
import { getRenderNodes, NodeBuilder, SpriteBuilder, type Node, type RenderGroupOptions, type RenderNode } from "../src";
import { planLayers, resolveVisibleNodes, type PaintItem } from "../src/render/layerPlan";

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

const SOFT = "mask:t_soft_group_no_outline";
const HARD = "clip:t_hard_clippath";

describe("resolveVisibleNodes", () => {
  it("drops nodes restricted to a mask or clip group nobody defines", () => {
    const body = root(
      part("kept", 1).build(),
      part("masked", 2).addMaskedBy("missing").build(),
      part("clipped", 3).addClippedBy("missing").build(),
    );

    expect(ids(resolveVisibleNodes(sorted(body)))).toEqual(["root", "kept"]);
  });

  it("hoists a stroked clip owner's outline just above its highest dependent, without changing the input", () => {
    const nodes = sorted(
      root(
        part("torso", 1, true).addClippingGroup("hard").build(),
        part("shirt", 5).addClippedBy("hard").build(),
        part("belt", 3).addClippedBy("hard").build(),
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
          part("skirt_outline", 1, true).addClippingGroup("hard").build(),
          part("dependent", 2).addClippedBy("hard").build(),
        ),
      ),
    );

    expect(ids(visible)).toEqual(["root", "skirt_outline", "dependent", "skirt_outline_outline"]);
    expect(visible.find((node) => node.id === "skirt_outline_outline")!.outlineOf).toBe("skirt_outline");
  });

  it("does not hoist an outline for an unstroked owner or one that opts out", () => {
    const visible = resolveVisibleNodes(
      sorted(
        root(
          part("plain", 1).addClippingGroup("a").build(),
          part("optedOut", 2, true).addClippingGroup("b").disableOutlineHoisting().build(),
          part("dependent", 3).addClippedBy("a", "b").build(),
        ),
      ),
    );

    expect(ids(visible)).toEqual(["root", "plain", "optedOut", "dependent"]);
  });
});

describe("planLayers paint order", () => {
  const skin = part("skin", 1).addMaskGroup("soft").build();
  const masked = (name: string, z: number) => part(name, z).addMaskedBy("soft").build();

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
      part("frame", 1).addClippingGroup("hard").build(),
      part("a", 2).addClippedBy("hard").setRenderGroup("g").build(),
      part("c", 2.5).build(),
      part("b", 3).addClippedBy("hard").setRenderGroup("g").build(),
    );
    const { items } = plan(body, { g: { clip: "hard", opacity: 2 } });

    expect(paintOrder(items)).toEqual(["frame", "c", { "group g": ["a", "b"] }]);
    const group = items.find((item) => item.kind === "renderGroup");
    expect(group?.kind === "renderGroup" && group.group).toEqual({
      id: "g",
      opacity: 1,
      maskId: undefined,
      clipId: "t_hard_clippath",
      blendMode: "normal",
    });
  });

  it("paints a mask outline after its clip owner's outline when that outline is at or above it", () => {
    const body = root(
      part("torso", 1, true).addClippingGroup("hard").build(),
      part("sleeve", 3).addClippedBy("hard").setMaskOutline(true).build(),
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
      part("torso", 1).addClippingGroup("hard").build(),
      part("sleeve", 3).addClippedBy("hard").setMaskOutline(true).build(),
    );

    expect(paintOrder(plan(body).items)).toEqual(["torso", { [HARD]: ["sleeve"] }, "mask outlines sleeve"]);
  });

  it("orders outer outlines with a run's standalone nodes before its fills", () => {
    const body = root(part("a", 1).build(), new NodeBuilder("empty").noSprite().setZIndex(2, "absolute").build());

    expect(ids(plan(body).outerOutlines)).toEqual(["root", "empty", "a"]);
  });
});

describe("planLayers defs", () => {
  it("builds only the mask variants visible nodes use", () => {
    const skin = part("skin", 1).addMaskGroup("soft").build();
    const plain = plan(root(skin, part("a", 2).addMaskedBy("soft").build())).defs;
    const outlined = plan(root(skin, part("a", 2).addMaskedBy("soft").setMaskOutline(true).build())).defs;

    expect(plain.maskFills.map(({ id, withFill, withNoOutline }) => ({ id, withFill, withNoOutline }))).toEqual([
      { id: "t_soft_group", withFill: false, withNoOutline: true },
    ]);
    expect(plain.maskOutlines).toEqual([]);
    expect(plain.clipOutlines).toEqual([]);
    expect(plain.clipFills).toEqual([]);
    expect(outlined.maskFills[0]).toMatchObject({ withFill: true, withNoOutline: false });
    expect(ids(outlined.maskOutlines[0].nodes)).toEqual(["skin"]);
  });

  it("draws mask groups from the original nodes, not the hoisted copies", () => {
    const { nodes, defs } = plan(
      root(
        part("torso", 1, true).addClippingGroup("hard").addMaskGroup("soft").build(),
        part("shirt", 2).addClippedBy("hard").addMaskedBy("soft").build(),
      ),
    );

    expect(defs.maskFills[0].nodes[0]).toBe(nodes.find((node) => node.id === "torso"));
    expect(defs.maskFills[0].nodes[0].sprite.strokeWidth).toBe(2);
  });
});
