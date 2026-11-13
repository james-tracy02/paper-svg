import paper from "paper";
import svgpath from "svgpath";
import type { CustomElement } from "../types/Sprite";
import { ensureSetup } from "./outsetPath";

/** Results by elements array and the indices kept, for a sprite drawn again without being rebuilt. */
const byElements = new WeakMap<readonly CustomElement[], Map<string, string | null>>();
/** Results by content, for a sprite rebuilt (SpriteBuilder copies its elements on every build). */
const byContent = new Map<string, string | null>();

/** The elements a clip-path draws: those with a filled path, limited to `indices` when given. */
export const clipElements = (elements: readonly CustomElement[], indices?: readonly number[]) => {
  const allowed = indices?.length ? new Set(indices) : null;
  return elements
    .map((element, index) => ({ element, index }))
    .filter(({ element, index }) => element.d && !element.noFill && (!allowed || allowed.has(index)));
};

/** Bounds of `a` and `b` agree to within `tolerance` on every side. */
const sameBounds = (a: paper.Rectangle, b: paper.Rectangle, tolerance: number) =>
  Math.abs(a.left - b.left) <= tolerance &&
  Math.abs(a.top - b.top) <= tolerance &&
  Math.abs(a.right - b.right) <= tolerance &&
  Math.abs(a.bottom - b.bottom) <= tolerance;

const unite = (elements: readonly CustomElement[]): string | null => {
  ensureSetup();
  const items: paper.PathItem[] = [];
  let result: paper.PathItem | undefined;
  try {
    for (const element of elements) {
      const d = element.transform ? svgpath(element.d!).transform(element.transform).toString() : element.d!;
      items.push(new paper.CompoundPath({ pathData: d, insert: false }));
    }
    result = items.reduce((acc, item) => acc.unite(item, { insert: false }));
    // A union covers exactly the pieces' bounds; anything else means the boolean op went wrong.
    const expected = items.map((item) => item.bounds).reduce((acc, bounds) => acc.unite(bounds));
    const tolerance = Math.max(expected.width, expected.height) * 1e-3;
    const d = result.pathData;
    return d && sameBounds(result.bounds, expected, tolerance) ? d : null;
  } catch {
    return null;
  } finally {
    for (const item of items) item.remove();
    result?.remove();
  }
};

/**
 * One path covering a custom sprite's clip elements (see clipElements), each element's transform baked in; null
 * when fewer than two elements are drawn or the union fails, so the caller draws the elements separately.
 *
 * The browser merges a <clipPath>'s children at draw time, in the clip's final transform, and Chromium's merge
 * fails on edges that coincide, or nearly do, at some transforms only: area drops out or appears at one rotation
 * (pieces of a sprite sharing an edge, such as shading traced along the base fill). Merged here once, in the
 * sprite's own space, the result doesn't depend on the transform. Cached.
 */
export const uniteClipElements = (elements: readonly CustomElement[], indices?: readonly number[]): string | null => {
  const indicesKey = indices?.join(",") ?? "";
  let known = byElements.get(elements);
  if (known?.has(indicesKey)) return known.get(indicesKey)!;

  const drawn = clipElements(elements, indices).map(({ element }) => element);
  let out: string | null = null;
  if (drawn.length > 1) {
    const key = drawn.map((element) => `${element.transform ?? ""}\u0001${element.d}`).join("\u0002");
    const cached = byContent.get(key);
    out = cached !== undefined ? cached : unite(drawn);
    if (cached === undefined) byContent.set(key, out);
  }
  if (!known) byElements.set(elements, (known = new Map()));
  known.set(indicesKey, out);
  return out;
};
