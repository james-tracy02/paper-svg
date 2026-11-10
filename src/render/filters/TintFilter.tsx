import type { ReactNode } from "react";

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

type TintFilterProps = {
  id: string;
  enabled: boolean;
  color?: string | null;
  opacity: number;
  blendMode?: GlobalCompositeOperation;
  children: ReactNode;
};

const TintFilter = ({ id, enabled, color, opacity, blendMode = "multiply", children }: TintFilterProps) => {
  const resolvedColor = color && color.trim() ? color : "#ffffff";
  const clampedOpacity = clamp01(opacity ?? 0);
  const isActive = enabled && clampedOpacity > 0;

  if (!isActive) {
    return <>{children}</>;
  }

  return (
    <>
      <defs>
        <filter
          id={id}
          x="-20%"
          y="-20%"
          width="140%"
          height="140%"
          colorInterpolationFilters="sRGB"
          filterRes="2048 2048"
        >
          <feFlood floodColor={resolvedColor} floodOpacity={clampedOpacity} result="tint" />
          <feComposite in="tint" in2="SourceGraphic" operator="in" result="tintMasked" />
          <feBlend in="SourceGraphic" in2="tintMasked" mode={blendMode} />
        </filter>
      </defs>
      <g filter={`url(#${id})`}>{children}</g>
    </>
  );
};

export default TintFilter;
