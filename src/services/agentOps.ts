import type { CanvasAgentOp } from "@/types/creative";

export interface CanvasAgentOpSpec {
  type: CanvasAgentOp["type"];
  category: "asset" | "canvas" | "workflow" | "library";
  label: string;
  description: string;
  required: string[];
  example: CanvasAgentOp;
}

export type CanvasAgentJsonSchema = Record<string, unknown>;

export const CANVAS_AGENT_OP_SPECS: CanvasAgentOpSpec[] = [
  {
    type: "asset.add",
    category: "asset",
    label: "新增素材",
    description: "新增 text/image/video/audio 素材，可同时放入创作画布。",
    required: ["asset.kind"],
    example: {
      type: "asset.add",
      asset: {
        kind: "text",
        title: "外部 Agent 需求",
        text: "等待用户审批后写入素材库。",
        source: "agent",
        tags: ["agent"],
      },
      canvasItem: {
        position: { x: 160, y: 160 },
        width: 320,
        height: 160,
      },
    },
  },
  {
    type: "asset.update",
    category: "asset",
    label: "更新素材",
    description: "更新素材标题、标签、备注或 metadata 等字段。",
    required: ["assetId", "patch"],
    example: {
      type: "asset.update",
      assetId: "asset-id",
      patch: { title: "更新后的素材标题" },
    },
  },
  {
    type: "asset.delete",
    category: "asset",
    label: "删除素材",
    description: "从素材库删除一个或多个素材。",
    required: ["assetIds"],
    example: {
      type: "asset.delete",
      assetIds: ["asset-id"],
    },
  },
  {
    type: "canvas.addItem",
    category: "canvas",
    label: "放入创作画布",
    description: "把已有素材实例化到创作画布。",
    required: ["assetId"],
    example: {
      type: "canvas.addItem",
      assetId: "asset-id",
      item: {
        position: { x: 240, y: 180 },
        width: 320,
        height: 240,
      },
    },
  },
  {
    type: "canvas.updateItem",
    category: "canvas",
    label: "更新画布素材",
    description: "更新创作画布上的素材实例，例如尺寸、层级、锁定、隐藏。",
    required: ["itemId", "patch"],
    example: {
      type: "canvas.updateItem",
      itemId: "item-id",
      patch: { width: 420, height: 240, zIndex: 2 },
    },
  },
  {
    type: "canvas.deleteItem",
    category: "canvas",
    label: "移除画布素材",
    description: "从创作画布移除一个或多个素材实例，不删除素材库原件。",
    required: ["itemIds"],
    example: {
      type: "canvas.deleteItem",
      itemIds: ["item-id"],
    },
  },
  {
    type: "canvas.moveItem",
    category: "canvas",
    label: "移动画布素材",
    description: "移动创作画布上的素材实例。",
    required: ["itemId", "position.x", "position.y"],
    example: {
      type: "canvas.moveItem",
      itemId: "item-id",
      position: { x: 320, y: 260 },
    },
  },
  {
    type: "canvas.selectItems",
    category: "canvas",
    label: "选择画布素材",
    description: "设置创作画布选中的素材实例。",
    required: ["itemIds"],
    example: {
      type: "canvas.selectItems",
      itemIds: ["item-id"],
    },
  },
  {
    type: "canvas.setViewport",
    category: "canvas",
    label: "调整创作视图",
    description: "设置创作画布视口位置和缩放。",
    required: ["viewport.x", "viewport.y", "viewport.zoom"],
    example: {
      type: "canvas.setViewport",
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  },
  {
    type: "workflow.addNode",
    category: "workflow",
    label: "新增工作流节点",
    description: "在 React Flow 工作流画布新增节点。",
    required: ["nodeType", "position.x", "position.y"],
    example: {
      type: "workflow.addNode",
      nodeType: "promptNode",
      position: { x: 160, y: 160 },
      data: { label: "Agent 提示词", prompt: "生成一张品牌海报" },
    },
  },
  {
    type: "workflow.updateNode",
    category: "workflow",
    label: "更新工作流节点",
    description: "更新已有工作流节点的数据。",
    required: ["nodeId", "data"],
    example: {
      type: "workflow.updateNode",
      nodeId: "node-id",
      data: { label: "更新后的节点" },
    },
  },
  {
    type: "workflow.connectNodes",
    category: "workflow",
    label: "连接工作流节点",
    description: "连接两个工作流节点。",
    required: ["source", "target"],
    example: {
      type: "workflow.connectNodes",
      source: "prompt-node-id",
      target: "image-node-id",
      sourceHandle: "output-prompt",
      targetHandle: "input-prompt",
    },
  },
  {
    type: "workflow.runNode",
    category: "workflow",
    label: "运行工作流节点",
    description: "请求运行已有工作流节点。",
    required: ["nodeId"],
    example: {
      type: "workflow.runNode",
      nodeId: "node-id",
    },
  },
  {
    type: "workflow.selectNodes",
    category: "workflow",
    label: "选择工作流节点",
    description: "设置工作流画布选中的节点。",
    required: ["nodeIds"],
    example: {
      type: "workflow.selectNodes",
      nodeIds: ["node-id"],
    },
  },
  {
    type: "library.saveWorkflowNode",
    category: "library",
    label: "保存节点为素材",
    description: "把工作流节点输出沉淀到素材库。",
    required: ["nodeId"],
    example: {
      type: "library.saveWorkflowNode",
      nodeId: "node-id",
    },
  },
];

export const CANVAS_AGENT_OP_TYPES = CANVAS_AGENT_OP_SPECS.map((spec) => spec.type);

export function createCanvasAgentOpJsonSchema(): CanvasAgentJsonSchema {
  return {
    oneOf: CANVAS_AGENT_OP_SPECS.map(createSchemaForOpSpec),
  };
}

export function createCanvasAgentApprovalRequestJsonSchema(): CanvasAgentJsonSchema {
  return {
    type: "object",
    required: ["ops"],
    properties: {
      title: {
        type: "string",
        description: "Human-readable approval title shown inside NextLemon.",
      },
      ops: {
        type: "array",
        minItems: 1,
        description: "CanvasAgentOp operations. Writes are validated and queued for approval, never executed directly.",
        items: createCanvasAgentOpJsonSchema(),
      },
    },
    additionalProperties: false,
  };
}

const WRITE_OPS = new Set<CanvasAgentOp["type"]>([
  "asset.add",
  "asset.update",
  "asset.delete",
  "canvas.addItem",
  "canvas.updateItem",
  "canvas.deleteItem",
  "canvas.moveItem",
  "canvas.selectItems",
  "canvas.setViewport",
  "workflow.addNode",
  "workflow.updateNode",
  "workflow.connectNodes",
  "workflow.runNode",
  "workflow.selectNodes",
  "library.saveWorkflowNode",
]);

export function isWriteAgentOp(op: CanvasAgentOp): boolean {
  return WRITE_OPS.has(op.type);
}

export function summarizeAgentOps(ops: CanvasAgentOp[]): string {
  const counts = ops.reduce<Record<string, number>>((acc, op) => {
    acc[op.type] = (acc[op.type] || 0) + 1;
    return acc;
  }, {});

  return Object.entries(counts)
    .map(([type, count]) => `${agentOpLabel(type as CanvasAgentOp["type"])} ${count}`)
    .join("，");
}

export function agentOpLabel(type: CanvasAgentOp["type"]): string {
  return CANVAS_AGENT_OP_SPECS.find((spec) => spec.type === type)?.label || type;
}

export function validateAgentOp(op: CanvasAgentOp): string | null {
  if (!op || typeof op !== "object") return "操作必须是对象";

  switch (op.type) {
    case "asset.add":
      if (!op.asset || typeof op.asset !== "object") return "新增素材缺少 asset";
      if (!["text", "image", "video", "audio"].includes(op.asset.kind)) return "新增素材类型无效";
      return null;
    case "asset.update":
      if (!op.assetId) return "更新素材缺少 assetId";
      return op.patch && typeof op.patch === "object" ? null : "更新素材缺少 patch";
    case "asset.delete":
      return Array.isArray(op.assetIds) && op.assetIds.length > 0 ? null : "删除素材缺少 assetIds";
    case "canvas.addItem":
      return op.assetId ? null : "放入创作画布缺少 assetId";
    case "canvas.updateItem":
      if (!op.itemId) return "更新画布素材缺少 itemId";
      return op.patch && typeof op.patch === "object" ? null : "更新画布素材缺少 patch";
    case "canvas.moveItem":
      if (!op.itemId) return "移动画布素材缺少 itemId";
      return isFinitePosition(op.position) ? null : "移动画布素材 position 无效";
    case "canvas.deleteItem":
      return Array.isArray(op.itemIds) && op.itemIds.length > 0 ? null : "删除画布素材缺少 itemIds";
    case "canvas.selectItems":
      return Array.isArray(op.itemIds) ? null : "选择画布素材缺少 itemIds";
    case "canvas.setViewport":
      return isFiniteViewport(op.viewport) ? null : "视口参数无效";
    case "workflow.addNode":
      if (!op.nodeType) return "新增工作流节点缺少 nodeType";
      return isFinitePosition(op.position) ? null : "新增工作流节点 position 无效";
    case "workflow.updateNode":
      if (!op.nodeId) return "更新工作流节点缺少 nodeId";
      return op.data && typeof op.data === "object" ? null : "更新工作流节点缺少 data";
    case "workflow.runNode":
      return op.nodeId ? null : "运行工作流节点缺少 nodeId";
    case "workflow.connectNodes":
      return op.source && op.target ? null : "连接工作流节点缺少 source 或 target";
    case "workflow.selectNodes":
      return Array.isArray(op.nodeIds) ? null : "选择工作流节点缺少 nodeIds";
    case "library.saveWorkflowNode":
      return op.nodeId ? null : "保存节点为素材缺少 nodeId";
    default:
      return "不支持的 Agent 操作";
  }
}

export function validateAgentOps(ops: unknown): string[] {
  if (!Array.isArray(ops)) return ["ops 必须是数组"];
  if (ops.length === 0) return ["写操作列表为空"];
  return ops
    .map((op, index) => {
      const error = validateAgentOp(op as CanvasAgentOp);
      return error ? `#${index + 1} ${error}` : null;
    })
    .filter((error): error is string => Boolean(error));
}

function isFinitePosition(value: unknown): value is { x: number; y: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const position = value as { x?: unknown; y?: unknown };
  return Number.isFinite(position.x) && Number.isFinite(position.y);
}

function isFiniteViewport(value: unknown): value is { x: number; y: number; zoom: number } {
  if (!isFinitePosition(value)) return false;
  const viewport = value as { zoom?: unknown };
  return Number.isFinite(viewport.zoom) && Number(viewport.zoom) > 0;
}

function createSchemaForOpSpec(spec: CanvasAgentOpSpec): CanvasAgentJsonSchema {
  const schema: CanvasAgentJsonSchema = {
    type: "object",
    description: spec.description,
    required: ["type"],
    properties: {
      type: {
        const: spec.type,
        description: spec.label,
      },
    },
    additionalProperties: true,
    examples: [spec.example],
  };

  for (const path of spec.required) addRequiredPath(schema, path, spec.type);
  return schema;
}

function addRequiredPath(schema: CanvasAgentJsonSchema, path: string, opType: CanvasAgentOp["type"]) {
  const parts = path.split(".");
  let current = schema;
  for (const [index, part] of parts.entries()) {
    const required = getStringArray(current, "required");
    if (!required.includes(part)) required.push(part);
    current.required = required;

    const properties = getRecord(current, "properties");
    const isLeaf = index === parts.length - 1;
    if (!properties[part]) {
      properties[part] = isLeaf ? schemaForField(part, path, opType) : { type: "object", properties: {}, required: [], additionalProperties: true };
    }
    current.properties = properties;
    if (!isLeaf) current = properties[part] as CanvasAgentJsonSchema;
  }
}

function schemaForField(field: string, path: string, opType: CanvasAgentOp["type"]): CanvasAgentJsonSchema {
  if (field === "kind" && path === "asset.kind") {
    return { type: "string", enum: ["text", "image", "video", "audio"] };
  }
  if (field === "zoom") return { type: "number", exclusiveMinimum: 0 };
  if (field === "x" || field === "y") return { type: "number" };
  if (field.endsWith("Ids")) {
    const canBeEmpty = opType === "canvas.selectItems" || opType === "workflow.selectNodes";
    return { type: "array", minItems: canBeEmpty ? 0 : 1, items: { type: "string" } };
  }
  if (["asset", "patch", "item", "data", "viewport", "position"].includes(field)) {
    return { type: "object", additionalProperties: true };
  }
  return { type: "string", minLength: 1 };
}

function getRecord(target: CanvasAgentJsonSchema, key: string): Record<string, unknown> {
  const value = target[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function getStringArray(target: CanvasAgentJsonSchema, key: string): string[] {
  const value = target[key];
  return Array.isArray(value) ? [...value.filter((item): item is string => typeof item === "string")] : [];
}
