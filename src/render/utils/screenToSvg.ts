export type ScreenPoint = { clientX: number; clientY: number };
export type SvgPoint = { x: number; y: number };
export type SvgScale = { x: number; y: number };
export type SvgRatio = { xAxis: SvgPoint; yAxis: SvgPoint };

export const screenToSvgRatio = (
  element: SVGGraphicsElement | SVGSVGElement | null,
  attachmentScale?: SvgScale,
  attachmentRotationDeg: number = 0,
): SvgRatio | null => {
  if (!element) return null;
  const svg = element instanceof SVGSVGElement ? element : element.ownerSVGElement;
  if (!svg) return null;
  const ctm = element.getScreenCTM();
  if (!ctm) return null;
  const ctmMatrix = svg.createSVGMatrix();
  ctmMatrix.a = ctm.a;
  ctmMatrix.b = ctm.b;
  ctmMatrix.c = ctm.c;
  ctmMatrix.d = ctm.d;
  ctmMatrix.e = ctm.e;
  ctmMatrix.f = ctm.f;
  const scaleX = attachmentScale?.x ?? 1;
  const scaleY = attachmentScale?.y ?? 1;
  const unscaledCtm =
    scaleX !== 0 && scaleY !== 0
      ? ctmMatrix.multiply(svg.createSVGMatrix().scaleNonUniform(1 / scaleX, 1 / scaleY))
      : ctmMatrix;
  const unrotatedCtm =
    attachmentRotationDeg !== 0
      ? unscaledCtm.multiply(svg.createSVGMatrix().rotate(-attachmentRotationDeg))
      : unscaledCtm;
  const inverse = unrotatedCtm.inverse();
  const xAxis = { x: inverse.a, y: inverse.b };
  const yAxis = { x: inverse.c, y: inverse.d };
  return { xAxis, yAxis };
};

export const screenDeltaToSvgDelta = (
  element: SVGGraphicsElement | SVGSVGElement | null,
  start: ScreenPoint,
  end: ScreenPoint,
  ratio?: SvgRatio | null,
): SvgPoint | null => {
  const dx = end.clientX - start.clientX;
  const dy = end.clientY - start.clientY;
  const resolvedRatio = ratio ?? screenToSvgRatio(element);
  if (!resolvedRatio) return null;
  return {
    x: dx * resolvedRatio.xAxis.x + dy * resolvedRatio.yAxis.x,
    y: dx * resolvedRatio.xAxis.y + dy * resolvedRatio.yAxis.y,
  };
};
