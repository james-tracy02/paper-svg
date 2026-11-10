import React from "react";
import type { MatrixTransform } from "../../types/Transform";
import { matrixTransformToSvg } from "../transform";

export type PivotGroup = {
  id: string;
  matrix: MatrixTransform;
  articulated?: boolean;
  debugColor?: string;
};

export type PivotsProps = {
  groups: PivotGroup[];
  show: boolean;
  includeNonArticulated?: boolean; // when true, show pivots for all groups
  /** Marker diameter in screen pixels. */
  size?: number;
};

/**
 * Draws each joint as a round-capped dot of non-scaling stroke, so its size on screen ignores node,
 * rig and viewBox scale. A filled circle would need its own transform to cancel each of those.
 */
const Pivots: React.FC<PivotsProps> = ({ groups, show, includeNonArticulated = false, size = 8 }) => {
  if (!show) return null;
  return (
    <g pointerEvents="none">
      {groups.map((g) => {
        if (!includeNonArticulated && !g.articulated) return null;
        return (
          <path
            key={g.id + "_joint"}
            transform={matrixTransformToSvg(g.matrix)}
            d="M 0 0 h 0.0001"
            fill="none"
            stroke={g.debugColor ?? (g.articulated ? "#ff000066" : "#00ff0066")}
            strokeWidth={size}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
    </g>
  );
};

export default Pivots;
