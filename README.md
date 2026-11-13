# paper-svg

Build articulated 2D characters and puppets from a tree of joints and sprites, then render them to SVG with React.

You describe a skeleton with chainable builders. `paper-svg` resolves the transforms, layers the sprites by z-index, and generates the masks, clip paths and outlines.

## Install

```sh
npm install paper-svg
```

`react` 18 or later is a peer dependency.

## Quick start

```tsx
import { NodeBuilder, Rig, SpriteBuilder } from "paper-svg";

const skin = new SpriteBuilder().setFill("#e8b796").setStroke("#222").setStrokeWidth(2);

const forearm = new NodeBuilder("forearm")
  .setPosition(0, -60)
  .setRotation(25)
  .setSprite(skin.setShape("rect").setScale(0.9, 6).setOffset(0, -30).build());

const arm = new NodeBuilder("arm")
  .setPosition(30, 40)
  .setRotation(20)
  .setSprite(skin.setShape("rect").setScale(1, 6).setOffset(0, -30).build());

const body = new NodeBuilder("torso")
  .setSprite(skin.setShape("ellipse").setScale(6, 10).build())
  .addJoints(
    arm.addJoints(forearm.buildRight()).buildRight(),
    arm.addJoints(forearm.buildLeft()).buildLeft(),
  )
  .build();

export const Character = () => (
  <svg viewBox="-150 -150 300 300">
    <Rig body={body} />
  </svg>
);
```

`Rig` renders SVG elements, so place it inside an `<svg>`. The root node's joint is at the origin of that SVG, so use a `viewBox` that includes `0, 0`.

## Concepts

### Coordinates

- Positive y points **up**, for both joint positions and sprite offsets.
- Positive rotation is **clockwise**, in degrees.
- A joint is a node's pivot. Its sprite is drawn relative to the joint, so offset a limb by half its length to make it hang from the joint.
- Built-in shapes are 10 units across at scale 1.

### Joints and attachments

A node has two kinds of children:

|                     | `addJoints`                    | `addAttachments`              |
| ------------------- | ------------------------------ | ----------------------------- |
| Use for             | Limbs and other moving parts   | Details that ride on a parent |
| Parent's scale      | Moves the child, does not resize it | Moves and resizes the child |
| Rotates when pressed | Yes                           | No, the press goes to the nearest articulated ancestor |

Use `setArticulated(true)` or `setArticulated(false)` to override the default for a node.

### Builders

`NodeBuilder` and `SpriteBuilder` are immutable. Every call returns a new builder, so you can share a base and branch from it, as `skin` and `arm` do above.

`set*` methods replace a value. Methods ending in `By` combine with what is there:

| Method                        | Effect                                                        |
| ----------------------------- | ------------------------------------------------------------- |
| `moveBy(x, y)`                | Adds to the position (`NodeBuilder`) or offset (`SpriteBuilder`) |
| `scaleBy(x, y = x)`           | Multiplies the scale; `NodeBuilder`'s takes `{ from }` to scale about a point |
| `rotateBy(d)`                 | Adds to the rotation                                          |
| `skewBy(x, y)`                | Adds to the skew (`NodeBuilder`)                              |
| `transformBy(t)`              | Applies a whole transform on top (`NodeBuilder`)              |

Upgrading from 0.1, where `setJointPosition` added and `NodeBuilder.setScale` multiplied: before you
upgrade, with 0.1 still installed, run the codemod that ships with 0.3 against your project:

```sh
npm pack paper-svg@0.3.0 && tar xzf paper-svg-0.3.0.tgz
node package/scripts/migrate-0.3.mjs tsconfig.json --write
```

It rewrites each old call to the method that does the same thing (including 0.1's
`addOutlineClippedBy`, which was a mask and is now `addOutlineMaskedBy`). Then upgrade to 0.3.

### Left and right sides

Build one side, then mirror it:

- `build()` keeps the node's name as its id.
- `buildRight()` adds the suffix `_right`.
- `buildLeft()` adds the suffix `_left` and mirrors x positions, sprites and rotation.

Children are already built when you add them, so build them for the matching side, as in the quick start.

### Layering

`setZIndex(z)` is relative to the parent by default. `setZIndex(z, "absolute")` ignores the parent.

`setOutlineZIndex(z)` draws the node's stroke as a separate layer. Put it below the fills of neighboring parts to make connected parts look like one outlined shape.

### Regions

Nodes can cut each other out, across different branches of the tree, through named regions. A region is the
shapes of the nodes that join it; a node cut by it draws only inside it.

| Call                                    | Does                                                           |
| --------------------------------------- | -------------------------------------------------------------- |
| `addToRegion(name)`                     | Adds the node's shape to the region                            |
| `addToRegion(name, { subtract: true })` | Removes the node's shape from it                               |
| `addToRegion(name, { outset: 1 })`      | Grows the node's shape in it                                   |
| `cutBy(name)`                           | Draws the node only inside the region                          |
| `setCut(sprite)`                        | Draws the node only inside a shape of its own                  |
| `traceOutline()`                        | Where the node covers its regions' outlines, draws them in its outline colour |

A node cut by a region stays inside its members' outlines. By default each member lifts its outline above the
nodes the region cuts (hoisting); `addToRegion(name, { inset: true })`, or `insetOutlines()` for all of a node's
regions, cuts the outline out of the region instead, so the outline keeps its own z-index.

You don't choose between `<clipPath>` and `<mask>`: the engine draws a region as a clip-path where its edges are
hard, which is cheaper, and as a mask where it subtracts or cuts out an outline.

`regionsForChildren()` adds a node's descendants to its regions; `cutsForChildren()` cuts its descendants by its
cuts. `stopInheritedRegions()` and `stopInheritedCuts()` end that for a node and its descendants.

> A node cut by a region that no node joins is not drawn.

Upgrading from 0.3: run `node node_modules/paper-svg/scripts/migrate-0.4.mjs tsconfig.json --write`. It rewrites
each mask and clip call to the region call that draws the same: mask groups become regions with `inset: true`.

### Constraints

Both constraints use a target's full id, including any `_left` or `_right` suffix. A node can target any node in the tree.

- `setAimAt(targetId, point)` keeps a node rotated toward a point on the target.
- `setPinTo(targetId, point)` keeps a node's joint on a point on the target.

## Custom sprites

Turn SVG markup into a sprite. Each distinct fill becomes a color slot, numbered in the order it first appears.

```ts
import { makeSprite, registerCustomSprite, SpriteBuilder } from "paper-svg";

registerCustomSprite(makeSprite("hand", svgText));

const hand = new SpriteBuilder()
  .setCustomSprite("hand")
  .setCustomColors("#e8b796", "#c9926f")
  .setStroke("#222")
  .setStrokeWidth(2)
  .build();
```

Register a sprite before you call `setCustomSprite` with its id, because the name is resolved at that call. You can also pass the `CustomSprite` object directly.

`makeSprite` measures paths with the DOM, so it runs only in a browser.

## `Rig` props

| Prop                    | Description                                                                 |
| ----------------------- | --------------------------------------------------------------------------- |
| `body`                  | Root `Node` to render. Required.                                            |
| `idPrefix`              | Prefix for generated SVG ids. Give each rig in a document a unique value.   |
| `scale`, `mirror`       | Scale or horizontally flip the whole rig.                                   |
| `onRotate`              | `(id, pivot) => (event) => void`. Called when an articulated node is pressed. |
| `colorTransform`        | Changes each sprite color at paint time, for example for scene lighting.    |
| `effects`               | `outerOutline`, `glow`, `tint`, `blur`, `opacity`, `isHidden`.              |
| `getRenderGroupOptions` | Mask, clip, opacity and blend mode for nodes grouped with `setRenderGroup`. |
| `showPivots`            | Draws joint markers for debugging.                                          |

### Rotation

`Rig` does not store poses. `onRotate` gives you the id of the node to rotate and its joint's screen position. Track the pointer, store the angle in your state, and rebuild the tree with the new `setRotation` value.

### Zoom

Strokes keep the same width on screen when the SVG is scaled. If you zoom by changing the `viewBox`, set `getZoomVars(zoom)` as the `<svg>` element's `style` so stroke widths follow the zoom.

## Animation

An animation is an object whose `update(dt, time)` returns a `PoseLayer` each frame: rotations and translations to add to the pose, scales to multiply it by, and values. An animator stacks animations, fades them in and out, and layers them onto a base pose. `useAnimator` runs one per frame and writes each frame with `Rig`'s `setPose`, so playing an animation doesn't cost a React render.

```tsx
import { continuous, oscillate, useAnimator, wave, type RigHandle } from "paper-svg";

const breathe = continuous((time) => ({
  scales: { torso: { x: 1, y: 1 + 0.02 * wave(time, 4000) } },
  // Pose rotations aren't mirrored: negate the left side so the arms mirror each other.
  rotations: { arm_right: oscillate(time, 6000), arm_left: -oscillate(time, 6000) },
}));

const rig = useRef<RigHandle>(null);
const animator = useAnimator({ base: () => pose, write: (next) => rig.current?.setPose(next) });

animator.add("breathe", breathe, { fadeMs: 400 });
animator.remove("breathe", { fadeMs: 400 });
```

- **Input.** An animation can read anything it closes over, such as a ref to the pointer, and keep state between frames. `damp` eases a value toward a moving target at any frame rate.
- **One-shots.** `oneShot(durationMs, sample)` plays once and is then dropped. `keyframes` builds a track to sample in it. When the last animation ends, one more frame writes the base pose alone, so the rig goes back to rest.
- **Values.** Pose values combine by name. Pass `values` rules to the animator: `add` (the default), `min` (e.g. eye openness, so a blink can only close the eyes), `max` or `override`.
- **Swapping parts.** A driver's `visible` can switch between versions of a part, such as an open and a closed eye. Hidden nodes stay in the markup with `display="none"`, so `setPose` shows and hides them without a React render.
- **Without React.** `createAnimator` holds no clock and touches no DOM; call `tick(now)` and `apply(base)` yourself, or use `runAnimator` with your own `write`. `layerPose` applies weighted layers to a pose directly.

## Lower-level APIs

| API                                                | Use                                                  |
| -------------------------------------------------- | ---------------------------------------------------- |
| `getRenderNodes`                                   | Resolve a tree to world matrices without React.      |
| `useRenderNodes`, `RigLayers`                      | Add your own selection, overlays or filters.         |
| `resolveRotationPivot`                             | Find a joint's screen position in a custom handler.  |
| `SvgSprite`                                        | Draw one sprite, for example in a thumbnail.         |
| `matrixToTransform`, `applyMatrixToPoint` and others | Matrix and drag math.                              |

## Server rendering

`Rig` renders on the server. Gradients are the exception: their definitions are added on the client, so gradient fills appear after hydration.

## Demo

The repository includes a posable puppet that shows joints, mirroring, clipping, constraints, custom sprites, effects and animation:

```sh
npm install
npm run demo
```

## License

[MIT](./LICENSE)
