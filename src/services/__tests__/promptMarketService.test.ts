import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PROMPT_MARKET_CONFIG,
  PROMPT_MARKET_CACHE_TTL_MS,
  buildPromptMarketManifestUrl,
  fetchPromptMarket,
  getPromptMarketConfig,
  resetPromptMarketCache,
  sanitizeMarketCategories,
} from "@/services/promptMarketService";
import { promptCategories as builtinPromptCategories } from "@/config/promptConfig";

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const validManifest = {
  categories: [
    {
      id: "market-cat",
      name: "市场精选",
      icon: "Camera",
      description: "来自 GitHub 的提示词",
      prompts: [
        {
          id: "market-1",
          title: "在线提示词 A",
          description: "描述 A",
          prompt: "Create something great",
          tags: ["在线", "测试"],
          source: "@someone",
          previewImage: "https://example.com/a.png",
          nodeTemplate: { requiresImageInput: false, generatorType: "pro", aspectRatio: "16:9" },
        },
        { title: "缺 prompt 的条目", description: "应被跳过" },
      ],
    },
    { name: "全部条目非法", prompts: [{ title: "no prompt" }] },
  ],
};

describe("sanitizeMarketCategories", () => {
  it("sanitizes a categories manifest and skips invalid entries", () => {
    const categories = sanitizeMarketCategories(validManifest);
    expect(categories).toHaveLength(1);
    expect(categories[0].id).toBe("market-cat");
    expect(categories[0].name).toBe("市场精选");
    expect(categories[0].prompts).toHaveLength(1);

    const prompt = categories[0].prompts[0];
    expect(prompt.title).toBe("在线提示词 A");
    expect(prompt.nodeTemplate).toEqual({ requiresImageInput: false, generatorType: "pro", aspectRatio: "16:9" });
    expect(prompt.previewImage).toBe("https://example.com/a.png");
  });

  it("groups a bare prompt array into a single online category and clamps unsafe fields", () => {
    const categories = sanitizeMarketCategories([
      {
        title: "裸提示词",
        prompt: "Do magic",
        previewImage: "javascript:alert(1)",
        nodeTemplate: { requiresImageInput: true, generatorType: "ultra", aspectRatio: "99:1" },
      },
    ]);
    expect(categories).toHaveLength(1);
    expect(categories[0].id).toBe("market");
    expect(categories[0].prompts[0].previewImage).toBeUndefined();
    expect(categories[0].prompts[0].nodeTemplate).toEqual({
      requiresImageInput: true,
      generatorType: "pro",
      aspectRatio: "1:1",
    });
  });

  it("returns empty for malformed payloads", () => {
    expect(sanitizeMarketCategories(null)).toEqual([]);
    expect(sanitizeMarketCategories({ foo: 1 })).toEqual([]);
    expect(sanitizeMarketCategories({ categories: "nope" })).toEqual([]);
  });
});

describe("fetchPromptMarket", () => {
  beforeEach(() => {
    resetPromptMarketCache();
  });

  it("falls back to the builtin library on network failure without throwing", async () => {
    const fetchImpl = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    const snapshot = await fetchPromptMarket({ fetchImpl });
    expect(snapshot.source).toBe("builtin");
    expect(snapshot.categories).toEqual(builtinPromptCategories);
    expect(snapshot.error).toContain("network down");
    expect(snapshot.fromCache).toBe(false);
  });

  it("falls back to the builtin library on HTTP and JSON failures", async () => {
    const httpFail = await fetchPromptMarket({
      fetchImpl: (async () => jsonResponse({}, 404)) as unknown as typeof fetch,
    });
    expect(httpFail.source).toBe("builtin");
    expect(httpFail.error).toContain("404");

    resetPromptMarketCache();
    const badJson = await fetchPromptMarket({
      fetchImpl: (async () => jsonResponse({ categories: [{ name: "空分类", prompts: [] }] })) as unknown as typeof fetch,
    });
    expect(badJson.source).toBe("builtin");
    expect(badJson.error).toContain("为空");
  });

  it("parses a valid manifest into github-sourced categories", async () => {
    const snapshot = await fetchPromptMarket({
      fetchImpl: (async () => jsonResponse(validManifest)) as unknown as typeof fetch,
    });
    expect(snapshot.source).toBe("github");
    expect(snapshot.categories).toHaveLength(1);
    expect(snapshot.categories[0].prompts[0].title).toBe("在线提示词 A");
    expect(snapshot.error).toBeUndefined();
  });

  it("serves repeat reads from the in-memory cache until force refresh", async () => {
    let callCount = 0;
    const fetchImpl = (async () => {
      callCount += 1;
      return jsonResponse(validManifest);
    }) as unknown as typeof fetch;

    const first = await fetchPromptMarket({ fetchImpl });
    const second = await fetchPromptMarket({ fetchImpl });
    expect(first.fromCache).toBe(false);
    expect(second.fromCache).toBe(true);
    expect(callCount).toBe(1);

    const refreshed = await fetchPromptMarket({ fetchImpl, force: true });
    expect(refreshed.fromCache).toBe(false);
    expect(callCount).toBe(2);
  });

  it("dedupes concurrent requests into a single fetch", async () => {
    let callCount = 0;
    let release: (value: Response) => void = () => {};
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const fetchImpl = (async () => {
      callCount += 1;
      return pending;
    }) as unknown as typeof fetch;

    const promiseA = fetchPromptMarket({ fetchImpl });
    const promiseB = fetchPromptMarket({ fetchImpl });
    release(jsonResponse(validManifest));
    const [a, b] = await Promise.all([promiseA, promiseB]);

    expect(callCount).toBe(1);
    expect(a.source).toBe("github");
    expect(b.source).toBe("github");
  });

  it("refetches after the cache is reset (TTL expiry uses the same path)", async () => {
    expect(PROMPT_MARKET_CACHE_TTL_MS).toBe(60 * 60 * 1000);
    let callCount = 0;
    const fetchImpl = (async () => {
      callCount += 1;
      return jsonResponse(validManifest);
    }) as unknown as typeof fetch;

    await fetchPromptMarket({ fetchImpl });
    resetPromptMarketCache();
    await fetchPromptMarket({ fetchImpl });
    expect(callCount).toBe(2);
  });
});

describe("prompt market config", () => {
  it("falls back to the default repo config outside the browser", () => {
    expect(getPromptMarketConfig()).toEqual(DEFAULT_PROMPT_MARKET_CONFIG);
    expect(DEFAULT_PROMPT_MARKET_CONFIG.repo).toContain("/");
  });

  it("builds a raw GitHub manifest URL", () => {
    expect(buildPromptMarketManifestUrl({ repo: "owner/repo", branch: "main", path: "data/prompts.json" })).toBe(
      "https://raw.githubusercontent.com/owner/repo/main/data/prompts.json"
    );
  });
});
