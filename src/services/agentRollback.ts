import { v4 as uuidv4 } from "uuid";
import { isWriteAgentOp, summarizeAgentOps } from "@/services/agentOps";
import type { AgentRollbackSnapshot } from "@/types/agent";
import type { CanvasAgentOp, CreativeAsset, CreativeCanvasData } from "@/types/creative";
import type { CustomEdge, CustomNode } from "@/types";

export interface RollbackSnapshotSource {
  creative: {
    assets: CreativeAsset[];
    canvas: CreativeCanvasData;
    selectedItemIds: string[];
  };
  workflow: {
    nodes: CustomNode[];
    edges: CustomEdge[];
    selectedNodeIds: string[];
  };
}

export function captureRollbackSnapshot(
  ops: CanvasAgentOp[],
  source: RollbackSnapshotSource,
  createdAt = Date.now()
): AgentRollbackSnapshot {
  const writeOps = ops.filter(isWriteAgentOp);
  const snapshot: AgentRollbackSnapshot = {
    id: uuidv4(),
    createdAt,
    opSummary: summarizeAgentOps(writeOps.length > 0 ? writeOps : ops),
    opTypes: (writeOps.length > 0 ? writeOps : ops).map((op) => op.type),
    creative: cloneJson({
      assets: source.creative.assets,
      canvas: source.creative.canvas,
      selectedItemIds: source.creative.selectedItemIds,
    }),
    workflow: cloneJson({
      nodes: source.workflow.nodes,
      edges: source.workflow.edges,
      selectedNodeIds: source.workflow.selectedNodeIds,
    }),
  };
  return snapshot;
}

export function hasRollbackSnapshot(snapshot: AgentRollbackSnapshot | null | undefined): boolean {
  return Boolean(snapshot && !snapshot.undone);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
