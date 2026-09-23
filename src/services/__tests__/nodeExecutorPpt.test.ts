import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PPTContentNodeData, PPTPageItem } from "@/components/nodes/PPTContentNode/types";

// 编排层测试：mock 服务与 store，验证 nodeExecutor.executePPTContentNode
// 的两阶段流转、错误结构、取消清理与暂停保护。

const h = vi.hoisted(() => {
  const state = {
    activeCanvasId: "canvas-1",
    nodes: [] as Array<{
      id: string;
      type?: string;
      position: { x: number; y: number };
      data: Record<string, unknown>;
    }>,
    edges: [] as Array<{ id: string; source: string; target: string }>,
    promptInput: undefined as string | undefined,
    connectedImages: [] as Array<{ id: string; fileName?: string; imageData: string; imagePath?: string }>,
  };

  const updateNodeData = (nodeId: string, patch: Record<string, unknown>) => {
    const node = state.nodes.find((n) => n.id === nodeId);
    if (node) node.data = { ...node.data, ...patch };
  };

  return {
    state,
    updateNodeData,
    generateText: vi.fn(),
    editImage: vi.fn(),
  };
});

vi.mock("@/services/llmService", () => ({
  generateText: h.generateText,
  generateLLMContent: vi.fn(),
  validateJsonOutput: (content: string) => {
    try {
      return { valid: true, data: JSON.parse(content) };
    } catch {
      return { valid: false, error: "输出不是有效的 JSON 格式" };
    }
  },
}));

vi.mock("@/services/imageService", () => ({
  generateImage: vi.fn(),
  editImage: h.editImage,
}));

vi.mock("@/services/videoService", () => ({
  createVideoTask: vi.fn(),
  pollVideoTask: vi.fn(),
}));

vi.mock("@/services/fileStorageService", () => ({
  saveImage: vi.fn(async () => ({ path: "stored/page.png" })),
  readImage: vi.fn(async () => "stored-base64"),
  isTauriEnvironment: () => false,
  getImageUrl: (path: string) => path,
  formatFileSize: () => "0 B",
  deleteImage: vi.fn(),
}));

vi.mock("@/utils/imageCompression", () => ({
  generateThumbnail: vi.fn(async () => "thumb-base64"),
}));

vi.mock("@/stores/flowStore", () => ({
  useFlowStore: {
    getState: () => ({
      nodes: h.state.nodes,
      edges: h.state.edges,
      updateNodeData: h.updateNodeData,
      getConnectedInputDataAsync: async () => ({
        prompt: h.state.promptInput,
        images: [],
        files: [],
      }),
      getConnectedImagesWithInfoAsync: async () => h.state.connectedImages,
    }),
  },
}));

vi.mock("@/stores/canvasStore", () => ({
  useCanvasStore: {
    getState: () => ({ activeCanvasId: h.state.activeCanvasId, canvases: [] }),
  },
}));

vi.mock("@/stores/creativeStore", () => ({
  useCreativeStore: {
    getState: () => ({ assets: [] }),
  },
}));

import { nodeExecutor } from "@/services/nodeExecutor";

const OUTLINE_JSON = JSON.stringify({
  title: "测试 PPT",
  pages: [
    { pageNumber: 1, heading: "标题页", points: ["a"], script: "s1" },
    { pageNumber: 2, heading: "内容页", points: ["b"], script: "s2" },
  ],
});

function makePptData(overrides: Partial<PPTContentNodeData> = {}): PPTContentNodeData {
  return {
    label: "PPT",
    activeTab: "config",
    outlineConfig: { pageCountRange: "5-8", detailLevel: "moderate", additionalNotes: "" },
    outlineModel: "outline-model",
    imageModel: "image-model",
    outlineStatus: "idle",
    imageConfig: { aspectRatio: "16:9", imageSize: "2K" },
    visualStyleTemplate: "academic",
    firstPageIsTitlePage: true,
    pages: [],
    generationStatus: "idle",
    progress: { completed: 0, total: 0 },
    ...overrides,
  };
}

function setupCanvas(pptData: PPTContentNodeData) {
  h.state.nodes = [
    {
      id: "prompt-1",
      type: "promptNode",
      position: { x: 0, y: 0 },
      data: { prompt: "主题" },
    },
    {
      id: "ppt-1",
      type: "pptContentNode",
      position: { x: 400, y: 0 },
      data: pptData as unknown as Record<string, unknown>,
    },
  ];
  h.state.edges = [];
  h.state.promptInput = "主题";
  h.state.connectedImages = [
    { id: "img-1", fileName: "template.png", imageData: "template-base64" },
  ];
}

function getPptNode() {
  const node = h.state.nodes.find((n) => n.id === "ppt-1")!;
  // 直接把画布中的节点交给执行器（与工作流引擎行为一致）
  return node as unknown as Parameters<typeof nodeExecutor.executeNode>[0];
}

function getPptData(): PPTContentNodeData {
  return h.state.nodes.find((n) => n.id === "ppt-1")!.data as unknown as PPTContentNodeData;
}

describe("nodeExecutor PPT 自动执行编排", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("大纲未就绪时自动生成大纲并逐页生成全部页面", async () => {
    setupCanvas(makePptData());
    h.generateText.mockResolvedValue({ content: OUTLINE_JSON });
    h.editImage.mockResolvedValue({ imageData: "page-img" });

    const result = await nodeExecutor.executeNode(getPptNode(), "canvas-1");

    expect(result.success).toBe(true);

    // 阶段一：走大纲服务路径（结构化输出 + 配置的系统提示词 + 用户模型）
    expect(h.generateText).toHaveBeenCalledTimes(1);
    const outlineCall = h.generateText.mock.calls[0][0] as Record<string, unknown>;
    expect(outlineCall.prompt).toBe("主题");
    expect(outlineCall.model).toBe("outline-model");
    expect(outlineCall.responseJsonSchema).toBeDefined();
    expect(String(outlineCall.systemPrompt)).toContain("PPT 大纲生成助手");

    // 阶段二：逐页走图片服务路径（基底图在输入首位、用户图片模型与图片配置）
    expect(h.editImage).toHaveBeenCalledTimes(2);
    const editCall = h.editImage.mock.calls[0][0] as Record<string, unknown>;
    expect((editCall.inputImages as string[])[0]).toBe("template-base64");
    expect(editCall.model).toBe("image-model");
    expect(editCall.aspectRatio).toBe("16:9");
    expect(editCall.imageSize).toBe("2K");

    // 节点最终状态
    const data = getPptData();
    expect(data.outlineStatus).toBe("ready");
    expect(data.generationStatus).toBe("completed");
    expect(data.progress).toEqual({ completed: 2, total: 2 });
    const pages = data.pages;
    expect(pages).toHaveLength(2);
    expect(pages.every((p) => p.status === "completed")).toBe(true);
    expect(pages[0].result?.image).toBe("page-img");
    expect(pages[0].result?.thumbnail).toBe("thumb-base64");
  });

  it("大纲 LLM 失败时返回既有错误结构且不进入页面阶段", async () => {
    setupCanvas(makePptData());
    h.generateText.mockResolvedValue({ error: "模型超时" });

    const result = await nodeExecutor.executeNode(getPptNode(), "canvas-1");

    expect(result).toEqual({ success: false, error: "模型超时" });
    const data = getPptData();
    expect(data.outlineStatus).toBe("error");
    expect(data.outlineError).toBe("模型超时");
    expect(data.generationStatus).toBe("idle");
    expect(h.editImage).not.toHaveBeenCalled();
  });

  it("大纲输出非法时返回结构错误", async () => {
    setupCanvas(makePptData());
    h.generateText.mockResolvedValue({ content: JSON.stringify({ title: "缺少页面" }) });

    const result = await nodeExecutor.executeNode(getPptNode(), "canvas-1");

    expect(result.success).toBe(false);
    expect(result.error).toBe("大纲格式不正确：缺少标题或页面");
    expect(getPptData().outlineStatus).toBe("error");
    expect(h.editImage).not.toHaveBeenCalled();
  });

  it("部分页面失败时返回 success:false 与聚合错误", async () => {
    setupCanvas(makePptData());
    h.generateText.mockResolvedValue({ content: OUTLINE_JSON });
    h.editImage
      .mockResolvedValueOnce({ imageData: "page-img" })
      .mockRejectedValueOnce(new Error("配额不足"));

    const result = await nodeExecutor.executeNode(getPptNode(), "canvas-1");

    expect(result.success).toBe(false);
    expect(result.error).toBe("1 个页面生成失败");
    const data = getPptData();
    expect(data.generationStatus).toBe("error");
    expect(data.pages.filter((p) => p.status === "completed")).toHaveLength(1);
    const failed = data.pages.find((p) => p.status === "failed");
    expect(failed?.error).toBe("配额不足");
  });

  it("执行前已取消时不触发任何服务调用", async () => {
    setupCanvas(makePptData());
    const controller = new AbortController();
    controller.abort();

    const result = await nodeExecutor.executeNode(getPptNode(), "canvas-1", controller.signal);

    expect(result).toEqual({ success: false, error: "已取消" });
    expect(h.generateText).not.toHaveBeenCalled();
    expect(h.editImage).not.toHaveBeenCalled();
    expect(getPptData().generationStatus).toBe("idle");
  });

  it("页面阶段被取消时清理节点状态，generationStatus 不卡在 running", async () => {
    setupCanvas(makePptData());
    h.generateText.mockResolvedValue({ content: OUTLINE_JSON });
    h.editImage.mockImplementation(async () => {
      // 模拟生成过程中工作流被取消
      controller.abort();
      return { imageData: "page-img" };
    });
    const controller = new AbortController();

    const result = await nodeExecutor.executeNode(getPptNode(), "canvas-1", controller.signal);

    expect(result).toEqual({ success: false, error: "已取消" });
    const data = getPptData();
    // 修复验证：取消后节点级状态被重置为 idle，而不是永久停留在 running
    expect(data.generationStatus).toBe("idle");
    // 页面被恢复为待生成
    expect(data.pages.every((p) => p.status === "pending")).toBe(true);
  });

  it("自动执行期间用户暂停时保留 paused 状态不被覆盖", async () => {
    setupCanvas(makePptData());
    h.generateText.mockResolvedValue({ content: OUTLINE_JSON });
    h.editImage.mockImplementation(async () => {
      // 模拟用户在生成期间点击节点 UI 的暂停按钮
      h.updateNodeData("ppt-1", { generationStatus: "paused" });
      return { imageData: "page-img" };
    });

    const result = await nodeExecutor.executeNode(getPptNode(), "canvas-1");

    const data = getPptData();
    // 修复验证：收尾不再用 completed 覆盖 paused
    expect(data.generationStatus).toBe("paused");
    // 页面已全部完成，工作流节点按成功收尾
    expect(result.success).toBe(true);
    expect(data.pages.every((p) => p.status === "completed")).toBe(true);
  });

  it("缺少提示词与文件输入时返回既有错误结构", async () => {
    setupCanvas(makePptData());
    h.state.promptInput = undefined;

    const result = await nodeExecutor.executeNode(getPptNode(), "canvas-1");

    expect(result).toEqual({ success: false, error: "缺少必需的提示词或文件输入" });
    expect(h.generateText).not.toHaveBeenCalled();
  });

  it("大纲就绪且无待生成页面时直接视为成功", async () => {
    const donePage: PPTPageItem = {
      id: "page-1",
      pageNumber: 1,
      heading: "H",
      points: [],
      script: "",
      status: "completed",
    };
    setupCanvas(
      makePptData({
        outlineStatus: "ready",
        pages: [donePage],
        progress: { completed: 1, total: 1 },
      })
    );

    const result = await nodeExecutor.executeNode(getPptNode(), "canvas-1");

    expect(result.success).toBe(true);
    expect(h.generateText).not.toHaveBeenCalled();
    expect(h.editImage).not.toHaveBeenCalled();
    expect(getPptData().generationStatus).toBe("idle");
  });

  it("缺少模板基底图时返回既有错误结构", async () => {
    setupCanvas(makePptData({ outlineStatus: "ready" }));
    // 预置一个待生成页面
    h.updateNodeData("ppt-1", {
      pages: [
        { id: "page-1", pageNumber: 1, heading: "H", points: [], script: "", status: "pending" },
      ],
      progress: { completed: 0, total: 1 },
    });
    h.state.connectedImages = [];

    const result = await nodeExecutor.executeNode(getPptNode(), "canvas-1");

    expect(result).toEqual({ success: false, error: "请上传模板基底图" });
    expect(h.editImage).not.toHaveBeenCalled();
    expect(getPptData().generationStatus).toBe("idle");
  });
});
