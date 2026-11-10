import React, { useState, useSyncExternalStore } from "react";
import { createDefsStore, HoistedDefsContext, type DefsStore } from "./useHoistedDefs";

const HoistedDefsOutlet: React.FC<{ store: DefsStore }> = ({ store }) => {
  const nodes = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return nodes.length ? <defs>{nodes}</defs> : null;
};

/** Collects the hoisted defs of every sprite below it into one <defs>. */
export const HoistedDefsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [store] = useState(createDefsStore);
  return (
    <HoistedDefsContext.Provider value={store}>
      <HoistedDefsOutlet store={store} />
      {children}
    </HoistedDefsContext.Provider>
  );
};
