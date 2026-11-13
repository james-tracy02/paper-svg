import type { Vector2 } from "./primitives";
import type { CSSProperties } from "react";
import type { Node, NodeFollow, NodePaint, RegionJoin } from "./Node";
import type { Sprite } from "./Sprite";
import type { TransformState } from "./TransformState";
import type { Transform } from "./Transform";
import type { RenderGroup } from "./RenderGroup";
import type { DriverOutput, NodeDriver } from "./Driver";
import type { Pose } from "./Pose";

interface BuilderState {
  name: string;
  translateX: number;
  translateY: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  fixedRotation?: {
    enabled: boolean;
    max?: number;
  };
  fixedScale?: boolean;
  patternSpace?: { rotation: number; offset: Vector2 };
  gradientSpace?: NodePaint["gradientSpace"];
  aimAt?: NodeFollow["aimAt"];
  pinTo?: { targetId: string; point?: Vector2 };
  joints: Node[];
  attachments: Node[];
  zIndex?: number;
  articulated?: boolean;
  skew?: Vector2;
  sprite: Sprite;
  noSprite?: boolean;
  mask?: Sprite;
  joins: RegionJoin[];
  regionOutsets: Record<string, number>;
  cuts: string[];
  onlyWhereCut?: boolean;
  regionsForChildren?: boolean;
  cutsForChildren?: boolean;
  stopInheritedRegions?: boolean;
  stopInheritedCuts?: boolean;
  outlineZIndex?: number;
  pointerEvents?: boolean;
  pointerEventsTarget?: string;
  blendMode?: CSSProperties["mixBlendMode"];
  zIndexMode: "relative" | "absolute";
  traceOutline?: boolean;
  traceRegions: string[];
  insetOutlines?: boolean;
  opacity?: number;
  renderGroup?: RenderGroup;
  debugColor?: string;
  drivers?: Omit<NodeDriver, "mirror">[];
}

/** One region name or several; empty names (undefined, null, "") are skipped, so optional regions can be passed as is. */
export type RegionNames = string | null | undefined | readonly (string | null | undefined)[];

const regionNames = (names: RegionNames): string[] =>
  (Array.isArray(names) ? names : [names]).filter((name): name is string => typeof name === "string" && name.length > 0);

/** `group` without its undefined fields, or undefined when none is left. */
const definedOnly = <T extends object>(group: T): T | undefined => {
  const entries = Object.entries(group).filter(([, value]) => value !== undefined);
  return entries.length ? (Object.fromEntries(entries) as T) : undefined;
};

export default class NodeBuilder {
  private readonly _state: BuilderState;

  constructor(name: string, state?: BuilderState) {
    this._state =
      state ??
      ({
        name,
        translateX: 0,
        translateY: 0,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        joints: [],
        attachments: [],
        sprite: {
          translate: { x: 0, y: 0 },
          scale: { x: 1, y: 1 },
          rotate: 0,
        },
        joins: [],
        regionOutsets: {},
        cuts: [],
        traceRegions: [],
        zIndexMode: "relative",
      } satisfies BuilderState);
  }

  /** helper to create a new builder with modified state */
  private with(patch: Partial<BuilderState>): NodeBuilder {
    return new NodeBuilder(this._state.name, { ...this._state, ...patch });
  }

  /** Sets the joint's position in its parent's space. */
  setPosition(x: number, y: number): NodeBuilder {
    return this.with({ translateX: x, translateY: y });
  }

  /** Moves the joint by (x, y) from where it is. */
  moveBy(x: number, y: number): NodeBuilder {
    return this.with({ translateX: this._state.translateX + x, translateY: this._state.translateY + y });
  }

  /** Sets the scale; `y` defaults to `x`. */
  setScale(x: number, y: number = x): NodeBuilder {
    return this.with({ scaleX: x, scaleY: y });
  }

  /**
   * Multiplies the scale by (x, y); `y` defaults to `x`. With `from`, scales about that point of the
   * node's own space instead of its joint: the joint moves so that point stays put.
   */
  scaleBy(x: number, y: number = x, { from }: { from?: Vector2 } = {}): NodeBuilder {
    const scaled = this.with({ scaleX: this._state.scaleX * x, scaleY: this._state.scaleY * y });
    return from ? scaled.moveBy((1 - x) * from.x, (1 - y) * from.y) : scaled;
  }

  /** Sets the joint's rest rotation in degrees, which a pose adds to. */
  setRotation(d: number): NodeBuilder {
    return this.with({ rotation: d });
  }

  /** Turns the rest rotation by `d` degrees. */
  rotateBy(d: number): NodeBuilder {
    return this.with({ rotation: this._state.rotation + d });
  }

  setFixedRotation(enabled: boolean, max?: number): NodeBuilder {
    return this.with({ fixedRotation: { enabled, max } });
  }

  setFixedScale(enabled: boolean = true): NodeBuilder {
    return this.with({ fixedScale: enabled });
  }

  /** Patterns on this node and its descendants tile in this node's frame, turned and moved (see `Node.patternSpace`). */
  setPatternSpace({ rotation = 0, x = 0, y = 0 }: { rotation?: number; x?: number; y?: number } = {}): NodeBuilder {
    return this.with({ patternSpace: { rotation, offset: { x, y } } });
  }

  /** This node's gradient frame becomes the gradient space for descendants that inherit it (see `Node.gradientSpace`). */
  setGradientSpace(): NodeBuilder {
    return this.with({ gradientSpace: "define" });
  }

  /** Draws this node's gradient in the nearest ancestor's gradient space (see `Node.gradientSpace`). */
  inheritGradientSpace(): NodeBuilder {
    return this.with({ gradientSpace: "inherit" });
  }

  /**
   * Always rotate this node so that `from` — a point in this node's own local space — ends up
   * as close as possible to `point` in the local space of the node with id `targetId` (pass
   * the fully resolved id, including any `_left`/`_right` suffix). `from` defaults to
   * (0, -1), which simply points the node down the limb at the target. `from.x` is mirrored by
   * `buildLeft`/`buildSide("left")` like every other x in the builder, while `point` is taken
   * as-is because the target's own local space is already mirrored. Any rotation set on this
   * node stays as an additive offset. With `stretch`, the node's y scale also changes so `from`
   * lands exactly on the target. With `arrive`, the path becomes a curve to `from` that ends heading
   * along `arrive.along` in the target's space (see `Node.aimAt`). Pass `undefined` targetId to clear.
   */
  setAimAt(
    targetId: string | undefined,
    point: Vector2,
    from?: Vector2,
    stretch?: boolean,
    arrive?: { along: Vector2; bend: number },
  ): NodeBuilder {
    if (!targetId) return this.with({ aimAt: undefined });
    return this.with({ aimAt: { targetId, point, from, stretch, arrive } });
  }

  /**
   * Always place this node's joint on `point` (default (0, 0)) in the local space of the node
   * with id `targetId` (pass the fully resolved id, including any `_left`/`_right` suffix), no
   * matter what parent chain or scaling either node sits under. Any joint position set on this
   * node stays as an additive offset in its parent's space. Pair with `setAimAt` to have a node
   * in a separate hierarchy follow another one in both pivot and angle. Pass `undefined`
   * targetId to clear.
   */
  setPinTo(targetId: string | undefined, point?: Vector2): NodeBuilder {
    if (!targetId) return this.with({ pinTo: undefined });
    return this.with({ pinTo: { targetId, point } });
  }

  /**
   * Computes part of this node's transform, or its visibility, from the pose each time it is solved,
   * instead of baking it in when the tree is built: a pose change then moves the node without a
   * rebuild. `drive` reads joint rotations (`pose.rotations`) or named values (`pose.values`) and
   * supplies its own defaults for anything missing. The output combines like `rotateBy`, `moveBy`,
   * `scaleBy` and `skewBy`, and `buildLeft` mirrors it the same way. Drivers stack: each one added applies on top of the others.
   */
  addDriver(drive: (pose: Pose) => DriverOutput): NodeBuilder {
    return this.with({ drivers: [...(this._state.drivers ?? []), { evaluate: drive }] });
  }

  /** Adds (x, y) degrees to the skew. */
  skewBy(x: number, y: number = 0): NodeBuilder {
    const skewX = (this._state.skew?.x ?? 0) + x;
    const skewY = (this._state.skew?.y ?? 0) + y;
    return this.with({ skew: { x: skewX, y: skewY } });
  }

  addJoints(...bs: Array<Node | undefined>): NodeBuilder {
    const filtered = bs.filter((node): node is Node => Boolean(node));
    if (!filtered.length) {
      return this;
    }
    return this.with({ joints: [...this._state.joints, ...filtered] });
  }

  addAttachments(...bs: Array<Node | undefined>): NodeBuilder {
    const filtered = bs.filter((node): node is Node => Boolean(node));
    if (!filtered.length) {
      return this;
    }
    return this.with({
      attachments: [...this._state.attachments, ...filtered],
    });
  }

  setZIndex(z: number | undefined, mode?: "relative" | "absolute"): NodeBuilder {
    if (z === undefined) {
      return this;
    }
    return this.with({ zIndex: z, zIndexMode: mode });
  }

  setArticulated(a: boolean): NodeBuilder {
    return this.with({ articulated: a });
  }

  /** Sets the skew in degrees. */
  setSkew(x: number, y: number): NodeBuilder {
    return this.with({ skew: { x, y } });
  }

  setSprite(sprite: Sprite): NodeBuilder {
    return this.with({ sprite });
  }

  noSprite(b: boolean = true): NodeBuilder {
    return this.with({ noSprite: b });
  }

  /**
   * Cuts this node by `cut`, a shape in the node's own space: only what lies inside it draws. Hard edges draw as a
   * clip-path, soft ones (partial opacity, blur, an image) as a mask. Does nothing for undefined.
   */
  setCut(cut: Sprite | undefined): NodeBuilder {
    return cut === undefined ? this : this.with({ mask: cut });
  }

  /**
   * Adds this node's shape to the named regions, or with `subtract` removes it. `outset` grows the shape in the
   * region by that much on every side (world units). `inset` keeps the nodes the region cuts inside this node's
   * outline by cutting the outline out of the region, instead of lifting it above them (hoisting, the default).
   * Joining a region again replaces its options.
   */
  addToRegion(names: RegionNames, options: { subtract?: boolean; outset?: number; inset?: boolean } = {}): NodeBuilder {
    const added = regionNames(names);
    if (!added.length) return this;
    const join = (region: string): RegionJoin => ({
      region,
      ...(options.subtract ? { subtract: true } : {}),
      ...(options.outset ? { outset: options.outset } : {}),
      ...(options.inset ? { inset: true } : {}),
    });
    return this.with({
      joins: [...this._state.joins.filter((existing) => !added.includes(existing.region)), ...added.map(join)],
    });
  }

  /** Grows this node's shape in the named region by `outset` (world units), whenever it joins it. */
  setRegionOutset(name: string, outset: number): NodeBuilder {
    return this.with({ regionOutsets: { ...this._state.regionOutsets, [name]: outset } });
  }

  /**
   * Cuts this node by the named regions: it draws only inside each, and inside its members' outlines (each member
   * either hoists its outline over this node or insets it). Repeats are kept, as each cut applies again.
   */
  cutBy(names: RegionNames): NodeBuilder {
    const added = regionNames(names);
    return added.length ? this.with({ cuts: [...this._state.cuts, ...added] }) : this;
  }

  /**
   * Draws this node over the outlines of the regions cutting it, in its own outline colour, where it covers them:
   * a garment along the body's silhouette redraws that stretch of the silhouette in its colour. The node's fill is
   * then cut by those regions' full shapes, outlines included. See `traceOutlineOf` to trace other regions.
   */
  traceOutline(enabled: boolean = true): NodeBuilder {
    return this.with({ traceOutline: enabled || undefined });
  }

  /** Like `traceOutline`, but traces the named regions' outlines instead of the regions cutting this node. */
  traceOutlineOf(names: RegionNames): NodeBuilder {
    const added = regionNames(names);
    return added.length ? this.with({ traceOutline: true, traceRegions: [...this._state.traceRegions, ...added] }) : this;
  }

  /** Insets this node's outline in every region it joins (see `addToRegion`), instead of hoisting it. */
  insetOutlines(enabled: boolean = true): NodeBuilder {
    return this.with({ insetOutlines: enabled || undefined });
  }

  /** Adds this node to its regions only where its own cuts leave it, not its whole shape. */
  onlyWhereCut(enabled: boolean = true): NodeBuilder {
    return this.with({ onlyWhereCut: enabled || undefined });
  }

  /** Every descendant joins this node's regions too, in addition to its own (outsets stay with this node). */
  regionsForChildren(enabled: boolean = true): NodeBuilder {
    return this.with({ regionsForChildren: enabled || undefined });
  }

  /** Every descendant is cut by this node's regions too, in addition to its own cuts. */
  cutsForChildren(enabled: boolean = true): NodeBuilder {
    return this.with({ cutsForChildren: enabled || undefined });
  }

  /** Ignores the regions ancestors pass down (`regionsForChildren`), for this node and its descendants. */
  stopInheritedRegions(enabled: boolean = true): NodeBuilder {
    return this.with({ stopInheritedRegions: enabled || undefined });
  }

  /** Ignores the cuts ancestors pass down (`cutsForChildren`), for this node and its descendants. */
  stopInheritedCuts(enabled: boolean = true): NodeBuilder {
    return this.with({ stopInheritedCuts: enabled || undefined });
  }

  setOutlineZIndex(zIndex: number): NodeBuilder {
    return this.with({ outlineZIndex: zIndex });
  }

  setOutlineZIndexIf(c: boolean, zIndex: number): NodeBuilder {
    if (c) {
      return this.setOutlineZIndex(zIndex);
    }
    return this;
  }

  setPointerEvents(enabled: boolean): NodeBuilder {
    return this.with({ pointerEvents: enabled });
  }

  /**
   * Forwards pointer interaction (drag-to-rotate) on this node to the node with the given
   * id, instead of this node's nearest articulated ancestor. Pass the fully resolved id
   * (including any `_left`/`_right` suffix) of the target node.
   */
  setPointerEventsTarget(id: string | undefined): NodeBuilder {
    return this.with({ pointerEventsTarget: id });
  }

  setBlendMode(mode: CSSProperties["mixBlendMode"] | undefined): NodeBuilder {
    return this.with({ blendMode: mode });
  }

  setOpacity(opacity: number | undefined): NodeBuilder {
    return this.with({ opacity });
  }

  setRenderGroup(id: string | undefined): NodeBuilder {
    if (!id) return this;
    return this.with({ renderGroup: { id } });
  }

  setDebugColor(color: string | undefined): NodeBuilder {
    return this.with({ debugColor: color });
  }

  /**
   * Applies `transform` on top of this node's own: moved by its position, turned by its rotation,
   * skewed by its skew and scaled by its scale. Does nothing for undefined.
   */
  transformBy(transform: TransformState | Transform | undefined): NodeBuilder {
    if (!transform) return this;
    if ("positionX" in transform) {
      return this.moveBy(transform.positionX, transform.positionY)
        .rotateBy(transform.rotation)
        .skewBy(transform.skewX, transform.skewY)
        .scaleBy(transform.scaleX, transform.scaleY);
    }
    return this.moveBy(transform.translate.x, transform.translate.y)
      .rotateBy(transform.rotate)
      .skewBy(transform.skew?.x ?? 0, transform.skew?.y ?? 0)
      .scaleBy(transform.scale.x, transform.scale.y);
  }

  private _build(suffix: string = "", mult: number = 1): Node {
    const s = this._state;
    const mask = s.mask
      ? {
          ...s.mask,
          translate: {
            x: s.mask.translate.x * mult,
            y: s.mask.translate.y,
          },
          scale: {
            x: s.mask.scale.x * mult,
            y: s.mask.scale.y,
          },
        }
      : undefined;

    const aimAt = s.aimAt && {
      ...s.aimAt,
      point: { x: s.aimAt.point.x * mult, y: s.aimAt.point.y },
      from: s.aimAt.from && { x: s.aimAt.from.x * mult, y: s.aimAt.from.y },
    };
    return {
      id: s.name + suffix,
      name: s.name + suffix,
      transform: {
        translate: { x: s.translateX * mult, y: s.translateY },
        scale: { x: s.scaleX, y: s.scaleY },
        rotate: s.rotation * mult,
        skew: { x: (s.skew?.x ?? 0) * mult, y: (s.skew?.y ?? 0) * mult },
      },
      follow: definedOnly({ fixedRotation: s.fixedRotation, fixedScale: s.fixedScale, aimAt, pinTo: s.pinTo }),
      drivers: s.drivers?.map((driver) => ({ ...driver, mirror: mult < 0 ? -1 : 1 })),
      joints: s.joints,
      attachments: [...s.attachments],
      zIndex: s.zIndex,
      zIndexMode: s.zIndexMode,
      sprite: {
        ...s.sprite,
        translate: { x: s.sprite.translate.x * mult, y: s.sprite.translate.y },
        scale: { x: s.sprite.scale.x * mult, y: s.sprite.scale.y },
      },
      paint: definedOnly({
        noSprite: s.noSprite,
        mask,
        opacity: s.opacity,
        blendMode: s.blendMode,
        patternSpace: s.patternSpace,
        gradientSpace: s.gradientSpace,
        renderGroup: s.renderGroup,
      }),
      outline: definedOnly({
        zIndex: s.outlineZIndex,
        trace: s.traceOutline ? (s.traceRegions.length ? s.traceRegions : true) : undefined,
        inset: s.insetOutlines,
      }),
      interaction: definedOnly({
        articulated: s.articulated,
        pointerEvents: s.pointerEvents,
        target: s.pointerEventsTarget,
      }),
      regions: definedOnly({
        joins: s.joins.length
          ? s.joins.map((join) => (s.regionOutsets[join.region] ? { ...join, outset: s.regionOutsets[join.region] } : join))
          : undefined,
        cuts: s.cuts.length ? s.cuts : undefined,
        onlyWhereCut: s.onlyWhereCut,
        regionsForChildren: s.regionsForChildren,
        cutsForChildren: s.cutsForChildren,
        stopInheritedRegions: s.stopInheritedRegions,
        stopInheritedCuts: s.stopInheritedCuts,
      }),
      debugColor: s.debugColor,
    };
  }

  build(id?: string): Node {
    return this._build(id ? "_" + id : "");
  }

  buildRight(id?: string): Node {
    return this._build((id ? "_" + id : "") + "_right", 1);
  }

  buildLeft(id?: string): Node {
    return this._build((id ? "_" + id : "") + "_left", -1);
  }

  buildSide(side: "left" | "right", id?: string): Node {
    return this._build((id ? "_" + id : "") + "_" + side, side === "left" ? -1 : 1);
  }
}
