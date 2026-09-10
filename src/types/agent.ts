import type { CustomEdge, CustomNode } from "@/types";
import type { CanvasAgentOp, CreativeAsset, CreativeCanvasData, DesignPlan } from "@/types/creative";

export type AgentProviderKind = "local" | "muapi";

export interface AgentApprovalAuditMetadata {
  requestId?: string;
  source?: string;
  createdAt?: number;
  opCount?: number;
  opSummary?: string;
  operationTypes?: string[];
  approvalPolicy?: {
    writesExecuteDirectly: false;
    approvalImportRequired: true;
    requiresUserApproval: true;
  };
  requestHash?: string;
}

// Agent 执行前的工作区快照，仅保留在内存中用于单步回滚，不持久化。
export interface AgentRollbackSnapshot {
  id: string;
  createdAt: number;
  opSummary: string;
  opTypes: string[];
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
  undone?: boolean;
}

export interface AgentProviderConfig {
  kind: AgentProviderKind;
  enabled: boolean;
  name: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  metadata?: Record<string, unknown>;
}

export type AgentEvent =
  | {
      id: string;
      type: "text";
      sessionId: string;
      content: string;
      createdAt: number;
    }
  | {
      id: string;
      type: "tool_call";
      sessionId: string;
      toolName: string;
      args: Record<string, unknown>;
      write: boolean;
      createdAt: number;
    }
  | {
      id: string;
      type: "tool_result";
      sessionId: string;
      toolName: string;
      ok: boolean;
      result?: unknown;
      error?: string;
      createdAt: number;
    }
  | {
      id: string;
      type: "plan_propose";
      sessionId: string;
      plan: DesignPlan;
      createdAt: number;
    }
  | {
      id: string;
      type: "approval_required";
      sessionId: string;
      title: string;
      ops: CanvasAgentOp[];
      audit?: AgentApprovalAuditMetadata;
      createdAt: number;
    }
  | {
      id: string;
      type: "error";
      sessionId: string;
      message: string;
      detail?: unknown;
      createdAt: number;
    };

export interface AgentMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: number;
  events?: AgentEvent[];
}

export interface AgentSession {
  id: string;
  title: string;
  providerKind: AgentProviderKind;
  messages: AgentMessage[];
  status: "idle" | "running" | "awaiting_approval" | "completed" | "failed" | "cancelled";
  pendingOps?: CanvasAgentOp[];
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

export interface MuApiSession {
  id: string;
  name?: string;
  title?: string;
  created_at?: string | number;
  updated_at?: string | number;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface MuApiAsset {
  id?: string;
  url?: string;
  kind?: string;
  asset_label?: string;
  source_tool?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface MuApiJob {
  id: string;
  session_id?: string;
  status?: string;
  type?: string;
  created_at?: string | number;
  updated_at?: string | number;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export type MuApiRawEvent = Record<string, unknown>;

export interface AgentProvider {
  kind: AgentProviderKind;
  label: string;
  startSession: (title?: string) => Promise<AgentSession>;
  sendMessage: (session: AgentSession, content: string) => AsyncIterable<AgentEvent>;
  approve: (session: AgentSession, ops: CanvasAgentOp[]) => Promise<AgentEvent>;
  reject: (session: AgentSession, reason?: string) => Promise<AgentEvent>;
  cancel: (session: AgentSession) => Promise<AgentEvent>;
}
