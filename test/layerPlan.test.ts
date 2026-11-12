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

const SOFT = "mask:t_soft_region_inset";
const HARD = "clip:t_hard_region";

describe("resolveVisibleNodes", () => {
  it("drops nodes restricted to a mask or clip group nobody defines", () => {
    const body = root(
      part("kept", 1).build(),
      part("masked", 2).cutBy("missing").build(),
      part("clipped", 3).cutBy("missing").build(),
    );

    expect(ids(resolveVisibleNodes(sorted(body)))).toEqual(["root", "kept"]);
  });

  it("hoists a stroked clip owner's outline just above its highest dependent, without changing the input", () => {
    const nodes = sorted(
      root(
        part("torso", 1, true).addToRegion("hard").build(),
        part("shirt", 5).cutBy("hard").build(),
        part("belt", 3).cutBy("hard").build(),
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
          part("dependent", 2).cutBy("hard").build(),
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
          part("plain", 1).addToRegion("a").build(),
          part("optedOut", 2, true).addToRegion("b").insetOutlines().build(),
          part("dependent", 3).cutBy(["a", "b"]).build(),
        ),
      ),
    );

    expect(ids(visible)).toEqual(["root", "plain", "optedOut", "dependent"]);
  });
});

describe("planLayers paint order", () => {
  // Stroked below the nodes it masks, so the mask cuts out its outline band and stays a <mask>.
  const skin = part("skin", 1, true).addToRegion("soft", { inset: true }).build();
  const masked = (name: string, z: number) => part(name, z).cutBy("soft").build();

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
      part("a", 2).cutBy("hard").setRenderGroup("g").build(),
      part("c", 2.5).build(),
      part("b", 3).cutBy("hard").setRenderGroup("g").build(),
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
      part("sleeve", 3).cutBy("hard").traceOutline(true).build(),
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
      part("sleeve", 3).cutBy("hard").traceOutline(true).build(),
    );

    expect(paintOrder(plan(body).items)).toEqual(["torso", { [HARD]: ["sleeve"] }, "mask outlines sleeve"]);
  });

  it("orders outer outlines with a run's standalone nodes before its fills", () => {
    const body = root(part("a", 1).build(), new NodeBuilder("empty").noSprite().setZIndex(2, "absolute").build());

    expect(ids(plan(body).outerOutlines)).toEqual(["root", "empty", "a"]);
  });
});

describe("planLayers defs", () => {
  /** Each region shape in use: its form, and the definitions drawn for it. */
  const shapes = (body: Node) => {
    const { defs } = plan(body);
    return {
      forms: Object.fromEntries(
        [...defs.forms].map(([name, form]) => [
          name,
          {
            full: form.full && { clip: form.full.clipId, mask: form.full.maskId },
            inset: form.inset && { clip: form.inset.clipId, mask: form.inset.maskId },
            outline: form.outlineMaskId,
          },
        ]),
      ),
      clips: defs.clips.map((def) => def.id),
      masks: defs.masks.map((def) => def.id),
    };
  };
  // Stroked below the nodes it cuts, insetting (a mask group member), so the inset shape needs a mask.
  const skin = () => part("skin", 1, true).addToRegion("soft", { inset: true }).build();

  it("builds only the shapes visible nodes use", () => {
    expect(shapes(root(skin(), part("a", 2).cutBy("soft").build()))).toEqual({
      forms: { soft: { full: undefined, inset: { clip: undefined, mask: "t_soft_region_inset" }, outline: undefined } },
      clips: [],
      masks: ["t_soft_region_inset"],
    });
  });

  it("cuts a node tracing its outline by the full shape, and its outline by the outline ring", () => {
    expect(shapes(root(skin(), part("a", 2).cutBy("soft").traceOutline(true).build()))).toEqual({
      forms: { soft: { full: { clip: "t_soft_region", mask: undefined }, inset: undefined, outline: "t_soft_region_outline" } },
      clips: ["t_soft_region"],
      masks: ["t_soft_region_outline"],
    });
  });

  it("draws regions from the original nodes, not the hoisted copies", () => {
    const { nodes, defs } = plan(
      root(
        part("torso", 1, true).addToRegion("hard").addToRegion("soft", { inset: true }).build(),
        part("shirt", 2).cutBy("hard").cutBy("soft").build(),
      ),
    );
    const soft = defs.masks.find((def) => def.region === "soft")!;

    expect(soft.nodes[0]).toBe(nodes.find((node) => node.id === "torso"));
    expect(soft.nodes[0].sprite.strokeWidth).toBe(2);
  });

  it("hoists a member's outline above the nodes its region cuts, unless the member insets it", () => {
    const hoisted = plan(root(part("owner", 1, true).addToRegion("hard").build(), part("cut", 5).cutBy("hard").build()));
    const inset = plan(
      root(
        new NodeBuilder("owner").setSprite(sprite(true)).setZIndex(1, "absolute").addToRegion("hard").insetOutlines().build(),
        part("cut", 5).cutBy("hard").build(),
      ),
    );

    expect(ids(hoisted.visibleNodes)).toEqual(["root", "owner", "cut", "owner_outline"]);
    expect(ids(inset.visibleNodes)).toEqual(["root", "owner", "cut"]);
    expect(inset.defs.forms.get("hard")?.inset?.maskId).toBe("t_hard_region_inset");
  });

  describe("draws a region as a clip-path when it only cuts hard edges", () => {
    const asClip = (...children: Node[]) => {
      const { defs, items } = plan(root(...children));
      return { clip: Boolean(defs.forms.get("soft")?.inset?.clipId), masks: defs.masks.length, order: paintOrder(items) };
    };
    const user = () => part("a", 5).cutBy("soft").build();

    it("with plain members", () => {
      expect(asClip(part("skin", 1).addToRegion("soft", { inset: true }).build(), user())).toEqual({
        clip: true,
        masks: 0,
        order: ["skin", { "clip:t_soft_region": ["a"] }],
      });
    });

    it("with an insetting member painting its outline above every node it cuts", () => {
      expect(asClip(part("skin", 9, true).addToRegion("soft", { inset: true }).build(), user()).clip).toBe(true);
    });

    it("but not when the outline paints below a node it cuts, as the mask leaves out the outline's inner half", () => {
      expect(asClip(skin(), user())).toMatchObject({ clip: false, masks: 1 });
    });

    it("only for nodes not clipped already, as Chromium stops anti-aliasing clips stacked deeper", () => {
      const { defs, items } = plan(
        root(
          part("skin", 1).addToRegion("soft", { inset: true }).addToRegion("hard").build(),
          part("a", 5).cutBy("soft").build(),
          part("b", 6).cutBy("soft").cutBy("hard").build(),
        ),
      );

      expect([...(defs.forms.get("soft")?.inset?.clipUsers ?? [])]).toEqual(["a"]);
      expect(defs.masks.map((def) => def.id)).toEqual(["t_soft_region"]);
      expect(paintOrder(items)).toEqual([
        "skin",
        { "clip:t_soft_region": ["a"] },
        { "clip:t_hard_region": [{ "mask:t_soft_region": ["b"] }] },
      ]);
    });

    it("but not when a member subtracts", () => {
      const cut = part("cut", 2).addToRegion("soft", { inset: true, subtract: true }).build();
      expect(asClip(part("skin", 1).addToRegion("soft", { inset: true }).build(), cut, user()).clip).toBe(false);
    });
  });
});
