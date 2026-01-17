import { GoogleGenAI } from "@google/genai";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ImageGenerationParams, ImageEditParams, GenerationResponse, ProviderProtocol, ErrorDetails } from "@/types";
import { useSettingsStore } from "@/stores/settingsStore";
import { LEMON_API_CONFIG, PROXY_PATH } from "@/config/lemonApi";

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

// 专门用于处理 Lemon API 的图像生成（通过 OpenAI Chat 接口返回 Markdown 图片）
// 专门用于处理 Lemon API 的图像生成（通过 OpenAI Chat 接口返回 Markdown 图片）
async function invokeLemonImageGeneration(
  params: { prompt: string; inputImages?: string[]; model: string },
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

      const cleanup = () => {
        unlistenData?.();
        unlistenError?.();
        unlistenDone?.();
      };

      const finish = () => {
        const match = accumulatedText.match(/!\[.*?\]\((.*?)\)/);
        if (match && match[1]) {
          let imageData = match[1];
          if (imageData.startsWith("data:")) imageData = imageData.split(",")[1];
          resolve({ imageData, text: accumulatedText });
        } else {
          resolve({ error: "未能从响应中提取图片", text: accumulatedText });
        }
      };

      unlistenData = await listen<string>(`stream://${channelId}`, (event) => {
        const chunk = event.payload;
        const lines = chunk.split("\n");
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



// 文本生成图片
// 文本生成图片
export async function generateImage(
  params: ImageGenerationParams,
  nodeType: ImageNodeType,
  onProgress?: (text: string) => void,
  abortSignal?: AbortSignal
): Promise<GenerationResponse> {
  try {
    const provider = getProviderConfig(nodeType);
    const isPro = params.model === "gemini-3-pro-image-preview";
    const apiBaseUrl = getApiBaseUrl(provider.baseUrl, provider.protocol);

    // 在 Tauri 环境中使用后端代理
    if (isTauri()) {
      // Lemon API 特殊处理
      // 检查 ID 是否匹配 (默认 Lemon API ID 或 Image ID)
      if (provider.protocol === "openai" && (provider.id === LEMON_API_CONFIG.id || provider.id === LEMON_API_CONFIG.imageId)) {
        return await invokeLemonImageGeneration({
          prompt: params.prompt,
          model: params.model
        }, provider, onProgress);
      }

      return await invokeGemini(
        {
          baseUrl: apiBaseUrl,
          apiKey: provider.apiKey,
          model: params.model,
          prompt: params.prompt,
          aspectRatio: params.aspectRatio || "1:1",
          imageSize: isPro ? params.imageSize : undefined,
        },
        { name: provider.name, protocol: provider.protocol }
      );
    }

    // Web 环境 (或 Tauri 检测失败)
    // 如果是 OpenAI 协议 (如 Lemon API)，也使用 invokeLemonImageGeneration (复用其 Stream 逻辑)
    if (provider.protocol === "openai") {
      return await invokeLemonImageGeneration({
        prompt: params.prompt,
        model: params.model
      }, provider, onProgress);
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
        abortSignal,
      },
    });

    // 解析响应
    const candidate = response.candidates?.[0];
    if (!candidate?.content?.parts) {
      return { error: "无有效响应" };
    }

    let imageData: string | undefined;
    let text: string | undefined;

    for (const part of candidate.content.parts) {
      if (part.inlineData) {
        imageData = part.inlineData.data;
      } else if (part.text) {
        text = part.text;
      }
    }

    return { imageData, text };
  } catch (error) {
    // 检查是否是中断错误
    if (error instanceof Error && error.name === "AbortError") {
      return { error: "已取消" };
    }
    const message = error instanceof Error ? error.message : "生成失败";
    return { error: message };
  }
}

// 图片编辑（支持多图输入）
export async function editImage(
  params: ImageEditParams,
  nodeType: ImageNodeType,
  onProgress?: (text: string) => void,
  abortSignal?: AbortSignal
): Promise<GenerationResponse> {
  console.log("[imageService] editImage called, images count:", params.inputImages?.length || 0);

  try {
    const provider = getProviderConfig(nodeType);
    const isPro = params.model === "gemini-3-pro-image-preview";
    const apiBaseUrl = getApiBaseUrl(provider.baseUrl, provider.protocol);

    // 在 Tauri 环境中使用后端代理
    if (isTauri()) {
      console.log("[imageService] Using Tauri backend proxy");
      // Lemon API 特殊处理
      if (provider.protocol === "openai" && (provider.id === LEMON_API_CONFIG.id || provider.id === LEMON_API_CONFIG.imageId)) {
        return await invokeLemonImageGeneration({
          prompt: params.prompt,
          model: params.model,
          inputImages: params.inputImages
        }, provider, onProgress);
      }

      return await invokeGemini(
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
      );
    }

    // Web 环境 (或 Tauri 检测失败) - OpenAI 协议处理
    if (provider.protocol === "openai") {
      return await invokeLemonImageGeneration({
        prompt: params.prompt,
        model: params.model,
        inputImages: params.inputImages
      }, provider, onProgress);
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
        abortSignal,
      },
    });

    // 解析响应
    const candidate = response.candidates?.[0];
    if (!candidate?.content?.parts) {
      return { error: "无有效响应" };
    }

    let imageData: string | undefined;
    let text: string | undefined;

    for (const part of candidate.content.parts) {
      if (part.inlineData) {
        imageData = part.inlineData.data;
      } else if (part.text) {
        text = part.text;
      }
    }

    return { imageData, text };
  } catch (error) {
    // 检查是否是中断错误
    if (error instanceof Error && error.name === "AbortError") {
      return { error: "已取消" };
    }
    const message = error instanceof Error ? error.message : "编辑失败";
    return { error: message };
  }
}
