import { useState } from "react";
import { Settings, Trash2, Download, Upload, Undo2, Redo2, HelpCircle, Server, HardDrive, AlertTriangle } from "lucide-react";
import { createPortal } from "react-dom";
import { useSettingsStore } from "@/stores/settingsStore";
import { useFlowStore } from "@/stores/flowStore";
import { useStorageManagementStore } from "@/stores/storageManagementStore";
import { useModal, getModalAnimationClasses } from "@/hooks/useModal";
import { isTauriEnvironment } from "@/services/fileStorageService";
import { toast } from "@/stores/toastStore";
import { WorkflowControls } from "@/components/workflow/WorkflowControls";
import logoImage from "@/assets/logo.png";

export function Toolbar({ onOpenHelp }: { onOpenHelp?: () => void }) {
  const { openSettings, openProviderPanel } = useSettingsStore();
  const clearCanvas = useFlowStore((state) => state.clearCanvas);
  const setNodes = useFlowStore((state) => state.setNodes);
  const setEdges = useFlowStore((state) => state.setEdges);
  const undo = useFlowStore((state) => state.undo);
  const redo = useFlowStore((state) => state.redo);
  const canUndo = useFlowStore((state) => state.canUndo);
  const canRedo = useFlowStore((state) => state.canRedo);
  const { openModal: openStorageModal } = useStorageManagementStore();

  // 清空画布确认对话框状态
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const handleClearCanvas = () => {
    clearCanvas();
    setShowClearConfirm(false);
  };

  // 清理节点数据中的 base64 图片，仅保留文件路径
  const cleanNodeDataForExport = (nodes: ReturnType<typeof useFlowStore.getState>["nodes"]) => {
    return nodes.map((node) => {
      const cleanedNode = { ...node, data: { ...node.data } };
      const data = cleanedNode.data;

      // 清理 ImageInputNode 的 base64 数据
      if ("imageData" in data && "imagePath" in data) {
        delete data.imageData;
      }

      // 清理 ImageGeneratorNode 的 base64 数据
      if ("outputImage" in data && "outputImagePath" in data) {
        delete data.outputImage;
      }

      // 清理 PPTContentNode 的 pages 数据中的 base64
      if ("pages" in data && Array.isArray(data.pages)) {
        data.pages = data.pages.map((page: Record<string, unknown>) => {
          const cleanedPage = { ...page };

          // 清理 result 中的 base64
          if (cleanedPage.result && typeof cleanedPage.result === "object") {
            const result = cleanedPage.result as Record<string, unknown>;
            const cleanedResult = { ...result };
            if (cleanedResult.imagePath) delete cleanedResult.image;
            if (cleanedResult.thumbnailPath) delete cleanedResult.thumbnail;
            cleanedPage.result = cleanedResult;
          }

          // 清理手动上传图片的 base64
          if (cleanedPage.manualImagePath) delete cleanedPage.manualImage;
          if (cleanedPage.manualThumbnailPath) delete cleanedPage.manualThumbnail;

          return cleanedPage;
        });
      }

      return cleanedNode;
    });
  };

  // 导出工作流
  const handleExport = async () => {
    const { nodes, edges } = useFlowStore.getState();
    // 清理 base64 数据，仅保留文件路径（同设备可恢复）
    const cleanedNodes = cleanNodeDataForExport(nodes);
    const data = { nodes: cleanedNodes, edges };
    const jsonStr = JSON.stringify(data, null, 2);
    const fileName = `next-workflow-${Date.now()}.json`;

    if (isTauriEnvironment()) {
      try {
        const { save } = await import("@tauri-apps/plugin-dialog");
        const { writeTextFile } = await import("@tauri-apps/plugin-fs");

        const filePath = await save({
          defaultPath: fileName,
          filters: [{ name: "JSON", extensions: ["json"] }],
        });

        if (filePath) {
          await writeTextFile(filePath, jsonStr);
          toast.success(`工作流已保存到: ${filePath.split("/").pop()}`);
        }
      } catch (error) {
        console.error("导出工作流失败:", error);
        toast.error(`导出失败: ${error instanceof Error ? error.message : "未知错误"}`);
      }
    } else {
      // 浏览器环境
      const blob = new Blob([jsonStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success("工作流下载已开始");
    }
  };

  // 导入工作流
  const handleImport = async () => {
    if (isTauriEnvironment()) {
      try {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const { readTextFile } = await import("@tauri-apps/plugin-fs");

        const filePath = await open({
          filters: [{ name: "JSON", extensions: ["json"] }],
          multiple: false,
        });

        if (filePath && typeof filePath === "string") {
          const content = await readTextFile(filePath);
          const data = JSON.parse(content);
          if (data.nodes && data.edges) {
            setNodes(data.nodes);
            setEdges(data.edges);
            toast.success("工作流导入成功");
          } else {
            toast.error("无效的工作流文件");
          }
        }
      } catch (error) {
        console.error("导入工作流失败:", error);
        toast.error(`导入失败: ${error instanceof Error ? error.message : "未知错误"}`);
      }
    } else {
      // 浏览器环境
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json";
      input.onchange = (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = () => {
          try {
            const data = JSON.parse(reader.result as string);
            if (data.nodes && data.edges) {
              setNodes(data.nodes);
              setEdges(data.edges);
              toast.success("工作流导入成功");
            } else {
              toast.error("无效的工作流文件");
            }
          } catch {
            toast.error("无效的工作流文件");
          }
        };
        reader.readAsText(file);
      };
      input.click();
    }
  };

  const isMac = typeof navigator !== "undefined" && navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  const cmdKey = isMac ? "⌘" : "Ctrl";

  // 工具按钮组件
  const ToolButton = ({ onClick, icon: Icon, tooltip, disabled = false, danger = false }: any) => (
    <div className="tooltip tooltip-bottom" data-tip={tooltip}>
      <button
        className={`
          btn btn-ghost btn-sm btn-square rounded-lg h-9 w-9 p-0
          transition-all duration-200
          ${danger ? "text-error hover:bg-error/10" : "text-base-content/70 hover:text-base-content"}
          ${disabled ? "opacity-30 cursor-not-allowed" : ""}
        `}
        onClick={onClick}
        disabled={disabled}
      >
        <Icon className="w-4.5 h-4.5 stroke-[1.5]" />
      </button>
    </div>
  );

  return (
    <div className="px-4 py-2 pointer-events-none">
      <div className="
        glass-panel 
        pointer-events-auto 
        flex items-center justify-between 
        px-3 py-2 
        rounded-xl 
        mx-auto max-w-[98%]
        bg-base-100/90 dark:bg-base-100/70
      ">
        {/* 左侧 Logo */}
        <div className="flex items-center gap-3 select-none">
          <div className="flex items-center gap-2 group cursor-default">
            <div className="relative">
              <div className="absolute inset-0 bg-primary/20 blur-lg rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
              <img src={logoImage} alt="NextLemon" className="w-8 h-8 relative z-10 drop-shadow-sm" />
            </div>
            <span className="font-semibold text-lg tracking-tight bg-gradient-to-br from-base-content to-base-content/70 bg-clip-text text-transparent">
              NextLemon
            </span>
          </div>
          <div className="px-2 py-0.5 rounded-full bg-base-200/50 border border-base-300/50 text-xs font-mono text-base-content/50">
            v0.2.0
          </div>
        </div>

        {/* 中间工具 */}
        <div className="flex items-center gap-1.5 absolute left-1/2 -translate-x-1/2">
          {/* 历史记录组 */}
          <div className="flex items-center bg-base-200/50 rounded-lg p-0.5 border border-base-300/30">
            <ToolButton icon={Undo2} onClick={undo} disabled={!canUndo()} tooltip={`撤销 (${cmdKey}+Z)`} />
            <ToolButton icon={Redo2} onClick={redo} disabled={!canRedo()} tooltip={`重做 (${cmdKey}+Shift+Z)`} />
          </div>

          <div className="w-px h-6 bg-base-300/50 mx-1" />

          {/* 运行控制 */}
          <WorkflowControls />

          <div className="w-px h-6 bg-base-300/50 mx-1" />

          {/* 文件操作组 */}
          <div className="flex items-center bg-base-200/50 rounded-lg p-0.5 border border-base-300/30">
            <ToolButton icon={Upload} onClick={handleImport} tooltip="导入工作流" />
            <ToolButton icon={Download} onClick={handleExport} tooltip="导出工作流" />
          </div>

          <div className="w-px h-6 bg-base-300/50 mx-1" />

          <ToolButton icon={Trash2} onClick={() => setShowClearConfirm(true)} tooltip="清空画布" danger />
        </div>

        {/* 右侧设置 */}
        <div className="flex items-center gap-1">
          <ToolButton icon={HardDrive} onClick={openStorageModal} tooltip="存储管理" />
          <ToolButton icon={Server} onClick={openProviderPanel} tooltip="供应商管理" />
          <ToolButton icon={HelpCircle} onClick={onOpenHelp} tooltip="帮助 (?)" />
          <div className="w-px h-4 bg-base-300/50 mx-1" />
          <div className="tooltip tooltip-bottom tooltip-left" data-tip="设置">
            <button
              className="btn btn-ghost btn-sm btn-circle text-base-content/70 hover:rotate-45 transition-transform duration-300"
              onClick={openSettings}
            >
              <Settings className="w-5 h-5 stroke-[1.5]" />
            </button>
          </div>
        </div>
      </div>

      {/* 清空画布确认对话框 */}
      {showClearConfirm && (
        <ClearConfirmModal
          onConfirm={handleClearCanvas}
          onClose={() => setShowClearConfirm(false)}
        />
      )}
    </div>
  );
}

// 清空确认对话框组件
interface ClearConfirmModalProps {
  onConfirm: () => void;
  onClose: () => void;
}

function ClearConfirmModal({ onConfirm, onClose }: ClearConfirmModalProps) {
  // 使用统一的 modal hook
  const { isVisible, isClosing, handleClose, handleBackdropClick } = useModal({
    isOpen: true,
    onClose,
  });

  // 获取动画类名
  const { backdropClasses, contentClasses } = getModalAnimationClasses(isVisible, isClosing);

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      {/* 背景遮罩 */}
      <div
        className={`
          absolute inset-0
          transition-all duration-200 ease-out
          ${backdropClasses}
        `}
        onClick={handleBackdropClick}
      />
      {/* Modal 内容 */}
      <div
        className={`
          relative bg-base-100 rounded-xl p-5 mx-4 max-w-sm shadow-xl
          transition-all duration-200 ease-out
          ${contentClasses}
        `}
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-error/10 rounded-lg">
            <AlertTriangle className="w-5 h-5 text-error" />
          </div>
          <h3 className="font-semibold">确认清空</h3>
        </div>
        <p className="text-sm text-base-content/70 mb-5">
          确定要清空画布吗？这将删除画布上的所有节点和连线，此操作不可撤销。
        </p>
        <div className="flex gap-2 justify-end">
          <button
            className="btn btn-ghost btn-sm"
            onClick={handleClose}
          >
            取消
          </button>
          <button
            className="btn btn-error btn-sm"
            onClick={onConfirm}
          >
            确认清空
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
