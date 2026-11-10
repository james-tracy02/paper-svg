import React, { useMemo } from "react";
import type { Node } from "../types/Node";
import type { Sprite, CustomElement } from "../types/Sprite";
import { pathDefId } from "./hashKey";

function* customElements(sprite: Sprite): Generator<CustomElement> {
  if (sprite.customSprite) yield* sprite.customSprite.elements;
}

function* traverseElements(part: Node): Generator<CustomElement> {
  yield* customElements(part.sprite);
  if (part.mask) yield* customElements(part.mask);
  if (part.clip) yield* customElements(part.clip);
  if (part.sprite.pattern) yield* customElements(part.sprite.pattern);
  if (part.joints) for (const j of part.joints) yield* traverseElements(j);
  if (part.attachments) for (const a of part.attachments) yield* traverseElements(a);
}

export type SpriteDefsProps = {
  body: Node;
};

/**
 * One <path> per distinct custom sprite path, which every copy of it (fill, mask variants, hit area) references through
 * <use>. Plain <path>s rather than <symbol>s, which would add a nested viewport per use. Simple shapes are cheaper inline.
 */
const SpriteDefs: React.FC<SpriteDefsProps> = ({ body }) => {
  const defs = useMemo(() => {
    const seen = new Set<string>();
    const nodes: React.ReactNode[] = [];
    for (const el of traverseElements(body)) {
      if (!el.d || seen.has(el.d)) continue;
      seen.add(el.d);
      const id = pathDefId(el.d);
      nodes.push(<path id={id} key={id} d={el.d} vectorEffect="non-scaling-stroke" />);
    }
    if (!nodes.length) return null;
    return <defs>{nodes}</defs>;
  }, [body]);

  return defs;
};

export default SpriteDefs;
