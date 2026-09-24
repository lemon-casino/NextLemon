/**
 * 创作素材图片详情弹窗（带编辑工具条）
 *
 * 工具条能力：裁剪（框选）/ 旋转 / 九宫格拆分 / 尺寸·格式导出 / 放大 / 反推词 / 局部重绘（mask 画笔）。
 * - 纯前端编辑走 imageEditService 的 canvas 实现；放大走 img2img 通道；反推词走 llmService 视觉输入；
 *   局部重绘走 ocrInpaintService 通用入口。
 * - 每个操作的产出都会作为新素材写入素材库（Tauri 环境同时落盘 media 文件），可选放入创作画布。
 * - 所有操作失败均 toast 明确错误，不静默。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Brush,
  Check,
  Copy,
  Crop,
  Download,
  Expand,
  Grid3X3,
  ImagePlus,
  Loader2,
  Paintbrush,
  RotateCw,
  Scaling,
  Wand2,
  X,
} from "lucide-react";
import { useCreativeStore } from "@/stores/creativeStore";
import { toast } from "@/stores/toastStore";
import { isTauriEnvironment, saveImage } from "@/services/fileStorageService";
import {
  EXPORT_FORMAT_EXTENSIONS,
  type ExportFormat,
  type ImageEditOutput,
  type LoadedImageSource,
  type NormalizedRect,
  type PixelRect,
  type ResizeSpec,
  buildExportFileName,
  computeCropRect,
  cropImage,
  inpaintImageRegion,
  interrogateImagePrompt,
  loadImageFromAssetSource,
  outputFromBase64,
  pickClosestAspectRatio,
  resizeImage,
  rotateImage,
  splitImageIntoGrid,
  toDataUrl,
  upscaleImage,
} from "@/services/imageEditService";
import { CREATIVE_ASSET_KIND_LABELS } from "@/services/creativeAssetService";
import { DEFAULT_INPAINT_API_URL } from "@/services/ocrInpaintService";
import type { CreativeAsset } from "@/types/creative";

type EditTool = "view" | "crop" | "inpaint";

interface StrokePoint {
  x: number;
  y: number;
}

/** 局部重绘 IOPaint 地址的 localStorage 记忆键（PPT 节点地址在 flowStore 节点数据内，无法跨包复用） */
const INPAINT_API_URL_STORAGE_KEY = "nextlemon.imageEdit.inpaintApiUrl";

function readPersistedInpaintApiUrl(): string {
  try {
    return localStorage.getItem(INPAINT_API_URL_STORAGE_KEY) || DEFAULT_INPAINT_API_URL;
  } catch {
    return DEFAULT_INPAINT_API_URL;
  }
}

function persistInpaintApiUrl(value: string) {
  try {
    localStorage.setItem(INPAINT_API_URL_STORAGE_KEY, value);
  } catch {
    // localStorage 不可用时静默忽略：地址输入框仍可在本次会话内生效
  }
}

interface ImageDetailModalProps {
  asset: CreativeAsset;
  onClose: () => void;
  /** 可选外部落画布回调（整批 assetIds 交给外部布局）；缺省时逐个放入创作画布 */
  onPlaceAssets?: (assetIds: string[]) => void;
}

export function ImageDetailModal({ asset, onClose, onPlaceAssets }: ImageDetailModalProps) {
  const [source, setSource] = useState<LoadedImageSource | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tool, setTool] = useState<EditTool>("view");
  const [busy, setBusy] = useState<string | null>(null);
  const [placeToCanvas, setPlaceToCanvas] = useState(true);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("image/png");
  const [resizeWidth, setResizeWidth] = useState<string>("");
  const [cropRect, setCropRect] = useState<NormalizedRect | null>(null);
  const [hasMask, setHasMask] = useState(false);
  const [brushSize, setBrushSize] = useState(48);
  const [inpaintPrompt, setInpaintPrompt] = useState("");
  const [inpaintApiUrl, setInpaintApiUrl] = useState<string>(readPersistedInpaintApiUrl);
  const [interrogated, setInterrogated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const previewRef = useRef<HTMLDivElement | null>(null);
  const maskDisplayRef = useRef<HTMLCanvasElement | null>(null);
  const cropDragRef = useRef<{ startX: number; startY: number; active: boolean } | null>(null);
  const strokesRef = useRef<StrokePoint[][]>([]);
  const drawingRef = useRef(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 卸载时清理“已复制”提示的还原计时器
  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  // 加载素材原图（storagePath 优先，回退 dataUrl）
  useEffect(() => {
    let cancelled = false;
    setSource(null);
    setLoadError(null);
    setTool("view");
    setCropRect(null);
    setInterrogated(null);
    setInpaintPrompt("");
    strokesRef.current = [];
    setHasMask(false);

    loadImageFromAssetSource({ dataUrl: asset.dataUrl, storagePath: asset.storagePath })
      .then((loaded) => {
        if (!cancelled) {
          setSource(loaded);
          setResizeWidth(String(loaded.width));
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "图片加载失败");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [asset.id, asset.dataUrl, asset.storagePath]);

  const redrawMaskDisplay = useCallback(() => {
    const canvas = maskDisplayRef.current;
    const container = previewRef.current;
    if (!canvas || !container || !source) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const scale = canvas.width / source.width;
    ctx.lineWidth = Math.max(2, brushSize * scale);

    for (const stroke of strokesRef.current) {
      drawStroke(ctx, stroke, canvas.width, canvas.height, ctx.lineWidth);
    }
  }, [brushSize, source]);

  // 局部重绘模式：蒙版显示画布与预览图对齐（含窗口尺寸变化）
  useEffect(() => {
    if (tool !== "inpaint") return;

    const syncCanvas = () => {
      const canvas = maskDisplayRef.current;
      const container = previewRef.current;
      if (!canvas || !container) return;
      const rect = container.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      canvas.width = rect.width;
      canvas.height = rect.height;
      redrawMaskDisplay();
    };

    syncCanvas();
    window.addEventListener("resize", syncCanvas);
    return () => window.removeEventListener("resize", syncCanvas);
  }, [tool, source, redrawMaskDisplay]);

  useEffect(() => {
    if (tool === "inpaint") redrawMaskDisplay();
  }, [brushSize, tool, redrawMaskDisplay]);

  // ESC：先退出编辑工具，再关闭弹窗
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (tool !== "view") {
        setTool("view");
        setCropRect(null);
      } else {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [tool, onClose]);

  /** 统一操作包装：busy + 失败明确提示（不静默） */
  const runAction = useCallback(async (key: string, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    try {
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[ImageDetailModal] ${key} 失败:`, error);
      toast.error(message);
    } finally {
      setBusy(null);
    }
  }, [busy]);

  /** 产出新素材入素材库，并按勾选落画布 */
  const commitDerived = useCallback(async (outputs: ImageEditOutput[], label: string) => {
    const { addAsset, updateAsset, addAssetToCanvas } = useCreativeStore.getState();
    const createdIds: string[] = [];

    for (let index = 0; index < outputs.length; index += 1) {
      const output = outputs[index];
      const title = outputs.length > 1 ? `${label} ${index + 1}` : label;
      const assetId = addAsset({
        kind: "image",
        title,
        dataUrl: output.dataUrl,
        mimeType: output.mimeType,
        fileName: buildExportFileName(label, output.mimeType),
        width: output.width,
        height: output.height,
        source: "manual",
        tags: ["图片编辑"],
        metadata: { derivedFrom: asset.id, editOperation: label },
      });

      // Tauri 环境落盘到 creative-canvas 目录，避免 dataUrl 常驻 store（与工作区上传逻辑一致）
      if (isTauriEnvironment()) {
        try {
          const imageInfo = await saveImage(
            output.base64,
            "creative-canvas",
            assetId,
            undefined,
            undefined,
            "input"
          );
          updateAsset(assetId, {
            storagePath: imageInfo.path,
            dataUrl: undefined,
            bytes: imageInfo.size,
          });
        } catch (error) {
          console.warn("[ImageDetailModal] 编辑结果落盘失败，保留 dataUrl:", error);
        }
      }
      createdIds.push(assetId);
    }

    if (placeToCanvas) {
      if (onPlaceAssets) {
        onPlaceAssets(createdIds);
      } else {
        createdIds.forEach((id, index) =>
          addAssetToCanvas(id, {
            position: { x: 120 + (index % 3) * 34, y: 120 + Math.floor(index / 3) * 34 },
          })
        );
      }
    }
    return createdIds;
  }, [asset.id, onPlaceAssets, placeToCanvas]);

  // ==================== 工具条操作 ====================

  const handleRotate = () => {
    if (!source) return;
    void runAction("rotate", async () => {
      const output = await rotateImage(source, 90, exportFormat);
      await commitDerived([output], "旋转");
      toast.success("已旋转 90° 并生成新素材");
    });
  };

  const handleGrid = () => {
    if (!source) return;
    void runAction("grid", async () => {
      const outputs = await splitImageIntoGrid(source, 3, 3, exportFormat);
      await commitDerived(outputs, "九宫格");
      toast.success(`已拆分为 ${outputs.length} 个素材`);
    });
  };

  const handleResize = () => {
    if (!source) return;
    void runAction("resize", async () => {
      const width = Number.parseInt(resizeWidth, 10);
      if (!Number.isFinite(width) || width < 1) {
        throw new Error("请输入有效的目标宽度（正整数）");
      }
      const spec: ResizeSpec = { mode: "width", width };
      const output = await resizeImage(source, spec, exportFormat);
      await commitDerived([output], "调整尺寸");
      toast.success(`已调整为 ${output.width}×${output.height} (${EXPORT_FORMAT_EXTENSIONS[exportFormat].toUpperCase()})`);
    });
  };

  const handleCropConfirm = () => {
    if (!source || !cropRect) return;
    void runAction("crop", async () => {
      const rect: PixelRect = computeCropRect(source.width, source.height, cropRect);
      const output = await cropImage(source, rect, exportFormat);
      await commitDerived([output], "裁剪");
      toast.success(`已裁剪 ${output.width}×${output.height} 并生成新素材`);
      setTool("view");
      setCropRect(null);
    });
  };

  const handleUpscale = () => {
    if (!source) return;
    void runAction("upscale", async () => {
      const result = await upscaleImage({
        imageBase64: source.base64,
        options: {
          aspectRatio: pickClosestAspectRatio(source.width, source.height),
          imageSize: "2K",
          promptHint: interrogated?.trim() || undefined,
        },
      });
      if (result.error || !result.imageData) {
        throw new Error(result.error || "放大失败：生成服务未返回图片");
      }
      const output = await outputFromBase64(result.imageData);
      await commitDerived([output], "放大");
      toast.success(`放大完成（${output.width}×${output.height}）`);
    });
  };

  const handleInterrogate = () => {
    if (!source) return;
    void runAction("interrogate", async () => {
      const result = await interrogateImagePrompt({
        imageBase64: source.base64,
        mimeType: source.mimeType,
      });
      if (result.error || !result.prompt) {
        throw new Error(result.error || "反推提示词失败：模型未返回内容");
      }
      setInterrogated(result.prompt);
      toast.success("已生成图片提示词");
    });
  };

  const handleInpaint = () => {
    if (!source) return;
    void runAction("inpaint", async () => {
      const prompt = inpaintPrompt.trim();
      if (!prompt) {
        throw new Error("请输入重绘内容提示词");
      }
      if (!hasMask || strokesRef.current.length === 0) {
        throw new Error("请先用画笔涂抹需要重绘的区域");
      }
      const maskBase64 = buildMaskBase64(source.width, source.height, brushSize, strokesRef.current);
      const result = await inpaintImageRegion({
        imageData: source.base64,
        maskData: maskBase64,
        prompt,
        inpaintApiUrl: inpaintApiUrl.trim() || undefined,
      });
      if (result.error || !result.image) {
        throw new Error(result.error || "局部重绘失败");
      }
      const output = await outputFromBase64(result.image);
      await commitDerived([output], "局部重绘");
      toast.success("局部重绘完成");
    });
  };

  const handleDownload = () => {
    if (!source) return;
    void runAction("download", async () => {
      // 下载保持原图格式：文件名按 source.mimeType 推导扩展名，与导出格式选择器解耦
      const fileName = buildExportFileName(asset.title || "image", source.mimeType);
      if (isTauriEnvironment()) {
        const { save } = await import("@tauri-apps/plugin-dialog");
        const { writeFile } = await import("@tauri-apps/plugin-fs");
        const filePath = await save({
          defaultPath: fileName,
          filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp"] }],
        });
        if (!filePath) return;
        const binary = atob(source.base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        await writeFile(filePath, bytes);
        toast.success(`图片已保存到: ${filePath.split(/[/\\]/).pop()}`);
      } else {
        const link = document.createElement("a");
        link.href = toDataUrl(source.base64, source.mimeType);
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        toast.success("图片下载已开始");
      }
    });
  };

  const handleCopyPrompt = async () => {
    if (!interrogated) return;
    try {
      await navigator.clipboard.writeText(interrogated);
      setCopied(true);
      toast.success("提示词已复制");
      // 重复点击时重置计时器，卸载时由 effect 统一清理
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("复制失败");
    }
  };

  // ==================== 预览区指针交互 ====================

  const normalizedPointer = (event: React.PointerEvent): { x: number; y: number } | null => {
    const container = previewRef.current;
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  };

  const handlePointerDown = (event: React.PointerEvent) => {
    if (!source) return;
    const point = normalizedPointer(event);
    if (!point) return;

    if (tool === "crop") {
      event.preventDefault();
      (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
      cropDragRef.current = { startX: point.x, startY: point.y, active: true };
      setCropRect({ x: point.x, y: point.y, width: 0, height: 0 });
      return;
    }

    if (tool === "inpaint") {
      event.preventDefault();
      (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
      drawingRef.current = true;
      strokesRef.current.push([point]);
      setHasMask(true);
      redrawMaskDisplay();
    }
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    if (!source) return;

    const drag = cropDragRef.current;
    if (tool === "crop" && drag?.active) {
      const point = normalizedPointer(event);
      if (!point) return;
      setCropRect({
        x: Math.min(drag.startX, point.x),
        y: Math.min(drag.startY, point.y),
        width: Math.abs(point.x - drag.startX),
        height: Math.abs(point.y - drag.startY),
      });
      return;
    }

    if (tool === "inpaint" && drawingRef.current) {
      const point = normalizedPointer(event);
      if (!point) return;
      const stroke = strokesRef.current[strokesRef.current.length - 1];
      if (!stroke) return;
      const last = stroke[stroke.length - 1];
      if (last && Math.abs(last.x - point.x) < 0.001 && Math.abs(last.y - point.y) < 0.001) return;
      stroke.push(point);
      redrawMaskDisplay();
    }
  };

  const handlePointerUp = () => {
    if (tool === "crop" && cropDragRef.current?.active) {
      cropDragRef.current.active = false;
      setCropRect((rect) => (rect && rect.width > 0.01 && rect.height > 0.01 ? rect : null));
    }
    drawingRef.current = false;
  };

  const busyButton = (key: string) => busy === key;
  const anyBusy = Boolean(busy);

  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={() => {
        if (tool === "view") onClose();
      }}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-base-300 bg-base-100 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        {/* 标题 + 编辑工具条 */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-base-300 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate font-semibold">{asset.title}</div>
            <div className="text-xs text-base-content/50">
              {CREATIVE_ASSET_KIND_LABELS.image}
              {source ? ` · ${source.width}×${source.height}` : ""}
              {exportFormat !== "image/png" ? ` · 导出 ${EXPORT_FORMAT_EXTENSIONS[exportFormat].toUpperCase()}` : ""}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1" role="toolbar" aria-label="图片编辑工具条">
            <ToolButton
              title="裁剪（在图上拖拽框选）"
              icon={<Crop className="h-4 w-4" />}
              active={tool === "crop"}
              disabled={anyBusy || !source}
              onClick={() => {
                setTool((current) => (current === "crop" ? "view" : "crop"));
                setCropRect(null);
              }}
            />
            <ToolButton
              title="旋转 90°"
              icon={busyButton("rotate") ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
              disabled={anyBusy || !source}
              onClick={handleRotate}
            />
            <ToolButton
              title="九宫格拆分（3×3 切片）"
              icon={busyButton("grid") ? <Loader2 className="h-4 w-4 animate-spin" /> : <Grid3X3 className="h-4 w-4" />}
              disabled={anyBusy || !source}
              onClick={handleGrid}
            />
            <ToolButton
              title="放大（AI 高清重绘，走 img2img）"
              icon={busyButton("upscale") ? <Loader2 className="h-4 w-4 animate-spin" /> : <Expand className="h-4 w-4" />}
              disabled={anyBusy || !source}
              onClick={handleUpscale}
            />
            <ToolButton
              title="反推提示词（视觉理解）"
              icon={busyButton("interrogate") ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
              disabled={anyBusy || !source}
              onClick={handleInterrogate}
            />
            <ToolButton
              title="局部重绘（画笔涂抹蒙版）"
              icon={<Paintbrush className="h-4 w-4" />}
              active={tool === "inpaint"}
              disabled={anyBusy || !source}
              onClick={() => {
                setTool((current) => (current === "inpaint" ? "view" : "inpaint"));
                setCropRect(null);
              }}
            />

            <div className="mx-1 h-6 w-px bg-base-300" />

            <label className="flex items-center gap-1 text-xs text-base-content/60" title="编辑产出格式（裁剪/旋转/九宫格/尺寸导出共用；下载保持原图格式）">
              <Scaling className="h-3.5 w-3.5" />
              <select
                className="select select-xs bg-transparent focus:outline-none"
                value={exportFormat}
                onChange={(event) => setExportFormat(event.target.value as ExportFormat)}
                disabled={anyBusy}
              >
                <option value="image/png">PNG</option>
                <option value="image/jpeg">JPG</option>
                <option value="image/webp">WEBP</option>
              </select>
            </label>

            <ToolButton
              title="下载当前图"
              icon={busyButton("download") ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              disabled={anyBusy || !source}
              onClick={handleDownload}
            />
            <ToolButton title="关闭" icon={<X className="h-4 w-4" />} onClick={onClose} />
          </div>
        </div>

        {/* 预览区 */}
        <div className="flex min-h-[320px] items-center justify-center overflow-auto bg-base-300/50 p-4">
          {loadError ? (
            <div className="flex flex-col items-center gap-2 text-base-content/50">
              <X className="h-8 w-8" />
              <span className="text-sm">{loadError}</span>
            </div>
          ) : !source ? (
            <Loader2 className="h-8 w-8 animate-spin text-base-content/40" />
          ) : (
            <div
              ref={previewRef}
              className={`relative inline-block select-none ${tool === "view" ? "" : "cursor-crosshair touch-none"}`}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            >
              <img
                src={source.dataUrl}
                alt={asset.title}
                draggable={false}
                className="block max-h-[56vh] max-w-full"
              />

              {tool === "inpaint" && (
                <canvas
                  ref={maskDisplayRef}
                  className="pointer-events-none absolute inset-0 h-full w-full opacity-70"
                />
              )}

              {tool === "crop" && cropRect && (
                <div
                  className="pointer-events-none absolute border-2 border-primary bg-primary/15"
                  style={{
                    left: `${cropRect.x * 100}%`,
                    top: `${cropRect.y * 100}%`,
                    width: `${cropRect.width * 100}%`,
                    height: `${cropRect.height * 100}%`,
                  }}
                />
              )}
            </div>
          )}
        </div>

        {/* 操作面板 */}
        <div className="border-t border-base-300 px-4 py-3">
          {tool === "crop" && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-base-content/55">
                在图片上按住拖拽框选裁剪区域，确认后导出新素材。
              </span>
              <div className="ml-auto flex items-center gap-2">
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setCropRect(null);
                    setTool("view");
                  }}
                  disabled={anyBusy}
                >
                  取消
                </button>
                <button
                  className="btn btn-primary btn-sm gap-1"
                  onClick={handleCropConfirm}
                  disabled={anyBusy || !cropRect}
                >
                  {busyButton("crop") ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Crop className="h-3.5 w-3.5" />}
                  确认裁剪
                </button>
              </div>
            </div>
          )}

          {tool === "inpaint" && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-xs text-base-content/60">
                  笔刷
                  <input
                    type="range"
                    min={8}
                    max={200}
                    value={brushSize}
                    onChange={(event) => setBrushSize(Number(event.target.value))}
                    className="range range-xs range-primary w-32"
                    disabled={anyBusy}
                  />
                  <span className="w-10 tabular-nums">{brushSize}px</span>
                </label>
                <label className="flex items-center gap-1 text-xs text-base-content/60" title="IOPaint 服务地址（记住本次修改，需与已启动的 IOPaint 服务一致）">
                  IOPaint 地址
                  <input
                    type="text"
                    className="input input-xs input-bordered w-56 font-mono"
                    placeholder={DEFAULT_INPAINT_API_URL}
                    value={inpaintApiUrl}
                    onChange={(event) => {
                      setInpaintApiUrl(event.target.value);
                      persistInpaintApiUrl(event.target.value.trim());
                    }}
                    disabled={anyBusy}
                  />
                </label>
                {interrogated && (
                  <button
                    className="btn btn-ghost btn-xs gap-1"
                    onClick={() => setInpaintPrompt(interrogated)}
                    disabled={anyBusy}
                  >
                    <Wand2 className="h-3 w-3" />
                    用反推词填充
                  </button>
                )}
              </div>
              <textarea
                className="textarea textarea-bordered w-full text-sm"
                placeholder="描述重绘区域内要生成的内容，例如：一束橙色郁金香"
                value={inpaintPrompt}
                onChange={(event) => setInpaintPrompt(event.target.value)}
                disabled={anyBusy}
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    strokesRef.current = [];
                    setHasMask(false);
                    redrawMaskDisplay();
                  }}
                  disabled={anyBusy}
                >
                  <Brush className="h-3.5 w-3.5" />
                  清除蒙版
                </button>
                <button
                  className="btn btn-primary btn-sm gap-1"
                  onClick={handleInpaint}
                  disabled={anyBusy}
                  title="对涂抹区域执行 AI 局部重绘（需 IOPaint 服务）"
                >
                  {busyButton("inpaint") ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paintbrush className="h-3.5 w-3.5" />}
                  执行重绘
                </button>
              </div>
            </div>
          )}

          {tool === "view" && (
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1 text-xs text-base-content/60" title="调整宽度，高度等比缩放">
                宽度
                <input
                  type="number"
                  min={1}
                  className="input input-xs input-bordered w-24"
                  value={resizeWidth}
                  onChange={(event) => setResizeWidth(event.target.value)}
                  disabled={anyBusy || !source}
                />
                px
              </label>
              <button
                className="btn btn-ghost btn-xs"
                onClick={handleResize}
                disabled={anyBusy || !source}
              >
                {busyButton("resize") ? <Loader2 className="h-3 w-3 animate-spin" /> : <Scaling className="h-3 w-3" />}
                按宽度导出
              </button>

              {interrogated && (
                <div className="ml-auto flex min-w-0 items-center gap-2">
                  <span className="max-w-[320px] truncate rounded bg-base-200 px-2 py-1 text-xs text-base-content/70" title={interrogated}>
                    {interrogated}
                  </span>
                  <button className="btn btn-ghost btn-xs gap-1" onClick={() => void handleCopyPrompt()}>
                    {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    {copied ? "已复制" : "复制"}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* 产出方式：入素材库恒定，落画布可选 */}
          <label className="mt-2 flex items-center gap-2 text-xs text-base-content/55">
            <input
              type="checkbox"
              className="checkbox checkbox-xs"
              checked={placeToCanvas}
              onChange={(event) => setPlaceToCanvas(event.target.checked)}
              disabled={anyBusy}
            />
            <ImagePlus className="h-3.5 w-3.5" />
            编辑产出自动放入素材库{placeToCanvas ? "，并同时落入创作画布" : "（不落画布）"}
          </label>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ==================== 局部组件与画布工具 ====================

function ToolButton({
  title,
  icon,
  active,
  disabled,
  onClick,
}: {
  title: string;
  icon: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={`btn btn-circle btn-sm ${active ? "btn-primary" : "btn-ghost"}`}
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}

/** 在画布上绘制一条笔画（坐标已按目标画布尺寸缩放） */
function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: StrokePoint[],
  width: number,
  height: number,
  lineWidth: number
) {
  if (stroke.length === 0) return;
  ctx.lineWidth = lineWidth;

  if (stroke.length === 1) {
    // 单点：画圆点，半径与线宽一致
    ctx.beginPath();
    ctx.arc(stroke[0].x * width, stroke[0].y * height, lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  ctx.beginPath();
  stroke.forEach((point, index) => {
    const x = point.x * width;
    const y = point.y * height;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

/** 按原图尺寸重建蒙版：黑底 = 保留，白色笔画 = 重绘区域（IOPaint 约定） */
function buildMaskBase64(
  naturalWidth: number,
  naturalHeight: number,
  brushSize: number,
  strokes: StrokePoint[][]
): string {
  const canvas = document.createElement("canvas");
  canvas.width = naturalWidth;
  canvas.height = naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("无法创建蒙版画布上下文");
  }

  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, naturalWidth, naturalHeight);
  ctx.strokeStyle = "#ffffff";
  ctx.fillStyle = "#ffffff";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const stroke of strokes) {
    drawStroke(ctx, stroke, naturalWidth, naturalHeight, brushSize);
  }

  const dataUrl = canvas.toDataURL("image/png");
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  if (!base64) {
    throw new Error("蒙版导出失败");
  }
  return base64;
}
