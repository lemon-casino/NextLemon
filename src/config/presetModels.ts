import type { ProviderProtocol, NodeProviderMapping } from "@/types";
import { useSettingsStore } from "@/stores/settingsStore";

// 预设模型选项
export interface PresetModel {
  value: string;
  label: string;
}

// 各协议的 LLM 预设模型
export const LLM_PRESET_MODELS: Record<ProviderProtocol, PresetModel[]> = {
  google: [
    { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { value: "gemini-3-pro-preview", label: "Gemini 3 Pro" },
  ],
  openai: [
    { value: "gpt-5", label: "GPT-5" },
    { value: "gpt-5.1", label: "GPT-5.1" },
    { value: "gpt-5.2", label: "GPT-5.2" },
  ],
  claude: [
    { value: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5" },
    { value: "claude-opus-4-5-20251101", label: "Claude Opus 4.5" },
    { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
  ],
};

// Lemon API 专属模型列表 (Text/LLM)
export const LEMON_API_MODELS: PresetModel[] = [
  { value: "gemini-auto", label: "Gemini Auto (识图/联网/多模态)" },
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { value: "gemini-3-flash-preview", label: "Gemini 3 Flash Preview" },
  { value: "gemini-3-pro-preview", label: "Gemini 3 Pro Preview" },
];

// Lemon API 专属模型列表 (Image)
// Lemon API 专属模型列表 (Image)
export const LEMON_API_IMAGE_MODELS: PresetModel[] = [
  { value: "gemini-3-pro-preview", label: "Gemini 3 Pro Preview" },
  { value: "gemini-3-flash-preview", label: "Gemini 3 Flash Preview" },
  { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { value: "gemini-auto", label: "Gemini Auto" },
];

// 各协议的默认 LLM 模型
export const DEFAULT_LLM_MODELS: Record<ProviderProtocol, string> = {
  google: "gemini-3-pro-preview",
  openai: "gpt-5",
  claude: "claude-sonnet-4-5-20250929",
};

// 各协议的预设 Image 模型 (目前主要复用 LLM 模型列表，因为 Lemon API 使用相同的模型 ID)
export const IMAGE_PRESET_MODELS: Record<ProviderProtocol, PresetModel[]> = {
  google: [
    { value: "gemini-3-pro-preview", label: "Gemini 3 Pro Image" },
    { value: "gemini-2.5-flash-image", label: "Gemini 2.5 Flash Image" },
  ],
  openai: [
    { value: "dall-e-3", label: "DALL-E 3" },
  ],
  claude: [], // Claude 暂不支持生图
};

// 各协议的默认 Image 模型
export const DEFAULT_IMAGE_MODELS: Record<ProviderProtocol, string> = {
  google: "gemini-3-pro-image-preview",
  openai: "dall-e-3",
  claude: "",
};

// 获取指定节点类型对应供应商的协议类型
export function getProviderProtocol(nodeType: keyof NodeProviderMapping): ProviderProtocol {
  const { settings } = useSettingsStore.getState();
  const providerId = settings.nodeProviders[nodeType];

  if (!providerId) {
    return "google";  // 默认返回 Google
  }

  const provider = settings.providers.find((p) => p.id === providerId);
  return provider?.protocol || "google";
}

// 获取指定节点类型的预设 LLM 模型列表
export function getLLMPresetModels(nodeType: keyof NodeProviderMapping): PresetModel[] {
  const { settings } = useSettingsStore.getState();

  // 如果未开启自定义供应商，使用 Lemon API 模型
  if (!settings.enableCustomProviders) {
    return LEMON_API_MODELS;
  }

  const protocol = getProviderProtocol(nodeType);
  return LLM_PRESET_MODELS[protocol] || LLM_PRESET_MODELS.google;
}

// 获取指定节点类型的默认 LLM 模型
export function getDefaultLLMModel(nodeType: keyof NodeProviderMapping): string {
  const { settings } = useSettingsStore.getState();

  // 如果未开启自定义供应商，默认使用 gemini-auto
  if (!settings.enableCustomProviders) {
    return "gemini-auto";
  }

  const protocol = getProviderProtocol(nodeType);
  return DEFAULT_LLM_MODELS[protocol] || DEFAULT_LLM_MODELS.google;
}

// 核心 Helper: 获取动态默认模型 (统一入口)
export function getDynamicDefaultModel(type: 'llm' | 'image'): string {
  const { settings } = useSettingsStore.getState();

  // 1. Lemon API 优先路径
  if (!settings.enableCustomProviders) {
    return type === 'image' ? "gemini-3-pro-preview" : "gemini-auto";
  }

  // 2. 自定义 Provider 路径
  // 获取当前默认协议 (目前简单取 Google，后续可扩展)
  // 如果需要更精确的逻辑，由于这里没有 nodeType 上下文，
  // 我们通常返回 Google 的默认值作为 safe fallback
  const protocol: ProviderProtocol = "google";

  if (type === 'image') {
    return DEFAULT_IMAGE_MODELS[protocol] || DEFAULT_IMAGE_MODELS.google;
  }
  return DEFAULT_LLM_MODELS[protocol] || DEFAULT_LLM_MODELS.google;
}

// React Hook: 获取指定节点类型的预设模型（响应式）
export function useLLMPresetModels(nodeType: keyof NodeProviderMapping): {
  presetModels: PresetModel[];
  defaultModel: string;
  protocol: ProviderProtocol;
} {
  const settings = useSettingsStore((state) => state.settings);

  // 特殊逻辑：默认 Lemon API
  if (!settings.enableCustomProviders) {
    return {
      presetModels: LEMON_API_MODELS,
      defaultModel: "gemini-auto",
      protocol: "openai", // Lemon API 兼容 OpenAI 协议
    };
  }

  const providerId = settings.nodeProviders[nodeType];
  const provider = settings.providers.find((p) => p.id === providerId);
  const protocol = provider?.protocol || "google";

  return {
    presetModels: LLM_PRESET_MODELS[protocol] || LLM_PRESET_MODELS.google,
    defaultModel: DEFAULT_LLM_MODELS[protocol] || DEFAULT_LLM_MODELS.google,
    protocol,
  };
}

// React Hook: 获取指定节点类型的预设图片模型（响应式）
export function useImagePresetModels(nodeType: keyof NodeProviderMapping): {
  presetModels: PresetModel[];
  defaultModel: string;
  protocol: ProviderProtocol;
} {
  const settings = useSettingsStore((state) => state.settings);

  // 特殊逻辑：默认 Lemon API (使用专属图片模型列表)
  if (!settings.enableCustomProviders) {
    return {
      presetModels: LEMON_API_IMAGE_MODELS,
      defaultModel: getDynamicDefaultModel('image'), // 使用统一 Helper
      protocol: "openai",
    };
  }

  const providerId = settings.nodeProviders[nodeType];
  const provider = settings.providers.find((p) => p.id === providerId);
  const protocol = provider?.protocol || "google";

  // Google 协议使用专门的 Image 模型列表，OpenAI 等可能复用 LLM 列表或专门列表
  let models = IMAGE_PRESET_MODELS[protocol] || IMAGE_PRESET_MODELS.google;
  // 如果是 OpenAI 协议但不是 Dall-E (例如用户配置了 Lemon API key)，可能也希望看到 gemini 模型?
  // 暂时按协议返回标准列表

  return {
    presetModels: models,
    defaultModel: DEFAULT_IMAGE_MODELS[protocol] || DEFAULT_IMAGE_MODELS.google,
    protocol,
  };
}
