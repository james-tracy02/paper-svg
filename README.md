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

### Masks and clips

Nodes can cut each other out, across different branches of the tree. Both systems work by group name:

| Purpose                 | Soft mask (`<mask>`) | Hard clip (`<clipPath>`) |
| ----------------------- | -------------------- | ------------------------ |
| Add a shape to a group  | `addMaskGroup(name)` | `addClippingGroup(name)` |
| Restrict a node to it   | `addMaskedBy(name)`  | `addClippedBy(name)`     |

Masks support soft edges and negative groups (`addNegativeMaskGroup`). Clips are cheaper and have hard edges.

`inheritMaskingForChildren()` passes a node's restrictions to its descendants. `inheritGroupsForChildren()` adds its descendants to its groups.

> A node restricted to a group that no node defines is not drawn.

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

The repository includes a posable puppet that shows joints, mirroring, clipping, constraints, custom sprites and effects:

```sh
npm install
npm run demo
```

## License

[MIT](./LICENSE)
