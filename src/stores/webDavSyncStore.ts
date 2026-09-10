import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { WebDavSyncConfig } from "@/types/projectPackage";
import { tauriStorage } from "@/utils/tauriStorage";

interface WebDavSyncStore {
  config: WebDavSyncConfig;
  lastSyncAt?: number;
  lastStatus?: "idle" | "uploading" | "downloading" | "success" | "error";
  lastError?: string;
  _hasHydrated: boolean;

  updateConfig: (patch: Partial<WebDavSyncConfig>) => void;
  setSyncStatus: (status: WebDavSyncStore["lastStatus"], error?: string) => void;
}

export const useWebDavSyncStore = create<WebDavSyncStore>()(
  persist(
    (set) => ({
      config: {
        enabled: false,
        endpoint: "",
        username: "",
        password: "",
        remotePath: "nextlemon-project.json",
      },
      lastStatus: "idle",
      _hasHydrated: false,

      updateConfig: (patch) => {
        set((state) => ({
          config: {
            ...state.config,
            ...patch,
          },
        }));
      },

      setSyncStatus: (status, error) => {
        set({
          lastStatus: status,
          lastError: error,
          lastSyncAt: status === "success" || status === "error" ? Date.now() : undefined,
        });
      },
    }),
    {
      name: "nextlemon-webdav-sync",
      storage: createJSONStorage(() => tauriStorage),
      partialize: (state) => ({
        config: state.config,
        lastSyncAt: state.lastSyncAt,
        lastStatus: state.lastStatus,
        lastError: state.lastError,
      }),
      onRehydrateStorage: () => () => {
        useWebDavSyncStore.setState({ _hasHydrated: true });
      },
    }
  )
);
