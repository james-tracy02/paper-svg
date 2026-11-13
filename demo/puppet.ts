import { NodeBuilder, SpriteBuilder, type Node, type Sprite } from "paper-svg";

export const STAR_SPRITE_ID = "star";

export const STAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <path fill="#ffd54a" d="M50 5 L61 38 L95 38 L68 59 L79 93 L50 72 L21 93 L32 59 L5 38 L39 38 Z" />
  <path fill="#f59e0b" d="M50 30 L56 45 L72 45 L59 55 L64 71 L50 61 L36 71 L41 55 L28 45 L44 45 Z" />
</svg>`;

type Side = "left" | "right";

/** Rotation in degrees by node id. Stored before mirroring, so both sides use the same values. */
export type Pose = Record<string, number>;

export type PuppetOptions = {
  pose: Pose;
  shirtColor: string;
  clipSash: boolean;
  balloon: { x: number; y: number };
};

export const DEFAULT_POSE: Pose = {
  head: 0,
  ear_right: 12,
  ear_left: 12,
  arm_right: -130,
  forearm_right: -15,
  hand_right: 0,
  arm_left: -20,
  forearm_left: 18,
  hand_left: 0,
  thigh_right: -6,
  shin_right: 8,
  thigh_left: -6,
  shin_left: 8,
};

const OUTLINE = "#000000ff";
const SKIN = "#ffffff";
const PANTS = "#3b5b92";
const TORSO_CLIP = "torso_shape";
const BALLOON_ID = "balloon";
const ORIGIN = { x: 0, y: 0 };

const paint = new SpriteBuilder().setStroke(OUTLINE).setStrokeWidth(2);

/** An ellipse hanging from its joint. Built-in shapes are 10 units across at scale 1. */
const limb = (color: string, width: number, length: number): Sprite =>
  paint
    .setFill(color)
    .setShape("ellipse")
    .setScale(width / 10, length / 10)
    .setOffset(0, -length / 2)
    .build();

const dot = (color: string, diameter: number): Sprite =>
  paint.setFill(color).setShape("ellipse").setScale(diameter / 10, diameter / 10).build();

const arm = (side: Side, { pose }: PuppetOptions): Node => {
  const hand = new NodeBuilder("hand")
    .moveBy(0, -60)
    .setRotation(pose[`hand_${side}`])
    .setZIndex(1)
    .setSprite(limb(SKIN, 20, 22))
    .buildSide(side);

  const forearm = new NodeBuilder("forearm")
    .moveBy(0, -62)
    .setRotation(pose[`forearm_${side}`])
    .setZIndex(1)
    .setSprite(limb(SKIN, 17, 66))
    .addJoints(hand)
    .buildSide(side);

  return new NodeBuilder("arm")
    .moveBy(36, 32)
    .setRotation(pose[`arm_${side}`])
    .setZIndex(side === "right" ? 3 : -1)
    .setSprite(limb(SKIN, 20, 70))
    .addJoints(forearm)
    .buildSide(side);
};

const leg = (side: Side, { pose }: PuppetOptions): Node => {
  const foot = new NodeBuilder("foot")
    .moveBy(8, -72)
    .setSprite(paint.setFill(OUTLINE).setShape("ellipse").setScale(3.4, 1.5).build())
    .buildSide(side);

  const shin = new NodeBuilder("shin")
    .moveBy(0, -66)
    .setRotation(pose[`shin_${side}`])
    .setSprite(limb(PANTS, 20, 74))
    .addAttachments(foot)
    .buildSide(side);

  return new NodeBuilder("thigh")
    .moveBy(19, -36)
    .setRotation(pose[`thigh_${side}`])
    .setZIndex(-1)
    .setSprite(limb(PANTS, 25, 74))
    .addJoints(shin)
    .buildSide(side);
};

/** An eye whose pupil orbits its center to look at the balloon. */
const eye = (side: Side): Node => {
  const pupil = new NodeBuilder("pupil")
    .setAimAt(BALLOON_ID, ORIGIN)
    .setSprite(new SpriteBuilder().setFill(OUTLINE).setStrokeWidth(0).setShape("ellipse").setScale(0.75, 0.75).setOffset(0, -3.2).build())
    .buildSide(side);

  return new NodeBuilder("eye").moveBy(10, 32).setSprite(dot("#ffffff", 14)).addAttachments(pupil).buildSide(side);
};

/** A bunny ear standing up from its joint, behind the head. Joints rotate when dragged. */
const ear = (side: Side, { pose }: PuppetOptions): Node =>
  new NodeBuilder("ear")
    .moveBy(13, 47)
    .setRotation(pose[`ear_${side}`])
    .setZIndex(-1)
    .setSprite(paint.setFill(SKIN).setShape("ellipse").setScale(2, 7).setOffset(0, 35).build())
    .buildSide(side);

const head = (options: PuppetOptions): Node => {
  const { pose } = options;
  const mouth = new NodeBuilder("mouth")
    .moveBy(0, 13)
    .setSprite(paint.setFill("none").setPath("M -8 0 Q 0 7 8 0").build())
    .build();

  return new NodeBuilder("head")
    .moveBy(0, 46)
    .setRotation(pose.head)
    .setZIndex(2)
    .setSprite(paint.setFill(SKIN).setShape("ellipse").setScale(5.4, 5.4).setOffset(0, 27).build())
    .addJoints(ear("right", options), ear("left", options))
    .addAttachments(eye("right"), eye("left"), mouth)
    .build();
};

const torso = (options: PuppetOptions): Node => {
  // Clipped to the torso's own shape when enabled. Turn it off to see the whole rectangle.
  const sash = new NodeBuilder("sash")
    .setRotation(35)
    .setZIndex(1)
    .setSprite(paint.setFill("#ef4444").setShape("rect").setScale(13, 1.7).build())
    .cutBy(options.clipSash ? TORSO_CLIP : undefined)
    .build();

  const badge = new NodeBuilder("badge")
    .moveBy(-16, 20)
    .setZIndex(2)
    .setSprite(
      new SpriteBuilder()
        .setCustomSprite(STAR_SPRITE_ID)
        .setCustomColors("#ffd54a", "#f59e0b")
        .setStrokeWidth(0)
        .setScale(0.2, 0.2)
        .build(),
    )
    .build();

  return new NodeBuilder("torso")
    .setArticulated(false)
    .setSprite(paint.setFill(options.shirtColor).setShape("ellipse").setScale(7.2, 10.5).build())
    .addToRegion(TORSO_CLIP)
    .addJoints(head(options), arm("right", options), arm("left", options), leg("right", options), leg("left", options))
    .addAttachments(sash, badge)
    .build();
};

/** The puppet and a balloon. The string and eyes reach across the tree with pin and aim constraints. */
export const buildScene = (options: PuppetOptions): Node => {
  const balloon = new NodeBuilder(BALLOON_ID)
    .setArticulated(false)
    .moveBy(options.balloon.x, options.balloon.y)
    .setZIndex(7)
    .setSprite(paint.setFill("#ef4444").setShape("ellipse").setScale(3.8, 4.6).setOffset(0, 23).build())
    .build();

  // A unit-long line: aim points it at the balloon, stretch scales it to reach.
  const string = new NodeBuilder("string")
    .setArticulated(false)
    .setPinTo("hand_right", { x: 0, y: -20 })
    .setAimAt(BALLOON_ID, ORIGIN, undefined, true)
    .setZIndex(6)
    .setSprite(new SpriteBuilder().setFill("none").setStroke(OUTLINE).setStrokeWidth(1.5).setPath("M 0 0 L 0 1").build())
    .build();

  return new NodeBuilder("scene")
    .setArticulated(false)
    .noSprite()
    .addJoints(torso(options), string, balloon)
    .build();
};
