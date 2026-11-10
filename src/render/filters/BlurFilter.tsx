import type { ReactNode } from "react";

type BlurFilterProps = {
  id: string;
  enabled: boolean;
  amount: number;
  children: ReactNode;
};

const BlurFilter = ({ id, enabled, amount, children }: BlurFilterProps) => {
  const sanitizedAmount = Math.max(0, amount ?? 0);
  const isActive = enabled && sanitizedAmount > 0;

  if (!isActive) {
    return <>{children}</>;
  }

  return (
    <>
      <defs>
        <filter id={id} x="-200%" y="-200%" width="400%" height="400%" colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation={sanitizedAmount} />
        </filter>
      </defs>
      <g filter={`url(#${id})`}>{children}</g>
    </>
  );
};

export default BlurFilter;
