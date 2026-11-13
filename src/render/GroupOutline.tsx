import type { Color } from "../types/primitives";
import React, { useContext } from "react";
import SvgSprite from "./Sprite";
import SvgSpriteMask, { spriteMaskAttributes } from "./SpriteMask";
import type { RenderNode } from "./RenderTree";
import { matrixTransformToSvg } from "./transform";
import { displayOf, PoseBindingsContext } from "./poseBindings";
import { bindNodeTransform } from "./Group";
import { isCut } from "./regions";

export type SvgGroupOutlineProps = {
  g: RenderNode;
  stroke: Color;
  strokeWidth: number;
  scopeId: (suffix: string) => string;
  opacity?: number;
};

const SvgGroupOutline: React.FC<SvgGroupOutlineProps> = ({ g, stroke, strokeWidth, scopeId, opacity }) => {
  const bindings = useContext(PoseBindingsContext);
  // A hidden node is still drawn, with display none, so a pose can show it again without a render.
  if (g.noSprite || g.sprite.stroke === "none") return null;

  const transform = matrixTransformToSvg(g.matrix);
  const maskId = g.mask ? scopeId(`${g.id}_mask`) : undefined;
  const isClipped = isCut(g);
  const outerStyle = g.blendMode ? { mixBlendMode: g.blendMode } : undefined;
  const adjustedStrokeWidth = strokeWidth + (g.linkedOutline ? g.linkedOutline.sprite.strokeWidth ?? 0 : 0);

  if (isClipped) {
    return null;
  }

  const sprite = (
    <SvgSprite
      id={g.id}
      poseNode={g.id}
      articulated={false}
      sprite={g.sprite}
      mode={"outer_outline"}
      strokeOverride={stroke}
      strokeWidthOverride={adjustedStrokeWidth}
      fillOverride="none"
      // Without a mask or opacity, the node transform goes straight onto the sprite.
      baseTransform={maskId || opacity !== undefined ? undefined : transform}
      hidden={maskId || opacity !== undefined ? undefined : g.hidden}
    />
  );
  const content = (
    <>
      {maskId ? <SvgSpriteMask id={maskId} sprite={g.mask!} /> : null}
      {maskId || opacity !== undefined ? (
        <g
          ref={bindNodeTransform(bindings, g.id)}
          transform={transform}
          display={displayOf(g)}
          {...(maskId ? spriteMaskAttributes(g.mask!, maskId) : {})}
          opacity={outerStyle ? undefined : opacity}
        >
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
