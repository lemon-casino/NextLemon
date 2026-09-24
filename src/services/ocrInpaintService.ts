/**
 * OCR + Inpaint 服务调用
 * 用于将 PPT 图片转换为可编辑文字形式
 */

import { invoke } from "@tauri-apps/api/core";
import type { PPTPageData } from "@/components/nodes/PPTAssemblerNode/types";

// ==================== 类型定义 ====================

/** 文本框数据 */
export interface TextBox {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  fontSize: number;
}

/** 处理后的页面数据 */
export interface ProcessedPage {
  /** 去除文字后的背景图 (base64) */
  backgroundImage: string;
  /** 检测到的文本框列表 */
  textBoxes: TextBox[];
  /** 原始页面数据 */
  originalPage: PPTPageData;
}

/** 服务配置 */
export interface OcrInpaintConfig {
  /** PaddleOCR 服务地址 */
  ocrApiUrl: string;
  /** IOPaint 服务地址 */
  inpaintApiUrl: string;
  /** 蒙版扩展边距（像素） */
  maskPadding?: number;
}

/** 处理进度回调 */
export type ProgressCallback = (current: number, total: number) => void;

/** 单页处理结果（来自 Rust） */
interface ProcessPageResult {
  success: boolean;
  backgroundImage: string | null;
  textBoxes: TextBox[];
  error: string | null;
}

/** 连接测试结果 */
interface TestConnectionResult {
  success: boolean;
  message: string;
}

// ==================== 通用局部重绘（泛化入口） ====================

/** 默认 IOPaint 服务地址（与 PPT 节点默认配置一致） */
export const DEFAULT_INPAINT_API_URL = "http://127.0.0.1:8080";

/** 通用局部重绘参数（mask + prompt → inpaint） */
export interface InpaintRegionParams {
  /** base64 原图（不含 data: 前缀） */
  imageData: string;
  /** base64 蒙版，黑色 = 保留、白色 = 重绘（与 IOPaint 约定一致），尺寸需与原图一致 */
  maskData: string;
  /** 重绘内容提示词 */
  prompt: string;
  /** IOPaint 服务地址；缺省 DEFAULT_INPAINT_API_URL（仅 HTTP 回退路径使用） */
  inpaintApiUrl?: string;
  /** HTTP 回退请求超时（毫秒）；缺省 300_000，与 Rust 侧 call_inpaint_service 的 300s 一致 */
  timeoutMs?: number;
}

/** 通用局部重绘结果 */
export interface InpaintRegionResult {
  /** 重绘后的图片 base64（不含 data: 前缀） */
  image: string;
}

interface InpaintRegionCommandResult {
  success: boolean;
  image?: string;
  error?: string;
}

/**
 * 通用局部重绘入口：与 PPT 页面可编辑化流程（processPageForEditable，OCR 驱动的整页去字）
 * 互不影响。当前实际路径是直连 IOPaint HTTP API（/api/v1/inpaint，请求/响应格式与 Rust 侧
 * ocr_inpaint.rs 的 call_inpaint_service 保持一致：JSON 载荷 + 二进制图片响应）。
 * invoke("inpaint_region") 为预留契约——Rust 侧 invoke_handler 尚未注册该命令，调用必然
 * reject 后走 HTTP 回退；Rust 包补充该命令后（入参 { params: { imageData, maskData, prompt } }、
 * 返回 { success, image?, error? }）将自动优先走原生通道。
 */
export async function inpaintRegion(params: InpaintRegionParams): Promise<InpaintRegionResult> {
  if (!params.imageData?.trim()) {
    throw new Error("缺少原图数据，无法局部重绘");
  }
  if (!params.maskData?.trim()) {
    throw new Error("缺少重绘蒙版，请先涂抹需要重绘的区域");
  }
  if (!params.prompt?.trim()) {
    throw new Error("请输入重绘内容提示词");
  }

  if (isTauriEnvironment()) {
    try {
      // 预留契约（Rust 侧未注册，当前必然 reject 走 HTTP 回退；命令落地后自动优先走此通道）
      const result = await invoke<InpaintRegionCommandResult>("inpaint_region", {
        params: {
          imageData: params.imageData,
          maskData: params.maskData,
          prompt: params.prompt,
        },
      });
      if (result?.success && result.image) {
        return { image: result.image };
      }
      throw new Error(result?.error || "局部重绘失败");
    } catch (commandError) {
      try {
        return await inpaintRegionViaHttp(params);
      } catch (httpError) {
        const commandMessage = commandError instanceof Error ? commandError.message : String(commandError);
        const httpMessage = httpError instanceof Error ? httpError.message : String(httpError);
        throw new Error(`局部重绘失败：${httpMessage}（inpaint_region 命令：${commandMessage}）`);
      }
    }
  }

  return inpaintRegionViaHttp(params);
}

/** 直连 IOPaint HTTP API 的回退实现（与 Rust 侧请求格式一致；带超时防挂起） */
async function inpaintRegionViaHttp(params: InpaintRegionParams): Promise<InpaintRegionResult> {
  const apiBase = (params.inpaintApiUrl || DEFAULT_INPAINT_API_URL).replace(/\/+$/, "");
  const timeoutMs = params.timeoutMs ?? 300_000;

  let response: Response;
  try {
    response = await fetch(`${apiBase}/api/v1/inpaint`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image: params.imageData,
        mask: params.maskData,
        prompt: params.prompt,
        ldm_steps: 30,
        hd_strategy: "Original",
      }),
      // 与 Rust 侧 call_inpaint_service 的 300s 超时对齐，避免服务挂起时无限期等待
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "";
    if (errorName === "TimeoutError" || errorName === "AbortError") {
      throw new Error(
        `IOPaint 局部重绘请求超时（${Math.round(timeoutMs / 1000)} 秒），请检查服务是否繁忙或已挂起`
      );
    }
    throw new Error(
      `无法连接 IOPaint 服务（${apiBase}），请检查服务是否启动: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!response.ok) {
    const errorText = (await response.text().catch(() => "")).slice(0, 200);
    throw new Error(`IOPaint 服务返回错误 (${response.status}): ${errorText || response.statusText}`);
  }

  // IOPaint 直接返回图片二进制（与 Rust 侧处理一致）
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0) {
    throw new Error("IOPaint 服务返回了空图片数据");
  }
  return { image: uint8ArrayToBase64(bytes) };
}

// ==================== 服务函数 ====================

/**
 * 检测 Tauri 环境
 */
function isTauriEnvironment(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** 字节 → base64（分块拼接，避免 String.fromCharCode 展开超长参数列表） */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * 处理单个 PPT 页面
 * @param imageData base64 编码的图片
 * @param config 服务配置
 * @returns 处理结果
 */
export async function processPageForEditable(
  imageData: string,
  config: OcrInpaintConfig
): Promise<{ backgroundImage: string; textBoxes: TextBox[] }> {
  if (!isTauriEnvironment()) {
    throw new Error("此功能仅在 Tauri 环境中可用");
  }

  const result = await invoke<ProcessPageResult>("process_ppt_page", {
    params: {
      imageData,
      ocrApiUrl: config.ocrApiUrl,
      inpaintApiUrl: config.inpaintApiUrl,
      maskPadding: config.maskPadding ?? 5,
    },
  });

  if (!result.success || !result.backgroundImage) {
    throw new Error(result.error || "处理失败");
  }

  return {
    backgroundImage: result.backgroundImage,
    textBoxes: result.textBoxes,
  };
}

/** 批量处理结果 */
export interface ProcessAllPagesResult {
  /** 是否全部成功 */
  success: boolean;
  /** 处理后的页面（仅成功时有值） */
  pages: ProcessedPage[];
  /** 错误信息（失败时） */
  error?: string;
  /** 失败的页面编号 */
  failedPageNumber?: number;
}

/**
 * 批量处理所有 PPT 页面
 * @param pages PPT 页面数据数组
 * @param config 服务配置
 * @param onProgress 进度回调
 * @returns 处理结果，包含成功/失败状态
 */
export async function processAllPages(
  pages: PPTPageData[],
  config: OcrInpaintConfig,
  onProgress?: ProgressCallback
): Promise<ProcessAllPagesResult> {
  if (!isTauriEnvironment()) {
    return {
      success: false,
      pages: [],
      error: "此功能仅在 Tauri 环境中可用",
    };
  }

  // 先检查服务是否可用
  const servicesCheck = await checkServicesAvailable(config);

  if (!servicesCheck.ocrAvailable) {
    return {
      success: false,
      pages: [],
      error: `OCR 服务连接失败: ${servicesCheck.ocrMessage}`,
    };
  }

  if (!servicesCheck.inpaintAvailable) {
    return {
      success: false,
      pages: [],
      error: `IOPaint 服务连接失败: ${servicesCheck.inpaintMessage}`,
    };
  }

  const results: ProcessedPage[] = [];
  const total = pages.length;

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];

    // 报告进度
    onProgress?.(i + 1, total);

    try {
      const processed = await processPageForEditable(page.image, config);

      results.push({
        backgroundImage: processed.backgroundImage,
        textBoxes: processed.textBoxes,
        originalPage: page,
      });
    } catch (error) {
      // 处理失败，立即停止并返回错误
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`第 ${page.pageNumber} 页处理失败:`, error);

      return {
        success: false,
        pages: results, // 返回已处理的页面
        error: `第 ${page.pageNumber} 页处理失败: ${errorMessage}`,
        failedPageNumber: page.pageNumber,
      };
    }
  }

  return {
    success: true,
    pages: results,
  };
}

/**
 * 测试 OCR 服务连接
 * @param url OCR 服务地址
 */
export async function testOcrConnection(url: string): Promise<TestConnectionResult> {
  if (!isTauriEnvironment()) {
    return { success: false, message: "此功能仅在 Tauri 环境中可用" };
  }

  return await invoke<TestConnectionResult>("test_ocr_connection", {
    params: { url },
  });
}

/**
 * 测试 IOPaint 服务连接
 * @param url IOPaint 服务地址
 */
export async function testInpaintConnection(url: string): Promise<TestConnectionResult> {
  if (!isTauriEnvironment()) {
    return { success: false, message: "此功能仅在 Tauri 环境中可用" };
  }

  return await invoke<TestConnectionResult>("test_inpaint_connection", {
    params: { url },
  });
}

/**
 * 检查服务是否可用（同时测试 OCR 和 IOPaint）
 */
export async function checkServicesAvailable(config: OcrInpaintConfig): Promise<{
  ocrAvailable: boolean;
  inpaintAvailable: boolean;
  ocrMessage: string;
  inpaintMessage: string;
}> {
  const [ocrResult, inpaintResult] = await Promise.all([
    testOcrConnection(config.ocrApiUrl),
    testInpaintConnection(config.inpaintApiUrl),
  ]);

  return {
    ocrAvailable: ocrResult.success,
    inpaintAvailable: inpaintResult.success,
    ocrMessage: ocrResult.message,
    inpaintMessage: inpaintResult.message,
  };
}
