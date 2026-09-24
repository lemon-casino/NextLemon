import { beforeEach, describe, expect, it, vi } from "vitest";

// 编排层测试：mock 服务与 store，验证 nodeExecutor.executeImageGeneratorNode
// 透传张数参数，并在执行结果与节点数据中返回 images 数组（画布批量图组折叠栈的数据源）。

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
    generateImage: vi.fn(),
    editImage: vi.fn(),
  };
});

vi.mock("@/services/imageService", () => ({
  generateImage: h.generateImage,
  editImage: h.editImage,
}));

vi.mock("@/services/llmService", () => ({
  generateText: vi.fn(),
  generateLLMContent: vi.fn(),
  validateJsonOutput: (content: string) => {
    try {
      return { valid: true, data: JSON.parse(content) };
    } catch {
      return { valid: false, error: "输出不是有效的 JSON 格式" };
    }
  },
}));

vi.mock("@/services/videoService", () => ({
  createVideoTask: vi.fn(),
  pollVideoTask: vi.fn(),
}));

vi.mock("@/services/fileStorageService", () => ({
  saveImage: vi.fn(async (_base64: string, _canvasId?: string, nodeId?: string) => ({
    path: `stored/${nodeId}.png`,
  })),
  readImage: vi.fn(async () => "stored-base64"),
  isTauriEnvironment: () => true,
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
        images: h.state.connectedImages.map((img) => img.imageData),
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

function makeImageData(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    label: "NanoBanana Pro",
    model: "img-model",
    aspectRatio: "1:1",
    status: "idle",
    ...overrides,
  };
}

function setupCanvas(data: Record<string, unknown>) {
  h.state.nodes = [
    { id: "prompt-1", type: "promptNode", position: { x: 0, y: 0 }, data: { prompt: "主题" } },
    { id: "img-1", type: "imageGeneratorProNode", position: { x: 400, y: 0 }, data },
  ];
  h.state.edges = [];
  h.state.promptInput = "主题";
  h.state.connectedImages = [];
}

function getImageNode() {
  const node = h.state.nodes.find((n) => n.id === "img-1")!;
  // 直接把画布中的节点交给执行器（与工作流引擎行为一致）
  return node as unknown as Parameters<typeof nodeExecutor.executeNode>[0];
}

function getImageData(): Record<string, unknown> {
  return h.state.nodes.find((n) => n.id === "img-1")!.data;
}

describe("nodeExecutor 图片生成多图张数编排", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("透传张数并在结果与节点数据返回 images 数组（逐张落盘，下标对齐）", async () => {
    setupCanvas(makeImageData({ count: 2 }));
    h.generateImage.mockResolvedValue({ images: ["a", "b"], imageData: "a" });

    const result = await nodeExecutor.executeNode(getImageNode(), "canvas-1");

    expect(result.success).toBe(true);

    // 透传张数与提示词
    const call = h.generateImage.mock.calls[0][0] as Record<string, unknown>;
    expect(call.count).toBe(2);
    expect(call.prompt).toBe("主题");
    expect(h.editImage).not.toHaveBeenCalled();

    // 结果包含多图数组（画布批量栈按 images 落位），路径与 images 下标对齐
    const output = result.output as Record<string, unknown>;
    expect(output.images).toEqual(["a", "b"]);
    expect(output.imagePaths).toEqual(["stored/img-1.png", "stored/img-1-2.png"]);
    expect(output.imageData).toBe("a");

    // 节点数据：首图镜像单图字段保持向后兼容，多图数组与张数齐备
    const data = getImageData();
    expect(data.status).toBe("success");
    expect(data.outputImage).toBe("a");
    expect(data.outputImages).toEqual(["a", "b"]);
    expect(data.outputImagePaths).toEqual(["stored/img-1.png", "stored/img-1-2.png"]);
    expect(data.outputCount).toBe(2);
  });

  it("缺省张数透传 1，单图响应（无 images）兜底为单元素数组", async () => {
    setupCanvas(makeImageData());
    h.generateImage.mockResolvedValue({ imageData: "a" });

    const result = await nodeExecutor.executeNode(getImageNode(), "canvas-1");

    expect(result.success).toBe(true);
    const call = h.generateImage.mock.calls[0][0] as Record<string, unknown>;
    expect(call.count).toBe(1);

    const output = result.output as Record<string, unknown>;
    expect(output.images).toEqual(["a"]);
    const data = getImageData();
    expect(data.outputImages).toEqual(["a"]);
    expect(data.outputCount).toBe(1);
  });

  it("多图参考输入走 editImage 并同样透传张数", async () => {
    setupCanvas(makeImageData({ count: 3 }));
    h.state.connectedImages = [
      { id: "in-1", fileName: "ref.png", imageData: "ref-1" },
    ];
    h.editImage.mockResolvedValue({ images: ["e1", "e2", "e3"], imageData: "e1" });

    const result = await nodeExecutor.executeNode(getImageNode(), "canvas-1");

    expect(result.success).toBe(true);
    expect(h.generateImage).not.toHaveBeenCalled();
    const call = h.editImage.mock.calls[0][0] as Record<string, unknown>;
    expect(call.count).toBe(3);
    expect(call.inputImages).toEqual(["ref-1"]);

    const output = result.output as Record<string, unknown>;
    expect(output.images).toEqual(["e1", "e2", "e3"]);
    const data = getImageData();
    expect(data.outputImages).toEqual(["e1", "e2", "e3"]);
    expect(data.outputCount).toBe(3);
  });

  it("部分失败时节点呈现「成功 N 张、失败 M 张」（partialFailedCount/partialError）", async () => {
    setupCanvas(makeImageData({ count: 2 }));
    h.generateImage.mockResolvedValue({
      images: ["a"],
      imageData: "a",
      failedCount: 1,
      partialError: "配额不足",
    });

    const result = await nodeExecutor.executeNode(getImageNode(), "canvas-1");

    // 部分失败仍算成功收尾，但携带失败信息
    expect(result.success).toBe(true);
    const output = result.output as Record<string, unknown>;
    expect(output.images).toEqual(["a"]);
    expect(output.failedCount).toBe(1);
    expect(output.partialError).toBe("配额不足");

    const data = getImageData();
    expect(data.status).toBe("success");
    expect(data.outputCount).toBe(1);
    expect(data.partialFailedCount).toBe(1);
    expect(data.partialError).toBe("配额不足");
  });

  it("生成失败时保持既有错误结构", async () => {
    setupCanvas(makeImageData({ count: 2 }));
    h.generateImage.mockResolvedValue({ error: "配额不足" });

    const result = await nodeExecutor.executeNode(getImageNode(), "canvas-1");

    expect(result).toEqual({ success: false, error: "配额不足" });
    const data = getImageData();
    expect(data.status).toBe("error");
    expect(data.error).toBe("配额不足");
    expect(data.outputImages).toBeUndefined();
  });
});
