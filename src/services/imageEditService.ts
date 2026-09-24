/**
 * 图片编辑工具链服务
 *
 * 两层结构：
 * 1. 纯函数层：裁剪框/旋转/网格切片/尺寸计算/格式与编码工具，无 DOM 依赖，可独立单测；
 * 2. 执行层：canvas 绘制导出（裁剪、旋转、九宫格拆分、尺寸/格式导出）+ AI 能力编排
 *    - 放大：走既有图片生成服务 img2img 通道（imageService.editImage）
 *    - 反推提示词：走既有 llmService 视觉输入（generateText + files）
 *    - 局部重绘：转发 ocrInpaintService 的通用 inpaintRegion 入口（mask + prompt）
 */

import { invoke } from "@tauri-apps/api/core";
import { isTauriEnvironment, readImage } from "@/services/fileStorageService";
import { editImage } from "@/services/imageService";
import { generateText } from "@/services/llmService";
import { inpaintRegion, type InpaintRegionParams } from "@/services/ocrInpaintService";

// ==================== 常量与类型 ====================

/** 默认图片编辑/生成模型（与 PPT 图片管线一致） */
export const DEFAULT_IMAGE_EDIT_MODEL = "gemini-3-pro-image-preview";
/** 默认反推提示词的视觉理解模型（与 PPT 大纲管线一致） */
export const DEFAULT_INTERROGATE_MODEL = "gemini-3-pro-preview";

/** 单边导出上限：超过该尺寸的 canvas 导出容易超过移动/桌面显存限制 */
export const MAX_EXPORT_EDGE = 8192;

/** 支持的导出格式 */
export type ExportFormat = "image/png" | "image/jpeg" | "image/webp";

export const EXPORT_FORMAT_EXTENSIONS: Record<ExportFormat, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** 生成服务支持的宽高比（与 ImageGenerationParams.aspectRatio 一致） */
export const SUPPORTED_ASPECT_RATIOS = [
  "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9",
] as const;
export type SupportedAspectRatio = (typeof SUPPORTED_ASPECT_RATIOS)[number];

/** 像素矩形（组件与纯函数间的统一坐标单位） */
export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 归一化矩形（0~1，拖拽方向无关），由 UI 层框选产生 */
export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 尺寸调整规格 */
export type ResizeSpec =
  | { mode: "width"; width: number }
  | { mode: "height"; height: number }
  | { mode: "scale"; scale: number }
  | { mode: "stretch"; width: number; height: number };

/** canvas 导出的统一产物 */
export interface ImageEditOutput {
  /** 纯 base64（不含 data: 前缀），可直接交给 saveImage / 生图服务 */
  base64: string;
  dataUrl: string;
  mimeType: ExportFormat;
  width: number;
  height: number;
}

/** 统一加载后的图片源 */
export interface LoadedImageSource {
  base64: string;
  dataUrl: string;
  mimeType: string;
  width: number;
  height: number;
}

// ==================== 纯函数：几何与格式计算 ====================

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * 归一化裁剪框 → 像素矩形。
 * 拖拽方向无关（负宽高自动归一），越界部分 clamp 到图像边界，最小 1px。
 */
export function computeCropRect(
  sourceWidth: number,
  sourceHeight: number,
  normalized: NormalizedRect
): PixelRect {
  const nx = normalized.width < 0 ? normalized.x + normalized.width : normalized.x;
  const ny = normalized.height < 0 ? normalized.y + normalized.height : normalized.y;
  const nw = Math.abs(normalized.width);
  const nh = Math.abs(normalized.height);

  const left = clamp(nx, 0, 1);
  const top = clamp(ny, 0, 1);
  const right = clamp(nx + nw, 0, 1);
  const bottom = clamp(ny + nh, 0, 1);

  // x/y 先 clamp 到图内，再以“剩余可用像素”封顶宽高，保证 x+width ≤ sourceWidth（避免 off-by-one 越界）
  const x = clamp(Math.round(left * sourceWidth), 0, Math.max(0, sourceWidth - 1));
  const y = clamp(Math.round(top * sourceHeight), 0, Math.max(0, sourceHeight - 1));
  const width = clamp(Math.round((right - left) * sourceWidth), 1, sourceWidth - x);
  const height = clamp(Math.round((bottom - top) * sourceHeight), 1, sourceHeight - y);

  return { x, y, width, height };
}

/** 任意角度按 90° 步进取整并归一到 0/90/180/270（非直角倍数就近取整） */
export function normalizeRotationAngle(angle: number): 0 | 90 | 180 | 270 {
  const stepped = Math.round(angle / 90) * 90;
  const mod = ((stepped % 360) + 360) % 360;
  return mod as 0 | 90 | 180 | 270;
}

/** 旋转后的画布尺寸：90°/270° 交换宽高，0°/180° 保持不变 */
export function computeRotatedSize(
  width: number,
  height: number,
  angle: number
): { width: number; height: number } {
  const normalized = normalizeRotationAngle(angle);
  const swap = normalized === 90 || normalized === 270;
  return swap ? { width: height, height: width } : { width, height };
}

/** 均分 total 为 parts 段的整数边界（parts+1 个边界值，余数归最后一段） */
function splitEvenly(total: number, parts: number): number[] {
  const base = Math.floor(total / parts);
  const edges: number[] = [];
  for (let i = 0; i < parts; i += 1) edges.push(i * base);
  edges.push(total);
  return edges;
}

/**
 * 网格切片坐标（九宫格即 rows=cols=3）。
 * 返回按行优先排列的 rows*cols 个源矩形；坐标为整数且无缝隙/重叠，余数像素归最后一行/列。
 */
export function computeGridSlices(
  width: number,
  height: number,
  rows: number,
  cols: number
): PixelRect[] {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new Error("图片尺寸无效，无法切片");
  }
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1) {
    throw new Error("切片行列数必须为不小于 1 的整数");
  }

  const xEdges = splitEvenly(width, cols);
  const yEdges = splitEvenly(height, rows);

  const slices: PixelRect[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      slices.push({
        x: xEdges[c],
        y: yEdges[r],
        width: xEdges[c + 1] - xEdges[c],
        height: yEdges[r + 1] - yEdges[r],
      });
    }
  }
  return slices;
}

/**
 * 尺寸调整计算。
 * width/height 模式等比缩放（另一边按比例取整），scale 按倍率，stretch 自由拉伸；
 * 结果 clamp 到 [1, MAX_EXPORT_EDGE]。
 */
export function computeResizedSize(
  sourceWidth: number,
  sourceHeight: number,
  spec: ResizeSpec
): { width: number; height: number } {
  if (sourceWidth < 1 || sourceHeight < 1) {
    throw new Error("图片尺寸无效，无法调整大小");
  }

  let width: number;
  let height: number;

  switch (spec.mode) {
    case "width":
      width = spec.width;
      height = (spec.width / sourceWidth) * sourceHeight;
      break;
    case "height":
      height = spec.height;
      width = (spec.height / sourceHeight) * sourceWidth;
      break;
    case "scale":
      width = sourceWidth * spec.scale;
      height = sourceHeight * spec.scale;
      break;
    case "stretch":
      width = spec.width;
      height = spec.height;
      break;
  }

  return {
    width: clamp(Math.round(width), 1, MAX_EXPORT_EDGE),
    height: clamp(Math.round(height), 1, MAX_EXPORT_EDGE),
  };
}

/** 从宽高比数值中挑最接近的支持比例（对数距离，横竖对称） */
export function pickClosestAspectRatio(width: number, height: number): SupportedAspectRatio {
  const ratio = width / height;
  let best: SupportedAspectRatio = "1:1";
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of SUPPORTED_ASPECT_RATIOS) {
    const [cw, ch] = candidate.split(":").map(Number);
    const distance = Math.abs(Math.log(ratio) - Math.log(cw / ch));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

const DATA_URL_PATTERN = /^data:([^;,]*)(;base64)?,([\s\S]*)$/;

/** 解析 data URL；非 base64 载荷或格式非法返回 null */
export function parseDataUrl(dataUrl: string): { mimeType: string; base64: string } | null {
  const match = DATA_URL_PATTERN.exec((dataUrl || "").trim());
  if (!match || !match[3]) return null;
  if (!match[2]) return null;
  return { mimeType: match[1] || "application/octet-stream", base64: match[3] };
}

/** 组装 data URL（默认 PNG） */
export function toDataUrl(base64: string, mimeType: string = "image/png"): string {
  return `data:${mimeType};base64,${base64}`;
}

/** 按扩展名/URL 猜测图片 MIME，无法识别时回退 PNG */
export function guessImageMimeType(source: string): string {
  const path = (source || "").split(/[?#]/)[0];
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  switch (extension) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "bmp":
      return "image/bmp";
    default:
      return "image/png";
  }
}

/** base64 → 字节（分块解析，避免超长字符串单次 charCodeAt 压力） */
export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** 字节 → base64（分块拼接，避免 String.fromCharCode 展开超长参数列表） */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** 依据 MIME 反查导出扩展名：优先导出格式表，未知类型取子类型，最终回退 png */
export function extensionForMimeType(mimeType: string): string {
  const known = EXPORT_FORMAT_EXTENSIONS[mimeType as ExportFormat];
  if (known) return known;
  return mimeType.split("/")[1]?.toLowerCase() || "png";
}

/** 依据导出格式/MIME 拼文件名：`裁剪-1730000000000.png` */
export function buildExportFileName(base: string, mimeType: ExportFormat | string): string {
  const safeBase = (base || "image").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80);
  return `${safeBase}-${Date.now()}.${extensionForMimeType(mimeType)}`;
}

/** 把生图服务返回的纯 base64 包装为统一导出产物（读取自然尺寸） */
export async function outputFromBase64(
  base64: string,
  mimeType: ExportFormat = "image/png"
): Promise<ImageEditOutput> {
  const dataUrl = toDataUrl(base64, mimeType);
  const image = await loadImageElement(dataUrl);
  return {
    base64,
    dataUrl,
    mimeType,
    width: image.naturalWidth,
    height: image.naturalHeight,
  };
}

// ==================== 执行层：图片输入归一化 ====================

/** 远程图片下载并转 base64（blob 读取，规避 canvas 跨域污染） */
async function fetchImageAsBase64(url: string): Promise<{ base64: string; mimeType: string }> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(`图片下载失败（${url}）: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) {
    throw new Error(`图片下载失败 (${response.status}): ${url}`);
  }
  const blob = await response.blob();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return {
    base64: uint8ArrayToBase64(bytes),
    mimeType: blob.type || guessImageMimeType(url),
  };
}

/**
 * 任意图片输入 → 统一 base64 + MIME。
 * 支持 data URL、http(s) URL、本地路径（仅 Tauri）。
 */
export async function resolveImageInput(input: string): Promise<{ base64: string; mimeType: string }> {
  const trimmed = (input || "").trim();
  if (!trimmed) {
    throw new Error("图片输入为空");
  }

  if (trimmed.startsWith("data:")) {
    const parsed = parseDataUrl(trimmed);
    if (!parsed) {
      throw new Error("无法解析 data URL 图片数据");
    }
    return parsed;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return fetchImageAsBase64(trimmed);
  }

  // 本地路径：优先走既有 read_image 命令
  if (!isTauriEnvironment()) {
    throw new Error("本地文件仅在桌面端（Tauri）环境中可读取");
  }

  try {
    const base64 = await readImage(trimmed);
    return { base64, mimeType: guessImageMimeType(trimmed) };
  } catch (primaryError) {
    const primaryMessage = primaryError instanceof Error ? primaryError.message : String(primaryError);
    // 回退跨包契约：Rust 包提供 read_media_file（限定 media 目录白名单内）。
    // 若该命令缺失或白名单拒绝，错误信息合并两个原因，避免排障方向被误导。
    try {
      const result = await invoke<{ base64: string }>("read_media_file", { path: trimmed });
      if (!result?.base64) {
        throw new Error("read_media_file 未返回数据");
      }
      return { base64: result.base64, mimeType: guessImageMimeType(trimmed) };
    } catch (fallbackError) {
      const fallbackMessage =
        fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      throw new Error(
        `读取本地图片失败: ${primaryMessage}；read_media_file 回退也失败: ${fallbackMessage}`
      );
    }
  }
}

/** 加载 HTMLImageElement（供 canvas 绘制） */
export function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片解码失败，文件可能已损坏或格式不受支持"));
    image.src = src;
  });
}

/** 加载任意输入并返回统一图片源（含自然尺寸） */
export async function loadImageFromInput(input: string): Promise<LoadedImageSource> {
  const { base64, mimeType } = await resolveImageInput(input);
  const dataUrl = toDataUrl(base64, mimeType);
  const image = await loadImageElement(dataUrl);
  return {
    base64,
    dataUrl,
    mimeType,
    width: image.naturalWidth,
    height: image.naturalHeight,
  };
}

/** 素材来源加载：storagePath（本地文件）优先，失败回退 dataUrl */
export async function loadImageFromAssetSource(
  source: { dataUrl?: string; storagePath?: string }
): Promise<LoadedImageSource> {
  if (source.storagePath?.trim()) {
    try {
      return await loadImageFromInput(source.storagePath);
    } catch (error) {
      console.warn("[imageEditService] storagePath 读取失败，回退 dataUrl:", error);
    }
  }
  if (source.dataUrl?.trim()) {
    return loadImageFromInput(source.dataUrl);
  }
  throw new Error("素材没有可用的图片数据");
}

// ==================== 执行层：canvas 编辑操作 ====================

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** 导出 canvas → ImageEditOutput；跨域污染/导出失败转为明确错误 */
function exportCanvas(
  canvas: HTMLCanvasElement,
  format: ExportFormat,
  quality?: number
): ImageEditOutput {
  let dataUrl: string;
  try {
    dataUrl = canvas.toDataURL(format, quality);
  } catch (error) {
    throw new Error(
      `图片导出失败（可能受跨域保护）: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) {
    throw new Error("图片导出失败：无法解析画布数据");
  }
  return {
    base64: parsed.base64,
    dataUrl,
    mimeType: format,
    width: canvas.width,
    height: canvas.height,
  };
}

interface DrawImageSource {
  dataUrl: string;
}

function drawSource(
  source: DrawImageSource
): Promise<{ image: HTMLImageElement; width: number; height: number }> {
  return loadImageElement(source.dataUrl).then((image) => ({
    image,
    width: image.naturalWidth,
    height: image.naturalHeight,
  }));
}

/** JPEG 不支持透明，导出前铺白底避免黑块 */
function fillWhiteIfOpaque(canvas: HTMLCanvasElement, format: ExportFormat): void {
  if (format === "image/jpeg") {
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = "source-over";
    }
  }
}

/** 框选裁剪：按像素矩形裁切并导出 */
export async function cropImage(
  source: DrawImageSource,
  rect: PixelRect,
  format: ExportFormat = "image/png",
  quality?: number
): Promise<ImageEditOutput> {
  const { image } = await drawSource(source);
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建画布上下文");
  ctx.drawImage(
    image,
    Math.round(rect.x),
    Math.round(rect.y),
    width,
    height,
    0,
    0,
    width,
    height
  );
  fillWhiteIfOpaque(canvas, format);
  return exportCanvas(canvas, format, quality);
}

/** 旋转：按 90° 步进（非直角倍数就近取整），画布尺寸随之调整 */
export async function rotateImage(
  source: DrawImageSource,
  angle: number,
  format: ExportFormat = "image/png",
  quality?: number
): Promise<ImageEditOutput> {
  const { image, width, height } = await drawSource(source);
  const normalizedAngle = normalizeRotationAngle(angle);
  const size = computeRotatedSize(width, height, normalizedAngle);
  const canvas = createCanvas(size.width, size.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建画布上下文");

  ctx.translate(size.width / 2, size.height / 2);
  ctx.rotate((normalizedAngle * Math.PI) / 180);
  ctx.drawImage(image, -width / 2, -height / 2, width, height);

  fillWhiteIfOpaque(canvas, format);
  return exportCanvas(canvas, format, quality);
}

/** 尺寸/格式导出：等比或自由拉伸（缩放质量优先平滑） */
export async function resizeImage(
  source: DrawImageSource,
  spec: ResizeSpec,
  format: ExportFormat = "image/png",
  quality?: number
): Promise<ImageEditOutput> {
  const { image, width, height } = await drawSource(source);
  const size = computeResizedSize(width, height, spec);
  const canvas = createCanvas(size.width, size.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建画布上下文");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, width, height, 0, 0, size.width, size.height);
  fillWhiteIfOpaque(canvas, format);
  return exportCanvas(canvas, format, quality);
}

/** 网格拆分（九宫格 rows=cols=3）：逐片导出，返回按行优先的切片数组 */
export async function splitImageIntoGrid(
  source: DrawImageSource,
  rows: number = 3,
  cols: number = 3,
  format: ExportFormat = "image/png",
  quality?: number
): Promise<ImageEditOutput[]> {
  const { image, width, height } = await drawSource(source);
  const slices = computeGridSlices(width, height, rows, cols);

  const outputs: ImageEditOutput[] = [];
  for (const slice of slices) {
    const canvas = createCanvas(slice.width, slice.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法创建画布上下文");
    ctx.drawImage(image, slice.x, slice.y, slice.width, slice.height, 0, 0, slice.width, slice.height);
    fillWhiteIfOpaque(canvas, format);
    outputs.push(exportCanvas(canvas, format, quality));
  }
  return outputs;
}

// ==================== 执行层：AI 能力编排 ====================

/** 放大提示词（img2img 通道） */
export const IMAGE_UPSCALE_PROMPT =
  "将这张图片放大为更高分辨率版本：严格保持原有构图、主体与配色不变，" +
  "增强细节纹理与清晰度，锐化边缘，修复压缩噪点，不要添加或删除任何元素。";

export interface UpscaleOptions {
  /** 附加提示（如风格强化要求），会拼接在放大提示词之后 */
  promptHint?: string;
  model?: string;
  aspectRatio?: SupportedAspectRatio;
  imageSize?: "1K" | "2K" | "4K";
  /** 生图节点通道，默认走 Pro 通道 */
  nodeType?: "imageGeneratorPro" | "imageGeneratorFast";
}

export interface UpscaleResult {
  imageData?: string;
  text?: string;
  error?: string;
}

/**
 * 放大：走既有图片生成服务 img2img 通道（imageService.editImage）。
 * 宽高比自动匹配原图最接近的支持比例，默认 2K 输出。
 */
export async function upscaleImage(params: {
  imageBase64: string;
  options?: UpscaleOptions;
}): Promise<UpscaleResult> {
  if (!params.imageBase64?.trim()) {
    return { error: "缺少图片数据，无法放大" };
  }
  const options = params.options || {};
  const prompt = [IMAGE_UPSCALE_PROMPT, options.promptHint?.trim()]
    .filter(Boolean)
    .join("\n");

  return editImage(
    {
      prompt,
      model: options.model || DEFAULT_IMAGE_EDIT_MODEL,
      inputImages: [params.imageBase64],
      aspectRatio: options.aspectRatio || "1:1",
      imageSize: options.imageSize || "2K",
    },
    options.nodeType || "imageGeneratorPro"
  );
}

/** 反推提示词指令：要求输出可直接用于生图的描述 */
export const INTERROGATE_PROMPT =
  "请仔细观察这张图片，反推出一段可以直接用于 AI 文生图的高质量提示词。" +
  "要求：覆盖主体、构图、风格、光线、色调、质感与氛围；使用英文逗号分隔的关键词短语；" +
  "只输出提示词本身，不要任何解释或前后缀。";

export interface InterrogateOptions {
  model?: string;
}

export interface InterrogateResult {
  prompt?: string;
  error?: string;
}

/** 反推提示词：走既有 llmService 视觉输入（generateText + files） */
export async function interrogateImagePrompt(params: {
  imageBase64: string;
  mimeType?: string;
  options?: InterrogateOptions;
}): Promise<InterrogateResult> {
  if (!params.imageBase64?.trim()) {
    return { error: "缺少图片数据，无法反推提示词" };
  }

  const response = await generateText({
    prompt: INTERROGATE_PROMPT,
    model: params.options?.model || DEFAULT_INTERROGATE_MODEL,
    files: [
      {
        data: params.imageBase64,
        mimeType: params.mimeType || "image/png",
        fileName: "interrogate-input",
      },
    ],
    temperature: 0.4,
  });

  if (response.error) {
    return { error: response.error };
  }
  const prompt = response.content?.trim();
  if (!prompt) {
    return { error: "模型未返回提示词内容" };
  }
  return { prompt };
}

export type InpaintImageRegionParams = InpaintRegionParams;
export type InpaintImageRegionResult = {
  image?: string;
  error?: string;
};

/** 局部重绘：转发 ocrInpaintService 通用入口（mask + prompt → inpaint） */
export async function inpaintImageRegion(
  params: InpaintImageRegionParams
): Promise<InpaintImageRegionResult> {
  try {
    const result = await inpaintRegion(params);
    return { image: result.image };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
