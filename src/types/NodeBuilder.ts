import type { Vector2 } from "./primitives";
import type { CSSProperties } from "react";
import type { Node } from "./Node";
import type { Shape, Sprite } from "./Sprite";
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
  gradientSpace?: Node["gradientSpace"];
  aimAt?: Node["aimAt"];
  pinTo?: { targetId: string; point?: Vector2 };
  joints: Node[];
  attachments: Node[];
  zIndex?: number;
  articulated?: boolean;
  shape?: Shape;
  skew?: Vector2;
  sprite: Sprite;
  noSprite?: boolean;
  mask?: Sprite;
  clip?: Sprite;
  maskGroups: string[];
  maskGroupModes: Record<string, "positive" | "negative">;
  parentMaskedBy: string[];
  maskedBy: string[];
  outlineMaskedBy: string[];
  clippingGroups: string[];
  clipOutsets: Record<string, number>;
  maskOutsets: Record<string, number>;
  clippedBy: string[];
  outlineClippedBy: string[];
  inheritMaskingForChildren?: boolean;
  stopInheritedMasking?: boolean;
  inheritGroupsForChildren?: boolean;
  stopInheritedGroups?: boolean;
  outlineZIndex?: number;
  pointerEvents?: boolean;
  pointerEventsTarget?: string;
  blendMode?: CSSProperties["mixBlendMode"];
  zIndexMode: "relative" | "absolute";
  maskOutline: boolean;
  disableOutlineHoisting?: boolean;
  clipMaskContribution?: boolean;
  opacity?: number;
  renderGroup?: RenderGroup;
  debugColor?: string;
  drivers?: Omit<NodeDriver, "mirror">[];
}

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
        maskGroups: [],
        maskGroupModes: {},
        parentMaskedBy: [],
        maskedBy: [],
        outlineMaskedBy: [],
        clippingGroups: [],
        clipOutsets: {},
        maskOutsets: {},
        clippedBy: [],
        outlineClippedBy: [],
        zIndexMode: "relative",
        maskOutline: false,
      } satisfies BuilderState);
  }

  /** helper to create a new builder with modified state */
  private with(patch: Partial<BuilderState>): NodeBuilder {
    return new NodeBuilder(this._state.name, { ...this._state, ...patch });
  }

  setJointPosition(x: number, y: number): NodeBuilder {
    return this.with({
      translateX: this._state.translateX + x,
      translateY: this._state.translateY + y,
    });
  }

  setScale(x: number, y: number): NodeBuilder {
    return this.scalesWithX(x).scalesWithY(y);
  }

  setRotation(d: number): NodeBuilder {
    return this.with({ rotation: d });
  }

  setFixedRotation(enabled: boolean, max?: number): NodeBuilder {
    return this.with({ fixedRotation: { enabled, max } });
  }

  fixedRotation(enabled: boolean, max?: number): NodeBuilder {
    return this.setFixedRotation(enabled, max);
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

  scalesWithFrom(n: number, x: number, y: number): NodeBuilder {
    return this.scalesWithXFrom(n, x).scalesWithYFrom(n, y);
  }

  scalesWithXFrom(n: number, x: number): NodeBuilder {
    return this.scalesWithX(n).translatesWithX((1 - n) * x);
  }

  scalesWithYFrom(n: number, y: number): NodeBuilder {
    return this.scalesWithY(n).translatesWithY((1 - n) * y);
  }

  scalesWith(...n: number[]): NodeBuilder {
    return this.scalesWithX(...n).scalesWithY(...n);
  }

  scalesWithX(...xs: number[]): NodeBuilder {
    const newScaleX = xs.reduce((prev, curr) => prev * curr, this._state.scaleX);
    return this.with({ scaleX: newScaleX });
  }

  scalesWithY(...ys: number[]): NodeBuilder {
    const newScaleY = ys.reduce((prev, curr) => prev * curr, this._state.scaleY);
    return this.with({ scaleY: newScaleY });
  }

  translatesWithX(...xs: number[]): NodeBuilder {
    const newTranslateX = xs.reduce((prev, curr) => prev + curr, this._state.translateX);
    return this.with({ translateX: newTranslateX });
  }

  translatesWithY(...ys: number[]): NodeBuilder {
    const newTranslateY = ys.reduce((prev, curr) => prev + curr, this._state.translateY);
    return this.with({ translateY: newTranslateY });
  }

  rotatesWith(...ds: number[]): NodeBuilder {
    const newRotation = ds.reduce((prev, curr) => prev + curr, this._state.rotation);
    return this.with({ rotation: newRotation });
  }

  /**
   * Computes part of this node's transform, or its visibility, from the pose each time it is solved,
   * instead of baking it in when the tree is built: a pose change then moves the node without a
   * rebuild. `drive` reads joint rotations (`pose.rotations`) or named values (`pose.values`) and
   * supplies its own defaults for anything missing. The output combines like `rotatesWith`,
   * `translatesWithX`/`Y`, `scalesWithX`/`Y` and `skewsWith`, and `buildLeft` mirrors it the same
   * way. Drivers stack: each one added applies on top of the others.
   */
  addDriver(drive: (pose: Pose) => DriverOutput): NodeBuilder {
    return this.with({ drivers: [...(this._state.drivers ?? []), { evaluate: drive }] });
  }

  skewsWith(x: number = 0, y: number = 0): NodeBuilder {
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

  setShape(s: Shape): NodeBuilder {
    return this.with({ shape: s });
  }

  setSkew(x: number, y: number): NodeBuilder {
    return this.with({ skew: { x, y } });
  }

  setSprite(sprite: Sprite): NodeBuilder {
    return this.with({ sprite });
  }

  noSprite(b: boolean = true): NodeBuilder {
    return this.with({ noSprite: b });
  }

  setMask(mask: Sprite | undefined): NodeBuilder {
    if (mask === undefined) {
      return this;
    }

    return this.with({ mask });
  }

  setClip(clip: Sprite): NodeBuilder {
    return this.with({ clip });
  }

  setClipIf(condition: boolean, clip: Sprite): NodeBuilder {
    if (condition) {
      return this.setClip(clip);
    }
    return this;
  }

  addMaskGroups(...names: string[]): NodeBuilder {
    if (!names.length) {
      return this;
    }
    const nextModes = { ...this._state.maskGroupModes };
    const nextGroups = [...this._state.maskGroups];
    names.forEach((name) => {
      if (!nextGroups.includes(name)) {
        nextGroups.push(name);
      }
      if (nextModes[name] === undefined) {
        nextModes[name] = "positive";
      }
    });
    return this.with({
      maskGroups: nextGroups,
      maskGroupModes: nextModes,
    });
  }

  addMaskGroup(name: string | undefined, mode: "positive" | "negative" = "positive", outset?: number): NodeBuilder {
    if (!name) return this;
    const nextGroups = this._state.maskGroups.includes(name)
      ? this._state.maskGroups
      : [...this._state.maskGroups, name];
    const next = this.with({
      maskGroups: nextGroups,
      maskGroupModes: { ...this._state.maskGroupModes, [name]: mode },
    });
    return outset === undefined ? next : next.setMaskOutset(name, outset);
  }

  /** Grows this node's shape in the named mask group by `outset` (world units, like outlineWidth). */
  setMaskOutset(name: string, outset: number): NodeBuilder {
    return this.with({
      maskOutsets: { ...this._state.maskOutsets, [name]: outset },
    });
  }

  addNegativeMaskGroup(name?: string): NodeBuilder {
    return this.addMaskGroup(name, "negative");
  }

  addMaskedBy(...names: Array<string | undefined | null>): NodeBuilder {
    const filtered = names.filter((value): value is string => typeof value === "string" && value.length > 0);
    if (!filtered.length) {
      return this;
    }
    return this.with({ maskedBy: [...this._state.maskedBy, ...filtered] });
  }

  /** Masks this node's mask outline by these mask groups instead of its `addMaskedBy` ones. */
  addOutlineMaskedBy(...names: Array<string | undefined | null>): NodeBuilder {
    const filtered = names.filter((value): value is string => typeof value === "string" && value.length > 0);
    if (!filtered.length) {
      return this;
    }
    return this.with({ outlineMaskedBy: [...this._state.outlineMaskedBy, ...filtered] });
  }

  addClippingGroups(...names: Array<string | undefined | null>): NodeBuilder {
    const filtered = names.filter((value): value is string => typeof value === "string" && value.length > 0);
    if (!filtered.length) {
      return this;
    }
    return this.with({
      clippingGroups: [...this._state.clippingGroups, ...filtered],
    });
  }

  addClippingGroup(name: string | undefined | null, outset?: number): NodeBuilder {
    return this.addClippingGroups(name).setClipOutset(name ?? "", outset ?? 0);
  }

  setClipOutset(name: string, outset: number): NodeBuilder {
    return this.with({
      clipOutsets: { ...this._state.clipOutsets, [name]: outset },
    });
  }

  setParentMaskedBy(...names: string[]): NodeBuilder {
    const filtered = names.filter((name) => name.length > 0);
    if (!filtered.length) return this;
    return this.with({ parentMaskedBy: [...this._state.parentMaskedBy, ...filtered] });
  }

  addParentMaskedBy(...names: string[]): NodeBuilder {
    return this.setParentMaskedBy(...names);
  }

  addClippedBy(...names: Array<string | undefined | null>): NodeBuilder {
    const filtered = names.filter((value): value is string => typeof value === "string" && value.length > 0);
    if (!filtered.length) {
      return this;
    }
    return this.with({ clippedBy: [...this._state.clippedBy, ...filtered] });
  }

  /** Clips this node's mask outline by these clip groups instead of its `addClippedBy` ones. */
  addOutlineClippedBy(...names: Array<string | undefined | null>): NodeBuilder {
    const filtered = names.filter((value): value is string => typeof value === "string" && value.length > 0);
    if (!filtered.length) {
      return this;
    }
    return this.with({ outlineClippedBy: [...this._state.outlineClippedBy, ...filtered] });
  }

  /**
   * When enabled, this node's own maskedBy (mask groups) and clippedBy (clip groups)
   * values are automatically inherited by every descendant joint and attachment, in
   * addition to whatever they already have — no need to repeat them on every child.
   */
  inheritMaskingForChildren(enabled: boolean = true): NodeBuilder {
    return this.with({ inheritMaskingForChildren: enabled });
  }

  /**
   * When enabled, this node ignores any maskedBy/clippedBy values being passed down from
   * an ancestor's inheritMaskingForChildren — breaking the chain here so this node (and,
   * since inheritance stops at the source, its descendants) stop receiving them. Does not
   * affect this node's own explicit addMaskedBy/addClippedBy values.
   */
  stopInheritedMasking(enabled: boolean = true): NodeBuilder {
    return this.with({ stopInheritedMasking: enabled });
  }

  /**
   * When enabled, this node's own maskGroups/clippingGroups (the mask and clip
   * groups it defines/belongs to, along with their maskGroupModes) are automatically
   * inherited by every descendant joint and attachment, in addition to whatever groups
   * they already declare. Every descendant then also contributes its geometry to those
   * same mask/clip groups — no need to repeat addMaskGroup/addClippingGroups on each child.
   */
  inheritGroupsForChildren(enabled: boolean = true): NodeBuilder {
    return this.with({ inheritGroupsForChildren: enabled });
  }

  /**
   * When enabled, this node ignores any maskGroups/clippingGroups/maskGroupModes
   * being passed down from an ancestor's inheritGroupsForChildren — breaking the chain
   * here so this node (and its descendants) stop receiving them. Does not affect this
   * node's own explicit addMaskGroup/addClippingGroups declarations.
   */
  stopInheritedGroups(enabled: boolean = true): NodeBuilder {
    return this.with({ stopInheritedGroups: enabled });
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

  setMaskOutline(maskOutline: boolean): NodeBuilder {
    return this.with({ maskOutline });
  }

  disableOutlineHoisting(): NodeBuilder {
    return this.with({ disableOutlineHoisting: true });
  }

  /**
   * This node adds only its clipped (addClippedBy) shape to its mask groups, not its full sprite.
   * Done with a soft mask of each clip group, since browsers ignore clip-path inside <mask> content.
   */
  clipMaskContribution(): NodeBuilder {
    return this.with({ clipMaskContribution: true });
  }

  mirrorX(b: boolean): NodeBuilder {
    return this.scalesWithX(b ? -1 : 1);
  }

  transformsWith(transformState: TransformState): NodeBuilder;
  transformsWith(transform: Transform): NodeBuilder;
  transformsWith(transform: TransformState | Transform): NodeBuilder {
    if ("positionX" in transform) {
      return this.translatesWithX(transform.positionX)
        .translatesWithY(transform.positionY)
        .rotatesWith(transform.rotation)
        .skewsWith(transform.skewX, transform.skewY)
        .scalesWithX(transform.scaleX)
        .scalesWithY(transform.scaleY);
    }
    return this.translatesWithX(transform.translate.x)
      .translatesWithY(transform.translate.y)
      .rotatesWith(transform.rotate)
      .skewsWith(transform.skew?.x ?? 0, transform.skew?.y ?? 0)
      .scalesWithX(transform.scale.x)
      .scalesWithY(transform.scale.y);
  }

  withTransform(transformState: TransformState): NodeBuilder;
  withTransform(transform: Transform): NodeBuilder;
  withTransform(transform: undefined): NodeBuilder;
  withTransform(transform: TransformState | Transform | undefined): NodeBuilder;
  withTransform(transform: TransformState | Transform | undefined): NodeBuilder {
    if (!transform) {
      return this;
    }
    return this.transformsWith(transform as TransformState & Transform);
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

    const clip = s.clip
      ? {
          ...s.clip,
          translate: {
            x: s.clip.translate.x * mult,
            y: s.clip.translate.y,
          },
          scale: {
            x: s.clip.scale.x * mult,
            y: s.clip.scale.y,
          },
        }
      : undefined;

    return {
      id: s.name + suffix,
      name: s.name + suffix,
      translate: { x: s.translateX * mult, y: s.translateY },
      scale: { x: s.scaleX, y: s.scaleY },
      rotate: s.rotation * mult,
      fixedRotation: s.fixedRotation,
      fixedScale: s.fixedScale,
      patternSpace: s.patternSpace,
      gradientSpace: s.gradientSpace,
      aimAt: s.aimAt
        ? {
            ...s.aimAt,
            point: { x: s.aimAt.point.x * mult, y: s.aimAt.point.y },
            from: s.aimAt.from && { x: s.aimAt.from.x * mult, y: s.aimAt.from.y },
          }
        : undefined,
      pinTo: s.pinTo,
      sprite: {
        ...s.sprite,
        translate: {
          x: s.sprite.translate.x * mult,
          y: s.sprite.translate.y,
        },
        scale: {
          x: s.sprite.scale.x * mult,
          y: s.sprite.scale.y,
        },
      },
      skew: {
        x: (s.skew?.x ?? 0) * mult,
        y: (s.skew?.y ?? 0) * mult,
      },
      joints: s.joints,
      attachments: [...s.attachments],
      zIndex: s.zIndex,
      articulated: s.articulated,
      noSprite: s.noSprite,
      maskedBy: s.maskedBy,
      outlineMaskedBy: s.outlineMaskedBy.length ? s.outlineMaskedBy : undefined,
      maskGroups: s.maskGroups,
      maskGroupModes: s.maskGroupModes,
      parentMaskedBy: s.parentMaskedBy,
      clippedBy: s.clippedBy,
      outlineClippedBy: s.outlineClippedBy.length ? s.outlineClippedBy : undefined,
      clippingGroups: s.clippingGroups,
      clipOutsets: Object.keys(s.clipOutsets).length > 0 ? s.clipOutsets : undefined,
      maskOutsets: Object.keys(s.maskOutsets).length > 0 ? s.maskOutsets : undefined,
      inheritMaskingForChildren: s.inheritMaskingForChildren,
      stopInheritedMasking: s.stopInheritedMasking,
      inheritGroupsForChildren: s.inheritGroupsForChildren,
      stopInheritedGroups: s.stopInheritedGroups,
      mask: mask,
      clip: clip,
      outlineZIndex: s.outlineZIndex,
      pointerEvents: s.pointerEvents,
      pointerEventsTarget: s.pointerEventsTarget,
      blendMode: s.blendMode,
      zIndexMode: s.zIndexMode,
      maskOutline: s.maskOutline,
      disableOutlineHoisting: s.disableOutlineHoisting,
      clipMaskContribution: s.clipMaskContribution,
      opacity: s.opacity,
      renderGroup: s.renderGroup,
      debugColor: s.debugColor,
      drivers: s.drivers?.map((driver) => ({ ...driver, mirror: mult < 0 ? -1 : 1 })),
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
