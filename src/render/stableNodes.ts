import type { RenderNode } from "./RenderTree";

/**
 * Structural equality. `seen` remembers pairs already found equal, so shared parents are compared once per pass.
 * A pair is recorded before its fields are walked, so self-references (articulated nodes are their own `parent`)
 * count as equal instead of recursing forever; it is dropped again if the fields differ.
 */
const deepEqual = (a: unknown, b: unknown, seen: WeakMap<object, object>): boolean => {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (seen.get(a) === b) return true;
  if (Array.isArray(a) !== Array.isArray(b)) return false;

  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const keys = Object.keys(aRecord);
  if (keys.length !== Object.keys(bRecord).length) return false;
  seen.set(a, b);
  for (const key of keys) {
    if (!(key in bRecord) || !deepEqual(aRecord[key], bRecord[key], seen)) {
      seen.delete(a);
      return false;
    }
  }
  return true;
};

/**
 * Returns a function that swaps each node for the previous call's node with the same id when the two are
 * structurally equal. Unchanged nodes keep their identity across rebuilds, so memoized groups skip re-rendering.
 * Reused nodes must not be mutated afterwards.
 */
export const createNodeInterner = () => {
  let previous = new Map<string, RenderNode>();

  return (nodes: RenderNode[]): RenderNode[] => {
    const seen = new WeakMap<object, object>();
    const next = new Map<string, RenderNode>();
    const result = nodes.map((node) => {
      const old = previous.get(node.id);
      const stable = old && deepEqual(node, old, seen) ? old : node;
      next.set(node.id, stable);
      return stable;
    });
    previous = next;
    return result;
  };
};
