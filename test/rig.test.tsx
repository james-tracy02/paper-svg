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

  it("generates masks and clips under idPrefix and applies them", () => {
    const body = part("root")
      .addMaskGroup("soft")
      .addClippingGroup("hard")
      .addJoints(part("masked").addMaskedBy("soft").build(), part("clipped").addClippedBy("hard").build())
      .build();
    const svg = render({ body, idPrefix: "demo" });

    expect(svg).toContain('id="demo_soft_group');
    expect(svg).toContain('mask="url(#demo_soft_group');
    expect(svg).toContain('id="demo_hard_clippath"');
    expect(svg).toContain("url(#demo_hard_clippath)");
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
    const body = part("root").setScale(40, 0.1).addJoints(part("joint").build()).build();
    const svg = render({ body, showPivots: true });
    const pivots = svg.slice(svg.indexOf('<g pointer-events="none">'));

    expect(count(pivots, "<path")).toBe(2);
    expect(count(pivots, 'stroke-width="8"')).toBe(2);
    expect(count(pivots, 'vector-effect="non-scaling-stroke"')).toBe(2);
  });
});
