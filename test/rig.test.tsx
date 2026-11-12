import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NodeBuilder, Rig, SpriteBuilder, type RigProps } from "../src";

const render = (props: RigProps) =>
  renderToStaticMarkup(
    <svg>
      <Rig {...props} />
    </svg>,
  );

const shape = (fill: string) => new SpriteBuilder().setShape("rect").setFill(fill).setStrokeWidth(0).build();
const part = (name: string, fill = "#abcdef") => new NodeBuilder(name).setSprite(shape(fill));
const count = (text: string, search: string) => text.split(search).length - 1;
const drawn = (id: string) => `data-render-id="${id}"`;

describe("Rig", () => {
  it("draws every node with a sprite and skips noSprite nodes", () => {
    const body = part("root")
      .noSprite()
      .addJoints(part("joint").build())
      .addAttachments(part("attachment").build())
      .build();
    const svg = render({ body });

    expect(svg).toContain(drawn("joint"));
    expect(svg).toContain(drawn("attachment"));
    expect(svg).not.toContain(drawn("root"));
  });

  it("paints lower z-index first", () => {
    const body = part("root")
      .noSprite()
      .addJoints(part("top").setZIndex(5).build(), part("bottom").setZIndex(1).build())
      .build();
    const svg = render({ body });

    expect(svg.indexOf(drawn("bottom"))).toBeLessThan(svg.indexOf(drawn("top")));
  });

  it("generates region masks and clips under idPrefix and applies them", () => {
    const body = part("root")
      // An outset keeps it a <mask> rather than a clip-path.
      .addMaskGroup("soft")
      .setMaskOutset("soft", 1)
      .addClippingGroup("hard")
      .addJoints(part("masked").addMaskedBy("soft").build(), part("clipped").addClippedBy("hard").build())
      .build();
    const svg = render({ body, idPrefix: "demo" });

    expect(svg).toContain('<mask id="demo_soft_region"');
    expect(svg).toContain('mask="url(#demo_soft_region)"');
    expect(svg).toContain('<clipPath id="demo_hard_region"');
    expect(svg).toContain('clip-path="url(#demo_hard_region)"');
  });

  it("draws a hard sprite mask as a <clipPath> and a soft one as a <mask>", () => {
    const hard = new SpriteBuilder().setShape("rect").setMaskScale(0.5).build();
    const soft = new SpriteBuilder().setShape("rect").setOpacity(0.5).build();
    const body = part("root").addJoints(part("cut").setMask(hard).build(), part("faded").setMask(soft).build()).build();
    const svg = render({ body, idPrefix: "demo" });

    expect(svg).toMatch(/<clipPath id="demo_cut_mask"[^>]*><rect [^>]*transform="[^"]*0\.5/);
    expect(svg).toContain('clip-path="url(#demo_cut_mask)"');
    expect(svg).toContain('<mask id="demo_faded_mask"');
    expect(svg).toContain('mask="url(#demo_faded_mask)"');
  });

  it("nests a node's own clip inside its hard sprite mask, as one element takes one clip-path", () => {
    const rect = new SpriteBuilder().setShape("rect").build();
    const body = part("root").addJoints(part("cut").setMask(rect).setClip(rect).build()).build();
    const svg = render({ body, idPrefix: "demo" });

    expect(svg).toMatch(/clip-path="url\(#demo_cut_mask\)"[^>]*><g clip-path="url\(#demo_cut_clip\)">/);
  });

  it("cuts a member adding only where it's cut by its cutting region's <clipPath>, inside the other region's mask", () => {
    const body = part("root")
      .addClippingGroup("hard")
      .addJoints(
        part("member").addMaskGroup("soft").addClippedBy("hard").clipMaskContribution().build(),
        part("masked").addMaskedBy("soft").build(),
      )
      .build();
    const svg = render({ body, idPrefix: "demo" });

    expect(svg).toMatch(/<mask id="demo_soft_region"[^]*?clip-path="url\(#demo_hard_region\)"[^]*?<\/mask>/);
    expect(svg).not.toContain('<mask id="demo_hard');
  });

  it("draws a clip member's path as is when its outset is 0, the addClippingGroup default", () => {
    const d = "M 0 0 L 10 0 L 10 10 Z";
    const body = part("root")
      .setSprite(new SpriteBuilder().setPath(d).build())
      .addClippingGroup("hard")
      .addJoints(part("clipped").addClippedBy("hard").build())
      .build();
    const clipPath = render({ body, idPrefix: "demo" }).match(/<clipPath id="demo_hard_region"[^>]*>(.*?)<\/clipPath>/)?.[1];

    expect(clipPath).toContain(`d="${d}"`);
  });

  it("does not draw a node restricted to a group nobody defines", () => {
    const body = part("root")
      .addJoints(part("masked").addMaskedBy("missing").build(), part("clipped").addClippedBy("missing").build())
      .build();
    const svg = render({ body });

    expect(svg).toContain(drawn("root"));
    expect(svg).not.toContain(drawn("masked"));
    expect(svg).not.toContain(drawn("clipped"));
  });

  it("runs paint colors through colorTransform", () => {
    const svg = render({ body: part("root").build(), colorTransform: () => "#000001" });

    expect(svg).toContain('fill="#000001"');
    expect(svg).not.toContain("#abcdef");
  });

  it("paints hidden nodes at zero opacity", () => {
    const svg = render({ body: part("root").build(), effects: { isHidden: () => true } });

    expect(svg).toContain('opacity="0"');
  });

  it("applies rig scale and mirror", () => {
    expect(render({ body: part("root").build(), scale: 2, mirror: true })).toContain('transform="scale(2, 2) scale(-1, 1)"');
  });

  it("draws one fixed-size pivot per node, ignoring pointer events", () => {
    const body = part("root").scaleBy(40, 0.1).addJoints(part("joint").build()).build();
    const svg = render({ body, showPivots: true });
    const pivots = svg.slice(svg.indexOf('<g pointer-events="none">'));

    expect(count(pivots, "<path")).toBe(2);
    expect(count(pivots, 'stroke-width="8"')).toBe(2);
    expect(count(pivots, 'vector-effect="non-scaling-stroke"')).toBe(2);
  });
});

describe("outlines", () => {
  const stroked = (fill: string) =>
    new SpriteBuilder().setShape("rect").setFill(fill).setStroke("#000").setStrokeWidth(2);

  it("does not repaint the owner's pattern in a setOutlineZIndex outline", () => {
    const pattern = new SpriteBuilder().setShape("ellipse").setFill("#ff0000").setScale(0.2, 0.2).build();
    const body = new NodeBuilder("part").setSprite(stroked("#00ff00").setPattern(pattern).build()).setOutlineZIndex(5).build();
    const svg = render({ body });

    expect(svg).toContain("url(#rig_part_pattern)");
    expect(svg).not.toContain("part_outline_pattern");
  });

  it("hoists a clip group owner's outline above its dependents, cut by the owner's own sprite mask", () => {
    const body = new NodeBuilder("owner")
      .setSprite(stroked("#00ff00").build())
      .setMask(new SpriteBuilder().setShape("rect").setScale(2, 2).build())
      .addClippingGroup("hard")
      .addJoints(part("dependent").setZIndex(3).addClippedBy("hard").build())
      .build();
    const svg = render({ body });

    expect(svg.indexOf(drawn("owner_outline"))).toBeGreaterThan(svg.indexOf(drawn("dependent")));
    const outlineMask = svg.slice(svg.indexOf('id="rig_owner_outline_mask"'));
    expect(outlineMask.slice(0, outlineMask.indexOf("</clipPath>"))).toContain("matrix(2, 0, 0, 2, 0, 0)");
  });
});
