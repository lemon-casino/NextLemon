import { GoogleGenAI } from "@google/genai";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import type { GenerationResponse, ProviderProtocol, ErrorDetails } from "@/types";
import { useSettingsStore } from "@/stores/settingsStore";
import { LEMON_API_CONFIG, PROXY_PATH } from "@/config/lemonApi";
import {
  IMAGE_GEN_MAX_PARALLEL,
  normalizeImageCount,
  planImageCountRequests,
  type ImageEditWithCountParams,
  type ImageGenerationWithCountParams,
  type MultiImageGenerationResponse,
} from "@/types/generation";
// 复用 PPT 页面生成的 ≤3 信号量并发模式（纯函数，无 React/store 依赖）
import { mapWithConcurrency } from "@/components/nodes/PPTContentNode/executionCore";

// 上游 API 是否支持一次请求直传 n 返回多张：
// - Google generateContent 图片模型：仅返回单张候选，多候选不可用；
// - OpenAI 协议（Lemon 流式 chat）：接口无 n 参数；
// - Tauri 代理（gemini_generate_content）：Rust 契约参数固定，未含 n。
// 后续上游/后端支持 n 后，将此开关置为 true 即自动走「n 直传」分支（见 planImageCountRequests）。
const IMAGE_GEN_UPSTREAM_SUPPORTS_N = false;

// 图片节点类型
type ImageNodeType = "imageGeneratorPro" | "imageGeneratorFast";

// 检测是否在 Tauri 环境中（Tauri 2.0）
const isTauri = () => {
  const result = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  console.log("[imageService] isTauri check:", result, "window keys:", typeof window !== "undefined" ? Object.keys(window).filter(k => k.includes("TAURI")) : []);
  return result;
};

// 根据协议类型获取完整的 API Base URL
function getApiBaseUrl(baseUrl: string, protocol: ProviderProtocol): string {
  const cleanBaseUrl = baseUrl.replace(/\/+$/, "");  // 移除末尾斜杠

  switch (protocol) {
    case "google":
      return `${cleanBaseUrl}/v1beta`;
    case "openai":
      return `${cleanBaseUrl}/v1`;
    case "claude":
      return `${cleanBaseUrl}/v1`;
    default:
      return `${cleanBaseUrl}/v1beta`;
  }
}

// 获取供应商配置
function getProviderConfig(nodeType: ImageNodeType) {
  const { settings } = useSettingsStore.getState();
  const providerId = settings.nodeProviders[nodeType];

  // 默认 Lemon API 配置
  // 默认 Lemon API 配置
  if (!settings.enableCustomProviders) {
    return {
      id: LEMON_API_CONFIG.imageId,
      name: LEMON_API_CONFIG.name,
      apiKey: LEMON_API_CONFIG.apiKey,
      baseUrl: LEMON_API_CONFIG.baseUrl,
      protocol: LEMON_API_CONFIG.protocol,
    };
  }



  if (!providerId) {
    throw new Error("请先在供应商管理中配置此节点的供应商");
  }

  const provider = settings.providers.find((p) => p.id === providerId);
  if (!provider) {
    throw new Error("供应商不存在，请重新配置");
  }

  if (!provider.apiKey) {
    throw new Error("供应商 API Key 未配置");
  }

  return provider;
}

// 创建 API 客户端（仅用于 Web 环境）
function createClient(nodeType: ImageNodeType) {
  const provider = getProviderConfig(nodeType);
  const apiBaseUrl = getApiBaseUrl(provider.baseUrl, provider.protocol);

  return new GoogleGenAI({
    apiKey: provider.apiKey,
    httpOptions: {
      baseUrl: apiBaseUrl,
    },
  });
}

// Tauri 后端代理请求参数
interface TauriGeminiParams {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  inputImages?: string[];
  aspectRatio?: string;
  imageSize?: string;
}

// Tauri 后端代理响应
interface TauriGeminiResult {
  success: boolean;
  imageData?: string;
  text?: string;
  error?: string;
}



// 通过 Tauri 后端代理发送请求
async function invokeGemini(params: TauriGeminiParams, provider?: { name: string; protocol: string }): Promise<GenerationResponse> {
  console.log("[imageService] invokeGemini called, sending to Tauri backend...");
  console.log("[imageService] params:", { ...params, inputImages: params.inputImages?.length || 0, apiKey: "***" });

  // 构建完整请求 URL
  const protocol = provider?.protocol || "google";
  let fullRequestUrl = params.baseUrl;
  if (protocol === "google") {
    fullRequestUrl = `${params.baseUrl}/models/${params.model}:generateContent`;
  }

  // 构建请求体信息
  const requestBody = {
    model: params.model,
    prompt: params.prompt.slice(0, 500),
    aspectRatio: params.aspectRatio,
    imageSize: params.imageSize,
    hasInputImages: !!(params.inputImages && params.inputImages.length > 0),
    inputImagesCount: params.inputImages?.length || 0,
  };

  try {
    const startTime = Date.now();
    const result = await invoke<TauriGeminiResult>("gemini_generate_content", { params });
    const elapsed = Date.now() - startTime;

    console.log("[imageService] Tauri backend response received in", elapsed, "ms");
    console.log("[imageService] result:", { success: result.success, hasImage: !!result.imageData, error: result.error });

    if (!result.success) {
      const errorMessage = result.error || "请求失败";

      // 构建详细错误信息
      const errorDetails: ErrorDetails = {
        name: "API_Error",
        message: errorMessage,
        timestamp: new Date().toISOString(),
        model: params.model,
        provider: provider?.name || "未知",
        requestUrl: fullRequestUrl,
        requestBody,
      };

      // 尝试提取状态码
      const statusCodeMatch = errorMessage.match(/\((\d{3})\)/);
      if (statusCodeMatch) {
        errorDetails.statusCode = parseInt(statusCodeMatch[1], 10);
      }

      // 尝试提取响应内容
      const responseMatch = errorMessage.match(/API 返回错误\s*\(\d{3}\)[：:]\s*([\s\S]*)/);
      if (responseMatch) {
        const responseContent = responseMatch[1].trim();
        try {
          errorDetails.responseBody = JSON.parse(responseContent);
        } catch {
          if (responseContent) {
            errorDetails.responseBody = responseContent;
          }
        }
      }

      return {
        error: errorMessage,
        errorDetails,
      };
    }

    return {
      imageData: result.imageData,
      text: result.text,
    };
  } catch (error) {
    console.error("[imageService] Tauri invoke error:", error);
    const message = error instanceof Error ? error.message : String(error);

    const errorDetails: ErrorDetails = {
      name: error instanceof Error ? error.name : "Error",
      message,
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: new Date().toISOString(),
      model: params.model,
      provider: provider?.name || "未知",
      requestUrl: fullRequestUrl,
      requestBody,
    };

    return {
      error: message,
      errorDetails,
    };
  }
}

// 判断供应商是否为 Lemon 生图通道（openai 协议 + Lemon 默认/生图 ID）
function isLemonImageProvider(provider: { id?: string; protocol: string }): boolean {
  return (
    provider.protocol === "openai" &&
    (provider.id === LEMON_API_CONFIG.id || provider.id === LEMON_API_CONFIG.imageId)
  );
}

// 发送生成完成的原生通知（多图批量生成时整批只调用一次，避免一次 N 张弹 N 条）
async function sendGenerationNotification(prompt: string): Promise<void> {
  try {
    let permissionGranted = await isPermissionGranted();
    if (!permissionGranted) {
      const permission = await requestPermission();
      permissionGranted = permission === "granted";
    }
    if (permissionGranted) {
      sendNotification({
        title: "图片生成完成",
        body: `您的 AI 绘图已准备就绪 (耗时: ${prompt.length > 20 ? prompt.slice(0, 20) + "..." : prompt})`,
      });
    }
  } catch (e) {
    console.warn("[imageService] Notification failed:", e);
  }
}

// 专门用于处理 Lemon API 的图像生成（通过 OpenAI Chat 接口返回 Markdown 图片）
// 专门用于处理 Lemon API 的图像生成（通过 OpenAI Chat 接口返回 Markdown 图片）
async function invokeLemonImageGeneration(
  params: { prompt: string; inputImages?: string[]; model: string; suppressNotification?: boolean },
  provider: { baseUrl: string; apiKey: string },
  onProgress?: (text: string) => void
): Promise<GenerationResponse> {
  console.log("[imageService] 调用 Lemon API 进行生图 (Streaming)...");

  // Tauri 环境下使用 Native Rust Command + Event Listener 方案
  if (isTauri()) {
    console.log("[imageService] Tauri Native Mode: Using Rust reqwest streaming");
    const channelId = crypto.randomUUID();
    let accumulatedText = "";

    return new Promise(async (resolve) => {
      // 1. 设置事件监听
      let unlistenData: (() => void) | undefined;
      let unlistenError: (() => void) | undefined;
      let unlistenDone: (() => void) | undefined;
      let buffer = ""; // 添加缓冲区处理跨包数据

      const cleanup = () => {
        unlistenData?.();
        unlistenError?.();
        unlistenDone?.();
      };

      const finish = async () => {
        const match = accumulatedText.match(/!\[.*?\]\((.*?)\)/);
        if (match && match[1]) {
          let imageData = match[1];
          if (imageData.startsWith("data:")) imageData = imageData.split(",")[1];

          // 发送原生通知（多图批量模式下抑制，由整批收尾统一发一次）
          if (!params.suppressNotification) {
            await sendGenerationNotification(params.prompt);
          }

          resolve({ imageData, text: accumulatedText });
        } else {
          resolve({ error: "未能从响应中提取图片", text: accumulatedText });
        }
      };

      unlistenData = await listen<string>(`stream://${channelId}`, (event) => {
        const chunk = event.payload;
        buffer += chunk; // 追加到缓冲区

        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // 保留最后一个不完整的行

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === "data: [DONE]") continue;

          if (trimmed.startsWith("data: ")) {
            try {
              const jsonStr = trimmed.slice(6);
              const data = JSON.parse(jsonStr);
              const delta = data.choices?.[0]?.delta;
              if (delta) {
                const reasoning = delta.reasoning_content || "";
                const content = delta.content || "";
                if (reasoning) accumulatedText += `[Thinking] ${reasoning}`;
                if (content) accumulatedText += content;
                onProgress?.(accumulatedText);
              }
            } catch (e) {
              // JSON parse error usually means incomplete chunk in line, but we split by \n so it should be a full frame. 
              // However, sometimes data can be malformed.
            }
          }
        }
      });

      unlistenError = await listen<string>(`stream-error://${channelId}`, (event) => {
        console.error("[imageService] Rust stream error:", event.payload);
        cleanup();
        resolve({ error: `流式传输中断: ${event.payload}` });
      });

      unlistenDone = await listen<void>(`stream-done://${channelId}`, () => {
        console.log("[imageService] Rust stream done");
        cleanup();
        finish();
      });

      // 2. 调用 Rust 命令
      try {
        await invoke("lemon_stream_generation", {
          params: {
            ...params,
            baseUrl: provider.baseUrl,
            apiKey: provider.apiKey,
            channelId
          }
        });
      } catch (err) {
        console.error("[imageService] Failed to invoke Rust command:", err);
        cleanup();
        resolve({ error: `启动请求失败: ${err}` });
      }
    });
  }

  // Web 模式逻辑
  let baseUrl = provider.baseUrl.replace(/\/+$/, "");
  if (baseUrl === LEMON_API_CONFIG.baseUrl) {
    baseUrl = PROXY_PATH;
  }

  const url = `${baseUrl}/v1/chat/completions`;

  const messages: unknown[] = [
    {
      role: "user",
      content: params.inputImages && params.inputImages.length > 0
        ? [
          { type: "text", text: params.prompt },
          ...params.inputImages.map(img => ({
            type: "image_url",
            image_url: {
              url: img.startsWith("data:") ? img : `data:image/png;base64,${img}`
            }
          }))
        ]
        : params.prompt
    }
  ];

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${provider.apiKey}`
      },
      body: JSON.stringify({
        model: params.model,
        messages,
        temperature: 0.7,
        stream: true
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      return {
        error: `请求失败 (${response.status})`,
        errorDetails: {
          name: "LemonAPIError",
          message: errText,
          provider: "Lemon AI",
          model: params.model
        }
      };
    }

    if (!response.body) {
      return { error: "未收到响应流" };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let accumulatedText = "";
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === "data: [DONE]") continue;

        if (trimmed.startsWith("data: ")) {
          try {
            const jsonStr = trimmed.slice(6);
            const data = JSON.parse(jsonStr);
            const delta = data.choices?.[0]?.delta;
            if (delta) {
              const reasoning = delta.reasoning_content || "";
              const content = delta.content || "";
              if (reasoning) accumulatedText += `[Thinking] ${reasoning}`;
              if (content) accumulatedText += content;
              onProgress?.(accumulatedText);
            }
          } catch (e) { }
        }
      }
    }

    const match = accumulatedText.match(/!\[.*?\]\((.*?)\)/);
    if (match && match[1]) {
      let imageData = match[1];
      if (imageData.startsWith("data:")) {
        imageData = imageData.split(",")[1];
      }
      return { imageData, text: accumulatedText };
    }

    return { error: "未能从响应中提取图片", text: accumulatedText };

  } catch (error) {
    console.error("[imageService] Lemon API stream error:", error);
    return { error: error instanceof Error ? error.message : String(error) };
  }
}



// 单图响应 → 多图响应（imageData 镜像为单元素 images，供批量聚合统一处理）
function toMultiResponse(response: GenerationResponse): MultiImageGenerationResponse {
  return response.imageData
    ? { ...response, images: [response.imageData] }
    : response;
}

// 批量聚合：按张数拆分请求后聚合成功图片；全部失败时返回首个错误（保留 text 供排查），
// 部分失败时返回成功图片 + failedCount/partialError（不中断整批），并在控制台记录失败详情
async function runImageCountBatch(
  count: number,
  onProgress: ((text: string) => void) | undefined,
  single: (
    onProgress: ((text: string) => void) | undefined,
    options?: { suppressNotification?: boolean }
  ) => Promise<MultiImageGenerationResponse>
): Promise<MultiImageGenerationResponse> {
  const indexes = Array.from({ length: count }, (_, index) => index);
  // 复用 ≤3 信号量并发；进度文本只随首个请求推送，避免多路流式文本交错；
  // 每个分请求都抑制完成通知，整批完成后由调用方统一发一次
  const results = await mapWithConcurrency(indexes, IMAGE_GEN_MAX_PARALLEL, (index) =>
    single(index === 0 ? onProgress : undefined, { suppressNotification: true })
  );

  const images: string[] = [];
  let firstError: string | undefined;
  let firstErrorDetails: ErrorDetails | undefined;
  for (const result of results) {
    if (result.images && result.images.length > 0) {
      images.push(...result.images);
    } else if (result.imageData) {
      images.push(result.imageData);
    }
    if (!firstError && result.error) {
      firstError = result.error;
      firstErrorDetails = result.errorDetails;
    }
  }

  if (images.length === 0) {
    // 全失败同样保留各请求的 text（Lemon 流式失败时携带思考内容，与单图失败路径行为一致）
    return {
      error: firstError || "生成失败",
      errorDetails: firstErrorDetails,
      text: results.find((result) => result.text)?.text,
    };
  }
  const failedCount = count - images.length;
  if (firstError) {
    console.warn(`[imageService] 多图生成部分失败（${failedCount}/${count}）:`, firstError);
  }

  return {
    images,
    imageData: images[0],
    text: results.find((result) => result.text)?.text,
    ...(failedCount > 0 ? { failedCount, partialError: firstError } : {}),
  };
}

// 按张数执行生成：上游支持 n 则单次直传，否则按张数拆分并发请求
async function generateWithCount(
  params: ImageGenerationWithCountParams,
  nodeType: ImageNodeType,
  onProgress: ((text: string) => void) | undefined,
  single: (
    onProgress: ((text: string) => void) | undefined,
    options?: { candidateCount?: number; suppressNotification?: boolean }
  ) => Promise<MultiImageGenerationResponse>
): Promise<MultiImageGenerationResponse> {
  const count = normalizeImageCount(params.count);
  if (count <= 1) {
    return single(onProgress);
  }

  const plan = planImageCountRequests(count, IMAGE_GEN_UPSTREAM_SUPPORTS_N);
  if (plan.mode === "upstream-n") {
    // 上游 n 直传：单次请求携带张数，由响应聚合多张（仅 Google SDK 通道支持传递）
    return single(onProgress, { candidateCount: plan.n });
  }

  try {
    const result = await runImageCountBatch(plan.requestCount, onProgress, (progress, options) =>
      single(progress, options)
    );

    // 整批完成只发一次完成通知；仅 Lemon Tauri 流式通道原本带通知，其他通道保持静默
    if (!result.error) {
      try {
        if (isTauri() && isLemonImageProvider(getProviderConfig(nodeType))) {
          await sendGenerationNotification(params.prompt);
        }
      } catch {
        // 供应商配置读取失败不影响生成结果
      }
    }

    return result;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { error: "已取消" };
    }
    return { error: error instanceof Error ? error.message : "生成失败" };
  }
}

// 文本生成图片（支持张数：缺省 1 张，行为与既有单图生成一致）
// 文本生成图片
export async function generateImage(
  params: ImageGenerationWithCountParams,
  nodeType: ImageNodeType,
  onProgress?: (text: string) => void,
  abortSignal?: AbortSignal
): Promise<MultiImageGenerationResponse> {
  return generateWithCount(params, nodeType, onProgress, (progress, options) =>
    generateSingleImage(params, nodeType, progress, abortSignal, options)
  );
}

// 文本生成图片（单次请求）
async function generateSingleImage(
  params: ImageGenerationWithCountParams,
  nodeType: ImageNodeType,
  onProgress?: (text: string) => void,
  abortSignal?: AbortSignal,
  options?: { candidateCount?: number; suppressNotification?: boolean }
): Promise<MultiImageGenerationResponse> {
  try {
    const provider = getProviderConfig(nodeType);
    const isPro = params.model === "gemini-3-pro-image-preview";
    const apiBaseUrl = getApiBaseUrl(provider.baseUrl, provider.protocol);

    // 在 Tauri 环境中使用后端代理
    if (isTauri()) {
      // Lemon API 特殊处理
      if (isLemonImageProvider(provider)) {
        return toMultiResponse(await invokeLemonImageGeneration({
          prompt: params.prompt,
          model: params.model,
          suppressNotification: options?.suppressNotification
        }, provider, onProgress));
      }

      return toMultiResponse(await invokeGemini(
        {
          baseUrl: apiBaseUrl,
          apiKey: provider.apiKey,
          model: params.model,
          prompt: params.prompt,
          aspectRatio: params.aspectRatio || "1:1",
          imageSize: isPro ? params.imageSize : undefined,
        },
        { name: provider.name, protocol: provider.protocol }
      ));
    }

    // Web 环境 (或 Tauri 检测失败)
    // 如果是 OpenAI 协议 (如 Lemon API)，也使用 invokeLemonImageGeneration (复用其 Stream 逻辑)
    if (isLemonImageProvider(provider)) {
      return toMultiResponse(await invokeLemonImageGeneration({
        prompt: params.prompt,
        model: params.model,
        suppressNotification: options?.suppressNotification
      }, provider, onProgress));
    }

    // Google 协议则继续使用 SDK
    const client = createClient(nodeType);

    const response = await client.models.generateContent({
      model: params.model,
      contents: [{ parts: [{ text: params.prompt }] }],
      config: {
        responseModalities: params.responseModalities || ["IMAGE"],
        imageConfig: {
          aspectRatio: params.aspectRatio || "1:1",
          ...(isPro && params.imageSize ? { imageSize: params.imageSize } : {}),
        },
        // 上游 n 直传（candidateCount）：当前上游不支持多候选，仅 planImageCountRequests
        // 命中 "upstream-n" 时由 options 传入；普通请求恒为 undefined
        ...(options?.candidateCount && options.candidateCount > 1
          ? { candidateCount: options.candidateCount }
          : {}),
        abortSignal,
      },
    });

    // 解析响应：收集全部候选中的图片（上游 n 直传返回多候选时可一次取回多张）
    const candidates = response.candidates || [];
    if (candidates.length === 0 || !candidates[0]?.content?.parts) {
      return { error: "无有效响应" };
    }

    const images: string[] = [];
    let text: string | undefined;

    for (const candidate of candidates) {
      for (const part of candidate.content?.parts || []) {
        if (part.inlineData?.data) {
          images.push(part.inlineData.data);
        } else if (part.text) {
          text = part.text;
        }
      }
    }

    return {
      images: images.length > 0 ? images : undefined,
      imageData: images[0],
      text,
    };
  } catch (error) {
    // 检查是否是中断错误
    if (error instanceof Error && error.name === "AbortError") {
      return { error: "已取消" };
    }
    const message = error instanceof Error ? error.message : "生成失败";
    return { error: message };
  }
}

// 图片编辑（支持多图输入与张数：缺省 1 张，行为与既有单图编辑一致）
export async function editImage(
  params: ImageEditWithCountParams,
  nodeType: ImageNodeType,
  onProgress?: (text: string) => void,
  abortSignal?: AbortSignal
): Promise<MultiImageGenerationResponse> {
  console.log("[imageService] editImage called, images count:", params.inputImages?.length || 0);

  return generateWithCount(params, nodeType, onProgress, (progress, options) =>
    editSingleImage(params, nodeType, progress, abortSignal, options)
  );
}

// 图片编辑（单次请求）
async function editSingleImage(
  params: ImageEditWithCountParams,
  nodeType: ImageNodeType,
  onProgress?: (text: string) => void,
  abortSignal?: AbortSignal,
  options?: { candidateCount?: number; suppressNotification?: boolean }
): Promise<MultiImageGenerationResponse> {
  console.log("[imageService] editSingleImage called, images count:", params.inputImages?.length || 0);

  try {
    const provider = getProviderConfig(nodeType);
    const isPro = params.model === "gemini-3-pro-image-preview";
    const apiBaseUrl = getApiBaseUrl(provider.baseUrl, provider.protocol);

    // 在 Tauri 环境中使用后端代理
    if (isTauri()) {
      console.log("[imageService] Using Tauri backend proxy");
      // Lemon API 特殊处理
      if (isLemonImageProvider(provider)) {
        return toMultiResponse(await invokeLemonImageGeneration({
          prompt: params.prompt,
          model: params.model,
          inputImages: params.inputImages,
          suppressNotification: options?.suppressNotification
        }, provider, onProgress));
      }

      return toMultiResponse(await invokeGemini(
        {
          baseUrl: apiBaseUrl,
          apiKey: provider.apiKey,
          model: params.model,
          prompt: params.prompt,
          inputImages: params.inputImages,
          aspectRatio: params.aspectRatio || "1:1",
          imageSize: isPro ? params.imageSize : undefined,
        },
        { name: provider.name, protocol: provider.protocol }
      ));
    }

    // Web 环境 (或 Tauri 检测失败) - OpenAI 协议处理
    if (isLemonImageProvider(provider)) {
      return toMultiResponse(await invokeLemonImageGeneration({
        prompt: params.prompt,
        model: params.model,
        inputImages: params.inputImages,
        suppressNotification: options?.suppressNotification
      }, provider, onProgress));
    }

    console.log("[imageService] Using browser SDK (not Tauri)");
    // Web 环境使用 SDK
    const client = createClient(nodeType);

    // Google SDK Logic ...
    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
      { text: params.prompt },
    ];

    // 添加所有输入图片
    if (params.inputImages && params.inputImages.length > 0) {
      for (const imageData of params.inputImages) {
        // SDK expects pure base64
        const cleanData = imageData.replace(/^data:image\/\w+;base64,/, "");
        parts.push({
          inlineData: {
            mimeType: "image/png",
            data: cleanData,
          },
        });
      }
    }

    const response = await client.models.generateContent({
      model: params.model,
      contents: [{ parts }],
      config: {
        responseModalities: params.responseModalities || ["IMAGE"],
        imageConfig: {
          aspectRatio: params.aspectRatio || "1:1",
          ...(isPro && params.imageSize ? { imageSize: params.imageSize } : {}),
        },
        // 上游 n 直传（candidateCount）：当前上游不支持多候选，仅 planImageCountRequests
        // 命中 "upstream-n" 时由 options 传入；普通请求恒为 undefined
        ...(options?.candidateCount && options.candidateCount > 1
          ? { candidateCount: options.candidateCount }
          : {}),
        abortSignal,
      },
    });

    // 解析响应：收集全部候选中的图片（上游 n 直传返回多候选时可一次取回多张）
    const candidates = response.candidates || [];
    if (candidates.length === 0 || !candidates[0]?.content?.parts) {
      return { error: "无有效响应" };
    }

    const images: string[] = [];
    let text: string | undefined;

    for (const candidate of candidates) {
      for (const part of candidate.content?.parts || []) {
        if (part.inlineData?.data) {
          images.push(part.inlineData.data);
        } else if (part.text) {
          text = part.text;
        }
      }
    }

    return {
      images: images.length > 0 ? images : undefined,
      imageData: images[0],
      text,
    };
  } catch (error) {
    // 检查是否是中断错误
    if (error instanceof Error && error.name === "AbortError") {
      return { error: "已取消" };
    }
    const message = error instanceof Error ? error.message : "编辑失败";
    return { error: message };
  }
}
