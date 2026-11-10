import React, { createContext, useContext, useLayoutEffect } from "react";

/**
 * Defs (gradients) that sprites register instead of emitting their own <defs>. Ids are content hashes, so sprites
 * sharing a definition share one element; it stays while any sprite still registers it.
 */
type HoistedDef = { id: string; node: React.ReactNode };

export type DefsStore = {
  add: (defs: HoistedDef[]) => () => void;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => React.ReactNode[];
};

export const createDefsStore = (): DefsStore => {
  const entries = new Map<string, { node: React.ReactNode; count: number }>();
  const listeners = new Set<() => void>();
  let snapshot: React.ReactNode[] = [];
  const emit = () => {
    snapshot = Array.from(entries.values(), (entry) => entry.node);
    listeners.forEach((listener) => listener());
  };
  return {
    add: (defs) => {
      let changed = false;
      defs.forEach(({ id, node }) => {
        const entry = entries.get(id);
        if (entry) {
          entry.count += 1;
        } else {
          entries.set(id, { node, count: 1 });
          changed = true;
        }
      });
      if (changed) emit();
      return () => {
        let removed = false;
        defs.forEach(({ id }) => {
          const entry = entries.get(id);
          if (!entry) return;
          entry.count -= 1;
          if (entry.count === 0) {
            entries.delete(id);
            removed = true;
          }
        });
        if (removed) emit();
      };
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
  };
};

export const HoistedDefsContext = createContext<DefsStore | null>(null);

/**
 * Registers `defs` with the nearest HoistedDefsProvider. Outside one (thumbnails, catalog previews) the defs come back
 * as a <defs> element for the caller to render in place.
 */
export const useHoistedDefs = (defs: HoistedDef[]): React.ReactNode => {
  const store = useContext(HoistedDefsContext);
  // Ids are content hashes, so the id list alone says when the defs changed.
  const key = defs.map((def) => def.id).join("|");
  useLayoutEffect(() => {
    if (!store || !defs.length) return;
    return store.add(defs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, key]);
  if (store || !defs.length) return null;
  return <defs>{defs.map((def) => def.node)}</defs>;
};
