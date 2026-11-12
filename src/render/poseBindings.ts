/**
 * Writing a pose straight to the DOM. Every element whose attributes depend on where a pose places a
 * node (its transform, a driven path, a pattern frame, a mask's bounds) registers a writer for them
 * as it mounts. `Rig`'s `setPose` then solves a pose and runs only the writers of the nodes it moved,
 * without a React render. Writers compute their values with the same functions the components render
 * with, so a written pose matches the markup React would render for it.
 *
 * React doesn't see those writes: after it commits, `commit` rewrites every node written since, so
 * the DOM again shows what React rendered.
 */
import { createContext } from "react";
import type { RenderNode } from "./RenderTree";

/** A node by id, as the pose being written places it; undefined for a node the pose doesn't know. */
export type PoseLookup = (id: string) => RenderNode | undefined;

/** Updates one element's pose-dependent attributes for the pose `get` describes. */
export type PoseWriter = (get: PoseLookup) => void;

export type PoseBindings = {
  /** Runs `writer` whenever one of `ids` moves. Returns its removal. */
  add(ids: readonly string[], writer: PoseWriter): () => void;
  /** Runs the writers of the `moved` node ids, each writer once, and remembers those nodes as written. */
  write(moved: Iterable<string>, get: PoseLookup): void;
  /** After React commits the pose `get` describes: rewrites the nodes written since the last commit. */
  commit(get: () => PoseLookup): void;
};

export const createPoseBindings = (): PoseBindings => {
  const writersById = new Map<string, Set<PoseWriter>>();
  const written = new Set<string>();

  const run = (ids: Iterable<string>, get: PoseLookup) => {
    const writers = new Set<PoseWriter>();
    for (const id of ids) writersById.get(id)?.forEach((writer) => writers.add(writer));
    writers.forEach((writer) => writer(get));
  };

  return {
    add(ids, writer) {
      for (const id of ids) {
        let writers = writersById.get(id);
        if (!writers) writersById.set(id, (writers = new Set()));
        writers.add(writer);
      }
      return () => ids.forEach((id) => writersById.get(id)?.delete(writer));
    },
    write(moved, get) {
      const ids = [...moved];
      ids.forEach((id) => written.add(id));
      run(ids, get);
    },
    commit(get) {
      if (!written.size) return;
      const ids = [...written];
      written.clear();
      run(ids, get());
    },
  };
};

/** The bindings of the rig being rendered; null outside a `Rig` (static markup, custom layers). */
export const PoseBindingsContext = createContext<PoseBindings | null>(null);

/**
 * A ref callback registering `writer` for the element while it is mounted, or undefined without
 * bindings. Make a new one each render, so the writer sees what that render drew.
 */
export const bindPose = <E extends Element>(
  bindings: PoseBindings | null,
  ids: string | readonly string[],
  writer: (element: E) => PoseWriter,
): ((element: E | null) => void) | undefined => {
  if (!bindings) return undefined;
  let remove: (() => void) | undefined;
  return (element) => {
    remove?.();
    remove = element ? bindings.add(typeof ids === "string" ? [ids] : ids, writer(element)) : undefined;
  };
};

/** Joins ref callbacks into one. */
export const joinRefs =
  <E extends Element>(...refs: (((element: E | null) => void) | undefined)[]) =>
  (element: E | null) =>
    refs.forEach((ref) => ref?.(element));

/** Sets an attribute only when it differs, or removes it for undefined. */
export const setAttr = (element: Element, name: string, value: string | number | undefined) => {
  if (value === undefined) {
    if (element.hasAttribute(name)) element.removeAttribute(name);
    return;
  }
  const text = String(value);
  if (element.getAttribute(name) !== text) element.setAttribute(name, text);
};

/**
 * Writes `attribute` as `format(node)` followed by what the element rendered after `base`, the value
 * `format` gave at render time; e.g. a node transform prefixed to a sprite's own. `rendered` is the
 * attribute as rendered (not read back: the DOM may still hold a written pose). Does nothing when
 * `rendered` doesn't start with `base`.
 */
export const prefixWriter =
  (id: string, attribute: string, base: string, rendered: string | undefined, format: (node: RenderNode) => string) =>
  (element: Element): PoseWriter => {
    if (rendered === undefined || !rendered.startsWith(base)) return () => {};
    const rest = rendered.slice(base.length);
    return (get) => {
      const node = get(id);
      if (node) setAttr(element, attribute, format(node) + rest);
    };
  };
