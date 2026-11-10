import type React from "react";
import type { SpriteStyle } from "../spriteTypes";
import { hashKey } from "../hashKey";
import { useHoistedDefs } from "../useHoistedDefs";
import { strokeAttributes, styleOrUndefined } from "../strokeAttributes";

type BaseShapeProps = {
  transform?: string;
  opacity?: number;
  style: SpriteStyle;
};

type BasicShapeProps = BaseShapeProps & {
  fill?: string;
  stroke?: string;
  /** CSS value; set through `style` so it can read the zoom vars. */
  strokeWidth: string | number;
};

type RadialGradientProps = BaseShapeProps & {
  fill?: string;
};

type LineShapeProps = BaseShapeProps & {
  stroke?: string;
  /** CSS value; set through `style` so it can read the zoom vars. */
  strokeWidth: string | number;
};

const SHAPE_BASE_SCALE = 10;

export const EllipseSprite: React.FC<BasicShapeProps> = ({ transform, fill, stroke, strokeWidth, opacity, style }) => (
  <ellipse
    transform={transform}
    fill={fill}
    rx={SHAPE_BASE_SCALE / 2}
    ry={SHAPE_BASE_SCALE / 2}
    opacity={opacity}
    {...strokeAttributes(stroke, strokeWidth, style)}
  />
);

export const RectSprite: React.FC<BasicShapeProps> = ({ transform, fill, stroke, strokeWidth, opacity, style }) => (
  <rect
    transform={transform}
    fill={fill}
    x={-SHAPE_BASE_SCALE / 2}
    y={-SHAPE_BASE_SCALE / 2}
    width={SHAPE_BASE_SCALE}
    height={SHAPE_BASE_SCALE}
    opacity={opacity}
    {...strokeAttributes(stroke, strokeWidth, style)}
  />
);

export const HalfCircleSprite: React.FC<BasicShapeProps> = ({
  transform,
  fill,
  stroke,
  strokeWidth,
  opacity,
  style,
}) => (
  <path
    transform={transform}
    d={`M ${-SHAPE_BASE_SCALE / 2} 0 A ${SHAPE_BASE_SCALE / 2} ${SHAPE_BASE_SCALE / 2} 0 0 0 ${
      SHAPE_BASE_SCALE / 2
    } 0 L ${-SHAPE_BASE_SCALE / 2} 0 Z`}
    fill={fill}
    opacity={opacity}
    {...strokeAttributes(stroke, strokeWidth, style)}
  />
);

/** Radial falloff ellipse; `solidUntil` is where the fade starts (0 fades from the center). */
const RadialFadeSprite: React.FC<RadialGradientProps & { kind: "soft" | "fuzzy"; solidUntil?: string }> = ({
  transform,
  fill,
  opacity,
  style,
  kind,
  solidUntil,
}) => {
  const gradId = `${kind}_${hashKey(fill ?? "")}`;
  const inlineDefs = useHoistedDefs([
    {
      id: gradId,
      node: (
        <radialGradient key={gradId} id={gradId} gradientUnits="userSpaceOnUse" cx="0" cy="0" r={SHAPE_BASE_SCALE / 2}>
          <stop offset="0%" stopColor={fill} />
          {solidUntil ? <stop offset={solidUntil} stopColor={fill} stopOpacity={1} /> : null}
          <stop offset="100%" stopColor={fill} stopOpacity={0} />
        </radialGradient>
      ),
    },
  ]);
  return (
    <>
      {inlineDefs}
      <ellipse
        transform={transform}
        fill={`url(#${gradId})`}
        rx={SHAPE_BASE_SCALE / 2}
        ry={SHAPE_BASE_SCALE / 2}
        style={styleOrUndefined(style)}
        opacity={opacity}
      />
    </>
  );
};

export const SoftSprite: React.FC<RadialGradientProps> = (props) => (
  <RadialFadeSprite {...props} kind="soft" solidUntil="60%" />
);

export const FuzzySprite: React.FC<RadialGradientProps> = (props) => <RadialFadeSprite {...props} kind="fuzzy" />;

export const LineSprite: React.FC<LineShapeProps> = ({ transform, stroke, strokeWidth, opacity, style }) => (
  <line
    transform={transform}
    y1={-SHAPE_BASE_SCALE / 2}
    x1={0}
    y2={SHAPE_BASE_SCALE / 2}
    x2={0}
    opacity={opacity}
    {...strokeAttributes(stroke, strokeWidth, style)}
  />
);
