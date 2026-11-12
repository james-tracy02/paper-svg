import type { Color } from "../types/primitives";
import React from "react";
import SvgSprite from "./Sprite";
import SvgSpriteMask from "./SpriteMask";
import type { RenderNode } from "./RenderTree";
import { matrixTransformToSvg } from "./transform";

export type SvgGroupOutlineProps = {
  g: RenderNode;
  stroke: Color;
  strokeWidth: number;
  scopeId: (suffix: string) => string;
  opacity?: number;
};

const SvgGroupOutline: React.FC<SvgGroupOutlineProps> = ({ g, stroke, strokeWidth, scopeId, opacity }) => {
  if (g.noSprite || g.sprite.stroke === "none") return null;

  const transform = matrixTransformToSvg(g.matrix);
  const maskId = g.mask ? scopeId(`${g.id}_mask`) : undefined;
  const isClipped = (g.maskedBy && g.maskedBy.length > 0) || (g.clippedBy && g.clippedBy.length > 0);
  const outerStyle = g.blendMode ? { mixBlendMode: g.blendMode } : undefined;
  const adjustedStrokeWidth = strokeWidth + (g.linkedOutline ? g.linkedOutline.sprite.strokeWidth ?? 0 : 0);

  if (isClipped) {
    return null;
  }

  const sprite = (
    <SvgSprite
      id={g.id}
      articulated={false}
      sprite={g.sprite}
      mode={"outer_outline"}
      strokeOverride={stroke}
      strokeWidthOverride={adjustedStrokeWidth}
      fillOverride="none"
      // Without a mask or opacity, the node transform goes straight onto the sprite.
      baseTransform={maskId || opacity !== undefined ? undefined : transform}
    />
  );
  const content = (
    <>
      {maskId ? <SvgSpriteMask id={maskId} sprite={g.mask!} /> : null}
      {maskId || opacity !== undefined ? (
        <g transform={transform} mask={maskId ? `url(#${maskId})` : undefined} opacity={outerStyle ? undefined : opacity}>
          {sprite}
        </g>
      ) : (
        sprite
      )}
    </>
  );

  // Only a blend mode needs its own <g>.
  return outerStyle ? (
    <g opacity={opacity} style={outerStyle}>
      {content}
    </g>
  ) : (
    content
  );
};

const areEqual = (a: SvgGroupOutlineProps, b: SvgGroupOutlineProps) =>
  a.g === b.g &&
  a.stroke === b.stroke &&
  a.strokeWidth === b.strokeWidth &&
  a.scopeId === b.scopeId &&
  a.opacity === b.opacity;
export default React.memo(SvgGroupOutline, areEqual);
