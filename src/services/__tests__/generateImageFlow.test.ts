import { describe, expect, it, vi } from "vitest";

// buildGenerateImageFlowOps 是纯函数，不依赖任何 store；
// mock 掉 flowStore 以避免在 node 测试环境加载执行引擎链路。
vi.mock("@/stores/flowStore", () => ({ useFlowStore: { getState: () => ({ nodes: [], edges: [], selectedNodeIds: [] }) } }));

import { buildGenerateImageFlowOps } from "@/services/canvasAgentRuntime";
import { validateAgentOp } from "@/services/agentOps";
import { validateConnection } from "@/utils/connectionValidator";
import type { CanvasAgentOp } from "@/types/creative";

const assets = [
  { id: "asset-internal-2", label: "asset_2" },
  { id: "asset-internal-5", label: "asset_5" },
];

describe("buildGenerateImageFlowOps", () => {
  it("expands one call into the controlled op sequence: asset → promptNode → generator → connect → run", () => {
    const result = buildGenerateImageFlowOps(
      { prompt: "生成一张赛博朋克海报", title: "赛博朋克海报", position: { x: 200, y: 160 } },
      assets
    );
    expect(result.ok).toBe(true);
    const ops = (result as { ok: true; ops: CanvasAgentOp[] }).ops;

    expect(ops.map((op) => op.type)).toEqual([
      "asset.add",
      "workflow.addNode",
      "workflow.addNode",
      "workflow.connectNodes",
      "workflow.runNode",
    ]);

    const promptNode = ops[1] as Extract<CanvasAgentOp, { type: "workflow.addNode" }>;
    const generatorNode = ops[2] as Extract<CanvasAgentOp, { type: "workflow.addNode" }>;
    const connect = ops[3] as Extract<CanvasAgentOp, { type: "workflow.connectNodes" }>;
    const run = ops[4] as Extract<CanvasAgentOp, { type: "workflow.runNode" }>;

    expect(promptNode.nodeType).toBe("promptNode");
    expect(promptNode.nodeId).toBeTruthy();
    expect(generatorNode.nodeType).toBe("imageGeneratorProNode");
    expect(generatorNode.position).toEqual({ x: 560, y: 160 });
    expect(connect.source).toBe(promptNode.nodeId);
    expect(connect.target).toBe(generatorNode.nodeId);
    expect(connect.sourceHandle).toBe("output-prompt");
    expect(connect.targetHandle).toBe("input-prompt");
    expect(run.nodeId).toBe(generatorNode.nodeId);

    // 提示词素材与提示词节点携带同一段 prompt
    const assetAdd = ops[0] as Extract<CanvasAgentOp, { type: "asset.add" }>;
    expect(assetAdd.asset.kind).toBe("text");
    expect(assetAdd.asset.text).toBe("生成一张赛博朋克海报");
    expect(promptNode.data?.prompt).toBe("生成一张赛博朋克海报");
  });

  it("passes granular op validation and yields a valid prompt→generator connection", () => {
    const result = buildGenerateImageFlowOps({ prompt: "一张极简主义猫" }, assets);
    expect(result.ok).toBe(true);
    const ops = (result as { ok: true; ops: CanvasAgentOp[] }).ops;

    for (const op of ops) {
      expect(validateAgentOp(op)).toBeNull();
    }

    const promptNode = ops[1] as Extract<CanvasAgentOp, { type: "workflow.addNode" }>;
    const generatorNode = ops[2] as Extract<CanvasAgentOp, { type: "workflow.addNode" }>;
    const connect = ops[3] as Extract<CanvasAgentOp, { type: "workflow.connectNodes" }>;
    const plannedNodes = [promptNode, generatorNode].map((op) => ({
      id: op.nodeId!,
      type: op.nodeType,
      position: op.position,
      data: {},
    }));
    const validation = validateConnection(
      { source: connect.source, target: connect.target, sourceHandle: connect.sourceHandle ?? null, targetHandle: connect.targetHandle ?? null },
      plannedNodes as never,
      []
    );
    expect(validation.isValid).toBe(true);
  });

  it("injects resolved reference assets as @[asset_N] mentions", () => {
    const result = buildGenerateImageFlowOps(
      { prompt: "参考风格作画", referenceAssetIds: ["asset_2", "asset-internal-5"] },
      assets
    );
    expect(result.ok).toBe(true);
    const ops = (result as { ok: true; ops: CanvasAgentOp[] }).ops;
    const expected = "参考风格作画\n\n参考素材：@[asset_2] @[asset_5]";
    const assetAdd = ops[0] as Extract<CanvasAgentOp, { type: "asset.add" }>;
    expect(assetAdd.asset.text).toBe(expected);
  });

  it("rejects missing prompt, unknown generator type, unresolved refs and unresolved mentions", () => {
    expect(buildGenerateImageFlowOps({}, assets)).toEqual({ ok: false, error: "缺少 prompt" });
    expect(
      buildGenerateImageFlowOps({ prompt: "x", generatorNodeType: "promptNode" }, assets).ok
    ).toBe(false);
    expect(
      buildGenerateImageFlowOps({ prompt: "x", referenceAssetIds: ["asset_99"] }, assets)
    ).toEqual({ ok: false, error: "素材不存在: asset_99（可引用快照中的 label，如 asset_3）" });
    expect(
      buildGenerateImageFlowOps({ prompt: "参考 @[asset_99] 的风格" }, assets).ok
    ).toBe(false);
  });
});
