import { useMemo } from "react";
import type { ReactNode } from "react";

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

type GlowFilterProps = {
  id: string;
  enabled: boolean;
  color?: string | null;
  radius: number;
  size: number;
  intensity: number;
  children: ReactNode;
};

const GlowFilter = ({ id, enabled, color, radius, size, intensity, children }: GlowFilterProps) => {
  const sanitizedRadius = Math.max(0, radius ?? 0);
  const sanitizedSize = Math.max(0, size ?? 0);
  const sanitizedIntensity = clamp01(intensity ?? 0);
  const resolvedColor = color && color.trim() ? color : "#ffffff";

  const isActive = enabled && sanitizedRadius > 0 && sanitizedIntensity > 0;

  const glowStdDeviation = useMemo(() => {
    if (!isActive) return 0;
    const baseRadius = Math.max(0.1, sanitizedRadius);
    return Math.max(0.25, baseRadius * 0.25);
  }, [isActive, sanitizedRadius]);

  const glowDilateRadius = useMemo(() => {
    if (!isActive) return 0;
    return sanitizedSize;
  }, [isActive, sanitizedSize]);

  if (!isActive) {
    return <>{children}</>;
  }

  return (
    <>
      <defs>
        <filter id={id} x="-200%" y="-200%" width="400%" height="400%" colorInterpolationFilters="sRGB">
          <feMorphology in="SourceGraphic" operator="dilate" radius={glowDilateRadius} result="dilated" />
          <feGaussianBlur in="dilated" stdDeviation={glowStdDeviation} result="blurred" />
          <feFlood floodColor={resolvedColor} floodOpacity={sanitizedIntensity} result="glowColor" />
          <feComposite in="glowColor" in2="blurred" operator="in" result="coloredGlow" />
          <feMerge>
            <feMergeNode in="coloredGlow" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g filter={`url(#${id})`}>{children}</g>
    </>
  );
};

export default GlowFilter;
