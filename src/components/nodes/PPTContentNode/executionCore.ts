/**
 * PPT 内容节点执行核心（纯函数）
 *
 * 供 usePPTContentExecution（手动按钮路径）与 nodeExecutor（工作流自动执行路径）
 * 共享的纯逻辑：信号量并发、大纲解析、页面初始化、@[asset_N] 提及还原。
 * 不依赖 React 与画布状态，可被单元测试直接覆盖。
 */

import { v4 as uuidv4 } from "uuid";
import { validateJsonOutput } from "@/services/llmService";
import { extractAssetMentions } from "@/services/creativeAssetService";
import type { PPTOutline, PPTPageItem } from "./types";

// PPT 页面并发生成上限：与工作流引擎的 maxParallelNodes 默认值保持一致
export const PPT_PAGE_MAX_PARALLEL = 3;

/**
 * 信号量并发执行：最多同时运行 limit 个任务，按原始顺序返回结果。
 * 并发控制模式与 WorkflowEngine.executeLayer 的实现保持一致：
 * 主循环逐个 await 空闲槽位并在启动任务前占用（runningCount++），
 * 槽位释放时唤醒等待队列中的下一个等待者。
 * 注意：占用槽位必须在主循环的 await 续体中完成（而非任务体内部），
 * 否则同步循环会在计数递增前把所有任务全部放行。
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const maxParallel = Math.max(1, limit);

  let runningCount = 0;
  const waitingResolvers: (() => void)[] = [];

  const waitForSlot = async (): Promise<void> => {
    if (runningCount < maxParallel) return;
    // 加入等待队列
    await new Promise<void>((resolve) => {
      waitingResolvers.push(resolve);
    });
  };

  const releaseSlot = (): void => {
    runningCount--;
    // 唤醒队列中的下一个等待者
    if (waitingResolvers.length > 0) {
      const nextResolve = waitingResolvers.shift()!;
      nextResolve();
    }
  };

  const allPromises: Promise<R>[] = [];

  for (const [index, item] of items.entries()) {
    // 等待有空闲槽位
    await waitForSlot();

    // 占用槽位后启动任务
    runningCount++;

    const promise = worker(item, index).finally(() => {
      releaseSlot();
    });

    allPromises.push(promise);
  }

  // 等待所有已启动的任务完成（保持原始顺序）
  return Promise.all(allPromises);
}

/**
 * 解析并校验大纲 LLM 输出（与手动生成路径一致：
 * 优先 JSON.parse，失败时回退 validateJsonOutput，再校验大纲结构）。
 */
export function parseOutlineContent(content: string): { outline?: PPTOutline; error?: string } {
  let outline: PPTOutline;
  try {
    outline = JSON.parse(content) as PPTOutline;
  } catch {
    // 如果解析失败，尝试使用原有的验证逻辑
    const validation = validateJsonOutput(content);
    if (!validation.valid || !validation.data) {
      return { error: validation.error || "JSON 解析失败" };
    }
    outline = validation.data as PPTOutline;
  }

  // 验证大纲结构
  if (!outline.title || !Array.isArray(outline.pages) || outline.pages.length === 0) {
    return { error: "大纲格式不正确：缺少标题或页面" };
  }

  return { outline };
}

/**
 * 由大纲初始化页面列表（与手动生成路径一致：全部置为 pending）。
 */
export function createPageItemsFromOutline(outline: PPTOutline): PPTPageItem[] {
  return outline.pages.map((page, index) => ({
    id: uuidv4(),
    pageNumber: page.pageNumber || index + 1,
    heading: page.heading || "",
    points: page.points || [],
    imageDesc: page.imageDesc,
    script: page.script || "",
    supplement: page.supplement,
    status: "pending",
  }));
}

// 提及解析所需素材的最小形状（来自 creativeStore 的 CreativeAsset）
export interface MentionResolvableAsset {
  label?: string;
  kind: string;
  dataUrl?: string;
  storagePath?: string;
}

const MENTION_TOKEN_PATTERN = /@\[(asset_\d+)\]/g;

/**
 * 生成时还原 prompt 中的 @[asset_N] 提及：
 * - 命中的图片素材按出现顺序追加为图片参考输入（base64，不含 data: 前缀）；
 * - prompt 中对应 token 替换为【图1】【图2】式编号引用（重复提及共享同一编号）；
 * - 无提及、素材缺失、非图片素材或图片数据不可用时行为不变（token 保持原样）。
 *
 * loadImageByPath 用于从文件路径加载素材图片（Tauri 环境由 readImage 提供）。
 */
export async function resolveAssetMentionsInPrompt(
  prompt: string,
  assets: readonly MentionResolvableAsset[],
  loadImageByPath?: (path: string) => Promise<string | undefined>
): Promise<{ prompt: string; images: string[] }> {
  const labels = extractAssetMentions(prompt);
  if (labels.length === 0) {
    return { prompt, images: [] };
  }

  const images: string[] = [];
  const numberByLabel = new Map<string, number>();

  for (const label of labels) {
    const asset = assets.find((item) => item.label === label);
    if (!asset || asset.kind !== "image") continue;
    const data = await loadMentionImageData(asset, loadImageByPath);
    if (!data) continue;
    numberByLabel.set(label, images.length);
    images.push(data);
  }

  if (images.length === 0) {
    return { prompt, images: [] };
  }

  const resolvedPrompt = prompt.replace(
    MENTION_TOKEN_PATTERN,
    (token, label: string) => {
      const number = numberByLabel.get(label);
      return number === undefined ? token : `【图${number + 1}】`;
    }
  );

  return { prompt: resolvedPrompt, images };
}

// 加载提及素材的图片数据：优先从文件路径加载，其次解码 dataUrl（去除 data: 前缀）
async function loadMentionImageData(
  asset: MentionResolvableAsset,
  loadImageByPath?: (path: string) => Promise<string | undefined>
): Promise<string | undefined> {
  if (asset.storagePath && loadImageByPath) {
    try {
      const data = await loadImageByPath(asset.storagePath);
      if (data) return data;
    } catch (error) {
      console.warn("[PPTExecutionCore] 加载提及素材图片失败:", error);
    }
  }

  // dataUrl 形如 data:image/png;base64,xxx，输入图片需要不含前缀的 base64
  const base64 = asset.dataUrl?.split(",")[1];
  return base64 || undefined;
}
