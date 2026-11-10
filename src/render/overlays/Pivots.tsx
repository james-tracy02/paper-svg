import React from "react";
import type { MatrixTransform } from "../../types/Transform";
import { matrixToTransform, matrixTransformToSvg } from "../transform";

export type PivotGroup = {
  id: string;
  matrix: MatrixTransform;
  articulated?: boolean;
  debugColor?: string;
};

export type PivotsProps = {
  groups: PivotGroup[];
  show: boolean;
  nonScalingStroke?: boolean;
  includeNonArticulated?: boolean; // when true, show pivots for all groups
};

const Pivots: React.FC<PivotsProps> = ({ groups, show, nonScalingStroke = true, includeNonArticulated = false }) => {
  if (!show) return null;
  return (
    <>
      {groups.map((g) => {
        if (!includeNonArticulated && !g.articulated) return null;
        const transform = matrixTransformToSvg(g.matrix);
        const derived = matrixToTransform(g.matrix);
        const scale = derived.scale;
        const invScaleX = scale.x !== 0 ? 1 / scale.x : 1;
        const invScaleY = scale.y !== 0 ? 1 / scale.y : 1;
        const fallbackColor = g.articulated ? "#ff000066" : "#00ff0066";
        const color = g.debugColor ?? fallbackColor;
        return (
          <g key={g.id + "_joint"} transform={transform}>
            <g transform={`scale(${invScaleX}, ${invScaleY})`}>
              <ellipse
                key={g.id + "_joint"}
                fill={color}
                rx={0.5}
                ry={0.5}
                stroke={color}
                strokeWidth={0}
                vectorEffect={nonScalingStroke ? "non-scaling-stroke" : undefined}
              />
            </g>
          </g>
        );
      })}
    </>
  );
};

export default Pivots;
