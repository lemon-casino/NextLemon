import { beforeEach, describe, expect, it, vi } from "vitest";

// imageService 多图张数测试：mock Google SDK（Web + Google 协议路径，node 环境无 window
// 故 isTauri 为 false），验证按张数拆分请求、≤3 信号量并发、部分/全部失败聚合，
// 以及单张时与既有行为一致（只发一次请求）。

const h = vi.hoisted(() => ({
  generateContent: vi.fn(),
}));

// GoogleGenAI 以 new 调用，mock 必须是 class/构造函数（箭头函数实现无法被 new）
vi.mock("@google/genai", () => {
  class GoogleGenAI {
    models: { generateContent: unknown };
    constructor() {
      this.models = { generateContent: h.generateContent };
    }
  }
  return { GoogleGenAI };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(async () => false),
  requestPermission: vi.fn(),
  sendNotification: vi.fn(),
}));

vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: {
    getState: () => ({
      settings: {
        enableCustomProviders: true,
        providers: [
          {
            id: "prov-image",
            name: "测试供应商",
            apiKey: "key-test",
            baseUrl: "https://gen.example.com",
            protocol: "google",
          },
        ],
        nodeProviders: { imageGeneratorPro: "prov-image" },
      },
    }),
  },
}));

import { editImage, generateImage } from "@/services/imageService";
import { IMAGE_GEN_MAX_PARALLEL } from "@/types/generation";

// 单候选、单图片的 SDK 响应
function singleImageResponse(data: string) {
  return {
    candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data } }] } }],
  };
}

// 等待一个宏任务，让信号量与任务启动的微任务链全部落地
async function flushAsync() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("generateImage 多图张数", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("缺省张数保持单次请求，返回 imageData 与单元素 images", async () => {
    h.generateContent.mockResolvedValue(singleImageResponse("img-0"));

    const result = await generateImage({ prompt: "p", model: "m" }, "imageGeneratorPro");

    expect(h.generateContent).toHaveBeenCalledTimes(1);
    expect(result.error).toBeUndefined();
    expect(result.imageData).toBe("img-0");
    expect(result.images).toEqual(["img-0"]);
  });

  it("count=3 时按张数拆分 3 次请求并按顺序聚合 images", async () => {
    let started = 0;
    h.generateContent.mockImplementation(async () => {
      const index = started;
      started += 1;
      return singleImageResponse(`img-${index}`);
    });

    const result = await generateImage(
      { prompt: "p", model: "m", count: 3 },
      "imageGeneratorPro"
    );

    expect(h.generateContent).toHaveBeenCalledTimes(3);
    expect(result.images).toEqual(["img-0", "img-1", "img-2"]);
    // imageData 兼容字段取首图
    expect(result.imageData).toBe("img-0");
  });

  it("多图请求并发不超过 IMAGE_GEN_MAX_PARALLEL(3)", async () => {
    let active = 0;
    let maxActive = 0;
    let started = 0;
    const resolvers: Array<() => void> = [];
    h.generateContent.mockImplementation(async () => {
      const index = started;
      started += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => resolvers.push(resolve));
      active -= 1;
      return singleImageResponse(`img-${index}`);
    });

    const promise = generateImage({ prompt: "p", model: "m", count: 4 }, "imageGeneratorPro");
    await flushAsync();

    // 第 4 个请求必须等有空闲槽位才会启动
    expect(h.generateContent).toHaveBeenCalledTimes(3);

    // 放行前 3 个请求后，第 4 个请求获得空闲槽位启动
    resolvers.splice(0).forEach((resolve) => resolve());
    await flushAsync();
    expect(h.generateContent).toHaveBeenCalledTimes(4);

    // 放行最后一个请求，整批收尾
    resolvers.splice(0).forEach((resolve) => resolve());
    const result = await promise;

    expect(maxActive).toBe(Math.min(4, IMAGE_GEN_MAX_PARALLEL));
    expect(result.images).toEqual(["img-0", "img-1", "img-2", "img-3"]);
  });

  it("部分失败时聚合成功图片并携带 failedCount/partialError", async () => {
    let started = 0;
    h.generateContent.mockImplementation(async () => {
      const index = started;
      started += 1;
      if (index === 1) throw new Error("配额不足");
      return singleImageResponse(`img-${index}`);
    });

    const result = await generateImage({ prompt: "p", model: "m", count: 3 }, "imageGeneratorPro");

    expect(h.generateContent).toHaveBeenCalledTimes(3);
    expect(result.images).toEqual(["img-0", "img-2"]);
    expect(result.error).toBeUndefined();
    // 部分失败信息：成功 2 张、失败 1 张（UI 据此呈现「成功 N 张、失败 M 张」）
    expect(result.failedCount).toBe(1);
    expect(result.partialError).toBe("配额不足");
  });

  it("全部失败时返回首个错误且无 images，并保留请求返回的 text 供排查", async () => {
    let started = 0;
    h.generateContent.mockImplementation(async () => {
      const index = started;
      started += 1;
      if (index === 0) throw new Error("配额不足");
      // 另一请求失败但携带流式思考文本（与 Lemon 失败路径的响应形状一致）
      return { candidates: [{ content: { parts: [{ text: "思考内容" }] } }] };
    });

    const result = await generateImage({ prompt: "p", model: "m", count: 2 }, "imageGeneratorPro");

    expect(h.generateContent).toHaveBeenCalledTimes(2);
    expect(result.error).toBe("配额不足");
    expect(result.text).toBe("思考内容");
    expect(result.images).toBeUndefined();
    expect(result.imageData).toBeUndefined();
  });
});

describe("editImage 多图张数（多图参考输入）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("count=2 时每次请求都携带参考输入图片", async () => {
    let started = 0;
    h.generateContent.mockImplementation(async () => {
      const index = started;
      started += 1;
      return singleImageResponse(`edit-${index}`);
    });

    const result = await editImage(
      { prompt: "p", model: "m", inputImages: ["ref-base64"], count: 2 },
      "imageGeneratorPro"
    );

    expect(h.generateContent).toHaveBeenCalledTimes(2);
    expect(result.images).toEqual(["edit-0", "edit-1"]);

    for (const call of h.generateContent.mock.calls) {
      const parts = (call[0] as { contents: Array<{ parts: unknown[] }> }).contents[0].parts;
      // 文本提示词 + 1 张参考输入图
      expect(parts).toHaveLength(2);
      expect((parts[1] as { inlineData: { data: string } }).inlineData.data).toBe("ref-base64");
    }
  });
});
