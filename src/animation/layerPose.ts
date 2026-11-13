import type { PoseLayer, ValueCombine, ValueRules, WeightedLayer } from "../types/Animation";
import type { Pose } from "../types/Pose";
import type { Vector2 } from "../types/primitives";

// Exact at both ends, so a full-weight layer lands on its value.
const lerp = (from: number, to: number, t: number) => from * (1 - t) + to * t;

const ruleOf = (rules: ValueRules, name: string): { combine: ValueCombine; rest?: number } => {
  const rule = rules[name];
  if (rule === undefined) return { combine: "add" };
  return typeof rule === "string" ? { combine: rule } : rule;
};

const combineValue = (current: number | undefined, value: number, weight: number, rules: ValueRules, name: string) => {
  const { combine, rest } = ruleOf(rules, name);
  const from = current ?? rest;
  if (combine === "add") return (from ?? 0) + value * weight;
  // Nothing to blend from: the layer's own value.
  if (from === undefined) return value;
  const target = combine === "min" ? Math.min(from, value) : combine === "max" ? Math.max(from, value) : value;
  return lerp(from, target, weight);
};

const addVectors = (
  into: Record<string, Vector2>,
  layer: Readonly<Record<string, Readonly<Vector2>>>,
  weight: number,
) => {
  for (const id in layer) {
    const v = layer[id];
    const current = into[id];
    into[id] = { x: (current?.x ?? 0) + v.x * weight, y: (current?.y ?? 0) + v.y * weight };
  }
};

const multiplyVectors = (
  into: Record<string, Vector2>,
  layer: Readonly<Record<string, Readonly<Vector2>>>,
  weight: number,
) => {
  for (const id in layer) {
    const v = layer[id];
    const current = into[id];
    into[id] = { x: (current?.x ?? 1) * lerp(1, v.x, weight), y: (current?.y ?? 1) * lerp(1, v.y, weight) };
  }
};

/**
 * `base` with `layers` applied in order: rotations and translations add `weight` times the layer's,
 * scales multiply by the layer's scaled toward 1 by the weight, and values combine by `rules`
 * (`add` for names it leaves out). Later layers apply on top of earlier ones, so an `override` later
 * in the list wins. Returns `base` itself when no layer has any weight, so an unchanged pose keeps its
 * identity (and a memoized render).
 */
export const layerPose = (base: Pose, layers: readonly WeightedLayer[], rules: ValueRules = {}): Pose => {
  const active = layers.filter((entry) => entry.weight > 0);
  if (!active.length) return base;

  let rotations: Record<string, number> | undefined;
  let translations: Record<string, Vector2> | undefined;
  let scales: Record<string, Vector2> | undefined;
  let values: Record<string, number> | undefined;

  for (const { layer, weight } of active) {
    const { rotations: r, translations: t, scales: s, values: v }: PoseLayer = layer;
    if (r) {
      rotations ??= { ...base.rotations };
      for (const id in r) rotations[id] = (rotations[id] ?? 0) + r[id] * weight;
    }
    if (t) addVectors((translations ??= { ...base.translations }), t, weight);
    if (s) multiplyVectors((scales ??= { ...base.scales }), s, weight);
    if (v) {
      values ??= { ...base.values };
      for (const name in v) values[name] = combineValue(values[name], v[name], weight, rules, name);
    }
  }

  if (!rotations && !translations && !scales && !values) return base;
  return {
    ...base,
    ...(rotations && { rotations }),
    ...(translations && { translations }),
    ...(scales && { scales }),
    ...(values && { values }),
  };
};
