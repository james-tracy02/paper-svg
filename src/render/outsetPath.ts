import paper from "paper";
import { PaperOffset } from "paperjs-offset";

let initialized = false;

/**
 * Lazily initialize paper.js with a headless canvas.
 * Must be called before any paper.Path construction.
 */
const ensureSetup = () => {
  if (initialized) return;
  paper.setup(new paper.Size(1, 1));
  initialized = true;
};

/** Small extra padding beyond the stroke to avoid sub-pixel aliasing gaps. */
const CLIP_OUTSET = 0.2;

/** Cache keyed by `d` + outset amount. */
const cache = new Map<string, string>();

/**
 * Expand an SVG path-data string outward by `amount` units (defaults to CLIP_OUTSET).
 * Results are cached so repeated calls with the same `d` + amount are free.
 * Returns the original `d` unchanged if offsetting fails or produces
 * an empty result (e.g. self-intersecting offset on tiny paths).
 */
export const outsetPathData = (d: string, amount: number = CLIP_OUTSET): string => {
  const key = `${amount}:${d}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  let out = d;
  try {
    ensureSetup();
    const src = new paper.CompoundPath(d);
    const result = PaperOffset.offset(src, amount, { join: "round" });
    if (result) {
      out = result.pathData || d;
      result.remove();
    }
    src.remove();
  } catch {
    // keep original d
  }

  cache.set(key, out);
  return out;
};
