import { useCallback, useEffect, useRef, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { History } from "lucide-react";

import { Toolbar } from "@/components/Toolbar";
import { FlowCanvas } from "@/components/FlowCanvas";
import { Sidebar } from "@/components/Sidebar";
import { RecentProjectsPanel } from "@/components/RecentProjectsPanel";
import { LocalAgentBridgeRuntime } from "@/components/agent/LocalAgentBridgeRuntime";
import { CreativeWorkspace } from "@/components/creative/CreativeWorkspace";
import { SettingsPanel } from "@/components/panels";
import { ToastContainer } from "@/components/ui/Toast";
import { WorkspaceModeSwitch } from "@/components/workspace/WorkspaceModeSwitch";
import { useCanvasStore } from "@/stores/canvasStore";
import { useAgentStore } from "@/stores/agentStore";
import { useFlowStore } from "@/stores/flowStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

import "@/index.css";

// ---------------------------------------------------------------------------
// URL 深链（?q=<brief>）幂等消费
// ---------------------------------------------------------------------------

// 模块级幂等标记：?q= 深链只消费一次（React StrictMode 双挂载 / HMR 时防重复建会话）。
let deepLinkBriefConsumed = false;

/**
 * 解析 location.search 的 ?q=，调用 agentStore 创建会话，随后 history.replaceState 清参。
 *
 * 跨包契约：Agent 面板扩展包在 agentStore 上扩展 createSessionFromBrief(brief: string): string
 * （创建会话并写入首条用户消息，返回会话 id）。agentStore 本体不在本包可编辑范围，
 * 因此这里用宽松对象参数消费：契约方法已就绪时直接调用；尚未合并时回退到语义等价的
 * 现有 API 组合（createSession + addMessage），保证任意落地顺序下深链均可用。
 *
 * 消费成功后切换到 creative 模式：AgentPanel 挂载于 CreativeWorkspace 侧栏，
 * 不切模式的话会话会"凭空消失"（URL 参数被静默清除而界面无变化），
 * 与 RecentProjectsPanel 点击卡片回访会话的行为保持一致。
 *
 * Tauri 侧：项目当前未配置 deep-link 插件（src-tauri/Cargo.toml 无 tauri-plugin-deep-link，
 * package.json 无 @tauri-apps/plugin-deep-link），故此处仅实现 web 侧 ?q= 消费。
 * 未来若接入插件，在 Rust 端注册 onOpenUrl 后，于前端监听 deep-link 事件并调用本函数即可复用。
 */
function consumeBriefFromUrl(): boolean {
  if (deepLinkBriefConsumed) return false;

  const params = new URLSearchParams(window.location.search);
  const brief = (params.get("q") || "").trim();
  if (!brief) return false;

  deepLinkBriefConsumed = true;

  // 跨包契约（宽松调用，见上方注释）：createSessionFromBrief(brief) => sessionId
  const agentApi = useAgentStore.getState() as ReturnType<typeof useAgentStore.getState> & {
    createSessionFromBrief?: (brief: string) => string;
  };
  if (typeof agentApi.createSessionFromBrief === "function") {
    agentApi.createSessionFromBrief(brief);
  } else {
    // 契约方法暂缺时的兜底：与 createSessionFromBrief 语义一致的最小实现
    const sessionId = useAgentStore
      .getState()
      .createSession(brief.slice(0, 24) || "深链会话", "local");
    useAgentStore.getState().addMessage(sessionId, "user", brief);
  }

  // 切到创作画布让新会话可见（AgentPanel 挂载于 CreativeWorkspace 侧栏）
  useWorkspaceStore.getState().setMode("creative");

  // 幂等清参：仅移除 q，保留其它查询参数与 hash
  const rest = new URLSearchParams(window.location.search);
  rest.delete("q");
  const query = rest.toString();
  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`
  );

  return true;
}

function App() {
  const { activeCanvasId, getActiveCanvas, createCanvas, updateCanvasData, canvases, _hasHydrated } = useCanvasStore();
  const { nodes, edges, setNodes, setEdges } = useFlowStore();
  const theme = useSettingsStore((state) => state.settings.theme);
  const { isSettingsOpen, settingsTab, openHelp, closeHelp } = useSettingsStore();
  const workspaceMode = useWorkspaceStore((state) => state.mode);
  const isHelpOpen = isSettingsOpen && settingsTab === "shortcuts";
  // agentStore 持久化 hydration 完成后再消费深链，避免新建会话被后续 rehydrate 覆盖
  const agentHydrated = useAgentStore((state) => state._hasHydrated);
  // 最近项目浮层状态提升到 App 常驻持有：Sidebar（workflow 模式）与 creative 模式的
  // 浮动入口共用同一面板实例。Sidebar 会随模式切换卸载，状态若留在 Sidebar 内，
  // 进入 creative 回访会话后将没有任何入口能再次打开浮层。
  const [isRecentProjectsOpen, setIsRecentProjectsOpen] = useState(false);
  const toggleRecentProjects = useCallback(() => {
    setIsRecentProjectsOpen((prev) => !prev);
  }, []);

  // 用于追踪是否正在切换画布，避免循环更新
  const isLoadingCanvasRef = useRef(false);
  const prevCanvasIdRef = useRef<string | null>(null);

  // 应用主题到 HTML 元素
  useEffect(() => {
    const applyTheme = (themeName: string) => {
      if (themeName === "system") {
        // 跟随系统主题
        const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        document.documentElement.setAttribute("data-theme", prefersDark ? "dark" : "light");
      } else {
        document.documentElement.setAttribute("data-theme", themeName);
      }
    };

    applyTheme(theme);

    // 如果是跟随系统，监听系统主题变化
    if (theme === "system") {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const handleChange = (e: MediaQueryListEvent) => {
        document.documentElement.setAttribute("data-theme", e.matches ? "dark" : "light");
      };
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }
  }, [theme]);

  // 初始化：如果没有画布，创建一个默认画布
  // 重要：必须等待 hydration 完成后再检查，否则会覆盖存储中的数据
  useEffect(() => {
    if (_hasHydrated && canvases.length === 0) {
      createCanvas("默认画布");
    }
  }, [_hasHydrated, canvases.length, createCanvas]);

  // URL 深链：?q=<brief> → agentStore.createSessionFromBrief（幂等，只消费一次）
  useEffect(() => {
    if (!agentHydrated) return;
    consumeBriefFromUrl();
  }, [agentHydrated]);

  // 切换画布时加载画布数据
  useEffect(() => {
    if (activeCanvasId && activeCanvasId !== prevCanvasIdRef.current) {
      isLoadingCanvasRef.current = true;
      prevCanvasIdRef.current = activeCanvasId;

      const canvas = getActiveCanvas();
      if (canvas) {
        setNodes(canvas.nodes);
        setEdges(canvas.edges);
      }

      // 延迟重置标志，确保数据加载完成
      requestAnimationFrame(() => {
        isLoadingCanvasRef.current = false;
      });
    }
  }, [activeCanvasId, getActiveCanvas, setNodes, setEdges]);

  // 同步节点和边的变化到画布存储（防抖处理）
  useEffect(() => {
    // 如果正在加载画布数据，不进行同步
    if (isLoadingCanvasRef.current || !activeCanvasId) return;

    // 使用防抖来减少频繁更新
    // 300ms 延迟：平衡性能和数据安全，避免应用关闭时数据丢失
    const timer = setTimeout(() => {
      updateCanvasData(nodes, edges);
    }, 300);

    return () => clearTimeout(timer);
  }, [nodes, edges, activeCanvasId, updateCanvasData]);

  // 监听 ? 键打开帮助面板
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (e.key === "?" || (e.key === "/" && e.shiftKey)) {
        e.preventDefault();
        if (isHelpOpen) {
          closeHelp();
        } else {
          openHelp();
        }
      }
    };

    // 阻止浏览器默认的拖拽打开行为
    const preventDefaultDrag = (e: DragEvent) => {
      e.preventDefault();
    };

    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("dragover", preventDefaultDrag);
    window.addEventListener("drop", preventDefaultDrag);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("dragover", preventDefaultDrag);
      window.removeEventListener("drop", preventDefaultDrag);
    };
  }, [isHelpOpen, openHelp, closeHelp]);

  // 拖拽开始处理
  const onDragStart = useCallback(
    (
      event: React.DragEvent,
      nodeType: string,
      defaultData: Record<string, unknown>
    ) => {
      event.dataTransfer.setData("application/reactflow/type", nodeType);
      event.dataTransfer.setData(
        "application/reactflow/data",
        JSON.stringify(defaultData)
      );
      event.dataTransfer.effectAllowed = "move";
    },
    []
  );

  return (
    <ReactFlowProvider>
      <div className="flex flex-col h-screen w-screen overflow-hidden">
        <WorkspaceModeSwitch />

        {workspaceMode === "workflow" ? (
          <>
            {/* 顶部工具栏 */}
            <Toolbar />

            {/* 主体内容 */}
            <div className="flex flex-1 overflow-hidden">
              {/* 左侧导航栏（包含画布列表和节点库） */}
              <Sidebar
                onDragStart={onDragStart}
                isRecentProjectsOpen={isRecentProjectsOpen}
                onToggleRecentProjects={toggleRecentProjects}
              />

              {/* 右侧画布区域 */}
              <FlowCanvas />
            </div>
          </>
        ) : (
          <CreativeWorkspace />
        )}

        {/* creative 模式下的最近项目浮动入口：Sidebar（workflow 专属）随模式切换卸载，
            该入口保证在创作画布中仍可打开最近项目浮层（与 Sidebar 入口共用同一面板） */}
        {workspaceMode === "creative" && (
          <button
            className="fixed left-4 top-1/2 z-40 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-xl bg-base-100/60 backdrop-blur-md border border-base-200/50 shadow-xl text-base-content/60 transition-all duration-300 cursor-pointer hover:bg-base-100/80 hover:text-base-content hover:shadow-md hover:scale-105"
            data-tip="最近项目"
            title="最近项目"
            onClick={toggleRecentProjects}
          >
            <History className="w-5 h-5" />
          </button>
        )}

        {/* 最近项目浮层（App 常驻，两种模式的入口共用） */}
        <RecentProjectsPanel
          open={isRecentProjectsOpen}
          onClose={() => setIsRecentProjectsOpen(false)}
        />

        {/* 设置面板 */}
        <SettingsPanel />

        {/* Toast 通知容器 */}
        <ToastContainer />
        <LocalAgentBridgeRuntime />
      </div>
    </ReactFlowProvider>
  );
}

export default App;
