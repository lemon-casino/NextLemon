import { describe, expect, it } from "vitest";
import {
  CANVAS_AGENT_OP_TYPES,
  agentOpLabel,
  createCanvasAgentApprovalRequestJsonSchema,
  createCanvasAgentOpJsonSchema,
  summarizeAgentOps,
  validateAgentOp,
  validateAgentOps,
} from "@/services/agentOps";
import type { CanvasAgentOp } from "@/types/creative";

describe("agentOps", () => {
  it("validates required operation fields", () => {
    expect(validateAgentOp({ type: "asset.add", asset: { kind: "text" } })).toBeNull();
    expect(validateAgentOp({ type: "asset.update", assetId: "", patch: {} })).toContain("assetId");
    expect(validateAgentOp({ type: "workflow.runNode", nodeId: "" })).toContain("nodeId");
    expect(validateAgentOp({ type: "workflow.connectNodes", source: "a", target: "" })).toContain("source");
  });

  it("publishes a complete operation catalog and validates batches", () => {
    expect(CANVAS_AGENT_OP_TYPES).toContain("library.saveWorkflowNode");
    expect(CANVAS_AGENT_OP_TYPES).toHaveLength(15);
    expect(validateAgentOps([{ type: "canvas.setViewport", viewport: { x: 0, y: 0, zoom: 1 } }])).toHaveLength(0);
    expect(validateAgentOps([{ type: "canvas.setViewport", viewport: { x: 0, y: 0, zoom: 0 } }])[0]).toContain("视口");
  });

  it("generates granular JSON schemas for external Agent tools", () => {
    const opSchema = createCanvasAgentOpJsonSchema();
    const approvalSchema = createCanvasAgentApprovalRequestJsonSchema() as any;
    const oneOf = opSchema.oneOf as Array<Record<string, any>>;
    const assetAdd = oneOf.find((schema) => schema.properties?.type?.const === "asset.add");

    expect(oneOf).toHaveLength(15);
    expect(assetAdd?.required).toEqual(expect.arrayContaining(["type", "asset"]));
    expect(assetAdd?.properties?.asset?.required).toContain("kind");
    expect(assetAdd?.properties?.asset?.properties?.kind?.enum).toEqual(["text", "image", "video", "audio"]);
    expect(approvalSchema.properties?.ops).toMatchObject({ type: "array", minItems: 1 });
    expect((approvalSchema.properties?.ops as any).items.oneOf).toHaveLength(15);
  });

  it("summarizes write operations with stable labels", () => {
    const ops: CanvasAgentOp[] = [
      { type: "asset.add", asset: { kind: "text", text: "hello" } },
      { type: "asset.add", asset: { kind: "text", text: "world" } },
      { type: "workflow.selectNodes", nodeIds: ["node-1"] },
    ];

    expect(agentOpLabel("asset.add")).toBe("新增素材");
    expect(summarizeAgentOps(ops)).toBe("新增素材 2，选择工作流节点 1");
  });
});
