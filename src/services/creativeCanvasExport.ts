import { formatFileSize, isTauriEnvironment, readImage } from "@/services/fileStorageService";
import {
  computeCreativeCanvasExportBounds,
  type CreativeCanvasRect,
} from "@/services/creativeCanvasGeometry";
import { getCreativeAssetPreviewUrl } from "@/services/creativeAssetService";
import { useCreativeStore } from "@/stores/creativeStore";
import type { CreativeAsset, CreativeCanvasItem } from "@/types/creative";

export type CreativeCanvasImageFormat = "png" | "jpeg";

const MAX_EXPORT_DIMENSION = 4096;

export interface CreativeCanvasExportResult {
  fileName: string;
  bytes: number;
  itemCount: number;
}

// 创作画布导出为图片：按导出边界在离屏 canvas 重绘（图片读原始字节避免跨域污染画布，
// 文本绘制换行段落，视频/音频绘制占位卡片），再编码为 PNG/JPEG 下载。
export async function exportCreativeCanvasImage(
  format: CreativeCanvasImageFormat
): Promise<CreativeCanvasExportResult> {
  const { canvas, assets } = useCreativeStore.getState();
  const bounds = computeCreativeCanvasExportBounds(canvas.items);
  if (!bounds) {
    throw new Error("画布上没有可导出的素材");
  }

  const scale = Math.min(1, MAX_EXPORT_DIMENSION / Math.max(bounds.width, bounds.height));
  const image = await renderCreativeCanvas(canvas.items, assets, bounds, format, scale);
  const dataUrl = image.toDataURL(format === "png" ? "image/png" : "image/jpeg", 0.92);
  const bytes = Math.floor((dataUrl.length - dataUrl.indexOf(",") - 1) * 0.75);
  const fileName = `nextlemon-creative-canvas-${Date.now()}.${format === "png" ? "png" : "jpg"}`;

  await saveDataUrl(dataUrl, fileName);
  return {
    fileName,
    bytes,
    itemCount: canvas.items.filter((item) => !item.hidden).length,
  };
}

async function renderCreativeCanvas(
  items: CreativeCanvasItem[],
  assets: CreativeAsset[],
  bounds: CreativeCanvasRect,
  format: CreativeCanvasImageFormat,
  scale: number
): Promise<HTMLCanvasElement> {
  const canvasEl = document.createElement("canvas");
  canvasEl.width = Math.max(1, Math.round(bounds.width * scale));
  canvasEl.height = Math.max(1, Math.round(bounds.height * scale));
  const ctx = canvasEl.getContext("2d");
  if (!ctx) throw new Error("无法创建画布上下文");

  if (format === "jpeg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);
  }

  ctx.scale(scale, scale);
  ctx.translate(-bounds.x, -bounds.y);

  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const ordered = [...items].filter((item) => !item.hidden).sort((a, b) => a.zIndex - b.zIndex);

  for (const item of ordered) {
    const asset = assetById.get(item.assetId);
    ctx.save();
    ctx.translate(item.position.x, item.position.y);
    drawItemCard(ctx, item);

    if (asset?.kind === "image" && asset) {
      const src = await loadImageSource(asset);
      if (src) {
        ctx.drawImage(src, 0, 0, item.width, item.height);
      } else {
        drawPlaceholder(ctx, item, "图片缺失");
      }
    } else if (asset?.kind === "text" && asset) {
      drawText(ctx, item, asset.text || "");
    } else {
      drawPlaceholder(ctx, item, asset?.kind === "video" ? "视频" : asset?.kind === "audio" ? "音频" : "素材缺失");
    }
    ctx.restore();
  }

  return canvasEl;
}

function drawItemCard(ctx: CanvasRenderingContext2D, item: CreativeCanvasItem) {
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#d1d5db";
  ctx.lineWidth = 2;
  roundRect(ctx, 0, 0, item.width, item.height, 8);
  ctx.fill();
  ctx.stroke();
}

function drawPlaceholder(ctx: CanvasRenderingContext2D, item: CreativeCanvasItem, label: string) {
  ctx.fillStyle = "#f3f4f6";
  ctx.fillRect(4, 4, item.width - 8, item.height - 8);
  ctx.fillStyle = "#9ca3af";
  ctx.font = "14px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, item.width / 2, item.height / 2);
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
}

function drawText(ctx: CanvasRenderingContext2D, item: CreativeCanvasItem, text: string) {
  ctx.fillStyle = "#1f2937";
  ctx.font = "14px sans-serif";
  const lineHeight = 20;
  const padding = 12;
  const maxWidth = item.width - padding * 2;
  let y = padding + lineHeight;

  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const char of paragraph) {
      if (ctx.measureText(line + char).width > maxWidth) {
        ctx.fillText(line, padding, y);
        y += lineHeight;
        line = char;
      } else {
        line += char;
      }
    }
    ctx.fillText(line, padding, y);
    y += lineHeight;
  }
}

async function loadImageSource(asset: CreativeAsset): Promise<HTMLImageElement | null> {
  let src = getCreativeAssetPreviewUrl(asset);
  // Tauri 下 storagePath 走 asset 协议会污染画布（跨域），改为读原始字节转 dataUrl
  if (asset.storagePath && isTauriEnvironment()) {
    try {
      const base64 = await readImage(asset.storagePath);
      src = `data:${asset.mimeType || "image/png"};base64,${base64}`;
    } catch (error) {
      console.warn("[creativeCanvasExport] 读取图片文件失败:", error);
      return null;
    }
  }
  if (!src) return null;

  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

async function saveDataUrl(dataUrl: string, fileName: string) {
  if (isTauriEnvironment()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    const extension = dataUrl.startsWith("data:image/jpeg") ? "jpg" : "png";
    const filePath = await save({
      defaultPath: fileName,
      filters: [{ name: "Image", extensions: [extension] }],
    });
    if (!filePath) return;
    await writeFile(filePath, dataUrlToBytes(dataUrl));
    return;
  }

  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function formatExportSize(bytes: number): string {
  return formatFileSize(bytes);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}
