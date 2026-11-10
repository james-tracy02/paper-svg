import { useMemo, useState } from "react";
import type { Node } from "../types/Node";
import { buildMaskSignature, getRenderNodes } from "./RenderTree";
import { createNodeInterner } from "./stableNodes";

/** The tree's render nodes sorted by zIndex. Unchanged nodes keep their identity across rebuilds. */
export const useRenderNodes = (body: Node) => {
  const maskSignature = buildMaskSignature(body);
  const [intern] = useState(createNodeInterner);
  const nodes = useMemo(() => intern(getRenderNodes(body)), [body, maskSignature, intern]);
  return useMemo(() => [...nodes].sort((a, b) => a.zIndex - b.zIndex), [nodes]);
};
