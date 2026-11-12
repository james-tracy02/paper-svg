import React from "react";
import type { BindTransform } from "../Sprite";

export type ImageSpriteProps = {
  transform?: string;
  href: string;
  bindTransform?: BindTransform;
};

const ImageSprite: React.FC<ImageSpriteProps> = ({ transform, href, bindTransform }) => (
  <image ref={bindTransform?.(transform)} transform={transform} x={-10} y={-10} width={20} height={20} href={href} />
);

export default ImageSprite;
