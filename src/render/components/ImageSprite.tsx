import React from "react";

export type ImageSpriteProps = {
  transform?: string;
  href: string;
};

const ImageSprite: React.FC<ImageSpriteProps> = ({ transform, href }) => (
  <image transform={transform} x={-10} y={-10} width={20} height={20} href={href} />
);

export default ImageSprite;
