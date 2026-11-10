import { useCallback, useRef } from "react";
import type { Node } from "../types/Node";
import type { Color, Vector2 } from "../types/primitives";
import type { RenderGroupOptions } from "../types/RenderGroup";
import type { RenderNode } from "./RenderTree";
import RigLayers from "./RigLayers";
import { useRenderNodes } from "./useRenderNodes";
import { resolveRotationPivot } from "./rotationPivot";
import Pivots from "./overlays/Pivots";
import GlowFilter from "./filters/GlowFilter";
import TintFilter from "./filters/TintFilter";
import BlurFilter from "./filters/BlurFilter";
import { SPRITE_ROOT_STYLE } from "./hooks/useSpriteVisuals";
import { ColorTransformProvider, type ColorTransform } from "./context/ColorTransformContext";

export type GlowConfig = {
  color?: Color;
  radius: number;
  size?: number;
  intensity?: number;
};

export type TintConfig = {
  color?: Color;
  opacity: number;
  blendMode?: GlobalCompositeOperation;
};

export type RigEffects = {
  /** A second stroke drawn around every node. */
  outerOutline?: { color: Color; thickness: number };
  glow?: GlowConfig;
  tint?: TintConfig;
  /** Gaussian blur radius in px. */
  blur?: number;
  /** Multiplies the whole rig's opacity (0..1). */
  opacity?: number;
  /** Return true to paint a node at zero opacity. */
  isHidden?: (node: RenderNode) => boolean;
};

export type RigProps = {
  /** Root of the node tree to render. */
  body: Node;
  /** Uniform scale applied to the whole rig. */
  scale?: number;
  /** Mirror the rig horizontally. */
  mirror?: boolean;
  /** Prefixes every generated SVG id. Give each rig in a document its own. */
  idPrefix?: string;
  /** Per-render-group options (mask, clip, opacity, blendMode) by group id. */
  getRenderGroupOptions?: (id: string) => RenderGroupOptions | undefined;
  /** Transforms every default and outline sprite color at paint time (e.g. lighting). */
  colorTransform?: ColorTransform;
  /** Called when a node that rotates is pressed. `pivot` is the joint's screen position. */
  onRotate?: (id: string, pivot: Vector2) => (event: React.MouseEvent) => void;
  /** Draw joint pivots for debugging. */
  showPivots?: boolean;
  effects?: RigEffects;
};

/** Renders a node tree to SVG. Place it inside an `<svg>`. */
const Rig: React.FC<RigProps> = ({
  body,
  scale = 1,
  mirror = false,
  idPrefix = "rig",
  getRenderGroupOptions,
  colorTransform,
  onRotate,
  showPivots = false,
  effects,
}) => {
  const scopeId = useCallback((suffix: string) => `${idPrefix}_${suffix}`, [idPrefix]);
  const nodes = useRenderNodes(body);

  const partRefs = useRef<Record<string, SVGGElement | null>>({});
  const setPartRef = useCallback((id: string, element: SVGGElement | null) => {
    partRefs.current[id] = element;
  }, []);

  // Read through a ref so handleRotate stays stable across rebuilds and nodes keep their memo.
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  const handleRotate = useCallback(
    (part: RenderNode) => (event: React.MouseEvent) => {
      if (!onRotate || event.button !== 0) return;
      const clicked = event.currentTarget as SVGGElement;
      const svg = clicked.ownerSVGElement;
      if (!svg) return;
      const pivot = resolveRotationPivot({
        svg,
        clicked,
        partId: part.id,
        element: partRefs.current[part.id],
        nodes: nodesRef.current,
      });
      if (pivot) onRotate(part.id, pivot)(event);
    },
    [onRotate],
  );

  const graphics = (
    <g opacity={effects?.opacity} style={SPRITE_ROOT_STYLE}>
      <BlurFilter id={scopeId("blurFilter")} enabled={Boolean(effects?.blur)} amount={effects?.blur ?? 0}>
        <GlowFilter
          id={scopeId("glowFilter")}
          enabled={Boolean(effects?.glow && effects.glow.radius > 0)}
          color={effects?.glow?.color ?? "#ffffff"}
          radius={effects?.glow?.radius ?? 0}
          size={effects?.glow?.size ?? 1}
          intensity={effects?.glow?.intensity ?? 1}
        >
          <TintFilter
            id={scopeId("tintFilter")}
            enabled={Boolean(effects?.tint && effects.tint.opacity > 0)}
            color={effects?.tint?.color ?? "#ffffff"}
            opacity={effects?.tint?.opacity ?? 0}
            blendMode={effects?.tint?.blendMode ?? "multiply"}
          >
            <g transform={`scale(${scale}, ${scale}) scale(${mirror ? -1 : 1}, 1)`}>
              <RigLayers
                body={body}
                nodes={nodes}
                scopeId={scopeId}
                getRenderGroupOptions={getRenderGroupOptions}
                onRotate={handleRotate}
                setPartRef={setPartRef}
                outerOutline={effects?.outerOutline}
                isHidden={effects?.isHidden}
              />
            </g>
          </TintFilter>
        </GlowFilter>
      </BlurFilter>
      {showPivots ? (
        <g transform={`scale(${scale}, ${scale})`}>
          <Pivots groups={nodes} show includeNonArticulated />
        </g>
      ) : null}
    </g>
  );

  return colorTransform ? <ColorTransformProvider value={colorTransform}>{graphics}</ColorTransformProvider> : graphics;
};

export default Rig;
