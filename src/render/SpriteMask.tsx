import SvgSprite from "./Sprite";
import React, { useMemo } from "react";
import type { Sprite } from "../types/Sprite";
import { maskProps } from "./maskProps";
import { getSpriteMaskRegion } from "./spriteBounds";

type MaskProps = {
  id: string;
  sprite: Sprite;
};

/** A node's own sprite mask (`setMask`), in the node's space. Its region comes from the sprite's geometry. */
const SvgSpriteMask: React.FC<MaskProps> = ({ id, sprite }) => {
  const region = useMemo(() => getSpriteMaskRegion(sprite), [sprite]);
  const maskAttributes = region
    ? { ...region, maskUnits: "userSpaceOnUse" as const, maskContentUnits: "userSpaceOnUse" as const }
    : { ...maskProps, maskContentUnits: "userSpaceOnUse" as const };

  return (
    <mask id={id} {...maskAttributes}>
      <g>
        <SvgSprite key={id} id={id} sprite={sprite} mode={"mask"} />
      </g>
    </mask>
  );
};

export default React.memo(SvgSpriteMask);
