import type { CustomEdge, CustomNode } from "@/types";
import type { CanvasAgentOp, CreativeAsset, CreativeCanvasData, DesignPlan } from "@/types/creative";

export type AgentProviderKind = "local" | "muapi";

// Local Provider 引擎模式：本地规则路由 / 真实模型工具循环 / Codex CLI / Claude Code CLI。
export type LocalAgentEngineMode = "rules" | "model-loop" | "codex" | "claude-code";

// AgentProviderConfig.metadata 中与 Agent 面板约定的键（metadata 为宽松 Record，缺失时回退默认值）。
export interface LocalAgentEngineMetadata {
  // 本地引擎选择；缺省时按 modelToolLoop 推断（true → model-loop，否则 rules）。
  engine?: LocalAgentEngineMode;
  // 旧版「真实模型工具调用」开关，保留以兼容既有持久化数据。
  modelToolLoop?: boolean;
  // Codex CLI 可执行文件路径（缺省用 PATH 上的 codex）。
  codexPath?: string;
  // Claude Code CLI 可执行文件路径（缺省用 PATH 上的 claude）。
  claudeCodePath?: string;
  // 引擎默认工作目录（会话线程绑定；会话 metadata.engineCwd 优先）。
  engineCwd?: string;
  // 勾选后该 provider 的 apiKey 不写入本地存储（内存保留，刷新即清）。
  sessionOnlyApiKey?: boolean;
}

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
