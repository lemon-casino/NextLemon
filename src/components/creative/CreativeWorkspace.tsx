import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
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
  Wand2,
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
import { CreativeCanvasMinimap } from "@/components/creative/CreativeCanvasMinimap";
import { AssetMentionTextarea } from "@/components/creative/AssetMentionTextarea";
import { findItemsInRect } from "@/services/creativeCanvasGeometry";
import { AgentPanel } from "@/components/agent/AgentPanel";
import { BrandKitPanel } from "@/components/creative/BrandKitPanel";
import { CreativeAssetLibrary } from "@/components/creative/CreativeAssetLibrary";
import { ProjectPackagePanel } from "@/components/creative/ProjectPackagePanel";
import {
  collectCollapsedBatchChildIds,
  isItemVisibleInViewport,
  useCreativeStore,
} from "@/stores/creativeStore";
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
import type { CreativeCanvasRect, SnapGuide } from "@/services/creativeCanvasGeometry";
import { computeSnapAdjustment } from "@/services/creativeCanvasGeometry";
import { useResilientMedia, type MediaKind } from "@/utils/mediaLoadStrategy";
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
  const autoSinkEnabled = useCreativeStore((state) => state.autoSinkEnabled);
  const setAutoSinkEnabled = useCreativeStore((state) => state.setAutoSinkEnabled);

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

  // 鼠标点击过的按钮主动失焦：Chromium/WebView2 下点击按钮后焦点滞留按钮上，
  // 会命中空格处理的排除名单导致无法进入平移模式。键盘聚焦（detail === 0）不
  // 受影响，保留按钮的空格激活能力。
  const handleRootClickCapture = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (event.detail === 0) return;
    const target = event.target instanceof Element ? event.target : null;
    target?.closest("button")?.blur();
  }, []);

  return (
    <div
      className="flex h-screen w-screen overflow-hidden bg-base-200"
      onClickCapture={handleRootClickCapture}
    >
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
              className={`btn btn-sm btn-circle ${autoSinkEnabled ? "btn-success" : "btn-ghost"}`}
              title="自动沉淀：工作流生成完成后，结果自动保存为素材并放入创作画布（执行中显示占位）"
              onClick={() => {
                setAutoSinkEnabled(!autoSinkEnabled);
                toast.info(autoSinkEnabled ? "自动沉淀已关闭" : "自动沉淀已开启，生成结果将自动放入创作画布");
              }}
            >
              <Wand2 className="h-4 w-4" />
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
  // 指针移动/视口更新按 rAF 合帧：同一帧内的多次 pointermove 只应用最后一次坐标
  const frameRef = useRef<number | null>(null);
  const pendingMoveRef = useRef<{ clientX: number; clientY: number } | null>(null);
  // 按住空格进入平移模式（不改变选区）
  const spacePanRef = useRef(false);
  // 视口裁剪需要容器尺寸（ResizeObserver 跟随窗口/面板变化）
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [marqueeRect, setMarqueeRect] = useState<CreativeCanvasRect | null>(null);
  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([]);
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
  const setBatchExpanded = useCreativeStore((state) => state.setBatchExpanded);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    // 首帧同步测量，避免初次渲染按 0 尺寸裁剪导致整屏空白闪帧
    setContainerSize({ width: element.clientWidth, height: element.clientHeight });
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setContainerSize({ width: rect.width, height: rect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

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

  // 折叠批量栈的子图不渲染也不参与框选命中（主图已完整覆盖其区域）
  const collapsedChildIds = useMemo(
    () => collectCollapsedBatchChildIds(canvas.items),
    [canvas.items]
  );

  // 视口外实例裁剪（只裁渲染不裁数据）：选中与拖拽中的实例强制保留渲染；
  // 折叠栈子图直接跳过。store 数据保持全量，框选/导出/小地图均读全量数据。
  const renderItems = useMemo(() => {
    const dragState = dragStateRef.current;
    const forcedIds = new Set(selectedItemIds);
    if (dragState && (dragState.type === "move" || dragState.type === "resize")) {
      forcedIds.add(dragState.itemId);
    }
    return canvas.items
      .filter(
        (item) =>
          !collapsedChildIds.has(item.id) &&
          (forcedIds.has(item.id) ||
            isItemVisibleInViewport(item, canvas.viewport, containerSize))
      )
      .sort((a, b) => a.zIndex - b.zIndex);
  }, [canvas.items, canvas.viewport, containerSize, selectedItemIds, collapsedChildIds]);

  useEffect(() => {
    // 应用合帧后的指针坐标（每帧最多一次 setState）
    const applyPointerFrame = () => {
      frameRef.current = null;
      const coords = pendingMoveRef.current;
      pendingMoveRef.current = null;
      const state = coords ? dragStateRef.current : null;
      if (!state || !coords) return;

      if (state.type === "pan") {
        setViewport({
          x: state.startViewport.x + coords.clientX - state.startClientX,
          y: state.startViewport.y + coords.clientY - state.startClientY,
          zoom: state.startViewport.zoom,
        });
        return;
      }

      if (state.type === "marquee") {
        const world = screenToWorld(coords.clientX, coords.clientY);
        setMarqueeRect({
          x: Math.min(state.startWorld.x, world.x),
          y: Math.min(state.startWorld.y, world.y),
          width: Math.abs(world.x - state.startWorld.x),
          height: Math.abs(world.y - state.startWorld.y),
        });
        return;
      }

      if (state.type === "move") {
        const raw = {
          x: state.startPosition.x + (coords.clientX - state.startClientX) / state.zoom,
          y: state.startPosition.y + (coords.clientY - state.startClientY) / state.zoom,
        };
        const dragItem = canvas.items.find((item) => item.id === state.itemId);
        if (dragItem) {
          // 批量栈主图拖动时排除自身子图：子图与主图同增量跟随，若参与吸附
          // 会把参考线锚到跟随中的子图上，导致主图被"吸住"无法拖动。
          const ownChildIds = dragItem.isBatchRoot ? dragItem.batchChildIds || [] : [];
          const snapTargets = ownChildIds.length
            ? canvas.items.filter((item) => !ownChildIds.includes(item.id))
            : canvas.items;
          const snapped = computeSnapAdjustment(dragItem, raw, snapTargets);
          moveItem(state.itemId, { x: snapped.x, y: snapped.y });
          setSnapGuides(snapped.guides);
        } else {
          moveItem(state.itemId, raw);
        }
        return;
      }

      resizeItem(state.itemId, {
        width: state.startSize.width + (coords.clientX - state.startClientX) / state.zoom,
        height: state.startSize.height + (coords.clientY - state.startClientY) / state.zoom,
      });
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!dragStateRef.current) return;
      pendingMoveRef.current = { clientX: event.clientX, clientY: event.clientY };
      if (frameRef.current == null) {
        frameRef.current = requestAnimationFrame(applyPointerFrame);
      }
    };

    // 拖拽结束时同步应用尚未合帧的最后一次坐标，保证终点位置不丢
    const flushPendingFrame = () => {
      if (frameRef.current != null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      if (pendingMoveRef.current != null) {
        applyPointerFrame();
      }
    };

    const handlePointerUp = (event: PointerEvent) => {
      flushPendingFrame();
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
          // 折叠栈子图不可见，框选不命中（展开后按各自网格位置正常命中）
          const hitIds = findItemsInRect(canvas.items, rect)
            .filter((item) => !collapsedChildIds.has(item.id))
            .map((item) => item.id);
          const base = state.additive ? selectedItemIds.filter((id) => !hitIds.includes(id)) : [];
          selectItems(Array.from(new Set([...base, ...hitIds])));
        }
      }
      setMarqueeRect(null);
      setSnapGuides([]);
      dragStateRef.current = null;
      document.body.style.cursor = "default";
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      if (frameRef.current != null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      pendingMoveRef.current = null;
    };
  }, [canvas.items, collapsedChildIds, moveItem, resizeItem, selectedItemIds, screenToWorld, selectItems, setViewport]);

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

  // 按住空格进入画布平移模式。排除名单：文本录入控件，以及 button/select——
  // 后者为保留键盘可达性（Tab 聚焦后按空格激活）；鼠标点击过的按钮已在
  // handleRootClickCapture 中失焦，不影响空格平移。
  useEffect(() => {
    const isTextEntryTarget = (event: KeyboardEvent) =>
      event.target instanceof HTMLElement &&
      (event.target.isContentEditable ||
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLButtonElement ||
        event.target instanceof HTMLSelectElement);

    const handleSpaceKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat || isTextEntryTarget(event)) return;
      event.preventDefault();
      spacePanRef.current = true;
    };
    const handleSpaceKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      spacePanRef.current = false;
    };
    const resetSpacePan = () => {
      spacePanRef.current = false;
    };

    window.addEventListener("keydown", handleSpaceKeyDown);
    window.addEventListener("keyup", handleSpaceKeyUp);
    window.addEventListener("blur", resetSpacePan);
    return () => {
      window.removeEventListener("keydown", handleSpaceKeyDown);
      window.removeEventListener("keyup", handleSpaceKeyUp);
      window.removeEventListener("blur", resetSpacePan);
      spacePanRef.current = false;
    };
  }, []);

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
      // 按住空格或鼠标中键：拖拽平移画布（素材之上同样生效），不改变当前选区。
      // 该分支必须先于 [data-creative-item] 拦截判断，否则素材铺满画布时无法平移。
      if (spacePanRef.current || event.button === 1) {
        event.preventDefault();
        dragStateRef.current = {
          type: "pan",
          startClientX: event.clientX,
          startClientY: event.clientY,
          startViewport: canvas.viewport,
        };
        document.body.style.cursor = "grabbing";
        return;
      }

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
        {snapGuides.map((guide, index) => (
          <div
            key={`guide-${index}`}
            className="pointer-events-none absolute bg-error/70"
            style={
              guide.orientation === "vertical"
                ? { left: guide.at - 0.5, top: -100000, width: 1, height: 200000 }
                : { top: guide.at - 0.5, left: -100000, height: 1, width: 200000 }
            }
          />
        ))}
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
        {renderItems.map((item) => {
            const asset = assetById.get(item.assetId);
            if (!asset) return null;
            return (
              <CreativeCanvasItemView
                key={item.id}
                item={item}
                asset={asset}
                selected={selectedItemIds.includes(item.id)}
                viewport={canvas.viewport}
                batchTotal={
                  item.isBatchRoot ? 1 + (item.batchChildIds?.length ?? 0) : undefined
                }
                batchExpanded={item.batchExpanded}
                onToggleBatch={() => setBatchExpanded(item.id, !item.batchExpanded)}
                onSelect={() => selectItems([item.id])}
                onMoveStart={(event) => {
                  // 空格/中键平移优先：不拦截事件，让其冒泡到画布容器进入平移分支
                  if (spacePanRef.current || event.button === 1) return;
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
                  // 空格/中键平移优先：不拦截事件，让其冒泡到画布容器进入平移分支
                  if (spacePanRef.current || event.button === 1) return;
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
      {canvas.items.length > 0 && <CreativeCanvasMinimap containerRef={containerRef} />}
    </div>
  );
}

function CreativeCanvasItemView({
  item,
  asset,
  selected,
  viewport,
  batchTotal,
  batchExpanded,
  onToggleBatch,
  onSelect,
  onMoveStart,
  onResizeStart,
}: {
  item: CreativeCanvasItem;
  asset: CreativeAsset;
  selected: boolean;
  viewport: CreativeViewport;
  // 批量栈主图的图组总数（含主图自身）；非主图为 undefined
  batchTotal?: number;
  batchExpanded?: boolean;
  onToggleBatch?: () => void;
  onSelect: () => void;
  onMoveStart: (event: React.PointerEvent<HTMLDivElement>) => void;
  onResizeStart: (event: React.PointerEvent<HTMLElement>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const updateAsset = useCreativeStore((state) => state.updateAsset);
  const assets = useCreativeStore((state) => state.assets);
  const previewUrl = getCreativeAssetPreviewUrl(asset);
  const mediaKind: MediaKind = asset.kind === "text" ? "image" : asset.kind;
  const media = useResilientMedia(previewUrl, mediaKind);

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
        // 批量栈主图：双击在展开/收起之间切换（折叠 ⇄ 网格）
        if (batchTotal != null && batchTotal > 1) {
          onToggleBatch?.();
          return;
        }
        if (asset.kind === "text") setEditing(true);
      }}
    >
      <div className="absolute left-2 top-2 z-10 rounded-md bg-black/45 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur">
        {item.title}
      </div>
      <div className="absolute right-2 top-2 z-10 flex flex-col items-end gap-1">
        {item.locked && (
          <div className="rounded-md bg-black/45 p-1 text-white backdrop-blur">
            <Lock className="h-3 w-3" />
          </div>
        )}
        {batchTotal != null && batchTotal > 1 && onToggleBatch && (
          <button
            type="button"
            className="flex items-center gap-1 rounded-md bg-black/45 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur transition-colors hover:bg-black/65"
            title={batchExpanded ? "收起图组" : `展开图组（${batchTotal} 张）`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onToggleBatch();
            }}
          >
            <Images className="h-3 w-3" />
            {batchTotal}
          </button>
        )}
      </div>

      <div className="h-full w-full overflow-hidden rounded-md">
        {asset.kind === "text" && (
          editing ? (
            <AssetMentionTextarea
              autoFocus
              assets={assets}
              className="h-full w-full resize-none bg-base-100 p-4 pt-9 text-sm outline-none"
              value={asset.text || ""}
              onChange={(text) => updateAsset(asset.id, { text })}
              onBlur={() => setEditing(false)}
              onPointerDown={(event) => event.stopPropagation()}
              onEscape={() => setEditing(false)}
            />
          ) : (
            <div className="h-full w-full overflow-auto whitespace-pre-wrap break-words p-4 pt-9 text-sm text-base-content">
              {asset.text || "双击编辑文本"}
            </div>
          )
        )}
        {asset.kind === "image" && (
          previewUrl && !media.failed ? (
            <img
              key={media.stage}
              src={media.src}
              crossOrigin={media.crossOrigin}
              alt={asset.title}
              className="h-full w-full object-contain"
              draggable={false}
              onError={media.onMediaError}
            />
          ) : (
            <EmptyAsset
              icon={<Image className="h-7 w-7" />}
              label={previewUrl ? "图片加载失败" : "图片缺失"}
            />
          )
        )}
        {asset.kind === "video" && (
          previewUrl && !media.failed ? (
            <video
              key={media.stage}
              src={media.src}
              crossOrigin={media.crossOrigin}
              className="h-full w-full bg-black object-contain"
              controls
              data-canvas-no-zoom
              onError={media.onMediaError}
              onCanPlay={media.onMediaReady}
            />
          ) : (
            <EmptyAsset
              icon={<FileVideo className="h-7 w-7" />}
              label={previewUrl ? "视频加载失败" : "视频缺失"}
            />
          )
        )}
        {asset.kind === "audio" && (
          <div className="flex h-full w-full flex-col justify-center gap-3 bg-base-100 px-4 pt-6">
            <div className="flex items-center gap-2 text-sm text-base-content/70">
              <FileAudio className="h-4 w-4" />
              <span className="truncate">{asset.title}</span>
            </div>
            {previewUrl && !media.failed ? (
              <audio
                key={media.stage}
                src={media.src}
                crossOrigin={media.crossOrigin}
                controls
                className="w-full"
                onError={media.onMediaError}
                onCanPlay={media.onMediaReady}
              />
            ) : (
              <div className="text-xs text-base-content/40">
                {previewUrl ? "音频加载失败" : "音频缺失"}
              </div>
            )}
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
