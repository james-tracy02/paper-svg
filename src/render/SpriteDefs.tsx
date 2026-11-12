import React, { useMemo } from "react";
import type { Node } from "../types/Node";
import type { Sprite, CustomElement } from "../types/Sprite";
import type { RenderNode } from "./RenderTree";
import { pathDefId } from "./hashKey";

function* customElements(sprite: Sprite | undefined): Generator<CustomElement> {
  if (sprite?.customSprite) yield* sprite.customSprite.elements;
}

function* traverseElements(part: Node): Generator<CustomElement> {
  yield* customElements(part.sprite);
  if (part.paint?.mask) yield* customElements(part.paint.mask);
  if (part.paint?.clip) yield* customElements(part.paint.clip);
  if (part.sprite.pattern) yield* customElements(part.sprite.pattern);
  if (part.joints) for (const j of part.joints) yield* traverseElements(j);
  if (part.attachments) for (const a of part.attachments) yield* traverseElements(a);
}

export type SpriteDefsProps = {
  body: Node;
  /**
   * The nodes being drawn, when their sprites can differ from the body's: a driver can swap in a custom
   * sprite the body doesn't have. Their paths are defined after the body's.
   */
  nodes?: readonly RenderNode[];
};

const pathDefs = (paths: Iterable<string>) =>
  [...paths].map((d) => {
    const id = pathDefId(d);
    return <path id={id} key={id} d={d} vectorEffect="non-scaling-stroke" />;
  });

/**
 * One <path> per distinct custom sprite path, which every copy of it (fill, mask variants, hit area) references through
 * <use>. Plain <path>s rather than <symbol>s, which would add a nested viewport per use. Simple shapes are cheaper inline.
 */
const SpriteDefs: React.FC<SpriteDefsProps> = ({ body, nodes }) => {
  const bodyPaths = useMemo(() => {
    const paths = new Set<string>();
    for (const el of traverseElements(body)) if (el.d) paths.add(el.d);
    return paths;
  }, [body]);

  // Paths only the drawn nodes have, joined into one string so the defs re-render only when that set changes.
  const extraKey = useMemo(() => {
    if (!nodes) return "";
    const extra = new Set<string>();
    for (const node of nodes) {
      for (const sprite of [node.sprite, node.mask, node.clip, node.pattern]) {
        for (const el of customElements(sprite)) if (el.d && !bodyPaths.has(el.d)) extra.add(el.d);
      }
    }
    return [...extra].join("\u0000");
  }, [nodes, bodyPaths]);

  return useMemo(() => {
    const defs = [...pathDefs(bodyPaths), ...(extraKey ? pathDefs(extraKey.split("\u0000")) : [])];
    return defs.length ? <defs>{defs}</defs> : null;
  }, [bodyPaths, extraKey]);
};

export default SpriteDefs;
