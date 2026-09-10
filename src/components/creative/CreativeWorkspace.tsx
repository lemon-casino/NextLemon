import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowUpToLine,
  Bot,
  Download,
  Eye,
  EyeOff,
  FileAudio,
  FileVideo,
  Image,
  ImageDown,
  Images,
  Lock,
  PackageOpen,
  Palette,
  Redo2,
  Trash2,
  Type,
  Undo2,
  Unlock,
  Upload,
} from "lucide-react";
import { exportCreativeCanvasImage } from "@/services/creativeCanvasExport";
import { findItemsInRect } from "@/services/creativeCanvasGeometry";
import { AgentPanel } from "@/components/agent/AgentPanel";
import { BrandKitPanel } from "@/components/creative/BrandKitPanel";
import { CreativeAssetLibrary } from "@/components/creative/CreativeAssetLibrary";
import { ProjectPackagePanel } from "@/components/creative/ProjectPackagePanel";
import { useCreativeStore } from "@/stores/creativeStore";
import { toast } from "@/stores/toastStore";
import {
  isTauriEnvironment,
  saveImage,
  saveMediaFile,
} from "@/services/fileStorageService";
import { getCreativeAssetPreviewUrl } from "@/services/creativeAssetService";
import type {
  CreativeAsset,
  CreativeAssetKind,
  CreativeCanvasItem,
  CreativeViewport,
} from "@/types/creative";
import type { CreativeCanvasRect } from "@/services/creativeCanvasGeometry";
import { CREATIVE_ASSET_DRAG_TYPE } from "@/types/creative";

type DragState =
  | {
      type: "pan";
      startClientX: number;
      startClientY: number;
      startViewport: CreativeViewport;
    }
  | {
      type: "marquee";
      startWorld: { x: number; y: number };
      additive: boolean;
    }
  | {
      type: "move";
      itemId: string;
      startClientX: number;
      startClientY: number;
      startPosition: { x: number; y: number };
      zoom: number;
    }
  | {
      type: "resize";
      itemId: string;
      startClientX: number;
      startClientY: number;
      startSize: { width: number; height: number };
      zoom: number;
    };

export function CreativeWorkspace() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [sidePanelView, setSidePanelView] = useState<"assets" | "agent" | "brand" | "project">("assets");
  const assets = useCreativeStore((state) => state.assets);
  const canvas = useCreativeStore((state) => state.canvas);
  const selectedItemIds = useCreativeStore((state) => state.selectedItemIds);
  const addAsset = useCreativeStore((state) => state.addAsset);
  const updateAsset = useCreativeStore((state) => state.updateAsset);
  const addTextAsset = useCreativeStore((state) => state.addTextAsset);
  const addAssetToCanvas = useCreativeStore((state) => state.addAssetToCanvas);
  const removeItems = useCreativeStore((state) => state.removeItems);
  const bringToFront = useCreativeStore((state) => state.bringToFront);
  const sendToBack = useCreativeStore((state) => state.sendToBack);
  const toggleItemLock = useCreativeStore((state) => state.toggleItemLock);
  const toggleItemHidden = useCreativeStore((state) => state.toggleItemHidden);
  const clearCanvas = useCreativeStore((state) => state.clearCanvas);
  const exportSnapshot = useCreativeStore((state) => state.exportSnapshot);
  const canUndo = useCreativeStore((state) => state.canUndo);
  const canRedo = useCreativeStore((state) => state.canRedo);
  const undoCanvas = useCreativeStore((state) => state.undoCanvas);
  const redoCanvas = useCreativeStore((state) => state.redoCanvas);
  const [imageExportRunning, setImageExportRunning] = useState(false);

  const selectedItem = useMemo(
    () => canvas.items.find((item) => item.id === selectedItemIds[0]) || null,
    [canvas.items, selectedItemIds]
  );

  const addFiles = useCallback(
    async (files: FileList | File[], position?: { x: number; y: number }) => {
      const fileArray = Array.from(files);
      if (!fileArray.length) return;

      for (let index = 0; index < fileArray.length; index += 1) {
        const file = fileArray[index];
        const kind = kindFromMime(file.type);
        if (!kind) {
          toast.error(`不支持的文件类型: ${file.name}`);
          continue;
        }

        const dataUrl = await readFileAsDataUrl(file);
        const assetId = addAsset({
          kind,
          title: file.name,
          dataUrl,
          mimeType: file.type,
          fileName: file.name,
          bytes: file.size,
          source: "upload",
        });

        if (kind !== "text" && isTauriEnvironment()) {
          try {
            const base64 = dataUrl.split(",")[1] || "";
            let path: string;
            let size: number;

            if (kind === "image") {
              const imageInfo = await saveImage(
                base64,
                "creative-canvas",
                assetId,
                undefined,
                undefined,
                "input"
              );
              path = imageInfo.path;
              size = imageInfo.size;
            } else {
              const extension = (file.name.split(".").pop() || "").toLowerCase();
              const mediaInfo = await saveMediaFile(base64, extension);
              path = mediaInfo.path;
              size = mediaInfo.size;
            }

            updateAsset(assetId, {
              storagePath: path,
              dataUrl: undefined,
              bytes: size,
            });
          } catch (error) {
            console.warn("[CreativeWorkspace] 保存素材文件到文件系统失败:", error);
          }
        }

        addAssetToCanvas(assetId, {
          position: position
            ? {
                x: position.x + index * 32,
                y: position.y + index * 32,
              }
            : undefined,
        });
      }

      toast.success(`已添加 ${fileArray.length} 个素材`);
    },
    [addAsset, addAssetToCanvas, updateAsset]
  );

  const handleFileInput = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (files) void addFiles(files);
      event.target.value = "";
    },
    [addFiles]
  );

  const handleAddText = useCallback(() => {
    addTextAsset("双击编辑文本", { x: 80, y: 80 });
  }, [addTextAsset]);

  const handleExport = useCallback(async () => {
    const snapshot = exportSnapshot();
    const json = JSON.stringify(snapshot, null, 2);
    const fileName = `nextlemon-creative-canvas-${Date.now()}.json`;

    if (isTauriEnvironment()) {
      try {
        const { save } = await import("@tauri-apps/plugin-dialog");
        const { writeTextFile } = await import("@tauri-apps/plugin-fs");
        const filePath = await save({
          defaultPath: fileName,
          filters: [{ name: "JSON", extensions: ["json"] }],
        });
        if (filePath) {
          await writeTextFile(filePath, json);
          toast.success("创作画布已导出");
        }
      } catch (error) {
        toast.error(`导出失败: ${error instanceof Error ? error.message : "未知错误"}`);
      }
      return;
    }

    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success("创作画布下载已开始");
  }, [exportSnapshot]);

  const handleExportImage = useCallback(async (format: "png" | "jpeg") => {
    setImageExportRunning(true);
    try {
      const result = await exportCreativeCanvasImage(format);
      toast.success(`已导出 ${result.itemCount} 个素材，${format.toUpperCase()} ${Math.round(result.bytes / 1024)} KB`);
    } catch (error) {
      toast.error(`导出图片失败: ${error instanceof Error ? error.message : "未知错误"}`);
    } finally {
      setImageExportRunning(false);
    }
  }, []);

  const handleClearCanvas = useCallback(() => {
    if (canvas.items.length === 0) return;
    if (window.confirm("确认清空创作画布上的所有素材实例？素材库中的素材不会被删除。")) {
      clearCanvas();
    }
  }, [canvas.items.length, clearCanvas]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-base-200">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*,audio/*"
        multiple
        className="hidden"
        onChange={handleFileInput}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-[72px] items-center justify-between border-b border-base-300/60 bg-base-100/75 px-5 pr-72 backdrop-blur-md">
          <div className="min-w-0">
            <div className="text-lg font-semibold tracking-tight">素材创作画布</div>
            <div className="text-xs text-base-content/50">
              {canvas.items.length} 个画布素材 · {assets.length} 个素材库条目
            </div>
          </div>

          <div className="flex items-center gap-1 rounded-full bg-base-200/80 p-1">
            <button
              className="btn btn-ghost btn-sm btn-circle"
              title="撤销 (Ctrl+Z)"
              disabled={!canUndo}
              onClick={undoCanvas}
            >
              <Undo2 className="h-4 w-4" />
            </button>
            <button
              className="btn btn-ghost btn-sm btn-circle"
              title="重做 (Ctrl+Shift+Z)"
              disabled={!canRedo}
              onClick={redoCanvas}
            >
              <Redo2 className="h-4 w-4" />
            </button>
            <button className="btn btn-ghost btn-sm gap-2 rounded-full" onClick={handleAddText}>
              <Type className="h-4 w-4" />
              文本
            </button>
            <button
              className="btn btn-primary btn-sm gap-2 rounded-full"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-4 w-4" />
              上传
            </button>
            <button className="btn btn-ghost btn-sm btn-circle" title="导出创作画布" onClick={handleExport}>
              <Download className="h-4 w-4" />
            </button>
            <button
              className="btn btn-ghost btn-sm btn-circle"
              title="导出为 PNG 图片"
              disabled={imageExportRunning}
              onClick={() => void handleExportImage("png")}
            >
              <ImageDown className="h-4 w-4" />
            </button>
            <button
              className="btn btn-ghost btn-sm btn-circle"
              title="导出为 JPG 图片"
              disabled={imageExportRunning}
              onClick={() => void handleExportImage("jpeg")}
            >
              <Images className="h-4 w-4" />
            </button>
            <button
              className="btn btn-ghost btn-sm btn-circle text-error hover:bg-error/10"
              title="清空创作画布"
              onClick={handleClearCanvas}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        <CreativeCanvasSurface onFilesDrop={addFiles} />
      </div>

      <div className="w-80 border-l border-base-300/60 bg-base-100/85 pt-[76px] backdrop-blur-md">
        <div className="absolute right-0 top-0 flex h-[72px] w-80 items-center justify-between border-b border-base-300/60 px-4">
          <div className="min-w-0">
            <div className="font-semibold">{getSidePanelTitle(sidePanelView)}</div>
            <div className="truncate text-xs text-base-content/50">
              {getSidePanelSubtitle(sidePanelView)}
            </div>
          </div>
          <div className="join">
            <button
              className={`btn join-item btn-xs ${sidePanelView === "assets" ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setSidePanelView("assets")}
              title="素材库"
            >
              <Image className="h-3.5 w-3.5" />
            </button>
            <button
              className={`btn join-item btn-xs ${sidePanelView === "brand" ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setSidePanelView("brand")}
              title="品牌模板"
            >
              <Palette className="h-3.5 w-3.5" />
            </button>
            <button
              className={`btn join-item btn-xs ${sidePanelView === "project" ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setSidePanelView("project")}
              title="项目包"
            >
              <PackageOpen className="h-3.5 w-3.5" />
            </button>
            <button
              className={`btn join-item btn-xs ${sidePanelView === "agent" ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setSidePanelView("agent")}
              title="画布助手"
            >
              <Bot className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        {sidePanelView === "assets" ? (
          <CreativeAssetLibrary
            activeAssetId={selectedItem?.assetId}
            onAddToCanvas={(assetId) => addAssetToCanvas(assetId, { position: { x: 120, y: 120 } })}
          />
        ) : sidePanelView === "brand" ? (
          <BrandKitPanel />
        ) : sidePanelView === "project" ? (
          <ProjectPackagePanel />
        ) : (
          <AgentPanel />
        )}
      </div>

      {selectedItem && (
        <div className="fixed bottom-6 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-1 rounded-full border border-base-300 bg-base-100/90 p-1 shadow-xl backdrop-blur-md">
          <button className="btn btn-ghost btn-sm btn-circle" title="置于顶层" onClick={() => bringToFront(selectedItem.id)}>
            <ArrowUpToLine className="h-4 w-4" />
          </button>
          <button className="btn btn-ghost btn-sm btn-circle" title="置于底层" onClick={() => sendToBack(selectedItem.id)}>
            <ArrowDownToLine className="h-4 w-4" />
          </button>
          <div className="mx-1 h-5 w-px bg-base-300" />
          <button className="btn btn-ghost btn-sm btn-circle" title="锁定/解锁" onClick={() => toggleItemLock(selectedItem.id)}>
            {selectedItem.locked ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
          </button>
          <button className="btn btn-ghost btn-sm btn-circle" title="隐藏/显示" onClick={() => toggleItemHidden(selectedItem.id)}>
            {selectedItem.hidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          </button>
          <button className="btn btn-ghost btn-sm btn-circle text-error hover:bg-error/10" title="删除画布实例" onClick={() => removeItems([selectedItem.id])}>
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

function getSidePanelTitle(view: "assets" | "agent" | "brand" | "project") {
  if (view === "assets") return "素材库";
  if (view === "brand") return "品牌模板";
  if (view === "project") return "项目包";
  return "画布助手";
}

function getSidePanelSubtitle(view: "assets" | "agent" | "brand" | "project") {
  if (view === "assets") return "拖到创作画布或工作流画布使用";
  if (view === "brand") return "品牌套件、Logo、参考图和内置模板";
  if (view === "project") return "导入导出、验收报告和 WebDAV 同步";
  return "会话、事件和审批队列";
}

function CreativeCanvasSurface({
  onFilesDrop,
}: {
  onFilesDrop: (files: FileList | File[], position?: { x: number; y: number }) => Promise<void>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<CreativeCanvasRect | null>(null);
  const canvas = useCreativeStore((state) => state.canvas);
  const assets = useCreativeStore((state) => state.assets);
  const selectedItemIds = useCreativeStore((state) => state.selectedItemIds);
  const setViewport = useCreativeStore((state) => state.setViewport);
  const moveItem = useCreativeStore((state) => state.moveItem);
  const resizeItem = useCreativeStore((state) => state.resizeItem);
  const selectItems = useCreativeStore((state) => state.selectItems);
  const clearSelection = useCreativeStore((state) => state.clearSelection);
  const addAssetToCanvas = useCreativeStore((state) => state.addAssetToCanvas);
  const removeItems = useCreativeStore((state) => state.removeItems);

  const assetById = useMemo(
    () => new Map(assets.map((asset) => [asset.id, asset])),
    [assets]
  );

  const screenToWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (clientX - rect.left - canvas.viewport.x) / canvas.viewport.zoom,
        y: (clientY - rect.top - canvas.viewport.y) / canvas.viewport.zoom,
      };
    },
    [canvas.viewport]
  );

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const state = dragStateRef.current;
      if (!state) return;

      if (state.type === "pan") {
        setViewport({
          x: state.startViewport.x + event.clientX - state.startClientX,
          y: state.startViewport.y + event.clientY - state.startClientY,
          zoom: state.startViewport.zoom,
        });
        return;
      }

      if (state.type === "marquee") {
        const world = screenToWorld(event.clientX, event.clientY);
        setMarqueeRect({
          x: Math.min(state.startWorld.x, world.x),
          y: Math.min(state.startWorld.y, world.y),
          width: Math.abs(world.x - state.startWorld.x),
          height: Math.abs(world.y - state.startWorld.y),
        });
        return;
      }

      if (state.type === "move") {
        moveItem(state.itemId, {
          x: state.startPosition.x + (event.clientX - state.startClientX) / state.zoom,
          y: state.startPosition.y + (event.clientY - state.startClientY) / state.zoom,
        });
        return;
      }

      resizeItem(state.itemId, {
        width: state.startSize.width + (event.clientX - state.startClientX) / state.zoom,
        height: state.startSize.height + (event.clientY - state.startClientY) / state.zoom,
      });
    };

    const handlePointerUp = (event: PointerEvent) => {
      const state = dragStateRef.current;
      if (state?.type === "marquee") {
        const world = screenToWorld(event.clientX, event.clientY);
        const rect: CreativeCanvasRect = {
          x: Math.min(state.startWorld.x, world.x),
          y: Math.min(state.startWorld.y, world.y),
          width: Math.abs(world.x - state.startWorld.x),
          height: Math.abs(world.y - state.startWorld.y),
        };
        if (rect.width > 4 && rect.height > 4) {
          const hitIds = findItemsInRect(canvas.items, rect).map((item) => item.id);
          const base = state.additive ? selectedItemIds.filter((id) => !hitIds.includes(id)) : [];
          selectItems(Array.from(new Set([...base, ...hitIds])));
        }
      }
      setMarqueeRect(null);
      dragStateRef.current = null;
      document.body.style.cursor = "default";
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [canvas.items, moveItem, resizeItem, selectedItemIds, screenToWorld, selectItems, setViewport]);

  const undoCanvas = useCreativeStore((state) => state.undoCanvas);
  const redoCanvas = useCreativeStore((state) => state.redoCanvas);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      const isUndo = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !event.shiftKey;
      const isRedo =
        ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && event.shiftKey) ||
        ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y");
      if (isUndo) {
        event.preventDefault();
        undoCanvas();
        return;
      }
      if (isRedo) {
        event.preventDefault();
        redoCanvas();
        return;
      }
      if (event.key === "Escape") clearSelection();
      if ((event.key === "Delete" || event.key === "Backspace") && selectedItemIds.length > 0) {
        event.preventDefault();
        removeItems(selectedItemIds);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [clearSelection, redoCanvas, removeItems, selectedItemIds, undoCanvas]);

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      event.preventDefault();
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const factor = Math.pow(1.1, -event.deltaY / 100);
      const nextZoom = Math.min(4, Math.max(0.12, canvas.viewport.zoom * factor));
      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;
      const worldX = (mouseX - canvas.viewport.x) / canvas.viewport.zoom;
      const worldY = (mouseY - canvas.viewport.y) / canvas.viewport.zoom;

      setViewport({
        x: mouseX - worldX * nextZoom,
        y: mouseY - worldY * nextZoom,
        zoom: nextZoom,
      });
    },
    [canvas.viewport, setViewport]
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("[data-creative-item]")) return;
      if (event.button !== 0) return;
      if (event.shiftKey) {
        dragStateRef.current = {
          type: "marquee",
          startWorld: screenToWorld(event.clientX, event.clientY),
          additive: selectedItemIds.length > 0,
        };
        document.body.style.cursor = "crosshair";
        return;
      }
      dragStateRef.current = {
        type: "pan",
        startClientX: event.clientX,
        startClientY: event.clientY,
        startViewport: canvas.viewport,
      };
      clearSelection();
      document.body.style.cursor = "grabbing";
    },
    [canvas.viewport, clearSelection, screenToWorld, selectedItemIds]
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const position = screenToWorld(event.clientX, event.clientY);
      const assetPayload = event.dataTransfer.getData(CREATIVE_ASSET_DRAG_TYPE);
      if (assetPayload) {
        try {
          const parsed = JSON.parse(assetPayload) as { assetId?: string };
          if (parsed.assetId) addAssetToCanvas(parsed.assetId, { position });
        } catch {
          toast.error("素材拖放数据无效");
        }
        return;
      }

      if (event.dataTransfer.files.length > 0) {
        void onFilesDrop(event.dataTransfer.files, position);
      }
    },
    [addAssetToCanvas, onFilesDrop, screenToWorld]
  );

  return (
    <div
      ref={containerRef}
      className="relative min-h-0 flex-1 cursor-grab overflow-hidden"
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
    >
      <CanvasGrid viewport={canvas.viewport} />
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{
          transform: `translate(${canvas.viewport.x}px, ${canvas.viewport.y}px) scale(${canvas.viewport.zoom})`,
        }}
      >
        {marqueeRect && (
          <div
            className="pointer-events-none absolute border-2 border-primary bg-primary/10"
            style={{
              transform: `translate(${marqueeRect.x}px, ${marqueeRect.y}px)`,
              width: marqueeRect.width,
              height: marqueeRect.height,
              zIndex: 9999,
            }}
          />
        )}
        {canvas.items
          .slice()
          .sort((a, b) => a.zIndex - b.zIndex)
          .map((item) => {
            const asset = assetById.get(item.assetId);
            if (!asset) return null;
            return (
              <CreativeCanvasItemView
                key={item.id}
                item={item}
                asset={asset}
                selected={selectedItemIds.includes(item.id)}
                viewport={canvas.viewport}
                onSelect={() => selectItems([item.id])}
                onMoveStart={(event) => {
                  if (item.locked) {
                    selectItems([item.id]);
                    return;
                  }
                  event.stopPropagation();
                  selectItems([item.id]);
                  dragStateRef.current = {
                    type: "move",
                    itemId: item.id,
                    startClientX: event.clientX,
                    startClientY: event.clientY,
                    startPosition: item.position,
                    zoom: canvas.viewport.zoom,
                  };
                  document.body.style.cursor = "grabbing";
                }}
                onResizeStart={(event) => {
                  event.stopPropagation();
                  dragStateRef.current = {
                    type: "resize",
                    itemId: item.id,
                    startClientX: event.clientX,
                    startClientY: event.clientY,
                    startSize: { width: item.width, height: item.height },
                    zoom: canvas.viewport.zoom,
                  };
                  document.body.style.cursor = "nwse-resize";
                }}
              />
            );
          })}
      </div>
      <div className="pointer-events-none absolute bottom-4 right-4 rounded-full border border-base-300 bg-base-100/80 px-3 py-1 text-xs text-base-content/60 shadow-sm backdrop-blur">
        {Math.round(canvas.viewport.zoom * 100)}%
      </div>
    </div>
  );
}

function CreativeCanvasItemView({
  item,
  asset,
  selected,
  viewport,
  onSelect,
  onMoveStart,
  onResizeStart,
}: {
  item: CreativeCanvasItem;
  asset: CreativeAsset;
  selected: boolean;
  viewport: CreativeViewport;
  onSelect: () => void;
  onMoveStart: (event: React.PointerEvent<HTMLDivElement>) => void;
  onResizeStart: (event: React.PointerEvent<HTMLElement>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const updateAsset = useCreativeStore((state) => state.updateAsset);
  const previewUrl = getCreativeAssetPreviewUrl(asset);

  const itemStyle: CSSProperties = {
    transform: `translate(${item.position.x}px, ${item.position.y}px)`,
    width: item.width,
    height: item.height,
    zIndex: item.zIndex,
    opacity: item.hidden ? 0.24 : 1,
  };

  return (
    <div
      data-creative-item
      className={`absolute select-none rounded-lg border-2 bg-base-100 shadow-lg transition-shadow ${
        selected ? "border-primary shadow-primary/20" : "border-base-300"
      } ${item.locked ? "cursor-not-allowed" : "cursor-grab"}`}
      style={itemStyle}
      onPointerDown={onMoveStart}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        if (asset.kind === "text") setEditing(true);
      }}
    >
      <div className="absolute left-2 top-2 z-10 rounded-md bg-black/45 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur">
        {item.title}
      </div>
      {item.locked && (
        <div className="absolute right-2 top-2 z-10 rounded-md bg-black/45 p-1 text-white backdrop-blur">
          <Lock className="h-3 w-3" />
        </div>
      )}

      <div className="h-full w-full overflow-hidden rounded-md">
        {asset.kind === "text" && (
          editing ? (
            <textarea
              autoFocus
              className="h-full w-full resize-none bg-base-100 p-4 pt-9 text-sm outline-none"
              value={asset.text || ""}
              onChange={(event) => updateAsset(asset.id, { text: event.target.value })}
              onBlur={() => setEditing(false)}
              onPointerDown={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === "Escape") setEditing(false);
              }}
            />
          ) : (
            <div className="h-full w-full overflow-auto whitespace-pre-wrap break-words p-4 pt-9 text-sm text-base-content">
              {asset.text || "双击编辑文本"}
            </div>
          )
        )}
        {asset.kind === "image" && (
          previewUrl ? (
            <img src={previewUrl} alt={asset.title} className="h-full w-full object-contain" draggable={false} />
          ) : (
            <EmptyAsset icon={<Image className="h-7 w-7" />} label="图片缺失" />
          )
        )}
        {asset.kind === "video" && (
          previewUrl ? (
            <video src={previewUrl} className="h-full w-full bg-black object-contain" controls data-canvas-no-zoom />
          ) : (
            <EmptyAsset icon={<FileVideo className="h-7 w-7" />} label="视频缺失" />
          )
        )}
        {asset.kind === "audio" && (
          <div className="flex h-full w-full flex-col justify-center gap-3 bg-base-100 px-4 pt-6">
            <div className="flex items-center gap-2 text-sm text-base-content/70">
              <FileAudio className="h-4 w-4" />
              <span className="truncate">{asset.title}</span>
            </div>
            {previewUrl ? <audio src={previewUrl} controls className="w-full" /> : <div className="text-xs text-base-content/40">音频缺失</div>}
          </div>
        )}
      </div>

      {selected && !item.locked && (
        <button
          className="absolute -bottom-3 -right-3 h-7 w-7 rounded-full border border-primary bg-base-100 shadow-md"
          style={{ transform: `scale(${1 / viewport.zoom})` }}
          onPointerDown={onResizeStart}
          title="缩放"
        />
      )}
    </div>
  );
}

function CanvasGrid({ viewport }: { viewport: CreativeViewport }) {
  const gridSize = 48 * viewport.zoom;
  const x = viewport.x % gridSize;
  const y = viewport.y % gridSize;
  return (
    <div
      className="pointer-events-none absolute inset-0 opacity-50"
      style={{
        backgroundImage:
          "linear-gradient(rgba(148, 163, 184, 0.22) 1px, transparent 1px), linear-gradient(90deg, rgba(148, 163, 184, 0.22) 1px, transparent 1px)",
        backgroundSize: `${gridSize}px ${gridSize}px`,
        backgroundPosition: `${x}px ${y}px`,
      }}
    />
  );
}

function EmptyAsset({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-base-content/35">
      {icon}
      <span className="text-xs">{label}</span>
    </div>
  );
}

function kindFromMime(mimeType: string): CreativeAssetKind | null {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("text/")) return "text";
  return null;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}
