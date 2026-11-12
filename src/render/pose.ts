/**
 * A rig is a node tree flattened once; a pose is joint values applied on top of it. Solving a pose
 * computes every node's world matrix in one pass, without rebuilding the tree: a pose change costs
 * matrix maths only. The per-node maths is RenderTree's own (`resolveNodeTransform`), so a solved
 * pose matches `getRenderNodes` on the same tree with the same rotations; RenderTree builds its
 * render nodes from a solved pose. Drivers (`NodeBuilder.addDriver`) are evaluated here, so values
 * that follow a joint move with the pose too.
 */
import type { Node } from "../types/Node";
import type { Pose } from "../types/Pose";
import type { Vector2 } from "../types/primitives";
import type { CustomSprite, Sprite } from "../types/Sprite";
import type { MatrixTransform } from "../types/Transform";
import { getGradientFrame } from "./gradient";
import {
  IDENTITY_MATRIX,
  resolveArrivePath,
  resolveNodeTransform,
  resolvePatternSpace,
  type TargetMatrices,
} from "./nodeTransform";
import {
  combineMatrixTransforms,
  invertMatrixTransform,
  matrixTransformToSvg,
  spriteUserSpace,
  transformToMatrixWithMatrix,
} from "./transform";

export type { Pose };

export type RigEntry = {
  node: Node;
  /** Index of the parent entry; -1 for the root. */
  parent: number;
  /** How the node hangs from its parent: joints move with the parent's scale, attachments are also sized by it. */
  via: "root" | "joint" | "attachment";
};

export type Rig = {
  /** Every node, parents before children (joints before attachments, as `getRenderNodes` lists them). */
  readonly entries: readonly RigEntry[];
  /** Entry index by node id. A node's outline id (`<id>_outline`) maps to the node, which it shares a matrix with. */
  readonly indexById: ReadonlyMap<string, number>;
};

export type PoseSolution = {
  /** World matrix per rig entry, in `rig.entries` order. */
  matrices: MatrixTransform[];
  /** The matrix each entry hangs from: its parent's world matrix, or for a joint the parent's without its scale. */
  parentMatrices: MatrixTransform[];
  /** Parent scale applied to each entry's position (see RenderNode.translateScale). */
  translateScales: Vector2[];
  /** Frame patterns tile in at each entry: its own `patternSpace`, else its nearest ancestor's. */
  patternSpaces: (MatrixTransform | undefined)[];
  /** Gradient frame each entry passes to its descendants: its own `gradientSpace: "define"`, else its ancestor's. */
  gradientSpaces: (MatrixTransform | undefined)[];
  /** For `gradientSpace: "inherit"` entries: the SVG gradientTransform that draws in the ancestor's frame. */
  gradientTransforms: (string | undefined)[];
  /** The path an entry draws instead of its sprite's: a driver's `path`, or an `aimAt.arrive` curve. */
  dynamicPaths: (string | undefined)[];
  /** The custom sprite a driver swaps in for an entry's own. */
  customSprites: (CustomSprite | undefined)[];
  /** The mask a driver sets in place of an entry's own (`null`: none); undefined where no driver does. */
  masks: (Sprite | null | undefined)[];
  /** Entries a driver hides (`visible: false`), directly or through an ancestor. */
  hidden: boolean[];
  /** What drivers add to each entry's z-index, and to its outline's. */
  zOffsets: number[];
  outlineZOffsets: number[];
  /**
   * The same for every pose that gives each entry the same z offsets. Draw order follows z, so the
   * layer plan only needs redoing when this changes.
   */
  zKey: string;
};

type PosedEntry = {
  node: Node;
  hidden: boolean;
  zOffset: number;
  outlineZOffset: number;
  path?: string;
  customSprite?: CustomSprite;
  mask?: Sprite | null;
};

/** Left-side copies of driver masks, mirrored as `buildLeft` mirrors a node's own, kept so a mask keeps its identity. */
const mirroredMasks = new WeakMap<Sprite, Sprite>();
const mirrorMask = (mask: Sprite): Sprite => {
  let mirrored = mirroredMasks.get(mask);
  if (!mirrored) {
    mirrored = {
      ...mask,
      translate: { x: mask.translate.x * -1, y: mask.translate.y },
      scale: { x: mask.scale.x * -1, y: mask.scale.y },
    };
    mirroredMasks.set(mask, mirrored);
  }
  return mirrored;
};

const UNIT_SCALE: Vector2 = { x: 1, y: 1 };

/**
 * `node` with its pose rotation and its drivers' outputs applied, and whether a driver hides it.
 * Returns `node` itself when neither changes it.
 */
const applyPose = (node: Node, pose: Pose): PosedEntry => {
  const posedRotation = pose.rotations?.[node.id] ?? 0;
  const posedTranslation = pose.translations?.[node.id];
  const posedScale = pose.scales?.[node.id];
  if (!node.drivers?.length && !posedTranslation && !posedScale) {
    const posed = posedRotation ? { ...node, transform: { ...node.transform, rotate: node.transform.rotate + posedRotation } } : node;
    return { node: posed, hidden: false, zOffset: 0, outlineZOffset: 0 };
  }
  const rest = node.transform;
  let rotate = rest.rotate + posedRotation;
  let x = rest.translate.x + (posedTranslation?.x ?? 0);
  let y = rest.translate.y + (posedTranslation?.y ?? 0);
  let scaleX = rest.scale.x * (posedScale?.x ?? 1);
  let scaleY = rest.scale.y * (posedScale?.y ?? 1);
  let skewX = rest.skew?.x ?? 0;
  let skewY = rest.skew?.y ?? 0;
  let hidden = false;
  let zOffset = 0;
  let outlineZOffset = 0;
  let path: string | undefined;
  let customSprite: CustomSprite | undefined;
  let mask: Sprite | null | undefined;
  for (const driver of node.drivers ?? []) {
    const out = driver.evaluate(pose);
    const m = driver.mirror;
    rotate += (out.rotate ?? 0) * m;
    x += (out.x ?? 0) * m;
    y += out.y ?? 0;
    scaleX *= out.scaleX ?? 1;
    scaleY *= out.scaleY ?? 1;
    skewX += (out.skewX ?? 0) * m;
    skewY += (out.skewY ?? 0) * m;
    if (out.visible === false) hidden = true;
    zOffset += out.zIndex ?? 0;
    outlineZOffset += out.outlineZIndex ?? 0;
    path = out.path ?? path;
    customSprite = out.customSprite ?? customSprite;
    if (out.mask !== undefined) mask = out.mask && m < 0 ? mirrorMask(out.mask) : out.mask;
  }
  const skew = rest.skew || skewX || skewY ? { x: skewX, y: skewY } : undefined;
  const sprite =
    path !== undefined || customSprite
      ? { ...node.sprite, dynamicPath: path ?? node.sprite.dynamicPath, customSprite: customSprite ?? node.sprite.customSprite }
      : node.sprite;
  return {
    node: { ...node, transform: { ...rest, rotate, translate: { x, y }, scale: { x: scaleX, y: scaleY }, skew }, sprite },
    hidden,
    zOffset,
    outlineZOffset,
    path,
    customSprite,
    mask,
  };
};

/**
 * `body` with `pose` and its drivers folded in: a plain tree, without drivers, that draws what `body`
 * draws in `pose`. For saving a posed body as data (drivers are functions); render with a pose instead.
 * A node a driver hides becomes `noSprite`, with everything under it.
 */
export const bakePose = (body: Node, pose: Pose = {}): Node => {
  const bake = (node: Node, parentHidden: boolean): Node => {
    const posed = applyPose(node, pose);
    const hidden = parentHidden || posed.hidden;
    const { drivers: _drivers, ...baked } = posed.node;
    void _drivers;
    const paint =
      hidden || posed.mask !== undefined
        ? {
            ...baked.paint,
            ...(hidden ? { noSprite: true } : {}),
            ...(posed.mask !== undefined ? { mask: posed.mask ?? undefined } : {}),
          }
        : baked.paint;
    const outline =
      posed.outlineZOffset && baked.outline?.zIndex !== undefined
        ? { ...baked.outline, zIndex: baked.outline.zIndex + posed.outlineZOffset }
        : baked.outline;
    return {
      ...baked,
      zIndex: posed.zOffset ? (node.zIndex ?? 0) + posed.zOffset : node.zIndex,
      paint,
      outline,
      joints: node.joints?.map((child) => bake(child, hidden)),
      attachments: node.attachments?.map((child) => bake(child, hidden)),
    };
  };
  return bake(body, false);
};

/** Flattens `root` into a rig. Build it once per structure; pose it with `solvePose`. */
export const createRig = (root: Node): Rig => {
  const entries: RigEntry[] = [];
  const indexById = new Map<string, number>();
  const add = (node: Node, parent: number, via: RigEntry["via"]) => {
    const index = entries.push({ node, parent, via }) - 1;
    indexById.set(node.id, index);
    if (node.outline?.zIndex !== undefined) indexById.set(`${node.id}_outline`, index);
    node.joints?.forEach((child) => add(child, index, "joint"));
    node.attachments?.forEach((child) => add(child, index, "attachment"));
  };
  add(root, -1, "root");
  return { entries, indexById };
};

const hasConstraint = (node: Node) => Boolean(node.follow?.aimAt || node.follow?.pinTo);

/** Thrown when a constraint's target can't be solved first: it depends on the constrained node itself. */
const CYCLE = Symbol("cycle");

/**
 * World matrices for `rig` in `pose`. Each `aimAt`/`pinTo` target is solved before the node that
 * uses it, so constraints see the target where it ends up. A target that depends on its own
 * constrained node (inside its subtree, or a cycle) can't come first; it is read from a solve
 * without constraints instead, as `getRenderNodes` reads every target.
 */
export const solvePose = (rig: Rig, pose: Pose = {}): PoseSolution => {
  const count = rig.entries.length;
  const matrices: MatrixTransform[] = new Array(count);
  const parentMatrices: MatrixTransform[] = new Array(count);
  const translateScales: Vector2[] = new Array(count);
  // The matrix a joint child hangs from: the entry's world matrix without its own scale.
  const jointBases: MatrixTransform[] = new Array(count);
  const dynamicPaths: (string | undefined)[] = new Array(count);
  const solving = new Uint8Array(count);
  let unconstrained: MatrixTransform[] | undefined;

  // Each node as this pose leaves it. Parents come first, so a hidden parent hides its children.
  const posedNodes: Node[] = new Array(count);
  const hidden: boolean[] = new Array(count);
  const zOffsets: number[] = new Array(count);
  const outlineZOffsets: number[] = new Array(count);
  const customSprites: (CustomSprite | undefined)[] = new Array(count);
  const masks: (Sprite | null | undefined)[] = new Array(count);
  const zKeyParts: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const { node, parent } = rig.entries[i];
    const posed = applyPose(node, pose);
    posedNodes[i] = posed.node;
    hidden[i] = posed.hidden || (parent >= 0 && hidden[parent]);
    zOffsets[i] = posed.zOffset;
    outlineZOffsets[i] = posed.outlineZOffset;
    customSprites[i] = posed.customSprite;
    masks[i] = posed.mask;
    if (posed.path !== undefined) dynamicPaths[i] = posed.path;
    if (posed.zOffset || posed.outlineZOffset) zKeyParts.push(`${i}:${posed.zOffset}:${posed.outlineZOffset}`);
  }

  /** One entry's matrices, given what it hangs from. */
  const solveEntry = (i: number, parentMatrix: MatrixTransform, targets: TargetMatrices | undefined) => {
    const { parent, via } = rig.entries[i];
    const scaleFactor = via === "joint" ? posedNodes[parent].transform.scale : UNIT_SCALE;
    const transform = resolveNodeTransform(posedNodes[i], parentMatrix, scaleFactor, targets);
    return {
      world: combineMatrixTransforms(parentMatrix, transformToMatrixWithMatrix(transform)),
      jointBase: combineMatrixTransforms(parentMatrix, transformToMatrixWithMatrix({ ...transform, scale: UNIT_SCALE })),
      scaleFactor,
    };
  };

  const hangsFrom = (i: number, worlds: MatrixTransform[], bases: MatrixTransform[]) => {
    const { parent, via } = rig.entries[i];
    if (parent < 0) return IDENTITY_MATRIX;
    return via === "joint" ? bases[parent] : worlds[parent];
  };

  /** Every entry without constraints, in entry order (parents come first). */
  const solveUnconstrained = () => {
    const worlds: MatrixTransform[] = new Array(count);
    const bases: MatrixTransform[] = new Array(count);
    for (let i = 0; i < count; i += 1) {
      const solved = solveEntry(i, hangsFrom(i, worlds, bases), undefined);
      worlds[i] = solved.world;
      bases[i] = solved.jointBase;
    }
    return worlds;
  };

  const targetsFor = (): TargetMatrices => ({
    get: (id) => {
      const index = rig.indexById.get(id);
      if (index === undefined) return undefined;
      try {
        return solve(index);
      } catch (error) {
        if (error !== CYCLE) throw error;
        unconstrained ??= solveUnconstrained();
        return unconstrained[index];
      }
    },
  });

  const solve = (i: number): MatrixTransform => {
    if (matrices[i]) return matrices[i];
    if (solving[i]) throw CYCLE;
    solving[i] = 1;
    try {
      const { node, parent } = rig.entries[i];
      if (parent >= 0) solve(parent);
      const parentMatrix = hangsFrom(i, matrices, jointBases);
      const targets = hasConstraint(node) ? targetsFor() : undefined;
      const solved = solveEntry(i, parentMatrix, targets);
      const aimAt = node.follow?.aimAt;
      if (aimAt?.arrive && targets) dynamicPaths[i] = resolveArrivePath(aimAt, solved.world, targets);
      matrices[i] = solved.world;
      jointBases[i] = solved.jointBase;
      parentMatrices[i] = parentMatrix;
      translateScales[i] = solved.scaleFactor;
      return solved.world;
    } finally {
      solving[i] = 0;
    }
  };

  for (let i = 0; i < count; i += 1) solve(i);

  // Pattern and gradient frames pass down the tree, so they follow entry order (parents first).
  const patternSpaces: (MatrixTransform | undefined)[] = new Array(count);
  const gradientSpaces: (MatrixTransform | undefined)[] = new Array(count);
  const gradientTransforms: (string | undefined)[] = new Array(count);
  for (let i = 0; i < count; i += 1) {
    const { parent } = rig.entries[i];
    // Posed, so a driven shape frames its gradient.
    const node = posedNodes[i];
    const world = matrices[i];
    const inheritedPattern = parent < 0 ? undefined : patternSpaces[parent];
    const inheritedGradient = parent < 0 ? undefined : gradientSpaces[parent];
    const { patternSpace, gradientSpace } = node.paint ?? {};
    patternSpaces[i] = patternSpace ? resolvePatternSpace(patternSpace, world, inheritedPattern) : inheritedPattern;
    gradientSpaces[i] =
      gradientSpace === "define"
        ? combineMatrixTransforms(spriteUserSpace(world, node.sprite), getGradientFrame(node.sprite))
        : inheritedGradient;
    if (gradientSpace === "inherit" && inheritedGradient) {
      const inverse = invertMatrixTransform(spriteUserSpace(world, node.sprite));
      if (inverse) gradientTransforms[i] = matrixTransformToSvg(combineMatrixTransforms(inverse, inheritedGradient), 6);
    }
  }

  return {
    matrices,
    parentMatrices,
    translateScales,
    patternSpaces,
    gradientSpaces,
    gradientTransforms,
    dynamicPaths,
    customSprites,
    masks,
    hidden,
    zOffsets,
    outlineZOffsets,
    zKey: zKeyParts.join(","),
  };
};
