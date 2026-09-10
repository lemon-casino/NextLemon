import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { WorkspaceMode } from "@/types/workspace";
import { tauriStorage } from "@/utils/tauriStorage";

interface WorkspaceStore {
  mode: WorkspaceMode;
  setMode: (mode: WorkspaceMode) => void;
}

export const useWorkspaceStore = create<WorkspaceStore>()(
  persist(
    (set) => ({
      mode: "workflow",
      setMode: (mode) => set({ mode }),
    }),
    {
      name: "nextlemon-workspace",
      storage: createJSONStorage(() => tauriStorage),
    }
  )
);
