/**
 * 生成参数扩展类型与纯函数（能力包：生成参数与 PPT 取消）
 *
 * - 多图张数：ImageCount / normalizeImageCount / planImageCountRequests，
 *   imageService 按「上游 API 支持 n 参数则直传，否则按张数拆分请求
 *   （复用 ≤ IMAGE_GEN_MAX_PARALLEL 的信号量并发模式）」执行；
 * - PPT 组装协作取消：createAssemblyCancelToken / requestAssemblyCancel /
 *   resolveAssemblyStopPatch / isAssemblyCancelledResult，
 *   供 PPTAssemblerNode 在组装任务开始时生成随机 token 并随每页任务传入
 *   process_ppt_page（跨包契约，Rust 侧 ProcessPageParams.cancel_token +
 *   OCR 前/inpaint 前两个检查点，见 src-tauri/src/ocr_inpaint.rs），停止时经
 *   invoke("cancel_ppt_assembly", { token }) 置位取消标志。
 *
 * 本文件只放纯类型与纯函数，不依赖 React、store 与 Tauri，可被单元测试直接覆盖。
 */

import type { GenerationResponse, ImageEditParams, ImageGenerationParams } from "@/types";

// ===== 多图张数 =====

// 一次生成的张数（生成节点属性面板提供 1-4 张选择）
export type ImageCount = 1 | 2 | 3 | 4;

// 张数可选值（与属性面板按钮一一对应）
export const IMAGE_COUNT_OPTIONS: readonly ImageCount[] = [1, 2, 3, 4];

// 缺省张数：1 张（未选择时行为与既有单图生成完全一致）
export const DEFAULT_IMAGE_COUNT: ImageCount = 1;

// 多图按张数拆分请求时的并发上限（复用 PPT 页面生成 / 工作流引擎的 ≤3 信号量模式）
export const IMAGE_GEN_MAX_PARALLEL = 3;

// 带张数的图片生成参数：在既有参数上扩展可选 count，缺省 1 张、行为不变
export interface ImageGenerationWithCountParams extends ImageGenerationParams {
  count?: ImageCount;
}

// 带张数的图片编辑参数（多图参考输入场景同样支持一次生成多张）
export interface ImageEditWithCountParams extends ImageEditParams {
  count?: ImageCount;
}

// 多图生成响应：images 为本次全部成功图片（base64，按请求顺序）；
// imageData 兼容字段取首图，既有单图消费方无需改动
export interface MultiImageGenerationResponse extends GenerationResponse {
  images?: string[];
  // 部分失败信息：仍有成功图片但部分请求失败时 failedCount > 0，partialError 为首个错误；
  // 全部失败时以 error 返回，二者不同时出现
  failedCount?: number;
  partialError?: string;
}

// 生成节点多图产物在节点数据 / 执行结果中的落位形状（images 与 imagePaths 按下标对齐，
// 落盘失败的项为 undefined，此时消费方回退 images 里的 base64）。
// 跨包契约标注：画布包经工作流结果 auto-sink 消费该数组，调用 creativeStore.addImageBatchToCanvas
// （creativeStore.ts:53、525）做批量图组折叠栈落位；接线由画布包完成。
export interface ImageGeneratorMultiOutput {
  images?: string[];
  imagePaths?: Array<string | undefined>;
  // 部分失败：成功张数 = images.length，失败张数 = failedCount
  failedCount?: number;
  partialError?: string;
}

// 归一化张数：非法/缺省回退 1；超过上限收敛到 4；非整数回退 1（旧数据或外部输入兜底）
export function normalizeImageCount(value: unknown): ImageCount {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_IMAGE_COUNT;
  return Math.min(parsed, IMAGE_COUNT_OPTIONS.length) as ImageCount;
}

// 张数请求计划：上游 API 支持 n 参数则单次请求直传，否则按张数拆成多次请求
export interface ImageCountRequestPlan {
  mode: "upstream-n" | "parallel-requests";
  // mode === "upstream-n" 时随单次请求直传的张数
  n?: number;
  // 需要发起的请求次数
  requestCount: number;
}

export function planImageCountRequests(
  count: ImageCount,
  upstreamSupportsN: boolean
): ImageCountRequestPlan {
  if (upstreamSupportsN && count > 1) {
    return { mode: "upstream-n", n: count, requestCount: 1 };
  }
  return { mode: "parallel-requests", requestCount: count };
}

// ===== PPT 组装协作取消（纯编排逻辑，供 PPTAssemblerNode 与单测共用） =====

// 生成组装任务的取消 token（随机 id；跨包契约：Rust 侧按该 token 匹配取消标志）
export function createAssemblyCancelToken(randomId: () => string = defaultRandomId): string {
  return randomId();
}

function defaultRandomId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `cancel-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// 取消成功（任务返回 { cancelled: true }）后的提示文案：「已取消，已完成 N 页」
export function buildAssemblyCancelMessage(completedCount: number): string {
  return `已取消，已完成 ${completedCount} 页`;
}

// Rust process_ppt_page 命中取消标志时的错误文案（src-tauri/src/ocr_inpaint.rs 检查点返回）；
// ocrInpaintService 透传层未显式暴露 cancelled 字段前，经抛错路径以该文案识别取消
export const ASSEMBLY_CANCELLED_ERROR_TEXT = "PPT 组装已被取消";

/**
 * 判断单页处理结果/错误是否为「命中协作取消」：
 * - 优先读宽松字段 cancelled（跨包契约 ProcessPageResult.cancelled，serde camelCase；
 *   ocrInpaintService 透传层补齐后生效）；
 * - 回退匹配 Rust 侧取消错误文案（当前透传层把 cancelled 结果按 error 抛出）。
 */
export function isAssemblyCancelledResult(result: unknown, error?: unknown): boolean {
  if (
    result &&
    typeof result === "object" &&
    (result as { cancelled?: unknown }).cancelled === true
  ) {
    return true;
  }
  if (error instanceof Error && error.message.includes(ASSEMBLY_CANCELLED_ERROR_TEXT)) {
    return true;
  }
  if (typeof error === "string" && error.includes(ASSEMBLY_CANCELLED_ERROR_TEXT)) {
    return true;
  }
  return false;
}

// 页面处理状态的最小形状（PPTAssemblerNode 的 PPTPageData 子集）
export interface AssemblyPageStatusLike {
  processStatus?: "pending" | "processing" | "completed" | "error";
  processError?: string;
}

// 停止/取消收尾写入：以最新页面计算（避免旧快照覆盖），重置 processing 页为 pending
export interface AssemblyStopPatch<P extends AssemblyPageStatusLike> {
  resetPages: P[];
  completedCount: number;
  cancelNotice?: string;
}

export function resolveAssemblyStopPatch<P extends AssemblyPageStatusLike>(
  pages: readonly P[],
  backendCancelled: boolean,
  messageBuilder: (completedCount: number) => string = buildAssemblyCancelMessage
): AssemblyStopPatch<P> {
  const completedCount = pages.filter((p) => p.processStatus === "completed").length;
  const resetPages = pages.map((p): P =>
    p.processStatus === "processing"
      ? ({ ...p, processStatus: "pending", processError: undefined } as P)
      : p
  );
  return {
    resetPages,
    completedCount,
    cancelNotice: backendCancelled ? messageBuilder(completedCount) : undefined,
  };
}

/**
 * 跨包契约（Rust 包提供）：invoke("cancel_ppt_assembly", { token }) → { cancelled: boolean }。
 * 封装调用与错误回退：命令缺失（Rust 未就绪）或返回异常时返回 false，调用方回退本地停止、
 * 不显示取消提示。invokeFn 注入便于单测验证调用参数与降级行为。
 */
export async function requestAssemblyCancel(
  invokeFn: (command: string, args: { token: string }) => Promise<unknown>,
  token: string
): Promise<boolean> {
  try {
    const result = await invokeFn("cancel_ppt_assembly", { token });
    return (result as { cancelled?: boolean } | null | undefined)?.cancelled === true;
  } catch (error) {
    console.warn("[PPTAssembler] cancel_ppt_assembly 调用失败，回退本地停止:", error);
    return false;
  }
}

// ===== 既有节点数据类型的字段补声明（模块增强） =====
// 多图/取消相关 UI 字段需要显式类型契约而非依赖索引签名；这些接口的所有权分属
// 各类型文件所在包，故以模块增强方式在本包内声明契约。后续所属包可把同名字段
// 按相同类型吸收进原接口（声明合并要求同名属性类型一致，可无损合并）。

declare module "@/types" {
  interface ImageGeneratorNodeData {
    // 属性面板张数（1-4）
    count?: ImageCount;
    // 多图产物：全部成功图片 base64（Tauri 落盘路径存在时为 undefined 以省内存）
    outputImages?: string[];
    // 与 outputImages 下标对齐的落盘路径（保存失败项为 undefined）
    outputImagePaths?: Array<string | undefined>;
    // 本次实际成功的张数（预览角标与部分失败提示使用）
    outputCount?: number;
    // 部分失败信息：成功 outputCount 张、失败 partialFailedCount 张，partialError 为首个错误
    partialFailedCount?: number;
    partialError?: string;
  }
}

declare module "@/components/nodes/PPTAssemblerNode/types" {
  interface PPTAssemblerNodeData {
    // 后端确认协作取消后的提示文案（「已取消，已完成 N 页」），刷新/重新开始时清除
    cancelNotice?: string;
  }
}
