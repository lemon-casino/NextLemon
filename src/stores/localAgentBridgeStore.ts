import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { v4 as uuidv4 } from "uuid";
import type { LocalAgentBridgeAuditEntry } from "@/types/localAgentBridge";
import { tauriStorage } from "@/utils/tauriStorage";

interface LocalAgentBridgeStore {
  enabled: boolean;
  allowWriteRequests: boolean;
  auditLog: LocalAgentBridgeAuditEntry[];
  installedAt?: number;
  lastSnapshotAt?: number;
  lastWriteRequestAt?: number;
  lastError?: string;
  _hasHydrated: boolean;

  setEnabled: (enabled: boolean) => void;
  setAllowWriteRequests: (allowWriteRequests: boolean) => void;
  markInstalled: () => void;
  markUninstalled: () => void;
  recordSnapshot: () => void;
  recordWriteRequest: () => void;
  recordError: (message?: string) => void;
  recordAudit: (type: LocalAgentBridgeAuditEntry["type"], message: string, detail?: unknown) => void;
  clearAuditLog: () => void;
}

function now() {
  return Date.now();
}

export const useLocalAgentBridgeStore = create<LocalAgentBridgeStore>()(
  persist(
    (set) => ({
      enabled: false,
      allowWriteRequests: true,
      auditLog: [],
      _hasHydrated: false,

      setEnabled: (enabled) => set({ enabled }),
      setAllowWriteRequests: (allowWriteRequests) => set({ allowWriteRequests }),
      markInstalled: () => {
        set({ installedAt: now(), lastError: undefined });
        useLocalAgentBridgeStore.getState().recordAudit("install", "本地 Agent 桥已挂载");
      },
      markUninstalled: () => {
        set({ installedAt: undefined });
        useLocalAgentBridgeStore.getState().recordAudit("uninstall", "本地 Agent 桥已卸载");
      },
      recordSnapshot: () => {
        set({ lastSnapshotAt: now(), lastError: undefined });
        useLocalAgentBridgeStore.getState().recordAudit("snapshot", "读取工作区快照");
      },
      recordWriteRequest: () => {
        set({ lastWriteRequestAt: now(), lastError: undefined });
        useLocalAgentBridgeStore.getState().recordAudit("approval_request", "写请求已进入审批队列");
      },
      recordError: (message) => {
        set({ lastError: message });
        if (message) useLocalAgentBridgeStore.getState().recordAudit("error", message);
      },
      recordAudit: (type, message, detail) => {
        const entry: LocalAgentBridgeAuditEntry = {
          id: uuidv4(),
          type,
          message,
          detail,
          createdAt: now(),
        };
        set((state) => ({
          auditLog: [entry, ...state.auditLog].slice(0, 80),
        }));
      },
      clearAuditLog: () => set({ auditLog: [] }),
    }),
    {
      name: "nextlemon-local-agent-bridge",
      storage: createJSONStorage(() => tauriStorage),
      partialize: (state) => ({
        enabled: state.enabled,
        allowWriteRequests: state.allowWriteRequests,
        auditLog: state.auditLog,
        installedAt: state.installedAt,
        lastSnapshotAt: state.lastSnapshotAt,
        lastWriteRequestAt: state.lastWriteRequestAt,
        lastError: state.lastError,
      }),
      onRehydrateStorage: () => () => {
        useLocalAgentBridgeStore.setState({ _hasHydrated: true });
      },
    }
  )
);
