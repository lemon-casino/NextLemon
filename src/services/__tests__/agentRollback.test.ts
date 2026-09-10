import { describe, expect, it } from "vitest";
import { captureRollbackSnapshot, hasRollbackSnapshot } from "@/services/agentRollback";
import type { AgentRollbackSnapshot } from "@/types/agent";
import type { CanvasAgentOp, CreativeAsset, CreativeCanvasData } from "@/types/creative";
import type { CustomEdge, CustomNode } from "@/types";

const assets: CreativeAsset[] = [
  {
    id: "asset-1",
    kind: "text",
    title: "Brief",
    text: "hello",
    tags: [],
    source: "manual",
    createdAt: 1,
    updatedAt: 1,
  },
];

const canvas: CreativeCanvasData = {
  id: "creative-main",
  title: "素材创作画布",
  items: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  createdAt: 1,
  updatedAt: 1,
};

const nodes = [
  { id: "node-1", type: "promptNode", position: { x: 0, y: 0 }, data: { label: "P" } },
] as unknown as CustomNode[];
const edges = [
  { id: "edge-1", source: "node-1", target: "node-2" },
] as unknown as CustomEdge[];

const source = {
  creative: { assets, canvas, selectedItemIds: ["item-1"] },
  workflow: { nodes, edges, selectedNodeIds: ["node-1"] },
};

const writeOps: CanvasAgentOp[] = [
  {
    type: "asset.add",
    asset: { kind: "text", title: "Agent 素材", text: "x", source: "agent" },
  },
  { type: "canvas.addItem", assetId: "asset-1" },
  { type: "canvas.selectItems", itemIds: ["item-1"] },
];

describe("agentRollback", () => {
  it("captures an isolated snapshot of creative and workflow state", () => {
    const snapshot = captureRollbackSnapshot(writeOps, source, 1234);

    expect(snapshot.id).toBeTruthy();
    expect(snapshot.createdAt).toBe(1234);
    expect(snapshot.opTypes).toEqual(["asset.add", "canvas.addItem", "canvas.selectItems"]);
    expect(snapshot.creative.assets[0].id).toBe("asset-1");
    expect(snapshot.workflow.nodes[0].id).toBe("node-1");
    expect(snapshot.workflow.selectedNodeIds).toEqual(["node-1"]);
    expect(hasRollbackSnapshot(snapshot)).toBe(true);

    // 修改原始数据不影响快照（深拷贝隔离）
    source.creative.assets.pop();
    source.workflow.nodes.pop();
    expect(snapshot.creative.assets).toHaveLength(1);
    expect(snapshot.workflow.nodes).toHaveLength(1);
  });

  it("records op summary text for the rollback card", () => {
    const snapshot = captureRollbackSnapshot(writeOps, source, 1);
    expect(typeof snapshot.opSummary).toBe("string");
    expect(snapshot.opSummary).toContain("新增素材");
  });

  it("treats undone snapshots as unavailable", () => {
    const snapshot: AgentRollbackSnapshot = captureRollbackSnapshot(writeOps, source, 1);
    snapshot.undone = true;
    expect(hasRollbackSnapshot(snapshot)).toBe(false);
    expect(hasRollbackSnapshot(null)).toBe(false);
  });
});
