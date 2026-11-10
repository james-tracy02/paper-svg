import type { Color } from "../types/primitives";
import type { CustomElement, CustomSprite } from "../types/Sprite";
import svgpath from "svgpath";
import { roundTo } from "../util/roundTo";
import { getSpriteTransform } from "../render/transform";

const sprites = new Map<string, CustomSprite>();

export type SpritePlacement = {
  offsetX?: number;
  offsetY?: number;
  scale?: number;
  rotate?: number;
};

type SpriteContent = Pick<CustomSprite, "id" | "elements" | "colors" | "strokeColors" | "image">;

// Scales/rotates about the sprite's center, then shifts by the offsets.
const placeSprite = (content: SpriteContent, metrics: SpriteMetrics, placement?: SpritePlacement): CustomSprite => {
  const offsetX = placement?.offsetX ?? 0;
  const offsetY = placement?.offsetY ?? 0;
  const scale = { x: placement?.scale ?? 1, y: placement?.scale ?? 1 };
  const rotate = placement?.rotate ?? 0;
  const linear = new DOMMatrix(getSpriteTransform({ translate: { x: 0, y: 0 }, scale, rotate }));
  const center = linear.transformPoint(new DOMPoint(metrics.center.x, metrics.center.y));
  return {
    ...content,
    translate: {
      x: offsetX - center.x,
      y: center.y + offsetY,
    },
    scale,
    rotate,
    offsetX,
    offsetY,
    size: metrics.size,
    bounds: {
      x: roundTo(metrics.center.x - metrics.size.width / 2, 4),
      y: roundTo(metrics.center.y - metrics.size.height / 2, 4),
      width: metrics.size.width,
      height: metrics.size.height,
    },
    origin: metrics.center,
  };
};

export const makeSprite = (id: string, svg: string, placement?: SpritePlacement): CustomSprite => {
  const { elements, colors, strokeColors, viewBox } = getElements(svg);
  return placeSprite({ id, elements, colors, strokeColors }, getPathsMetrics(elements, viewBox), placement);
};

export const makeImageSprite = (
  id: string,
  image: { href: string; width: number; height: number },
  placement?: SpritePlacement,
): CustomSprite => {
  const metrics = {
    center: { x: image.width / 2, y: image.height / 2 },
    size: { width: image.width, height: image.height },
  };
  return placeSprite({ id, elements: [], colors: 0, strokeColors: 0, image }, metrics, placement);
};

/** Re-applies placement to an already-built sprite. */
export const withPlacement = (sprite: CustomSprite, placement?: SpritePlacement): CustomSprite =>
  placeSprite(sprite, { center: sprite.origin ?? { x: 0, y: 0 }, size: sprite.size ?? { width: 0, height: 0 } }, placement);

const readDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });

export const isSvgFile = (file: File) => file.type === "image/svg+xml" || /\.svg$/i.test(file.name);

export const makeSpriteFromFile = async (id: string, file: File): Promise<CustomSprite> => {
  if (isSvgFile(file)) return makeSprite(id, await file.text());
  if (!file.type.startsWith("image/")) throw new Error("Unsupported file type. Choose an SVG or image file.");
  const href = await readDataUrl(file);
  const img = new Image();
  img.src = href;
  await img.decode();
  return makeImageSprite(id, { href, width: img.naturalWidth, height: img.naturalHeight });
};

export const registerCustomSprite = (sprite: CustomSprite) => {
  sprites.set(sprite.id, sprite);
};

export const unregisterCustomSprite = (id: string) => {
  sprites.delete(id);
};

const getElements = (
  svgText: string | undefined,
): { colors: number; elements: CustomElement[]; strokeColors: number; viewBox?: string } => {
  if (!svgText) {
    return { colors: 0, elements: [], strokeColors: 0 };
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, "image/svg+xml");

  const elements: CustomElement[] = [];
  const colorMap = new Map<Color, string>();
  const strokeColorMap = new Map<Color, string>();

  const gatherGroupTransforms = (el: Element | null): string[] => {
    if (!el) return [];
    const transforms: string[] = [];
    let current: Element | null = el.parentElement;
    while (current && current !== doc.documentElement) {
      if (current.tagName.toLowerCase() === "g") {
        const t = current.getAttribute("transform");
        if (t) {
          transforms.unshift(t.trim());
        }
      }
      current = current.parentElement;
    }
    return transforms;
  };

  const parseTransformMatrix = (transform?: string, context?: string): DOMMatrix | null => {
    if (!transform) return null;
    const svgNS = "http://www.w3.org/2000/svg";
    try {
      const svg = document.createElementNS(svgNS, "svg");
      const g = document.createElementNS(svgNS, "g");
      g.setAttribute("transform", transform);
      svg.appendChild(g);
      const consolidated = g.transform.baseVal.consolidate();
      if (!consolidated) return null;
      const matrix = consolidated.matrix as DOMMatrix;
      return new DOMMatrix([matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f]);
    } catch {
      console.warn("[sprite-transform-parse-failed]", { context, transform });
      return null;
    }
  };

  const flattenPathTransform = (d: string, matrix: DOMMatrix | null) => {
    if (!matrix) return { d, didFlatten: false };
    const nextD = svgpath(d)
      .matrix([matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f])
      .round(4)
      .toString();
    return { d: nextD, didFlatten: true };
  };

  const roundPathData = (pathData: string) => svgpath(pathData).round(4).toString();

  const paths = doc.querySelectorAll("path");
  paths.forEach((pathElem, index) => {
    let d = pathElem.getAttribute("d") || undefined;

    let fill = pathElem.getAttribute("fill");
    // let fillOpacity = pathElem.getAttribute("fill-opacity");
    let strokeWidth = pathElem.getAttribute("stroke-width");
    let stroke = pathElem.getAttribute("stroke");
    const pathId = pathElem.getAttribute("id") ?? `path_${index}`;
    const ownTransform = pathElem.getAttribute("transform")?.trim();
    const groupTransforms = gatherGroupTransforms(pathElem);
    const groupTransform = groupTransforms.length ? groupTransforms.join(" ") : undefined;
    const transform = [groupTransform, ownTransform].filter(Boolean).join(" ").trim();

    const ownMatrix = parseTransformMatrix(ownTransform, `${pathId}:own`);
    const groupMatrices = groupTransforms
      .map((t, groupIndex) => parseTransformMatrix(t, `${pathId}:group_${groupIndex}`))
      .filter((m): m is DOMMatrix => Boolean(m));
    const groupMatrix = groupMatrices.reduce((acc, m) => acc.multiply(m), new DOMMatrix());
    const combinedMatrix =
      ownMatrix && groupMatrices.length
        ? groupMatrix.multiply(ownMatrix)
        : ownMatrix || (groupMatrices.length ? groupMatrix : null);

    if (transform && !combinedMatrix) {
      console.warn("[sprite-transform-combine-failed]", { pathId, transform });
    }

    let didFlatten = false;
    let resolvedTransform = transform || undefined;
    if (d) {
      const flattened = flattenPathTransform(d, combinedMatrix);
      d = flattened.d;
      if (flattened.didFlatten) {
        didFlatten = true;
        resolvedTransform = undefined;
        // clear transform because it has been baked into the path data
        (pathElem as any).removeAttribute?.("transform");
      }
      d = roundPathData(d);
    }

    const style = pathElem.getAttribute("style");
    if (style) {
      const fillMatch = style.match(/fill:\s*([^;]+)/i);
      if (fillMatch) fill = fillMatch[1].trim();

      const strokeWidthMatch = style.match(/stroke-width:\s*([^;]+)/i);
      if (strokeWidthMatch) strokeWidth = strokeWidthMatch[1].trim();

      const strokeMatch = style.match(/stroke:\s*([^;]+)/i);
      if (strokeMatch) stroke = strokeMatch[1].trim();

      // const fillOpacityMatch = style.match(/fill-opacity:\s*([^;]+)/i);
      // if (fillOpacityMatch) fillOpacity = fillOpacityMatch[1].trim();
    }

    if (fill == "none") {
      fill = null;
    }

    let colorKey;
    if (fill && !colorMap.has(fill)) {
      colorKey = `color${colorMap.size}`;
      colorMap.set(fill, colorKey);
    } else {
      colorKey = colorMap.get(fill!);
    }

    let strokeColorKey;
    if (stroke && stroke !== "none" && !strokeColorMap.has(stroke)) {
      strokeColorKey = `stroke_color${strokeColorMap.size}`;
      strokeColorMap.set(stroke, strokeColorKey);
    } else {
      strokeColorKey = strokeColorMap.get(stroke!);
    }

    const element: CustomElement = {
      d: d,
      colorKey: colorKey,
      strokeColorKey: strokeColorKey,
      noFill: fill === null,
      noStroke: strokeWidth === "0" || strokeWidth === "none" || stroke == "none",
      transform: didFlatten ? undefined : resolvedTransform,
    };
    elements.push(element);
  });

  const viewBox = doc.documentElement.getAttribute("viewBox") ?? undefined;

  return {
    colors: colorMap.size,
    elements: elements,
    strokeColors: strokeColorMap.size,
    viewBox,
  };
};

// Get only the element's own transform attribute as a matrix (ignore viewport/viewBox/CSS)
function getTransformAttrMatrix(el: SVGGraphicsElement) {
  const tlist = (el as any).transform?.baseVal;
  if (!tlist || tlist.numberOfItems === 0 || !tlist.consolidate) {
    return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  }
  const item = tlist.consolidate();
  if (!item) return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const m = (item as any).matrix as any; // SVGMatrix or DOMMatrix
  return { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f };
}

// Compute axis-aligned bbox after applying ONLY the element's own transform attribute
function getTransformedBBox(el: SVGGraphicsElement) {
  const bbox = el.getBBox();
  const ctm = el.getCTM();
  const m = ctm ?? getTransformAttrMatrix(el);

  const tx = (x: number, y: number) => ({
    x: m.a * x + m.c * y + m.e,
    y: m.b * x + m.d * y + m.f,
  });

  const p1 = tx(bbox.x, bbox.y);
  const p2 = tx(bbox.x + bbox.width, bbox.y);
  const p3 = tx(bbox.x, bbox.y + bbox.height);
  const p4 = tx(bbox.x + bbox.width, bbox.y + bbox.height);

  const minX = Math.min(p1.x, p2.x, p3.x, p4.x);
  const maxX = Math.max(p1.x, p2.x, p3.x, p4.x);
  const minY = Math.min(p1.y, p2.y, p3.y, p4.y);
  const maxY = Math.max(p1.y, p2.y, p3.y, p4.y);

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

type SpriteMetrics = {
  center: { x: number; y: number };
  size: { width: number; height: number };
};

function getPathsMetrics(paths: CustomElement[], viewBox?: string): SpriteMetrics {
  const svgNS = "http://www.w3.org/2000/svg";
  const tempSvg = document.createElementNS(svgNS, "svg");
  let viewBoxApplied = false;
  if (viewBox) {
    tempSvg.setAttribute("viewBox", viewBox);
    const parts = viewBox.split(/\s+|,/).map((val) => Number(val));
    if (parts.length === 4 && parts.every((val) => Number.isFinite(val))) {
      tempSvg.setAttribute("width", `${parts[2]}`);
      tempSvg.setAttribute("height", `${parts[3]}`);
      viewBoxApplied = true;
    }
  }
  // Use nonzero size and hide offscreen to avoid CTM quirks across browsers
  if (!viewBoxApplied) {
    tempSvg.setAttribute("width", "1");
    tempSvg.setAttribute("height", "1");
  }
  (tempSvg.style as any).position = "absolute";
  (tempSvg.style as any).left = "-99999px";
  (tempSvg.style as any).top = "-99999px";
  (tempSvg.style as any).opacity = "0";
  (tempSvg.style as any).pointerEvents = "none";
  document.body.appendChild(tempSvg);

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  for (const p of paths) {
    const d = p.d;
    if (!d) continue;
    const path = document.createElementNS(svgNS, "path");
    path.setAttribute("d", d);
    if (p.transform) path.setAttribute("transform", p.transform);
    tempSvg.appendChild(path);

    // Use CTM-aware bbox to account for transform attributes
    const tb = getTransformedBBox(path);
    minX = Math.min(minX, tb.x);
    minY = Math.min(minY, tb.y);
    maxX = Math.max(maxX, tb.x + tb.width);
    maxY = Math.max(maxY, tb.y + tb.height);
  }

  tempSvg.remove();

  const cx = roundTo((minX + maxX) / 2, 4);
  const cy = roundTo((minY + maxY) / 2, 4);
  const width = roundTo(maxX - minX, 0);
  const height = roundTo(maxY - minY, 0);

  return {
    center: { x: cx, y: cy },
    size: { width, height },
  };
}

export const getSprite = (name: string): CustomSprite | undefined => {
  return sprites.get(name);
};
