import { GitBranch, LayoutDashboard } from "lucide-react";
import type { ComponentType } from "react";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import type { WorkspaceMode } from "@/types/workspace";

const modeOptions: Array<{
  mode: WorkspaceMode;
  label: string;
  icon: ComponentType<{ className?: string }>;
}> = [
  { mode: "workflow", label: "工作流", icon: GitBranch },
  { mode: "creative", label: "创作画布", icon: LayoutDashboard },
];

export function WorkspaceModeSwitch() {
  const mode = useWorkspaceStore((state) => state.mode);
  const setMode = useWorkspaceStore((state) => state.setMode);

  return (
    <div
      className={`fixed top-6 z-[80] flex items-center gap-1 rounded-full border border-base-200/60 bg-base-100/75 p-1 shadow-lg backdrop-blur-md ${
        // 创作模式右侧面板头部（画布助手等切换按钮）与浮窗同区，左移避让
        mode === "creative" ? "right-[22rem]" : "right-6"
      }`}
    >
      {modeOptions.map((option) => {
        const Icon = option.icon;
        const active = mode === option.mode;
        return (
          <button
            key={option.mode}
            type="button"
            className={`flex h-9 items-center gap-2 rounded-full px-3 text-sm font-medium transition-colors ${
              active
                ? "bg-primary text-primary-content shadow-sm"
                : "text-base-content/60 hover:bg-base-200/70 hover:text-base-content"
            }`}
            onClick={() => setMode(option.mode)}
          >
            <Icon className="h-4 w-4" />
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
