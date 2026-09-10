import type { Connection } from "@xyflow/react";
import { v4 as uuidv4 } from "uuid";
import { nodeCategories } from "@/config/nodeConfig";
import { agentOpLabel, validateAgentOp } from "@/services/agentOps";
import { captureRollbackSnapshot } from "@/services/agentRollback";
import {
  computeNextToSourcePosition,
  deriveUpstreamAssetRefs,
  findAssetIdByRef,
  findUnresolvedAssetMentions,
} from "@/services/creativeAssetService";
import {
  createCreativeAssetDraftsFromWorkflowNode,
  getDefaultWorkflowNodeData,
} from "@/services/workflowAssetService";
import { useAgentStore } from "@/stores/agentStore";
import { useCanvasStore } from "@/stores/canvasStore";
import { useCreativeStore } from "@/stores/creativeStore";
import { useFlowStore } from "@/stores/flowStore";
import type { CustomNodeData } from "@/types";
import type { AgentEvent } from "@/types/agent";
import type { CanvasAgentOp, CreativeAssetDraft, CreativeAssetKind } from "@/types/creative";
import { validateConnection } from "@/utils/connectionValidator";

export type CanvasAgentToolName =
  | "workspace.readSnapshot"
  | "asset.create"
  | "asset.update"
  | "canvas.addAssetItem"
  | "workflow.createNode"
  | "workflow.connectNodes"
  | "workflow.runNode"
  | "workflow.selectNodes";

export interface CanvasAgentToolDefinition {
  name: CanvasAgentToolName;
  label: string;
  write: boolean;
  exampleArgs: Record<string, unknown>;
}

export interface CanvasAgentToolRunResult {
  ok: boolean;
  pendingApproval?: boolean;
  result?: unknown;
  error?: string;
}

export const CANVAS_AGENT_TOOLS: CanvasAgentToolDefinition[] = [
  {
    name: "workspace.readSnapshot",
    label: "读取工作区快照",
    write: false,
    exampleArgs: {},
  },
  {
    name: "asset.create",
    label: "创建素材",
    write: true,
    exampleArgs: {
      kind: "text",
      title: "Agent 文本素材",
      text: "把这段 brief 沉淀为素材。",
      tags: ["agent"],
      placeOnCanvas: true,
      position: { x: 120, y: 120 },
    },
  },
  {
    name: "asset.update",
    label: "更新素材",
    write: true,
    exampleArgs: {
      assetId: "",
      patch: { title: "新标题", tags: ["reference"] },
    },
  },
  {
    name: "canvas.addAssetItem",
    label: "素材放入创作画布",
    write: true,
    exampleArgs: {
      assetId: "",
      position: { x: 160, y: 160 },
    },
  },
  {
    name: "workflow.createNode",
    label: "创建工作流节点",
    write: true,
    exampleArgs: {
      nodeType: "promptNode",
      position: { x: 120, y: 120 },
      data: { label: "Agent 提示词", prompt: "生成一张产品海报" },
    },
  },
  {
    name: "workflow.connectNodes",
    label: "连接工作流节点",
    write: true,
    exampleArgs: {
      source: "",
      target: "",
      sourceHandle: "output-prompt",
      targetHandle: "input-prompt",
    },
  },
  {
    name: "workflow.runNode",
    label: "运行工作流节点",
    write: true,
    exampleArgs: { nodeId: "" },
  },
  {
    name: "workflow.selectNodes",
    label: "选择工作流节点",
    write: true,
    exampleArgs: { nodeIds: [] },
  },
];

const VALID_NODE_TYPES = new Set(nodeCategories.flatMap((category) => category.nodes.map((node) => node.type)));
const VALID_ASSET_KINDS = new Set<CreativeAssetKind>(["text", "image", "video", "audio"]);

export function getWorkspaceSnapshot() {
  const canvasState = useCanvasStore.getState();
  const flowState = useFlowStore.getState();
  const creativeState = useCreativeStore.getState();
  const labelByAssetId: Record<string, string> = {};
  for (const asset of creativeState.assets) {
    if (asset.label) labelByAssetId[asset.id] = asset.label;
  }

  return {
    workspace: {
      activeCanvasId: canvasState.activeCanvasId,
      canvases: canvasState.canvases.map((canvas) => ({
        id: canvas.id,
        name: canvas.name,
        nodeCount: canvas.nodes.length,
        edgeCount: canvas.edges.length,
        updatedAt: canvas.updatedAt,
      })),
    },
    workflow: {
      nodes: flowState.nodes.map((node) => ({
        id: node.id,
        type: node.type,
        label: typeof node.data.label === "string" ? node.data.label : node.type,
        position: node.position,
        dataKeys: Object.keys(node.data || {}),
        upstreamAssetLabels: deriveUpstreamAssetRefs(
          node.id,
          flowState.nodes,
          flowState.edges,
          labelByAssetId
        )
          .map((ref) => ref.label)
          .filter((label): label is string => Boolean(label)),
      })),
      edges: flowState.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
      })),
      selectedNodeIds: flowState.selectedNodeIds,
    },
    creative: {
      viewport: creativeState.canvas.viewport,
      assets: creativeState.assets.map((asset) => ({
        id: asset.id,
        label: asset.label,
        kind: asset.kind,
        title: asset.title,
        source: asset.source,
        tags: asset.tags,
        hasPreview: Boolean(asset.storagePath || asset.dataUrl || asset.text),
        updatedAt: asset.updatedAt,
      })),
      items: creativeState.canvas.items.map((item) => ({
        id: item.id,
        assetId: item.assetId,
        kind: item.kind,
        title: item.title,
        position: item.position,
        width: item.width,
        height: item.height,
        locked: item.locked,
        hidden: item.hidden,
      })),
      selectedItemIds: creativeState.selectedItemIds,
    },
  };
}

export async function runCanvasAgentInput(
  sessionId: string,
  content: string
): Promise<CanvasAgentToolRunResult> {
  const parsed = parseToolCallInput(content);
  if (parsed) {
    let lastResult: CanvasAgentToolRunResult = { ok: true };
    for (const call of parsed) {
      lastResult = await runCanvasAgentTool(sessionId, call.tool, call.args);
      if (!lastResult.ok) return lastResult;
    }
    return lastResult;
  }

  if (/快照|snapshot|状态|workspace/i.test(content)) {
    return runCanvasAgentTool(sessionId, "workspace.readSnapshot", {});
  }

  return runCanvasAgentTool(sessionId, "asset.create", {
    kind: "text",
    title: content.slice(0, 18) || "Agent 文本素材",
    text: content,
    tags: ["agent"],
    placeOnCanvas: true,
  });
}

export async function runCanvasAgentTool(
  sessionId: string,
  toolName: CanvasAgentToolName,
  args: Record<string, unknown>
): Promise<CanvasAgentToolRunResult> {
  const tool = CANVAS_AGENT_TOOLS.find((item) => item.name === toolName);
  if (!tool) {
    const error = `不支持的工具: ${toolName}`;
    appendToolResult(sessionId, toolName, false, undefined, error);
    return { ok: false, error };
  }

  appendToolCall(sessionId, tool, args);

  if (toolName === "workspace.readSnapshot") {
    const snapshot = getWorkspaceSnapshot();
    appendToolResult(sessionId, toolName, true, snapshot);
    return { ok: true, result: snapshot };
  }

  const opsResult = createOpsFromToolCall(toolName, args);
  if (!opsResult.ok) {
    appendToolResult(sessionId, toolName, false, undefined, opsResult.error);
    return { ok: false, error: opsResult.error };
  }

  const validationError = validateCanvasAgentOpsAgainstState(opsResult.ops);
  if (validationError) {
    appendToolResult(sessionId, toolName, false, undefined, validationError);
    return { ok: false, error: validationError };
  }

  const approval = useAgentStore
    .getState()
    .requestApproval(sessionId, tool.label, opsResult.ops);
  if (!approval.ok) {
    return { ok: false, error: approval.errors.join("；") };
  }

  return { ok: true, pendingApproval: true, result: opsResult.ops };
}

export async function approveAndExecuteAgentOps(sessionId: string): Promise<CanvasAgentToolRunResult> {
  const ops = useAgentStore.getState().approvePendingOps(sessionId);
  if (ops.length === 0) return { ok: true, result: [] };

  const flowState = useFlowStore.getState();
  const creativeState = useCreativeStore.getState();
  const snapshot = captureRollbackSnapshot(ops, {
    creative: {
      assets: creativeState.assets,
      canvas: creativeState.canvas,
      selectedItemIds: creativeState.selectedItemIds,
    },
    workflow: {
      nodes: flowState.nodes,
      edges: flowState.edges,
      selectedNodeIds: flowState.selectedNodeIds,
    },
  });

  const execution = await executeCanvasAgentOps(ops);
  useAgentStore.getState().recordRollbackSnapshot(snapshot);

  const hasError = execution.some((item) => !item.ok);
  appendToolResult(
    sessionId,
    "approval.execute" as CanvasAgentToolName,
    !hasError,
    execution,
    hasError ? "部分操作执行失败" : undefined
  );

  return {
    ok: !hasError,
    result: execution,
    error: hasError ? "部分操作执行失败" : undefined,
  };
}

export function rollbackLastAgentExecution(sessionId: string): { ok: boolean; error?: string } {
  const agentState = useAgentStore.getState();
  const snapshot = agentState.lastRollback;
  if (!snapshot || snapshot.undone) {
    appendToolResult(
      sessionId,
      "agent.rollback" as CanvasAgentToolName,
      false,
      undefined,
      "没有可回滚的 Agent 执行记录"
    );
    return { ok: false, error: "没有可回滚的 Agent 执行记录" };
  }

  useCreativeStore
    .getState()
    .restoreWorkspaceState({
      assets: snapshot.creative.assets,
      canvas: snapshot.creative.canvas,
      selectedItemIds: snapshot.creative.selectedItemIds,
    });
  const flow = useFlowStore.getState();
  flow.setNodes(snapshot.workflow.nodes);
  flow.setEdges(snapshot.workflow.edges);
  flow.setSelectedNodes(snapshot.workflow.selectedNodeIds);

  agentState.markRollbackUndone();
  appendToolResult(sessionId, "agent.rollback" as CanvasAgentToolName, true, {
    summary: snapshot.opSummary,
    opTypes: snapshot.opTypes,
    executedAt: snapshot.createdAt,
    rolledBackAt: Date.now(),
  });
  return { ok: true };
}

export async function executeCanvasAgentOps(ops: CanvasAgentOp[]) {
  const results: Array<{ type: CanvasAgentOp["type"]; ok: boolean; result?: unknown; error?: string }> = [];

  for (const op of ops) {
    try {
      const result = await executeCanvasAgentOp(op);
      results.push({ type: op.type, ok: true, result });
    } catch (error) {
      results.push({
        type: op.type,
        ok: false,
        error: error instanceof Error ? error.message : "未知错误",
      });
    }
  }

  return results;
}

function createOpsFromToolCall(
  toolName: CanvasAgentToolName,
  args: Record<string, unknown>
): { ok: true; ops: CanvasAgentOp[] } | { ok: false; error: string } {
  switch (toolName) {
    case "asset.create": {
      const kind = getString(args.kind) as CreativeAssetKind;
      if (!VALID_ASSET_KINDS.has(kind)) return { ok: false, error: "素材类型无效" };

      const asset: CreativeAssetDraft = {
        kind,
        title: getString(args.title) || undefined,
        text: getString(args.text) || undefined,
        dataUrl: getString(args.dataUrl) || undefined,
        storagePath: getString(args.storagePath) || undefined,
        mimeType: getString(args.mimeType) || undefined,
        fileName: getString(args.fileName) || undefined,
        tags: getStringArray(args.tags),
        source: "agent",
        note: getString(args.note) || undefined,
        metadata: getRecord(args.metadata),
      };

      if (kind === "text" && !asset.text?.trim()) return { ok: false, error: "文本素材缺少 text" };
      if (kind === "text" && asset.text) {
        const unresolved = findUnresolvedAssetMentions(asset.text, useCreativeStore.getState().assets);
        if (unresolved.length > 0) {
          return {
            ok: false,
            error: `提及的素材不存在: ${unresolved.map((label) => "@[" + label + "]").join("、")}（只能引用快照中的 label）`,
          };
        }
      }
      if (kind !== "text" && !asset.dataUrl && !asset.storagePath) {
        return { ok: false, error: "媒体素材缺少 dataUrl 或 storagePath" };
      }

      const canvasItem = args.placeOnCanvas === true
        ? {
            position: args.position ? getPosition(args.position) : undefined,
          }
        : undefined;

      return { ok: true, ops: [{ type: "asset.add", asset, canvasItem }] };
    }
    case "asset.update": {
      const assetRef = getString(args.assetId);
      if (!assetRef) return { ok: false, error: "缺少 assetId" };
      const assetId = findAssetIdByRef(useCreativeStore.getState().assets, assetRef);
      if (!assetId) return { ok: false, error: `素材不存在: ${assetRef}（可引用快照中的 label，如 asset_3）` };
      const patchInput = getRecord(args.patch);
      const patch = sanitizeAssetPatch(patchInput);
      return { ok: true, ops: [{ type: "asset.update", assetId, patch }] };
    }
    case "canvas.addAssetItem": {
      const assetRef = getString(args.assetId);
      if (!assetRef) return { ok: false, error: "缺少 assetId" };
      const assetId = findAssetIdByRef(useCreativeStore.getState().assets, assetRef);
      if (!assetId) return { ok: false, error: `素材不存在: ${assetRef}（可引用快照中的 label，如 asset_3）` };
      return {
        ok: true,
        ops: [{
          type: "canvas.addItem",
          assetId,
          item: {
            position: args.position ? getPosition(args.position) : undefined,
            width: getNumber(args.width),
            height: getNumber(args.height),
          },
        }],
      };
    }
    case "workflow.createNode": {
      const nodeType = getString(args.nodeType);
      if (!nodeType) return { ok: false, error: "缺少 nodeType" };
      return {
        ok: true,
        ops: [{
          type: "workflow.addNode",
          nodeId: getString(args.nodeId) || undefined,
          nodeType,
          position: getPosition(args.position),
          data: getRecord(args.data) as Partial<CustomNodeData>,
        }],
      };
    }
    case "workflow.connectNodes": {
      const source = getString(args.source);
      const target = getString(args.target);
      if (!source || !target) return { ok: false, error: "缺少 source 或 target" };
      return {
        ok: true,
        ops: [{
          type: "workflow.connectNodes",
          source,
          target,
          sourceHandle: getString(args.sourceHandle) || undefined,
          targetHandle: getString(args.targetHandle) || undefined,
        }],
      };
    }
    case "workflow.runNode": {
      const nodeId = getString(args.nodeId);
      if (!nodeId) return { ok: false, error: "缺少 nodeId" };
      return { ok: true, ops: [{ type: "workflow.runNode", nodeId }] };
    }
    case "workflow.selectNodes": {
      return { ok: true, ops: [{ type: "workflow.selectNodes", nodeIds: getStringArray(args.nodeIds) }] };
    }
    default:
      return { ok: false, error: "该工具没有写操作映射" };
  }
}

export function validateCanvasAgentOpsAgainstState(ops: CanvasAgentOp[]): string | null {
  const flow = useFlowStore.getState();
  const creative = useCreativeStore.getState();
  const assetIds = new Set(creative.assets.map((asset) => asset.id));
  const itemIds = new Set(creative.canvas.items.map((item) => item.id));
  const plannedNodes = [...flow.nodes];
  let plannedEdges = [...flow.edges];
  const nodeIds = new Set(plannedNodes.map((node) => node.id));

  for (const op of ops) {
    const schemaError = validateAgentOp(op);
    if (schemaError) return `${agentOpLabel(op.type)}: ${schemaError}`;

    switch (op.type) {
      case "asset.update":
        if (!assetIds.has(op.assetId)) return `素材不存在: ${op.assetId}`;
        break;
      case "asset.delete":
        if (op.assetIds.some((assetId) => !assetIds.has(assetId))) return "删除素材包含不存在的 assetId";
        break;
      case "canvas.addItem":
        if (!assetIds.has(op.assetId)) return `素材不存在: ${op.assetId}`;
        break;
      case "canvas.updateItem":
      case "canvas.moveItem":
        if (!itemIds.has(op.itemId)) return `画布素材不存在: ${op.itemId}`;
        break;
      case "canvas.deleteItem":
      case "canvas.selectItems":
        if (op.itemIds.some((itemId) => !itemIds.has(itemId))) return "画布素材列表包含不存在的 itemId";
        break;
      case "workflow.addNode":
        if (!VALID_NODE_TYPES.has(op.nodeType)) return `节点类型不存在: ${op.nodeType}`;
        if (op.nodeId && nodeIds.has(op.nodeId)) return `工作流节点 ID 已存在: ${op.nodeId}`;
        if (op.nodeId) {
          plannedNodes.push({
            id: op.nodeId,
            type: op.nodeType,
            position: op.position,
            data: getDefaultWorkflowNodeData(op.nodeType, op.data),
          });
          nodeIds.add(op.nodeId);
        }
        break;
      case "workflow.updateNode":
      case "workflow.runNode":
        if (!nodeIds.has(op.nodeId)) return `工作流节点不存在: ${op.nodeId}`;
        break;
      case "workflow.connectNodes": {
        if (!nodeIds.has(op.source) || !nodeIds.has(op.target)) return "连接包含不存在的节点 ID";
        const connection: Connection = {
          source: op.source,
          target: op.target,
          sourceHandle: op.sourceHandle || null,
          targetHandle: op.targetHandle || null,
        };
        const result = validateConnection(connection, plannedNodes, plannedEdges);
        if (!result.isValid) return result.reason || "连接无效";
        plannedEdges = result.existingEdge
          ? plannedEdges.filter((edge) => edge.id !== result.existingEdge?.id)
          : plannedEdges;
        plannedEdges.push({
          id: uuidv4(),
          source: op.source,
          target: op.target,
          sourceHandle: op.sourceHandle,
          targetHandle: op.targetHandle,
        });
        break;
      }
      case "workflow.selectNodes":
        if (op.nodeIds.some((nodeId) => !nodeIds.has(nodeId))) return "选择节点包含不存在的 nodeId";
        break;
      case "library.saveWorkflowNode":
        if (!nodeIds.has(op.nodeId)) return `工作流节点不存在: ${op.nodeId}`;
        break;
      default:
        break;
    }
  }

  return null;
}

async function executeCanvasAgentOp(op: CanvasAgentOp): Promise<unknown> {
  const creative = useCreativeStore.getState();
  const flow = useFlowStore.getState();

  switch (op.type) {
    case "asset.add": {
      const assetId = creative.addAsset(op.asset);
      const canvasItem = op.canvasItem?.position
        ? op.canvasItem
        : op.canvasItem
          ? {
              ...op.canvasItem,
              position: computeNextToSourcePosition(
                useCreativeStore.getState().canvas.items,
                assetId
              ),
            }
          : undefined;
      const itemId = canvasItem ? creative.addAssetToCanvas(assetId, canvasItem) : null;
      return { assetId, itemId };
    }
    case "asset.update":
      creative.updateAsset(op.assetId, op.patch);
      return { assetId: op.assetId };
    case "asset.delete":
      creative.removeAssets(op.assetIds);
      return { assetIds: op.assetIds };
    case "canvas.addItem": {
      const item = op.item?.position
        ? op.item
        : {
            ...op.item,
            position: computeNextToSourcePosition(
              useCreativeStore.getState().canvas.items,
              op.assetId
            ),
          };
      const itemId = creative.addAssetToCanvas(op.assetId, item);
      return { itemId };
    }
    case "canvas.updateItem":
      creative.updateItem(op.itemId, op.patch);
      return { itemId: op.itemId };
    case "canvas.deleteItem":
      creative.removeItems(op.itemIds);
      return { itemIds: op.itemIds };
    case "canvas.moveItem":
      creative.moveItem(op.itemId, op.position);
      return { itemId: op.itemId };
    case "canvas.selectItems":
      creative.selectItems(op.itemIds);
      return { itemIds: op.itemIds };
    case "canvas.setViewport":
      creative.setViewport(op.viewport);
      return op.viewport;
    case "workflow.addNode": {
      const data = getDefaultWorkflowNodeData(op.nodeType, op.data);
      const nodeId = flow.addNode(op.nodeType, op.position, data, op.nodeId);
      return { nodeId };
    }
    case "workflow.updateNode":
      flow.updateNodeData(op.nodeId, op.data);
      return { nodeId: op.nodeId };
    case "workflow.connectNodes":
      flow.onConnect({
        source: op.source,
        target: op.target,
        sourceHandle: op.sourceHandle || null,
        targetHandle: op.targetHandle || null,
      });
      return { source: op.source, target: op.target };
    case "workflow.runNode":
      await flow.executeFromNode(op.nodeId);
      return { nodeId: op.nodeId };
    case "workflow.selectNodes":
      flow.setSelectedNodes(op.nodeIds);
      return { nodeIds: op.nodeIds };
    case "library.saveWorkflowNode": {
      const node = flow.nodes.find((item) => item.id === op.nodeId);
      if (!node) throw new Error(`工作流节点不存在: ${op.nodeId}`);
      const drafts = createCreativeAssetDraftsFromWorkflowNode(node);
      if (drafts.length === 0) throw new Error("节点暂无可保存为素材的内容");
      const assetIds = drafts.map((draft) => creative.addAsset(draft));
      return { assetIds };
    }
    default:
      return null;
  }
}

function appendToolCall(
  sessionId: string,
  tool: CanvasAgentToolDefinition,
  args: Record<string, unknown>
) {
  const event: AgentEvent = {
    id: uuidv4(),
    type: "tool_call",
    sessionId,
    toolName: tool.name,
    args,
    write: tool.write,
    createdAt: Date.now(),
  };
  useAgentStore.getState().appendEvent(sessionId, event);
}

function appendToolResult(
  sessionId: string,
  toolName: CanvasAgentToolName,
  ok: boolean,
  result?: unknown,
  error?: string
) {
  const event: AgentEvent = {
    id: uuidv4(),
    type: "tool_result",
    sessionId,
    toolName,
    ok,
    result,
    error,
    createdAt: Date.now(),
  };
  useAgentStore.getState().appendEvent(sessionId, event);
}

function parseToolCallInput(content: string): Array<{ tool: CanvasAgentToolName; args: Record<string, unknown> }> | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const items = Array.isArray(parsed) ? parsed : [parsed];
    const calls = items
      .map((item) => {
        const record = getRecord(item);
        const tool = getString(record.tool || record.toolName || record.name) as CanvasAgentToolName;
        if (!tool) return null;
        return { tool, args: getRecord(record.args) };
      })
      .filter((call): call is { tool: CanvasAgentToolName; args: Record<string, unknown> } => Boolean(call));
    return calls.length > 0 ? calls : null;
  } catch {
    return null;
  }
}

function sanitizeAssetPatch(input: Record<string, unknown>) {
  return {
    title: getString(input.title) || undefined,
    text: getString(input.text) || undefined,
    tags: Array.isArray(input.tags) ? getStringArray(input.tags) : undefined,
    note: getString(input.note) || undefined,
    metadata: getRecord(input.metadata),
  };
}

function getRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function getString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => getString(item)).filter(Boolean);
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getPosition(value: unknown): { x: number; y: number } {
  const record = getRecord(value);
  const x = getNumber(record.x);
  const y = getNumber(record.y);
  return {
    x: x ?? 120,
    y: y ?? 120,
  };
}
