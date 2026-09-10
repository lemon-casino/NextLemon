import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { v4 as uuidv4 } from "uuid";
import { isWriteAgentOp, summarizeAgentOps, validateAgentOp } from "@/services/agentOps";
import type {
  AgentApprovalAuditMetadata,
  AgentEvent,
  AgentMessage,
  AgentProviderConfig,
  AgentProviderKind,
  AgentRollbackSnapshot,
  AgentSession,
} from "@/types/agent";
import type { CanvasAgentOp } from "@/types/creative";
import { tauriStorage } from "@/utils/tauriStorage";

interface ApprovalRequestResult {
  ok: boolean;
  errors: string[];
}

interface AgentStore {
  providerConfigs: Record<AgentProviderKind, AgentProviderConfig>;
  sessions: AgentSession[];
  activeSessionId: string | null;
  _hasHydrated: boolean;
  // 最近一次 Agent 审批执行的回滚快照，仅存内存，重启后失效。
  lastRollback: AgentRollbackSnapshot | null;

  setProviderConfig: (kind: AgentProviderKind, patch: Partial<AgentProviderConfig>) => void;
  createSession: (title?: string, providerKind?: AgentProviderKind) => string;
  upsertSession: (session: AgentSession) => void;
  updateSession: (sessionId: string, patch: Partial<AgentSession>) => void;
  updateSessionMetadata: (sessionId: string, metadata: Record<string, unknown>) => void;
  setSessionStatus: (sessionId: string, status: AgentSession["status"]) => void;
  setActiveSession: (sessionId: string | null) => void;
  addMessage: (sessionId: string, role: AgentMessage["role"], content: string) => string;
  appendEvent: (sessionId: string, event: AgentEvent) => void;
  recordRollbackSnapshot: (snapshot: AgentRollbackSnapshot) => void;
  markRollbackUndone: () => void;
  requestApproval: (
    sessionId: string,
    title: string,
    ops: CanvasAgentOp[],
    audit?: AgentApprovalAuditMetadata
  ) => ApprovalRequestResult;
  approvePendingOps: (sessionId: string) => CanvasAgentOp[];
  rejectPendingOps: (sessionId: string, reason?: string) => void;
  cancelSession: (sessionId: string) => void;
  clearSession: (sessionId: string) => void;
  getActiveSession: () => AgentSession | null;
}

const DEFAULT_PROVIDER_CONFIGS: Record<AgentProviderKind, AgentProviderConfig> = {
  local: {
    kind: "local",
    enabled: true,
    name: "Local Provider",
    metadata: { approvalRequired: true },
  },
  muapi: {
    kind: "muapi",
    enabled: false,
    name: "MuAPI Provider",
    metadata: { optional: true },
  },
};

function now() {
  return Date.now();
}

function createMessage(role: AgentMessage["role"], content: string): AgentMessage {
  return {
    id: uuidv4(),
    role,
    content,
    createdAt: now(),
  };
}

function createTextEvent(sessionId: string, content: string): AgentEvent {
  return {
    id: uuidv4(),
    type: "text",
    sessionId,
    content,
    createdAt: now(),
  };
}

function createToolResultEvent(
  sessionId: string,
  toolName: string,
  ok: boolean,
  result?: unknown,
  error?: string
): AgentEvent {
  return {
    id: uuidv4(),
    type: "tool_result",
    sessionId,
    toolName,
    ok,
    result,
    error,
    createdAt: now(),
  };
}

export const useAgentStore = create<AgentStore>()(
  persist(
    (set, get) => ({
      providerConfigs: DEFAULT_PROVIDER_CONFIGS,
      sessions: [],
      activeSessionId: null,
      _hasHydrated: false,
      lastRollback: null,

      setProviderConfig: (kind, patch) => {
        set((state) => ({
          providerConfigs: {
            ...state.providerConfigs,
            [kind]: {
              ...state.providerConfigs[kind],
              ...patch,
              kind,
            },
          },
        }));
      },

      createSession: (title = "新建 Agent 会话", providerKind = "local") => {
        const timestamp = now();
        const session: AgentSession = {
          id: uuidv4(),
          title,
          providerKind,
          messages: [],
          status: "idle",
          createdAt: timestamp,
          updatedAt: timestamp,
        };

        set((state) => ({
          sessions: [session, ...state.sessions],
          activeSessionId: session.id,
        }));

        return session.id;
      },

      upsertSession: (session) => {
        set((state) => {
          const exists = state.sessions.some((item) => item.id === session.id);
          return {
            sessions: exists
              ? state.sessions.map((item) => (item.id === session.id ? session : item))
              : [session, ...state.sessions],
            activeSessionId: session.id,
          };
        });
      },

      updateSession: (sessionId, patch) => {
        set((state) => ({
          sessions: state.sessions.map((session) =>
            session.id === sessionId
              ? {
                  ...session,
                  ...patch,
                  metadata: patch.metadata
                    ? { ...(session.metadata || {}), ...patch.metadata }
                    : session.metadata,
                  updatedAt: now(),
                }
              : session
          ),
        }));
      },

      updateSessionMetadata: (sessionId, metadata) => {
        get().updateSession(sessionId, {
          metadata: {
            ...metadata,
          },
        });
      },

      setSessionStatus: (sessionId, status) => {
        get().updateSession(sessionId, { status });
      },

      setActiveSession: (sessionId) => {
        set({ activeSessionId: sessionId });
      },

      addMessage: (sessionId, role, content) => {
        const message = createMessage(role, content);
        set((state) => ({
          sessions: state.sessions.map((session) =>
            session.id === sessionId
              ? {
                  ...session,
                  messages: [...session.messages, message],
                  updatedAt: now(),
                }
              : session
          ),
        }));
        return message.id;
      },

      appendEvent: (sessionId, event) => {
        set((state) => ({
          sessions: state.sessions.map((session) =>
            session.id === sessionId
              ? {
                  ...session,
                  messages: appendEventToLastAssistantMessage(session.messages, event),
                  updatedAt: now(),
                }
              : session
          ),
        }));
      },

      recordRollbackSnapshot: (snapshot) => {
        set({ lastRollback: snapshot });
      },

      markRollbackUndone: () => {
        set((state) => ({
          lastRollback: state.lastRollback
            ? { ...state.lastRollback, undone: true }
            : null,
        }));
      },

      requestApproval: (sessionId, title, ops, audit) => {
        const errors = ops
          .map((op, index) => {
            const error = validateAgentOp(op);
            return error ? `#${index + 1} ${error}` : null;
          })
          .filter((error): error is string => Boolean(error));

        if (errors.length > 0) {
          get().appendEvent(
            sessionId,
            createToolResultEvent(sessionId, "approval.validate", false, undefined, errors.join("；"))
          );
          return { ok: false, errors };
        }

        const writeOps = ops.filter(isWriteAgentOp);
        if (writeOps.length === 0) {
          get().appendEvent(
            sessionId,
            createToolResultEvent(sessionId, "approval.read", true, { ops })
          );
          return { ok: true, errors: [] };
        }

        const approvalEvent: AgentEvent = {
          id: uuidv4(),
          type: "approval_required",
          sessionId,
          title,
          ops: writeOps,
          audit,
          createdAt: now(),
        };

        set((state) => ({
          sessions: state.sessions.map((session) =>
            session.id === sessionId
              ? {
                  ...session,
                  status: "awaiting_approval",
                  pendingOps: writeOps,
                  messages: appendEventToLastAssistantMessage(session.messages, approvalEvent),
                  updatedAt: now(),
                }
              : session
          ),
        }));

        return { ok: true, errors: [] };
      },

      approvePendingOps: (sessionId) => {
        const session = get().sessions.find((item) => item.id === sessionId);
        const pendingOps = session?.pendingOps || [];
        if (pendingOps.length === 0) return [];

        const event = createToolResultEvent(sessionId, "approval.approve", true, {
          summary: summarizeAgentOps(pendingOps),
          ops: pendingOps,
        });

        set((state) => ({
          sessions: state.sessions.map((item) =>
            item.id === sessionId
              ? {
                  ...item,
                  status: "idle",
                  pendingOps: undefined,
                  messages: appendEventToLastAssistantMessage(item.messages, event),
                  updatedAt: now(),
                }
              : item
          ),
        }));

        return pendingOps;
      },

      rejectPendingOps: (sessionId, reason = "用户拒绝执行") => {
        const event = createToolResultEvent(sessionId, "approval.reject", false, undefined, reason);
        set((state) => ({
          sessions: state.sessions.map((session) =>
            session.id === sessionId
              ? {
                  ...session,
                  status: "idle",
                  pendingOps: undefined,
                  messages: appendEventToLastAssistantMessage(session.messages, event),
                  updatedAt: now(),
                }
              : session
          ),
        }));
      },

      cancelSession: (sessionId) => {
        const event = createTextEvent(sessionId, "会话已取消");
        set((state) => ({
          sessions: state.sessions.map((session) =>
            session.id === sessionId
              ? {
                  ...session,
                  status: "cancelled",
                  pendingOps: undefined,
                  messages: appendEventToLastAssistantMessage(session.messages, event),
                  updatedAt: now(),
                }
              : session
          ),
        }));
      },

      clearSession: (sessionId) => {
        set((state) => {
          const sessions = state.sessions.filter((session) => session.id !== sessionId);
          return {
            sessions,
            activeSessionId: state.activeSessionId === sessionId ? sessions[0]?.id || null : state.activeSessionId,
          };
        });
      },

      getActiveSession: () => {
        const { activeSessionId, sessions } = get();
        return sessions.find((session) => session.id === activeSessionId) || null;
      },
    }),
    {
      name: "nextlemon-agent-workspace",
      storage: createJSONStorage(() => tauriStorage),
      partialize: (state) => ({
        providerConfigs: state.providerConfigs,
        sessions: state.sessions,
        activeSessionId: state.activeSessionId,
      }),
      onRehydrateStorage: () => () => {
        useAgentStore.setState({ _hasHydrated: true });
      },
    }
  )
);

function appendEventToLastAssistantMessage(messages: AgentMessage[], event: AgentEvent): AgentMessage[] {
  const lastAssistantIndex = findLastAssistantMessageIndex(messages);
  if (lastAssistantIndex === -1) {
    return [
      ...messages,
      {
        id: uuidv4(),
        role: "assistant",
        content: "",
        createdAt: now(),
        events: [event],
      },
    ];
  }

  return messages.map((message, index) =>
    index === lastAssistantIndex
      ? {
          ...message,
          events: [...(message.events || []), event],
        }
      : message
  );
}

function findLastAssistantMessageIndex(messages: AgentMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "assistant") return index;
  }
  return -1;
}
