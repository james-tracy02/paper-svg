import { screenDeltaToSvgDelta } from "./screenToSvg";

export type DragRatio = {
  xAxis: { x: number; y: number };
  yAxis: { x: number; y: number };
};

import type { ScreenPoint } from "./screenToSvg";

export const computeDragDelta = (args: {
  start: ScreenPoint;
  end: ScreenPoint;
  svg: SVGGraphicsElement | SVGSVGElement | null;
  ratio?: DragRatio | null;
}) => {
  const delta = screenDeltaToSvgDelta(args.svg, args.start, args.end, args.ratio ?? null);
  if (!delta) return { dx: 0, dy: 0 };
  return { dx: delta.x, dy: delta.y };
};

export const applyMatrixToRatio = (
  ratio: DragRatio | null,
  matrix?: { a: number; b: number; c: number; d: number },
) => {
  if (!ratio || !matrix) return ratio;
  const transform = (v: { x: number; y: number }) => ({
    x: matrix.a * v.x + matrix.c * v.y,
    y: matrix.b * v.x + matrix.d * v.y,
  });
  return {
    xAxis: transform(ratio.xAxis),
    yAxis: transform(ratio.yAxis),
  };
};

export type Bounds = { x: number; y: number; width: number; height: number };

export const getHandleCursor = (rotation: number, handleIndex: number) => {
  const baseAngles = [135, 45, 315, 225];
  const base = baseAngles[handleIndex] ?? 0;
  const angle = (((base + rotation) % 360) + 360) % 360;
  const step = Math.round(angle / 45) % 8;
  const cursors = [
    "ew-resize",
    "nesw-resize",
    "ns-resize",
    "nwse-resize",
    "ew-resize",
    "nesw-resize",
    "ns-resize",
    "nwse-resize",
  ];
  return cursors[step];
};

export const getRotateCursor = () => "grab";

export const getHandleBounds = (bounds: Bounds | undefined, padding: number, fallbackOffset: number) => {
  const hasBounds = !!bounds && Number.isFinite(bounds.width) && Number.isFinite(bounds.height);
  const left = hasBounds ? bounds!.x - padding : -fallbackOffset;
  const right = hasBounds ? bounds!.x + bounds!.width + padding : fallbackOffset;
  const top = hasBounds ? bounds!.y - padding : -fallbackOffset;
  const bottom = hasBounds ? bounds!.y + bounds!.height + padding : fallbackOffset;
  return { hasBounds, left, right, top, bottom };
};

export const getHandlePositions = (left: number, right: number, top: number, bottom: number) => [
  { x: left, y: top, sx: -1, sy: -1 },
  { x: right, y: top, sx: 1, sy: -1 },
  { x: right, y: bottom, sx: 1, sy: 1 },
  { x: left, y: bottom, sx: -1, sy: 1 },
];

export const getRotateOffset = (handleSize: number, rotateHitRadius: number, safeScale: number) =>
  handleSize / 2 + rotateHitRadius / safeScale + 1 / safeScale;

export const getInverseMatrix2x2 = (matrix: { a: number; b: number; c: number; d: number }) => {
  const det = matrix.a * matrix.d - matrix.b * matrix.c;
  if (!det) return { a: 1, b: 0, c: 0, d: 1 };
  return {
    a: matrix.d / det,
    b: -matrix.b / det,
    c: -matrix.c / det,
    d: matrix.a / det,
  };
};

export const getRotateDelta = (
  point: { clientX: number; clientY: number },
  pivotScreen: { x: number; y: number },
  startAngle: number,
  snap: boolean,
  startRotationDeg?: number,
) => {
  const angle = Math.atan2(point.clientY - pivotScreen.y, point.clientX - pivotScreen.x);
  const delta = (angle - startAngle) * (180 / Math.PI);
  if (!snap) return delta;
  if (startRotationDeg !== undefined) {
    // Snap to absolute orthodox angles (0, 15, 30, 45, …)
    const absolute = startRotationDeg + delta;
    const snappedAbsolute = Math.round(absolute / 15) * 15;
    return snappedAbsolute - startRotationDeg;
  }
  return Math.round(delta / 15) * 15;
};

export const getScaleFromDelta = (args: {
  bounds: Bounds;
  handleIndex: number;
  delta: { dx: number; dy: number };
  sensitivity: number;
  uniform: boolean;
}) => {
  const signX = args.handleIndex === 0 || args.handleIndex === 3 ? -1 : 1;
  const signY = args.handleIndex === 0 || args.handleIndex === 1 ? -1 : 1;
  const deltaX = args.delta.dx * signX * args.sensitivity;
  const deltaY = args.delta.dy * signY * args.sensitivity;
  let scaleX = args.bounds.width ? 1 + deltaX / args.bounds.width : 1;
  let scaleY = args.bounds.height ? 1 + deltaY / args.bounds.height : 1;
  if (args.uniform) {
    const uniform = Math.abs(scaleX) > Math.abs(scaleY) ? scaleX : scaleY;
    scaleX = uniform;
    scaleY = uniform;
  }
  return { scaleX, scaleY };
};

export const getSafeScale = (scaleX: number, scaleY: number) => ({
  x: Math.max(0.01, Math.abs(scaleX)),
  y: Math.max(0.01, Math.abs(scaleY)),
});
