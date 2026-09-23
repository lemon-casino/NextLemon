import { describe, expect, it } from "vitest";
import {
  createPageItemsFromOutline,
  mapWithConcurrency,
  parseOutlineContent,
  PPT_PAGE_MAX_PARALLEL,
  resolveAssetMentionsInPrompt,
  type MentionResolvableAsset,
} from "@/components/nodes/PPTContentNode/executionCore";
import type { PPTOutline } from "@/components/nodes/PPTContentNode/types";

function createOutlineFixture(pageCount = 2): PPTOutline {
  return {
    title: "测试 PPT",
    pages: Array.from({ length: pageCount }, (_, index) => ({
      pageNumber: index + 1,
      heading: `第 ${index + 1} 页标题`,
      points: ["**要点一**", "要点二"],
      script: "讲稿内容",
    })),
  };
}

describe("PPT 页面信号量并发", () => {
  it("默认并发上限与工作流引擎的 maxParallel 默认值一致", () => {
    expect(PPT_PAGE_MAX_PARALLEL).toBe(3);
  });

  it("同时运行的任务数不超过上限", async () => {
    let running = 0;
    let maxRunning = 0;

    const results = await mapWithConcurrency(
      Array.from({ length: 20 }, (_, index) => index),
      PPT_PAGE_MAX_PARALLEL,
      async (item) => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running--;
        return item;
      }
    );

    expect(maxRunning).toBeLessThanOrEqual(PPT_PAGE_MAX_PARALLEL);
    expect(results).toEqual(Array.from({ length: 20 }, (_, index) => index));
  });

  it("按原始顺序返回结果，与完成先后无关", async () => {
    const results = await mapWithConcurrency(
      [10, 20, 30, 40],
      PPT_PAGE_MAX_PARALLEL,
      async (item, index) => {
        // 越靠后的任务完成越早
        await new Promise((resolve) => setTimeout(resolve, (4 - index) * 10));
        return item * 2;
      }
    );

    expect(results).toEqual([20, 40, 60, 80]);
  });

  it("任务数少于上限或上限为 1 时都能全部完成", async () => {
    const worker = async (item: number) => item + 1;

    expect(await mapWithConcurrency([1, 2], 3, worker)).toEqual([2, 3]);
    expect(await mapWithConcurrency([1, 2, 3], 1, worker)).toEqual([2, 3, 4]);
  });

  it("非法上限（0/负数）按 1 处理且不影响结果", async () => {
    const results = await mapWithConcurrency([1, 2, 3], 0, async (item) => item);
    expect(results).toEqual([1, 2, 3]);
  });

  it("worker 抛错时 Promise 整体拒绝", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (item) => {
        if (item === 2) throw new Error("生成失败");
        return item;
      })
    ).rejects.toThrow("生成失败");
  });
});

describe("PPT 大纲解析", () => {
  it("解析有效的 JSON 大纲", () => {
    const outline = createOutlineFixture();
    const parsed = parseOutlineContent(JSON.stringify(outline));

    expect(parsed.error).toBeUndefined();
    expect(parsed.outline?.title).toBe("测试 PPT");
    expect(parsed.outline?.pages).toHaveLength(2);
  });

  it("非 JSON 输出返回解析错误", () => {
    const parsed = parseOutlineContent("这不是 JSON");
    expect(parsed.outline).toBeUndefined();
    expect(parsed.error).toBe("输出不是有效的 JSON 格式");
  });

  it("缺少标题或页面的大纲返回结构错误", () => {
    expect(parseOutlineContent(JSON.stringify({ pages: [] })).error).toBe(
      "大纲格式不正确：缺少标题或页面"
    );
    expect(parseOutlineContent(JSON.stringify({ title: "t" })).error).toBe(
      "大纲格式不正确：缺少标题或页面"
    );
  });
});

describe("PPT 大纲初始化页面", () => {
  it("生成全部为 pending 的页面并回填默认值", () => {
    const outline = createOutlineFixture(3);
    const pages = createPageItemsFromOutline(outline);

    expect(pages).toHaveLength(3);
    expect(pages.every((p) => p.status === "pending")).toBe(true);
    expect(new Set(pages.map((p) => p.id)).size).toBe(3);
    pages.forEach((page, index) => {
      expect(page.pageNumber).toBe(index + 1);
      expect(page.heading).toBe(`第 ${index + 1} 页标题`);
      expect(page.points).toEqual(["**要点一**", "要点二"]);
      expect(page.script).toBe("讲稿内容");
    });
  });

  it("页码缺失时回退为索引加一，可选字段透传", () => {
    const pages = createPageItemsFromOutline({
      title: "t",
      pages: [
        { pageNumber: 0, heading: "", points: [], script: "s", imageDesc: "配图" },
      ],
    });

    expect(pages[0].pageNumber).toBe(1);
    expect(pages[0].heading).toBe("");
    expect(pages[0].imageDesc).toBe("配图");
  });
});

describe("@[asset_N] 提及生成时还原", () => {
  const assets: MentionResolvableAsset[] = [
    { label: "asset_0", kind: "image", dataUrl: "data:image/png;base64,AAAA" },
    { label: "asset_1", kind: "image", storagePath: "media/asset-1.png" },
    { label: "asset_2", kind: "text" },
  ];

  it("无提及或无命中时行为不变", async () => {
    expect(await resolveAssetMentionsInPrompt("没有提及的提示词", assets)).toEqual({
      prompt: "没有提及的提示词",
      images: [],
    });
    expect(
      await resolveAssetMentionsInPrompt("引用 @[asset_9] 但素材不存在", assets)
    ).toEqual({ prompt: "引用 @[asset_9] 但素材不存在", images: [] });
  });

  it("命中图片素材时替换为【图N】编号并返回图片数据", async () => {
    const { prompt, images } = await resolveAssetMentionsInPrompt(
      "参考 @[asset_0] 的构图",
      assets
    );

    expect(prompt).toBe("参考 【图1】 的构图");
    expect(images).toEqual(["AAAA"]);
  });

  it("按出现顺序编号，重复提及共享编号", async () => {
    const { prompt, images } = await resolveAssetMentionsInPrompt(
      "用 @[asset_1] 和 @[asset_0]，配色沿用 @[asset_1]",
      assets,
      async () => "BBBB"
    );

    expect(prompt).toBe("用 【图1】 和 【图2】，配色沿用 【图1】");
    expect(images).toEqual(["BBBB", "AAAA"]);
  });

  it("非图片素材保持原样，不影响其他编号", async () => {
    const { prompt, images } = await resolveAssetMentionsInPrompt(
      "文案 @[asset_2] 与图片 @[asset_0]",
      assets
    );

    expect(prompt).toBe("文案 @[asset_2] 与图片 【图1】");
    expect(images).toEqual(["AAAA"]);
  });

  it("优先从 storagePath 加载，加载失败时回退 dataUrl", async () => {
    const storageAsset: MentionResolvableAsset[] = [
      { label: "asset_0", kind: "image", storagePath: "media/a.png", dataUrl: "data:image/png;base64,CCCC" },
    ];

    const loaded = await resolveAssetMentionsInPrompt(
      "图 @[asset_0]",
      storageAsset,
      async () => "DDDD"
    );
    expect(loaded.images).toEqual(["DDDD"]);

    const fallback = await resolveAssetMentionsInPrompt(
      "图 @[asset_0]",
      storageAsset,
      async () => {
        throw new Error("读取失败");
      }
    );
    expect(fallback.images).toEqual(["CCCC"]);
    expect(fallback.prompt).toBe("图 【图1】");
  });
});
