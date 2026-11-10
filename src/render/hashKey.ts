// Small stable hash for derived def ids (shared geometry, hoisted gradients).
export function hashKey(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = (h * 33) ^ str.charCodeAt(i);
  }
  // convert to unsigned and base36 to keep short
  return (h >>> 0).toString(36);
}

/** Id of the shared `<path>` SpriteDefs emits for a custom sprite element's `d`. */
export const pathDefId = (d: string) => `sym_${hashKey(`c:${d}`)}`;
