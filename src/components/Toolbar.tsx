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

  // Clear canvas confirmation state
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const handleClearCanvas = () => {
    clearCanvas();
    setShowClearConfirm(false);
  };

  // Clean base64 image data from nodes for export
  // Keeps only file paths to reduce file size and allow sharing
  const cleanNodeDataForExport = (nodes: ReturnType<typeof useFlowStore.getState>["nodes"]) => {
    return nodes.map((node) => {
      const cleanedNode = { ...node, data: { ...node.data } };
      const data = cleanedNode.data;

      // Clean ImageInputNode base64
      if ("imageData" in data && "imagePath" in data) {
        delete data.imageData;
      }

      // Clean ImageGeneratorNode base64
      if ("outputImage" in data && "outputImagePath" in data) {
        delete data.outputImage;
      }

      // Clean PPTContentNode pages base64
      if ("pages" in data && Array.isArray(data.pages)) {
        data.pages = data.pages.map((page: Record<string, unknown>) => {
          const cleanedPage = { ...page };

          // Clean result base64
          if (cleanedPage.result && typeof cleanedPage.result === "object") {
            const result = cleanedPage.result as Record<string, unknown>;
            const cleanedResult = { ...result };
            if (cleanedResult.imagePath) delete cleanedResult.image;
            if (cleanedResult.thumbnailPath) delete cleanedResult.thumbnail;
            cleanedPage.result = cleanedResult;
          }

          // Clean manual upload base64
          if (cleanedPage.manualImagePath) delete cleanedPage.manualImage;
          if (cleanedPage.manualThumbnailPath) delete cleanedPage.manualThumbnail;

          return cleanedPage;
        });
      }

      return cleanedNode;
    });
  };

  // Export Workflow
  const handleExport = async () => {
    const { nodes, edges } = useFlowStore.getState();
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
          toast.success(`Workflow saved to: ${filePath.split("/").pop()}`);
        }
      } catch (error) {
        console.error("Export failed:", error);
        toast.error(`Export failed: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    } else {
      // Browser environment
      const blob = new Blob([jsonStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success("Workflow download started");
    }
  };

  // Import Workflow
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
            toast.success("Workflow imported successfully");
          } else {
            toast.error("Invalid workflow file");
          }
        }
      } catch (error) {
        console.error("Import failed:", error);
        toast.error(`Import failed: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    } else {
      // Browser environment
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json";
      input.onchange = (e: Event) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = () => {
          try {
            const data = JSON.parse(reader.result as string);
            if (data.nodes && data.edges) {
              setNodes(data.nodes);
              setEdges(data.edges);
              toast.success("Workflow imported successfully");
            } else {
              toast.error("Invalid workflow file");
            }
          } catch {
            toast.error("Invalid workflow file");
          }
        };
        reader.readAsText(file);
      };
      input.click();
    }
  };

  const isMac = typeof navigator !== "undefined" && navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  const cmdKey = isMac ? "⌘" : "Ctrl";

  return (
    <div className="flex items-center justify-between px-6 py-3 glass-panel rounded-full mt-4 mx-auto max-w-5xl transition-all duration-300 hover:shadow-2xl hover:border-white/20">
      {/* Left Logo */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <img src={logoImage} alt="NextLemon" className="w-8 h-8 drop-shadow-md" />
          <span className="font-bold text-lg tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-primary to-accent">NextLemon</span>
        </div>
        <div className="badge badge-ghost badge-sm border-white/10 bg-white/5 backdrop-blur-md">v0.2.0</div>
      </div>

      {/* Middle Tools */}
      <div className="flex items-center gap-2">
        {/* Undo/Redo */}
        <div className="tooltip tooltip-bottom" data-tip={`Undo (${cmdKey}+Z)`}>
          <button
            className="btn btn-ghost btn-sm btn-circle glass-btn"
            onClick={undo}
            disabled={!canUndo()}
          >
            <Undo2 className="w-4 h-4" />
          </button>
        </div>
        <div className="tooltip tooltip-bottom" data-tip={`Redo (${cmdKey}+Shift+Z)`}>
          <button
            className="btn btn-ghost btn-sm btn-circle glass-btn"
            onClick={redo}
            disabled={!canRedo()}
          >
            <Redo2 className="w-4 h-4" />
          </button>
        </div>
        <div className="w-px h-6 bg-white/10 mx-2" />

        {/* Workflow Controls */}
        <WorkflowControls />
        <div className="w-px h-6 bg-white/10 mx-2" />

        <div className="tooltip tooltip-bottom" data-tip="Import Workflow">
          <button className="btn btn-ghost btn-sm gap-2 glass-btn rounded-full px-4" onClick={handleImport}>
            <Upload className="w-4 h-4" />
            <span className="hidden sm:inline">Import</span>
          </button>
        </div>
        <div className="tooltip tooltip-bottom" data-tip="Export Workflow">
          <button className="btn btn-ghost btn-sm gap-2 glass-btn rounded-full px-4" onClick={handleExport}>
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Export</span>
          </button>
        </div>
        <div className="w-px h-6 bg-white/10 mx-2" />
        <div className="tooltip tooltip-bottom" data-tip="Clear Canvas">
          <button
            className="btn btn-ghost btn-sm text-error/80 hover:text-error gap-2 glass-btn rounded-full px-4 hover:bg-error/10"
            onClick={() => setShowClearConfirm(true)}
          >
            <Trash2 className="w-4 h-4" />
            <span className="hidden sm:inline">Clear</span>
          </button>
        </div>
      </div>

      {/* Right Settings */}
      <div className="flex items-center gap-2 pl-4 border-l border-white/10">
        <div className="tooltip tooltip-bottom" data-tip="Storage Management">
          <button className="btn btn-ghost btn-sm btn-circle glass-btn" onClick={openStorageModal}>
            <HardDrive className="w-4 h-4" />
          </button>
        </div>
        <div className="tooltip tooltip-bottom" data-tip="Provider Settings">
          <button className="btn btn-ghost btn-sm btn-circle glass-btn" onClick={openProviderPanel}>
            <Server className="w-4 h-4" />
          </button>
        </div>
        <div className="tooltip tooltip-bottom" data-tip="Help">
          <button className="btn btn-ghost btn-sm btn-circle glass-btn" onClick={onOpenHelp}>
            <HelpCircle className="w-4 h-4" />
          </button>
        </div>
        <div className="tooltip tooltip-bottom" data-tip="Settings">
          <button className="btn btn-ghost btn-sm btn-circle glass-btn" onClick={openSettings}>
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Clear Confirmation Modal */}
      {showClearConfirm && (
        <ClearConfirmModal
          onConfirm={handleClearCanvas}
          onClose={() => setShowClearConfirm(false)}
        />
      )}
    </div>
  );
}

// Clear Confirmation Modal Component
interface ClearConfirmModalProps {
  onConfirm: () => void;
  onClose: () => void;
}

function ClearConfirmModal({ onConfirm, onClose }: ClearConfirmModalProps) {
  // Use unified modal hook
  const { isVisible, isClosing, handleClose, handleBackdropClick } = useModal({
    isOpen: true,
    onClose,
  });

  // Get animation classes
  const { backdropClasses, contentClasses } = getModalAnimationClasses(isVisible, isClosing);

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className={`
          absolute inset-0 bg-black/50 backdrop-blur-sm
          transition-all duration-200 ease-out
          ${backdropClasses}
        `}
        onClick={handleBackdropClick}
      />
      {/* Modal Content */}
      <div
        className={`
          relative glass-panel rounded-xl p-5 mx-4 max-w-sm shadow-xl border border-error/20
          transition-all duration-200 ease-out
          ${contentClasses}
        `}
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-error/10 rounded-lg">
            <AlertTriangle className="w-5 h-5 text-error" />
          </div>
          <h3 className="font-semibold text-white">Confirm Clear</h3>
        </div>
        <p className="text-sm text-white/70 mb-5">
          Are you sure you want to clear the canvas? This will remove all nodes and edges. This action cannot be undone.
        </p>
        <div className="flex gap-2 justify-end">
          <button
            className="glass-btn btn-sm"
            onClick={handleClose}
          >
            Cancel
          </button>
          <button
            className="btn btn-error btn-sm"
            onClick={onConfirm}
          >
            Clear Canvas
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
