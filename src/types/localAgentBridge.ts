import type { CanvasAgentOp } from "@/types/creative";
import type { BrandKit, BrandSpecDocument, DesignTemplateCapabilityMatrix, DesignTemplateKind } from "@/types/brand";
import type { CreativeAsset } from "@/types/creative";
import type { CanvasAgentOpSpec } from "@/services/agentOps";
import type { AgentApprovalAuditMetadata } from "@/types/agent";

export interface LocalAgentBridgeTool {
  name:
    | "nextlemon.readSnapshot"
    | "nextlemon.listCanvasAgentOps"
    | "nextlemon.listBrandTemplates"
    | "nextlemon.createBrandSpec"
    | "nextlemon.validateApprovalRequest"
    | "nextlemon.requestApproval";
  description: string;
  write: boolean;
  inputSchema: LocalAgentBridgeJsonSchema;
}

export interface LocalAgentBridgeJsonSchema {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface LocalAgentBridgeSnapshot {
  version: string;
  createdAt: number;
  snapshot: unknown;
}

export interface LocalAgentBridgeStatus {
  enabled: boolean;
  allowWriteRequests: boolean;
  requireApproval: true;
  version: string;
  installedAt?: number;
  lastSnapshotAt?: number;
  lastWriteRequestAt?: number;
  lastError?: string;
  auditCount: number;
}

export interface LocalAgentBridgeApprovalRequest {
  title?: string;
  ops: CanvasAgentOp[];
  source?: string;
  opCount?: number;
  opSummary?: string;
  operationTypes?: string[];
  approvalPolicy?: AgentApprovalAuditMetadata["approvalPolicy"];
  requestHash?: string;
}

export interface LocalAgentApprovalRequestPackage extends LocalAgentBridgeApprovalRequest {
  packageType: "nextlemon.agent-approval-request";
  schemaVersion: 1;
  id: string;
  createdAt: number;
  source?: string;
  opCount?: number;
  opSummary?: string;
  operationTypes?: string[];
  approvalPolicy?: AgentApprovalAuditMetadata["approvalPolicy"];
  requestHash?: string;
}

export interface LocalAgentBridgeApprovalResult {
  ok: boolean;
  requestId?: string;
  sessionId?: string;
  pendingApproval?: boolean;
  summary?: string;
  opSummary?: string;
  operationTypes?: string[];
  approvalPolicy?: AgentApprovalAuditMetadata["approvalPolicy"];
  requestHash?: string;
  errors?: string[];
}

export interface LocalAgentBridgeValidationResult {
  ok: boolean;
  summary?: string;
  opCount: number;
  errors: string[];
}

export interface LocalAgentBridgeBrandTemplateListRequest {
  kind?: DesignTemplateKind;
  id?: string;
  includePromptGuidance?: boolean;
  includeVariants?: boolean;
  includeAppliedVariants?: boolean;
  includeCapabilityMatrix?: boolean;
}

export interface LocalAgentBridgeBrandSpecRequest {
  brandKit: BrandKit;
  assets?: CreativeAsset[];
  templateId?: string;
  variantId?: string;
}

export interface LocalAgentBridgeBrandTemplateListResult {
  ok: boolean;
  requiredKinds: DesignTemplateKind[];
  summary: {
    templateCount: number;
    filteredCount: number;
    variantCount: number;
    appliedVariantCount: number;
    readyTemplateCount?: number;
    capabilityVariantCount?: number;
  };
  capabilityMatrix?: DesignTemplateCapabilityMatrix;
  templates: unknown[];
}

export interface LocalAgentBridgeBrandSpecResult {
  ok: boolean;
  templateId?: string;
  baseTemplateId?: string;
  variantId?: string;
  validation: BrandSpecDocument["validation"];
  templateCapability?: BrandSpecDocument["templateCapability"];
  templateCatalog?: BrandSpecDocument["templateCatalog"];
  promptGuidanceCount: number;
  usageNoteCount: number;
  spec: BrandSpecDocument;
}

export interface LocalAgentBridgeAuditEntry {
  id: string;
  type: "install" | "uninstall" | "snapshot" | "approval_request" | "approval_reject" | "error";
  message: string;
  createdAt: number;
  detail?: unknown;
}

export interface LocalAgentMcpManifest {
  protocol: "mcp-like";
  name: "nextlemon-local-agent-bridge";
  version: string;
  transport: "in-app-window-bridge";
  entry: "window.nextlemonAgentBridge";
  approvalRequired: true;
  tools: LocalAgentBridgeTool[];
  operationCatalog: CanvasAgentOpSpec[];
  brandTemplates: {
    tool: "nextlemon.listBrandTemplates";
    brandSpecTool: "nextlemon.createBrandSpec";
    supportsVariants: true;
    supportsAppliedVariants: true;
    supportsCapabilityMatrix: true;
    supportsBrandSpecExport: true;
    supportsVariantBrandSpec: true;
    expectedTemplateCount: number;
    expectedVariantCount: number;
    expectedAppliedVariantCount: number;
  };
  security: {
    defaultEnabled: false;
    writeRequestsCanBeDisabled: true;
    writesExecuteDirectly: false;
  };
  stdioProxy: {
    command: "npm run mcp:local";
    mode: "file-based-approval-inbox";
    inboxEnv: "NEXTLEMON_AGENT_INBOX";
    projectPackageEnv: "NEXTLEMON_PROJECT_PACKAGE";
  };
}

export interface LocalAgentBridgeConfigBundle {
  manifest: LocalAgentMcpManifest;
  clientConfig: {
    name: string;
    transport: LocalAgentMcpManifest["transport"];
    entry: LocalAgentMcpManifest["entry"];
    tools: Array<{
      name: LocalAgentBridgeTool["name"];
      write: boolean;
      inputSchema: LocalAgentBridgeTool["inputSchema"];
    }>;
  };
  examples: {
    readSnapshot: {
      tool: "nextlemon.readSnapshot";
      args: Record<string, never>;
    };
    listBrandTemplates: {
      tool: "nextlemon.listBrandTemplates";
      args: LocalAgentBridgeBrandTemplateListRequest;
    };
    createBrandSpec: {
      tool: "nextlemon.createBrandSpec";
      args: LocalAgentBridgeBrandSpecRequest;
    };
    validateApprovalRequest: {
      tool: "nextlemon.validateApprovalRequest";
      args: LocalAgentBridgeApprovalRequest;
    };
    requestApproval: {
      tool: "nextlemon.requestApproval";
      args: LocalAgentBridgeApprovalRequest;
    };
  };
  notes: string[];
}

export interface LocalAgentBridgeApi {
  version: string;
  tools: LocalAgentBridgeTool[];
  getStatus: () => LocalAgentBridgeStatus;
  getMcpManifest: () => LocalAgentMcpManifest;
  getConfigBundle: () => LocalAgentBridgeConfigBundle;
  getAuditLog: () => LocalAgentBridgeAuditEntry[];
  listCanvasAgentOps: () => CanvasAgentOpSpec[];
  listBrandTemplates: (
    request?: LocalAgentBridgeBrandTemplateListRequest
  ) => LocalAgentBridgeBrandTemplateListResult;
  createBrandSpec: (
    request: LocalAgentBridgeBrandSpecRequest
  ) => LocalAgentBridgeBrandSpecResult;
  validateApprovalRequest: (
    request: LocalAgentBridgeApprovalRequest
  ) => LocalAgentBridgeValidationResult;
  readSnapshot: () => Promise<LocalAgentBridgeSnapshot>;
  requestApproval: (
    request: LocalAgentBridgeApprovalRequest
  ) => Promise<LocalAgentBridgeApprovalResult>;
}
