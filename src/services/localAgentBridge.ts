import {
  CANVAS_AGENT_OP_SPECS,
  createCanvasAgentApprovalRequestJsonSchema,
  summarizeAgentOps,
  validateAgentOps,
} from "@/services/agentOps";
import {
  getWorkspaceSnapshot,
  validateCanvasAgentOpsAgainstState,
} from "@/services/canvasAgentRuntime";
import {
  applyTemplateVariant,
  createBrandSpecDocument,
  createDesignTemplateCapabilityMatrix,
  DESIGN_TEMPLATES,
  getTemplateVariants,
  REQUIRED_DESIGN_TEMPLATE_KINDS,
} from "@/services/designTemplateService";
import { useAgentStore } from "@/stores/agentStore";
import { useLocalAgentBridgeStore } from "@/stores/localAgentBridgeStore";
import type { AgentApprovalAuditMetadata } from "@/types/agent";
import type {
  LocalAgentBridgeAuditEntry,
  LocalAgentBridgeApi,
  LocalAgentBridgeApprovalRequest,
  LocalAgentBridgeApprovalResult,
  LocalAgentBridgeBrandSpecRequest,
  LocalAgentBridgeBrandSpecResult,
  LocalAgentBridgeBrandTemplateListRequest,
  LocalAgentBridgeBrandTemplateListResult,
  LocalAgentBridgeConfigBundle,
  LocalAgentBridgeJsonSchema,
  LocalAgentMcpManifest,
  LocalAgentBridgeSnapshot,
  LocalAgentBridgeStatus,
  LocalAgentBridgeTool,
  LocalAgentBridgeValidationResult,
  LocalAgentApprovalRequestPackage,
} from "@/types/localAgentBridge";
import type { CanvasAgentOp } from "@/types/creative";
import type { DesignTemplate } from "@/types/brand";

export const LOCAL_AGENT_BRIDGE_VERSION = "0.1.0";

const READ_SNAPSHOT_SCHEMA: LocalAgentBridgeJsonSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

const REQUEST_APPROVAL_SCHEMA = createCanvasAgentApprovalRequestJsonSchema() as unknown as LocalAgentBridgeJsonSchema;

const LIST_BRAND_TEMPLATES_SCHEMA: LocalAgentBridgeJsonSchema = {
  type: "object",
  properties: {
    kind: { type: "string", enum: REQUIRED_DESIGN_TEMPLATE_KINDS },
    id: { type: "string" },
    includePromptGuidance: { type: "boolean" },
    includeVariants: { type: "boolean" },
    includeAppliedVariants: { type: "boolean" },
    includeCapabilityMatrix: { type: "boolean" },
  },
  additionalProperties: false,
};

const CREATE_BRAND_SPEC_SCHEMA: LocalAgentBridgeJsonSchema = {
  type: "object",
  properties: {
    brandKit: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        colors: { type: "array", items: { type: "string" } },
        fonts: {
          type: "object",
          properties: {
            heading: { type: "string" },
            body: { type: "string" },
          },
          additionalProperties: false,
        },
        logoAssetId: { type: "string" },
        tone: { type: "string" },
        customTone: { type: "string" },
        referenceAssetIds: { type: "array", items: { type: "string" } },
      },
      required: ["name"],
      additionalProperties: true,
    },
    assets: { type: "array", items: { type: "object" } },
    templateId: { type: "string" },
    variantId: { type: "string" },
  },
  required: ["brandKit"],
  additionalProperties: false,
};

export const LOCAL_AGENT_BRIDGE_TOOLS: LocalAgentBridgeTool[] = [
  {
    name: "nextlemon.readSnapshot",
    description: "Read a controlled snapshot of the current workspace, workflow, creative canvas, and asset library.",
    write: false,
    inputSchema: READ_SNAPSHOT_SCHEMA,
  },
  {
    name: "nextlemon.listCanvasAgentOps",
    description: "List supported CanvasAgentOp write operations with required fields and examples.",
    write: false,
    inputSchema: READ_SNAPSHOT_SCHEMA,
  },
  {
    name: "nextlemon.listBrandTemplates",
    description: "List built-in brand/design templates with variants, applied variants, and capability matrix details.",
    write: false,
    inputSchema: LIST_BRAND_TEMPLATES_SCHEMA,
  },
  {
    name: "nextlemon.createBrandSpec",
    description: "Create a read-only BrandSpecDocument from a brand kit, assets, template, and optional template variant.",
    write: false,
    inputSchema: CREATE_BRAND_SPEC_SCHEMA,
  },
  {
    name: "nextlemon.validateApprovalRequest",
    description: "Validate a CanvasAgentOp approval request without writing it to the approval queue.",
    write: false,
    inputSchema: REQUEST_APPROVAL_SCHEMA,
  },
  {
    name: "nextlemon.requestApproval",
    description: "Submit CanvasAgentOp writes to NextLemon's existing approval queue. The bridge never executes writes directly.",
    write: true,
    inputSchema: REQUEST_APPROVAL_SCHEMA,
  },
];

declare global {
  interface Window {
    nextlemonAgentBridge?: LocalAgentBridgeApi;
  }
}

export function getLocalAgentBridgeStatus(): LocalAgentBridgeStatus {
  const state = useLocalAgentBridgeStore.getState();
  return {
    enabled: state.enabled,
    allowWriteRequests: state.allowWriteRequests,
    requireApproval: true,
    version: LOCAL_AGENT_BRIDGE_VERSION,
    installedAt: state.installedAt,
    lastSnapshotAt: state.lastSnapshotAt,
    lastWriteRequestAt: state.lastWriteRequestAt,
    lastError: state.lastError,
    auditCount: state.auditLog.length,
  };
}

export function getLocalAgentMcpManifest(): LocalAgentMcpManifest {
  return {
    protocol: "mcp-like",
    name: "nextlemon-local-agent-bridge",
    version: LOCAL_AGENT_BRIDGE_VERSION,
    transport: "in-app-window-bridge",
    entry: "window.nextlemonAgentBridge",
    approvalRequired: true,
    tools: LOCAL_AGENT_BRIDGE_TOOLS,
    operationCatalog: CANVAS_AGENT_OP_SPECS,
    brandTemplates: {
      tool: "nextlemon.listBrandTemplates",
      brandSpecTool: "nextlemon.createBrandSpec",
      supportsVariants: true,
      supportsAppliedVariants: true,
      supportsCapabilityMatrix: true,
      supportsBrandSpecExport: true,
      supportsVariantBrandSpec: true,
      expectedTemplateCount: 5,
      expectedVariantCount: 15,
      expectedAppliedVariantCount: 15,
    },
    security: {
      defaultEnabled: false,
      writeRequestsCanBeDisabled: true,
      writesExecuteDirectly: false,
    },
    stdioProxy: {
      command: "npm run mcp:local",
      mode: "file-based-approval-inbox",
      inboxEnv: "NEXTLEMON_AGENT_INBOX",
      projectPackageEnv: "NEXTLEMON_PROJECT_PACKAGE",
    },
  };
}

export function getLocalAgentBridgeConfigBundle(): LocalAgentBridgeConfigBundle {
  const manifest = getLocalAgentMcpManifest();
  return {
    manifest,
    clientConfig: {
      name: manifest.name,
      transport: manifest.transport,
      entry: manifest.entry,
      tools: manifest.tools.map((tool) => ({
        name: tool.name,
        write: tool.write,
        inputSchema: tool.inputSchema,
      })),
    },
    examples: {
      readSnapshot: {
        tool: "nextlemon.readSnapshot",
        args: {},
      },
      listBrandTemplates: {
        tool: "nextlemon.listBrandTemplates",
        args: {
          includePromptGuidance: false,
          includeVariants: true,
          includeAppliedVariants: true,
          includeCapabilityMatrix: true,
        },
      },
      createBrandSpec: {
        tool: "nextlemon.createBrandSpec",
        args: {
          brandKit: {
            id: "external-brand",
            name: "外部 Agent 品牌",
            colors: ["#111827", "#f59e0b"],
            fonts: { heading: "Inter", body: "Inter" },
            tone: "professional",
            referenceAssetIds: [],
            createdAt: 1,
            updatedAt: 1,
          },
          assets: [],
          templateId: "poster-vertical-campaign",
          variantId: "bold",
        },
      },
      validateApprovalRequest: {
        tool: "nextlemon.validateApprovalRequest",
        args: {
          title: "校验一条文本素材",
          ops: [
            {
              type: "asset.add",
              asset: {
                kind: "text",
                title: "外部 Agent 需求",
                text: "仅校验，不提交审批。",
                source: "agent",
                tags: ["external-agent"],
              },
            },
          ],
        },
      },
      requestApproval: {
        tool: "nextlemon.requestApproval",
        args: {
          title: "创建一条文本素材",
          ops: [
            {
              type: "asset.add",
              asset: {
                kind: "text",
                title: "外部 Agent 需求",
                text: "通过本地桥提交，等待用户审批后写入。",
                source: "agent",
                tags: ["external-agent"],
              },
              canvasItem: {
                position: { x: 160, y: 160 },
                width: 320,
                height: 160,
              },
            },
          ],
        },
      },
    },
    notes: [
      "This is an in-app window bridge, not a standalone stdio/http MCP server.",
      "Use listCanvasAgentOps before writing so external agents can choose supported operations.",
      "Use listBrandTemplates and createBrandSpec to reuse the same brand template catalog as the app and stdio MCP proxy.",
      "Use validateApprovalRequest before requestApproval to catch schema errors without creating pending approvals.",
      "Read operations can run directly after the bridge is enabled.",
      "Write operations are validated and queued for NextLemon approval; they never execute directly.",
      "The stdio proxy writes approval request files that can be imported from the Local Agent Bridge panel.",
    ],
  };
}

export function getLocalAgentBridgeAuditLog(): LocalAgentBridgeAuditEntry[] {
  return useLocalAgentBridgeStore.getState().auditLog;
}

export async function readLocalAgentBridgeSnapshot(): Promise<LocalAgentBridgeSnapshot> {
  const snapshot = getWorkspaceSnapshot();
  useLocalAgentBridgeStore.getState().recordSnapshot();
  return {
    version: LOCAL_AGENT_BRIDGE_VERSION,
    createdAt: Date.now(),
    snapshot,
  };
}

export function listLocalAgentBridgeCanvasAgentOps() {
  return CANVAS_AGENT_OP_SPECS;
}

export function listLocalAgentBridgeBrandTemplates(
  request: LocalAgentBridgeBrandTemplateListRequest = {}
): LocalAgentBridgeBrandTemplateListResult {
  const includePromptGuidance = request.includePromptGuidance !== false;
  const includeAppliedVariants = request.includeAppliedVariants === true;
  const includeVariants = request.includeVariants === true || includeAppliedVariants;
  const includeCapabilityMatrix = request.includeCapabilityMatrix === true;
  const filtered = DESIGN_TEMPLATES.filter((template) => {
    if (request.kind && template.kind !== request.kind) return false;
    if (request.id && template.id !== request.id) return false;
    return true;
  });
  const templates = filtered.map((template) =>
    summarizeBridgeTemplate(template, { includePromptGuidance, includeVariants, includeAppliedVariants })
  );
  const capabilityMatrix = includeCapabilityMatrix ? createDesignTemplateCapabilityMatrix() : undefined;

  return {
    ok: true,
    requiredKinds: [...REQUIRED_DESIGN_TEMPLATE_KINDS],
    summary: {
      templateCount: DESIGN_TEMPLATES.length,
      filteredCount: filtered.length,
      variantCount: templates.reduce((sum, template) => sum + (Number(template.variantCount) || 0), 0),
      appliedVariantCount: templates.reduce(
        (sum, template) => sum + (Array.isArray(template.appliedVariants) ? template.appliedVariants.length : 0),
        0
      ),
      readyTemplateCount: capabilityMatrix?.readyTemplateCount,
      capabilityVariantCount: capabilityMatrix?.variantCount,
    },
    capabilityMatrix,
    templates,
  };
}

export function createLocalAgentBridgeBrandSpec(
  request: LocalAgentBridgeBrandSpecRequest
): LocalAgentBridgeBrandSpecResult {
  if (!request?.brandKit || typeof request.brandKit !== "object") {
    throw new Error("brandKit 必须是对象");
  }

  const { template, baseTemplateId, variantId } = resolveBridgeTemplate(request.templateId, request.variantId);
  const spec = createBrandSpecDocument(request.brandKit, request.assets || [], template);

  return {
    ok: true,
    templateId: template?.id,
    baseTemplateId,
    variantId,
    validation: spec.validation,
    templateCapability: spec.templateCapability,
    templateCatalog: spec.templateCatalog,
    promptGuidanceCount: spec.promptGuidance.length,
    usageNoteCount: spec.usageNotes.length,
    spec,
  };
}

export function validateLocalAgentBridgeApprovalRequest(
  request: LocalAgentBridgeApprovalRequest
): LocalAgentBridgeValidationResult {
  const ops: unknown = request.ops;
  const errors = validateAgentOps(ops);
  return {
    ok: errors.length === 0,
    opCount: Array.isArray(ops) ? ops.length : 0,
    summary: errors.length === 0 ? summarizeAgentOps(ops as CanvasAgentOp[]) : undefined,
    errors,
  };
}

export async function requestLocalAgentBridgeApproval(
  request: LocalAgentBridgeApprovalRequest
): Promise<LocalAgentBridgeApprovalResult> {
  const bridgeStore = useLocalAgentBridgeStore.getState();
  if (!bridgeStore.enabled) {
    const error = "本地 Agent 桥未启用";
    bridgeStore.recordError(error);
    return { ok: false, errors: [error] };
  }

  if (!bridgeStore.allowWriteRequests) {
    const error = "本地 Agent 桥写请求已关闭";
    bridgeStore.recordError(error);
    return { ok: false, errors: [error] };
  }

  const ops = Array.isArray(request.ops) ? request.ops : [];
  const errors = validateBridgeOps(ops);
  if (errors.length > 0) {
    bridgeStore.recordError(errors.join("；"));
    bridgeStore.recordAudit("approval_reject", "写请求校验失败", { errors, ops });
    return { ok: false, errors };
  }

  const requestId = crypto.randomUUID();
  const audit = createApprovalAuditMetadata(request, requestId, ops);
  const sessionId = ensureLocalBridgeSession();
  const title = request.title?.trim() || "本地 Agent 桥写操作";
  const agentStore = useAgentStore.getState();
  agentStore.addMessage(sessionId, "system", createApprovalSystemMessage(title, audit, ops));
  const approval = agentStore.requestApproval(sessionId, title, ops, audit);
  if (!approval.ok) {
    bridgeStore.recordError(approval.errors.join("；"));
    bridgeStore.recordAudit("approval_reject", "审批请求被拒绝", { requestId, errors: approval.errors });
    return { ok: false, requestId, sessionId, errors: approval.errors };
  }

  bridgeStore.recordWriteRequest();
  bridgeStore.recordAudit("approval_request", "审批请求已创建", {
    requestId,
    title,
    summary: summarizeAgentOps(ops),
    audit,
  });
  return {
    ok: true,
    requestId,
    sessionId,
    pendingApproval: true,
    summary: summarizeAgentOps(ops),
    opSummary: audit.opSummary,
    operationTypes: audit.operationTypes,
    requestHash: audit.requestHash,
    approvalPolicy: audit.approvalPolicy,
  };
}

export function parseLocalAgentApprovalRequestJson(json: string): LocalAgentApprovalRequestPackage {
  const parsed = JSON.parse(json) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("审批请求必须是对象");
  }
  const record = parsed as Partial<LocalAgentApprovalRequestPackage>;
  if (record.packageType !== "nextlemon.agent-approval-request" || record.schemaVersion !== 1) {
    throw new Error("不是有效的 NextLemon Agent 审批请求");
  }
  if (!record.id || typeof record.id !== "string") {
    throw new Error("审批请求缺少 id");
  }
  if (!Array.isArray(record.ops) || record.ops.length === 0) {
    throw new Error("审批请求缺少 ops");
  }
  return {
    packageType: "nextlemon.agent-approval-request",
    schemaVersion: 1,
    id: record.id,
    title: record.title,
    createdAt: typeof record.createdAt === "number" ? record.createdAt : Date.now(),
    source: record.source,
    opCount: typeof record.opCount === "number" ? record.opCount : record.ops.length,
    opSummary: typeof record.opSummary === "string" ? record.opSummary : summarizeAgentOps(record.ops),
    operationTypes: Array.isArray(record.operationTypes)
      ? record.operationTypes.filter((type): type is string => typeof type === "string")
      : [...new Set(record.ops.map((op) => op.type))],
    approvalPolicy: record.approvalPolicy,
    requestHash: typeof record.requestHash === "string" ? record.requestHash : undefined,
    ops: record.ops,
  };
}

export function createLocalAgentBridgeApi(): LocalAgentBridgeApi {
  return {
    version: LOCAL_AGENT_BRIDGE_VERSION,
    tools: LOCAL_AGENT_BRIDGE_TOOLS,
    getStatus: getLocalAgentBridgeStatus,
    getMcpManifest: getLocalAgentMcpManifest,
    getConfigBundle: getLocalAgentBridgeConfigBundle,
    getAuditLog: getLocalAgentBridgeAuditLog,
    listCanvasAgentOps: listLocalAgentBridgeCanvasAgentOps,
    listBrandTemplates: listLocalAgentBridgeBrandTemplates,
    createBrandSpec: createLocalAgentBridgeBrandSpec,
    validateApprovalRequest: validateLocalAgentBridgeApprovalRequest,
    readSnapshot: readLocalAgentBridgeSnapshot,
    requestApproval: requestLocalAgentBridgeApproval,
  };
}

export function installLocalAgentBridge(): () => void {
  if (typeof window === "undefined") return () => undefined;

  const api = createLocalAgentBridgeApi();
  window.nextlemonAgentBridge = api;
  useLocalAgentBridgeStore.getState().markInstalled();

  return () => {
    if (window.nextlemonAgentBridge === api) {
      delete window.nextlemonAgentBridge;
    }
    useLocalAgentBridgeStore.getState().markUninstalled();
  };
}

function validateBridgeOps(ops: CanvasAgentOp[]): string[] {
  const schemaErrors = validateAgentOps(ops);
  if (schemaErrors.length > 0) return schemaErrors;

  const stateError = validateCanvasAgentOpsAgainstState(ops);
  return stateError ? [stateError] : [];
}

function summarizeBridgeTemplate(
  template: DesignTemplate,
  options: { includePromptGuidance: boolean; includeVariants: boolean; includeAppliedVariants: boolean }
) {
  const summary: Record<string, unknown> = {
    id: template.id,
    kind: template.kind,
    planKind: template.planKind,
    name: template.name,
    description: template.description,
    outputKind: template.outputKind,
    aspectRatio: template.aspectRatio,
    videoSize: template.videoSize,
    pageCountRange: template.pageCountRange,
    deliverables: template.deliverables,
    recommendedWorkflowNodes: template.recommendedWorkflowNodes,
    acceptanceCriteria: template.acceptanceCriteria,
    tags: template.tags,
    modelHint: template.modelHint,
  };

  if (options.includePromptGuidance) {
    summary.defaultBrief = template.defaultBrief;
    summary.promptGuidance = template.promptGuidance;
  }

  if (!options.includeVariants) return summary;

  const variants = getTemplateVariants(template);
  summary.variantCount = variants.length;
  summary.variants = variants;
  if (options.includeAppliedVariants) {
    summary.appliedVariants = variants.map((variant) =>
      summarizeBridgeTemplate(applyTemplateVariant(template, variant), {
        includePromptGuidance: options.includePromptGuidance,
        includeVariants: false,
        includeAppliedVariants: false,
      })
    );
  }

  return summary;
}

function resolveBridgeTemplate(templateId?: string, variantId?: string) {
  const normalizedTemplateId = templateId?.trim() || "";
  if (!normalizedTemplateId) return { template: undefined, baseTemplateId: undefined, variantId: undefined };

  const baseTemplateId = getBaseTemplateId(normalizedTemplateId);
  const inferredVariantId = variantId?.trim() || getVariantIdFromTemplateId(normalizedTemplateId);
  const baseTemplate = DESIGN_TEMPLATES.find((template) => template.id === baseTemplateId || template.id === normalizedTemplateId);
  if (!baseTemplate) throw new Error(`未知设计模板：${normalizedTemplateId}`);
  if (!inferredVariantId) return { template: baseTemplate, baseTemplateId: baseTemplate.id, variantId: undefined };

  const variant = getTemplateVariants(baseTemplate).find((item) => item.id === inferredVariantId);
  if (!variant) throw new Error(`模板 ${baseTemplate.id} 不存在变体：${inferredVariantId}`);

  return {
    template: applyTemplateVariant(baseTemplate, variant),
    baseTemplateId: baseTemplate.id,
    variantId: inferredVariantId,
  };
}

function getBaseTemplateId(templateId: string) {
  return templateId.includes("__") ? templateId.split("__")[0] : templateId;
}

function getVariantIdFromTemplateId(templateId: string) {
  return templateId.includes("__") ? templateId.split("__").slice(1).join("__") : "";
}

function ensureLocalBridgeSession() {
  const agentStore = useAgentStore.getState();
  const activeSession = agentStore.sessions.find((session) => session.id === agentStore.activeSessionId);
  if (activeSession?.providerKind === "local") return activeSession.id;
  return agentStore.createSession("本地 Agent 桥会话", "local");
}

function createApprovalAuditMetadata(
  request: LocalAgentBridgeApprovalRequest,
  requestId: string,
  ops: CanvasAgentOp[]
): AgentApprovalAuditMetadata {
  return {
    requestId,
    source: request.source || "nextlemon-in-app-bridge",
    createdAt: Date.now(),
    opCount: typeof request.opCount === "number" ? request.opCount : ops.length,
    opSummary: typeof request.opSummary === "string" ? request.opSummary : summarizeAgentOps(ops),
    operationTypes: Array.isArray(request.operationTypes)
      ? request.operationTypes.filter((type): type is string => typeof type === "string")
      : [...new Set(ops.map((op) => op.type))],
    approvalPolicy: request.approvalPolicy,
    requestHash: typeof request.requestHash === "string" ? request.requestHash : undefined,
  };
}

function createApprovalSystemMessage(
  title: string,
  audit: AgentApprovalAuditMetadata,
  ops: CanvasAgentOp[]
) {
  return [
    title,
    `requestId: ${audit.requestId}`,
    `summary: ${audit.opSummary || summarizeAgentOps(ops)}`,
    audit.requestHash ? `requestHash: ${audit.requestHash}` : "",
    audit.operationTypes?.length ? `operationTypes: ${audit.operationTypes.join(", ")}` : "",
  ].filter(Boolean).join("\n");
}
