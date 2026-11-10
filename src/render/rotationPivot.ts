import type { RenderNode } from "./RenderTree";
import { matrixTransformToSvg } from "./transform";
import type { Vector2 } from "../types/primitives";

const toScreen = (svg: SVGSVGElement, element: SVGGElement, local: Vector2): Vector2 => {
  const ctm = element.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const point = svg.createSVGPoint();
  point.x = local.x;
  point.y = local.y;
  const screen = point.matrixTransform(ctm);
  return { x: screen.x, y: screen.y };
};

export type RotationPivotOptions = {
  svg: SVGSVGElement;
  /** Element that received the press. */
  clicked: SVGGElement;
  /** Id of the node that rotates. */
  partId: string;
  /** Root element of that node, if it has one. */
  element?: SVGGElement | null;
  nodes: RenderNode[];
};

/**
 * Screen position of a node's joint. A spriteless node has no element, so its joint is mapped
 * through the clicked element instead. Returns null when neither route is available.
 */
export const resolveRotationPivot = ({ svg, clicked, partId, element, nodes }: RotationPivotOptions): Vector2 | null => {
  if (element) return toScreen(svg, element, { x: 0, y: 0 });
  const clickedNode = nodes.find((node) => node.id === clicked.dataset.renderId);
  const targetNode = nodes.find((node) => node.id === partId);
  if (!clickedNode || !targetNode) return null;
  const joint = new DOMPoint(0, 0).matrixTransform(
    new DOMMatrix(matrixTransformToSvg(clickedNode.matrix)).inverse().multiply(new DOMMatrix(matrixTransformToSvg(targetNode.matrix))),
  );
  return toScreen(svg, clicked, joint);
};
