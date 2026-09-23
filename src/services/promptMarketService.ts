import {
  promptCategories as builtinPromptCategories,
  promptIconMap,
  type PromptCategory,
  type PromptItem,
  type PromptNodeTemplate,
} from "@/config/promptConfig";

// 在线提示词市场：运行时从配置的 GitHub 仓库拉取提示词清单。
// - 1 小时内存缓存，并发调用共享同一个请求（去重）；
// - 任何失败（网络/解析/清单为空）都静默回退到内置库，绝不抛错打断面板。

export const PROMPT_MARKET_CACHE_TTL_MS = 60 * 60 * 1000;
export const PROMPT_MARKET_CONFIG_STORAGE_KEY = "nextlemon.promptMarket.config";

// 默认仓库与内置提示词同源（内置预览图已引用该仓库），可被 localStorage 配置覆盖。
export const DEFAULT_PROMPT_MARKET_CONFIG: PromptMarketRepoConfig = {
  repo: "ZeroLu/awesome-nanobanana-pro",
  branch: "main",
  path: "prompts.json",
};

export interface PromptMarketRepoConfig {
  /** GitHub 仓库，格式 owner/repo */
  repo: string;
  branch: string;
  /** 仓库内清单文件路径（JSON） */
  path: string;
}

export interface PromptMarketSnapshot {
  categories: PromptCategory[];
  source: "github" | "builtin";
  fetchedAt: number;
  fromCache: boolean;
  /** 回退内置库时的原因，仅供诊断，UI 不强提示 */
  error?: string;
}

interface PromptMarketCache {
  snapshot: PromptMarketSnapshot;
  expiresAt: number;
}

const MAX_MARKET_CATEGORIES = 50;
const MAX_PROMPTS_PER_CATEGORY = 200;

const cache: { current: PromptMarketCache | null } = { current: null };
let inFlight: Promise<PromptMarketSnapshot> | null = null;

const ALLOWED_ASPECT_RATIOS = new Set<string>([
  "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9",
]);

export function getPromptMarketConfig(): PromptMarketRepoConfig {
  try {
    if (typeof localStorage === "undefined") return DEFAULT_PROMPT_MARKET_CONFIG;
    const raw = localStorage.getItem(PROMPT_MARKET_CONFIG_STORAGE_KEY);
    if (!raw) return DEFAULT_PROMPT_MARKET_CONFIG;
    const parsed = JSON.parse(raw) as Partial<PromptMarketRepoConfig> | null;
    if (!parsed || typeof parsed !== "object") return DEFAULT_PROMPT_MARKET_CONFIG;
    return {
      repo: typeof parsed.repo === "string" && parsed.repo.trim() ? parsed.repo.trim() : DEFAULT_PROMPT_MARKET_CONFIG.repo,
      branch: typeof parsed.branch === "string" && parsed.branch.trim() ? parsed.branch.trim() : DEFAULT_PROMPT_MARKET_CONFIG.branch,
      path: typeof parsed.path === "string" && parsed.path.trim() ? parsed.path.trim() : DEFAULT_PROMPT_MARKET_CONFIG.path,
    };
  } catch {
    return DEFAULT_PROMPT_MARKET_CONFIG;
  }
}

export function buildPromptMarketManifestUrl(config: PromptMarketRepoConfig): string {
  const repo = config.repo.replace(/^\/+|\/+$/g, "");
  const branch = config.branch.replace(/^\/+|\/+$/g, "");
  const filePath = config.path.replace(/^\/+|\/+$/g, "");
  return `https://raw.githubusercontent.com/${repo}/${branch}/${filePath}`;
}

function builtinFallback(error: string): PromptMarketSnapshot {
  return {
    categories: builtinPromptCategories,
    source: "builtin",
    fetchedAt: Date.now(),
    fromCache: false,
    error,
  };
}

// 入口：带缓存与并发去重的拉取。force=true（刷新按钮）绕过缓存重新请求。
export async function fetchPromptMarket(
  options: { force?: boolean; fetchImpl?: typeof fetch; config?: PromptMarketRepoConfig } = {}
): Promise<PromptMarketSnapshot> {
  const now = Date.now();
  if (!options.force && cache.current && cache.current.expiresAt > now) {
    return { ...cache.current.snapshot, fromCache: true };
  }
  if (inFlight) return inFlight;

  inFlight = (async (): Promise<PromptMarketSnapshot> => {
    const config = options.config || getPromptMarketConfig();
    if (!config.repo || !config.path) {
      return builtinFallback("在线提示词仓库未配置");
    }

    try {
      const fetchImpl = options.fetchImpl || fetch;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      let response: Response;
      try {
        response = await fetchImpl(buildPromptMarketManifestUrl(config), {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) {
        return builtinFallback(`在线提示词清单请求失败 (${response.status})`);
      }
      const data = (await response.json()) as unknown;
      const categories = sanitizeMarketCategories(data);
      if (categories.length === 0) {
        return builtinFallback("在线提示词清单为空或格式无效");
      }
      const snapshot: PromptMarketSnapshot = {
        categories,
        source: "github",
        fetchedAt: Date.now(),
        fromCache: false,
      };
      cache.current = { snapshot, expiresAt: Date.now() + PROMPT_MARKET_CACHE_TTL_MS };
      return snapshot;
    } catch (error) {
      return builtinFallback(error instanceof Error ? error.message : "在线提示词拉取失败");
    }
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

// 仅供测试/强制刷新后重置内存缓存
export function resetPromptMarketCache(): void {
  cache.current = null;
}

// 把远程清单（{categories:[...]} 或裸 PromptItem 数组）清洗为合法 PromptCategory；
// 非法条目直接跳过，不抛错。
export function sanitizeMarketCategories(data: unknown): PromptCategory[] {
  const rawCategories = extractRawCategories(data);
  const categories: PromptCategory[] = [];
  for (const rawCategory of rawCategories) {
    if (categories.length >= MAX_MARKET_CATEGORIES) break;
    if (!rawCategory || typeof rawCategory !== "object") continue;
    const record = rawCategory as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const prompts = Array.isArray(record.prompts) ? record.prompts : [];
    if (!name) continue;

    const sanitizedPrompts = prompts
      .slice(0, MAX_PROMPTS_PER_CATEGORY)
      .map(sanitizeMarketPrompt)
      .filter((item): item is PromptItem => Boolean(item));
    if (sanitizedPrompts.length === 0) continue;

    const icon = typeof record.icon === "string" && promptIconMap[record.icon] ? record.icon : "Sparkles";
    categories.push({
      id: typeof record.id === "string" && record.id.trim() ? record.id.trim() : `market-${categories.length + 1}`,
      name,
      nameEn: typeof record.nameEn === "string" ? record.nameEn : name,
      icon,
      description: typeof record.description === "string" ? record.description : "",
      prompts: sanitizedPrompts,
    });
  }
  return categories;
}

function extractRawCategories(data: unknown): unknown[] {
  if (Array.isArray(data)) {
    // 裸提示词数组：归入单个「在线提示词」分组
    return data.length > 0 ? [{ id: "market", name: "在线提示词", icon: "Sparkles", description: "", prompts: data }] : [];
  }
  if (data && typeof data === "object" && Array.isArray((data as Record<string, unknown>).categories)) {
    return (data as Record<string, unknown>).categories as unknown[];
  }
  return [];
}

function sanitizeMarketPrompt(raw: unknown): PromptItem | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const title = typeof record.title === "string" ? record.title.trim() : "";
  const prompt = typeof record.prompt === "string" ? record.prompt.trim() : "";
  if (!title || !prompt) return null;

  const nodeTemplate = sanitizeNodeTemplate(record.nodeTemplate);
  const previewImage = typeof record.previewImage === "string" &&
    (/^https?:\/\//.test(record.previewImage) || record.previewImage.startsWith("/"))
    ? record.previewImage
    : undefined;

  return {
    id: typeof record.id === "string" && record.id.trim() ? record.id.trim() : `market-prompt-${title}`,
    title,
    titleEn: typeof record.titleEn === "string" ? record.titleEn : title,
    description: typeof record.description === "string" ? record.description : "",
    prompt,
    tags: Array.isArray(record.tags)
      ? record.tags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0).slice(0, 12)
      : [],
    source: typeof record.source === "string" ? record.source : "github",
    previewImage,
    nodeTemplate,
  };
}

function sanitizeNodeTemplate(raw: unknown): PromptNodeTemplate {
  const record = raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
  const generatorType = record.generatorType === "fast" ? "fast" : "pro";
  const aspectRatio = typeof record.aspectRatio === "string" && ALLOWED_ASPECT_RATIOS.has(record.aspectRatio)
    ? (record.aspectRatio as PromptNodeTemplate["aspectRatio"])
    : "1:1";
  return {
    requiresImageInput: record.requiresImageInput === true,
    generatorType,
    aspectRatio,
  };
}
