import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

// imageEditService 依赖 Tauri IPC 与两个 AI 服务：node 测试环境下 mock 掉边界，
// 纯函数与编排逻辑用注入数据驱动，不依赖 DOM/canvas。
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (path: string) => path,
}));
vi.mock("@/services/imageService", () => ({
  editImage: vi.fn(),
}));
vi.mock("@/services/llmService", () => ({
  generateText: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { editImage } from "@/services/imageService";
import { generateText } from "@/services/llmService";
import {
  DEFAULT_IMAGE_EDIT_MODEL,
  DEFAULT_INTERROGATE_MODEL,
  base64ToUint8Array,
  buildExportFileName,
  computeCropRect,
  computeGridSlices,
  computeResizedSize,
  computeRotatedSize,
  guessImageMimeType,
  normalizeRotationAngle,
  parseDataUrl,
  pickClosestAspectRatio,
  resolveImageInput,
  toDataUrl,
  uint8ArrayToBase64,
} from "@/services/imageEditService";
import { inpaintRegion } from "@/services/ocrInpaintService";

const mockedInvoke = vi.mocked(invoke);
const mockedEditImage = vi.mocked(editImage);
const mockedGenerateText = vi.mocked(generateText);

/** 模拟 window.__TAURI_INTERNALS__ 以打开 Tauri 环境分支 */
function enterTauriEnvironment() {
  vi.stubGlobal("window", globalThis);
  (globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {};
}
function leaveTauriEnvironment() {
  delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__;
}

/** 构造最小 fetch Response 替身（ocrInpaintService 只用到 ok/status/text/arrayBuffer） */
function mockResponse(
  ok: boolean,
  status: number,
  body: { bytes?: Uint8Array; text?: string }
): Response {
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    text: async () => body.text ?? "",
    arrayBuffer: async () => (body.bytes ?? new Uint8Array()).buffer,
  } as unknown as Response;
}

beforeEach(() => {
  leaveTauriEnvironment();
  mockedInvoke.mockReset();
  mockedEditImage.mockReset();
  mockedGenerateText.mockReset();
  vi.unstubAllGlobals();
});

// ==================== 裁剪坐标 ====================

describe("computeCropRect", () => {
  it("maps a normalized rect onto pixel coordinates", () => {
    expect(computeCropRect(200, 100, { x: 0.1, y: 0.2, width: 0.5, height: 0.5 })).toEqual({
      x: 20,
      y: 20,
      width: 100,
      height: 50,
    });
  });

  it("normalizes inverted drag directions (negative width/height)", () => {
    expect(computeCropRect(200, 100, { x: 0.6, y: 0.7, width: -0.2, height: -0.4 })).toEqual({
      x: 80,
      y: 30,
      width: 40,
      height: 40,
    });
  });

  it("clamps out-of-bounds rects to the full image", () => {
    expect(computeCropRect(200, 100, { x: -0.5, y: -0.5, width: 2, height: 2 })).toEqual({
      x: 0,
      y: 0,
      width: 200,
      height: 100,
    });
  });

  it("keeps at least one pixel for degenerate selections", () => {
    const rect = computeCropRect(200, 100, { x: 0.5, y: 0.5, width: 0.001, height: 0.001 });
    expect(rect.width).toBeGreaterThanOrEqual(1);
    expect(rect.height).toBeGreaterThanOrEqual(1);
    expect(rect.x).toBe(100);
    expect(rect.y).toBe(50);
  });

  it("never lets x+width exceed the source image (rounding off-by-one)", () => {
    // x=round(0.0025*200)=1 且 width=round(0.9975*200)=200，必须被收敛到 199，否则源矩形越界 1px
    const rect = computeCropRect(200, 100, { x: 0.0025, y: 0, width: 0.9975, height: 1 });
    expect(rect).toEqual({ x: 1, y: 0, width: 199, height: 100 });
    expect(rect.x + rect.width).toBeLessThanOrEqual(200);
    expect(rect.y + rect.height).toBeLessThanOrEqual(100);
  });
});

// ==================== 旋转 ====================

describe("normalizeRotationAngle and computeRotatedSize", () => {
  it("normalizes arbitrary angles onto right-angle steps", () => {
    expect(normalizeRotationAngle(0)).toBe(0);
    expect(normalizeRotationAngle(90)).toBe(90);
    expect(normalizeRotationAngle(180)).toBe(180);
    expect(normalizeRotationAngle(270)).toBe(270);
    expect(normalizeRotationAngle(360)).toBe(0);
    expect(normalizeRotationAngle(450)).toBe(90);
    expect(normalizeRotationAngle(-90)).toBe(270);
    expect(normalizeRotationAngle(45)).toBe(90);
  });

  it("swaps width/height only for quarter turns", () => {
    expect(computeRotatedSize(100, 50, 90)).toEqual({ width: 50, height: 100 });
    expect(computeRotatedSize(100, 50, 270)).toEqual({ width: 50, height: 100 });
    expect(computeRotatedSize(100, 50, 180)).toEqual({ width: 100, height: 50 });
    expect(computeRotatedSize(100, 50, 0)).toEqual({ width: 100, height: 50 });
  });
});

// ==================== 九宫格切片 ====================

describe("computeGridSlices", () => {
  it("splits an evenly divisible image into row-major tiles", () => {
    const slices = computeGridSlices(300, 300, 3, 3);
    expect(slices).toHaveLength(9);
    expect(slices[0]).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    expect(slices[2]).toEqual({ x: 200, y: 0, width: 100, height: 100 });
    expect(slices[4]).toEqual({ x: 100, y: 100, width: 100, height: 100 });
    expect(slices[8]).toEqual({ x: 200, y: 200, width: 100, height: 100 });
  });

  it("assigns remainder pixels to the last row/column without gaps or overlaps", () => {
    const slices = computeGridSlices(100, 100, 3, 3);
    expect(slices.slice(0, 3).map((slice) => slice.width)).toEqual([33, 33, 34]);
    expect(slices.filter((_, index) => index % 3 === 0).map((slice) => slice.height)).toEqual([
      33, 33, 34,
    ]);

    // 无缝隙无重叠：面积守恒
    const totalArea = slices.reduce((sum, slice) => sum + slice.width * slice.height, 0);
    expect(totalArea).toBe(100 * 100);
  });

  it("supports non-square grids", () => {
    const slices = computeGridSlices(400, 100, 1, 2);
    expect(slices).toEqual([
      { x: 0, y: 0, width: 200, height: 100 },
      { x: 200, y: 0, width: 200, height: 100 },
    ]);
  });

  it("rejects invalid dimensions", () => {
    expect(() => computeGridSlices(0, 100, 3, 3)).toThrow();
    expect(() => computeGridSlices(100, 100, 0, 3)).toThrow();
    expect(() => computeGridSlices(100, 100, 3, 1.5)).toThrow();
  });
});

// ==================== 尺寸计算 ====================

describe("computeResizedSize", () => {
  const source = { sourceWidth: 200, sourceHeight: 100 };

  it("scales proportionally by target width", () => {
    expect(computeResizedSize(source.sourceWidth, source.sourceHeight, { mode: "width", width: 100 })).toEqual({
      width: 100,
      height: 50,
    });
  });

  it("scales proportionally by target height", () => {
    expect(computeResizedSize(source.sourceWidth, source.sourceHeight, { mode: "height", height: 200 })).toEqual({
      width: 400,
      height: 200,
    });
  });

  it("supports free scale and stretch modes", () => {
    expect(computeResizedSize(100, 100, { mode: "scale", scale: 1.5 })).toEqual({ width: 150, height: 150 });
    expect(computeResizedSize(100, 100, { mode: "stretch", width: 50, height: 80 })).toEqual({
      width: 50,
      height: 80,
    });
  });

  it("clamps results to [1, MAX_EXPORT_EDGE]", () => {
    expect(computeResizedSize(1, 1, { mode: "width", width: 999_999 })).toEqual({
      width: 8192,
      height: 8192,
    });
    expect(computeResizedSize(100, 100, { mode: "scale", scale: 0 })).toEqual({ width: 1, height: 1 });
  });

  it("rejects invalid source dimensions", () => {
    expect(() => computeResizedSize(0, 100, { mode: "width", width: 10 })).toThrow();
  });
});

// ==================== 宽高比匹配 ====================

describe("pickClosestAspectRatio", () => {
  it("picks the closest supported ratio", () => {
    expect(pickClosestAspectRatio(1920, 1080)).toBe("16:9");
    expect(pickClosestAspectRatio(1000, 1000)).toBe("1:1");
    expect(pickClosestAspectRatio(1080, 1920)).toBe("9:16");
    expect(pickClosestAspectRatio(1000, 1500)).toBe("2:3");
    expect(pickClosestAspectRatio(2100, 1000)).toBe("21:9");
    expect(pickClosestAspectRatio(640, 480)).toBe("4:3");
  });
});

// ==================== 格式与编码工具 ====================

describe("data url and base64 helpers", () => {
  it("parses and builds data urls", () => {
    expect(parseDataUrl("data:image/png;base64,QUJD")).toEqual({ mimeType: "image/png", base64: "QUJD" });
    expect(parseDataUrl("data:;base64,QUJD")).toEqual({
      mimeType: "application/octet-stream",
      base64: "QUJD",
    });
    expect(parseDataUrl("not-a-data-url")).toBeNull();
    // URL-encoded（非 base64）载荷不支持
    expect(parseDataUrl("data:text/plain,hello")).toBeNull();
    expect(toDataUrl("QUJD")).toBe("data:image/png;base64,QUJD");
    expect(toDataUrl("QUJD", "image/jpeg")).toBe("data:image/jpeg;base64,QUJD");
  });

  it("round-trips base64 bytes including multi-chunk payloads", () => {
    expect(Array.from(base64ToUint8Array("AQID"))).toEqual([1, 2, 3]);
    expect(uint8ArrayToBase64(new Uint8Array([1, 2, 3]))).toBe("AQID");

    const large = new Uint8Array(0x8000 + 17).map((_, index) => index % 251);
    expect(uint8ArrayToBase64(large)).toBe(
      btoa(String.fromCharCode(...Array.from(large)))
    );
    expect(Array.from(base64ToUint8Array(uint8ArrayToBase64(large)))).toEqual(Array.from(large));
  });

  it("guesses mime types from extensions", () => {
    expect(guessImageMimeType("C:\\dir\\a.PNG")).toBe("image/png");
    expect(guessImageMimeType("https://example.com/x.jpg?w=1")).toBe("image/jpeg");
    expect(guessImageMimeType("/tmp/photo.webp")).toBe("image/webp");
    expect(guessImageMimeType("no-extension")).toBe("image/png");
  });

  it("builds sanitized export file names", () => {
    const name = buildExportFileName('裁/剪:图', "image/jpeg");
    expect(name.startsWith("裁_剪_图-")).toBe(true);
    expect(name.endsWith(".jpg")).toBe(true);
  });

  it("derives extensions from arbitrary source mime types for downloads", () => {
    expect(buildExportFileName("原图", "image/png").endsWith(".png")).toBe(true);
    expect(buildExportFileName("原图", "image/gif").endsWith(".gif")).toBe(true);
    expect(buildExportFileName("原图", "image/avif").endsWith(".avif")).toBe(true);
    expect(buildExportFileName("原图", "weird").endsWith(".png")).toBe(true);
  });
});

// ==================== 图片输入归一化 ====================

describe("resolveImageInput", () => {
  it("parses data urls directly", async () => {
    await expect(resolveImageInput("data:image/jpeg;base64,QUJD")).resolves.toEqual({
      base64: "QUJD",
      mimeType: "image/jpeg",
    });
  });

  it("rejects empty input", async () => {
    await expect(resolveImageInput("   ")).rejects.toThrow("图片输入为空");
  });

  it("downloads http(s) images and converts to base64", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/webp" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolveImageInput("https://example.com/a.webp")).resolves.toEqual({
      base64: "AQID",
      mimeType: "image/webp",
    });
    expect(fetchMock).toHaveBeenCalledWith("https://example.com/a.webp");
  });

  it("surfaces http failures with status codes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(resolveImageInput("https://example.com/missing.png")).rejects.toThrow(
      "图片下载失败 (404)"
    );
  });

  it("rejects local paths outside Tauri", async () => {
    await expect(resolveImageInput("C:\\media\\a.png")).rejects.toThrow("本地文件仅在桌面端");
  });

  it("reads local paths via read_image and falls back to read_media_file contract", async () => {
    enterTauriEnvironment();

    // 主路径：read_image 命令返回 base64
    mockedInvoke.mockImplementation(async (command: string) => {
      if (command === "read_image") return "QUJD";
      throw new Error(`unexpected command ${command}`);
    });
    await expect(resolveImageInput("C:\\media\\a.png")).resolves.toEqual({
      base64: "QUJD",
      mimeType: "image/png",
    });

    // 回退路径：read_image 失败 → 跨包契约 read_media_file
    mockedInvoke.mockImplementation(async (command: string) => {
      if (command === "read_image") throw new Error("file not found");
      if (command === "read_media_file") return { base64: "QUJD" };
      throw new Error(`unexpected command ${command}`);
    });
    await expect(resolveImageInput("C:\\media\\a.png")).resolves.toEqual({
      base64: "QUJD",
      mimeType: "image/png",
    });

    // 双双失败：抛出合并两个原因的错误，排障方向不被吞掉
    mockedInvoke.mockImplementation(async () => {
      throw new Error("permission denied");
    });
    await expect(resolveImageInput("C:\\media\\a.png")).rejects.toThrow(
      "读取本地图片失败: permission denied；read_media_file 回退也失败: permission denied"
    );
  });
});

// ==================== 素材来源加载（storagePath → dataUrl 回退链） ====================

describe("loadImageFromAssetSource", () => {
  it("prefers storagePath when it loads", async () => {
    enterTauriEnvironment();
    installImageStub(320, 240);
    mockedInvoke.mockImplementation(async (command: string) => {
      if (command === "read_image") return "QUJD";
      throw new Error(`unexpected command ${command}`);
    });

    const { loadImageFromAssetSource } = await import("@/services/imageEditService");
    await expect(
      loadImageFromAssetSource({
        storagePath: "C:\\media\\a.png",
        dataUrl: "data:image/png;base64,REVG",
      })
    ).resolves.toEqual({
      base64: "QUJD",
      dataUrl: "data:image/png;base64,QUJD",
      mimeType: "image/png",
      width: 320,
      height: 240,
    });
    // 只走文件读取一次：dataUrl 未被消费
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
  });

  it("falls back to dataUrl when storagePath fails to load", async () => {
    installImageStub(320, 240);
    mockedInvoke.mockRejectedValue(new Error("file gone"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { loadImageFromAssetSource } = await import("@/services/imageEditService");
    try {
      await expect(
        loadImageFromAssetSource({
          storagePath: "C:\\media\\missing.png",
          dataUrl: "data:image/jpeg;base64,QUJD",
        })
      ).resolves.toEqual({
        base64: "QUJD",
        dataUrl: "data:image/jpeg;base64,QUJD",
        mimeType: "image/jpeg",
        width: 320,
        height: 240,
      });
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("rejects clearly when neither source is available", async () => {
    const { loadImageFromAssetSource } = await import("@/services/imageEditService");
    await expect(loadImageFromAssetSource({})).rejects.toThrow("素材没有可用的图片数据");
  });
});

// ==================== 通用局部重绘（ocrInpaintService 泛化入口） ====================

describe("inpaintRegion (generalized entry)", () => {
  const baseParams = {
    imageData: "QUJD",
    maskData: "REVG",
    prompt: "a bouquet of orange tulips",
  };

  it("validates required params", async () => {
    await expect(inpaintRegion({ ...baseParams, imageData: " " })).rejects.toThrow("缺少原图数据");
    await expect(inpaintRegion({ ...baseParams, maskData: "" })).rejects.toThrow("缺少重绘蒙版");
    await expect(inpaintRegion({ ...baseParams, prompt: "  " })).rejects.toThrow("重绘内容提示词");
  });

  it("posts to the IOPaint http api and decodes the binary reply", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(mockResponse(true, 200, { bytes: new Uint8Array([9, 8, 7]) }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(inpaintRegion(baseParams)).resolves.toEqual({ image: "CQgH" });

    // 请求格式与 Rust 侧 call_inpaint_service 保持一致：纯 base64 + JSON 载荷
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:8080/api/v1/inpaint");
    expect(JSON.parse(String(init.body))).toEqual({
      image: "QUJD",
      mask: "REVG",
      prompt: baseParams.prompt,
      ldm_steps: 30,
      hd_strategy: "Original",
    });
  });

  it("reports http errors and connection failures clearly", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(false, 500, { text: "boom" })));
    await expect(inpaintRegion(baseParams)).rejects.toThrow("IOPaint 服务返回错误 (500)");

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network down")));
    await expect(inpaintRegion(baseParams)).rejects.toThrow("无法连接 IOPaint 服务");
  });

  it("aborts hung http requests after timeoutMs with a clear timeout message", async () => {
    // 模拟服务挂起：fetch 永不 resolve，仅监听 abort 信号后以 reason reject
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        const signal = init?.signal as AbortSignal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason));
        });
      })
    );

    await expect(inpaintRegion({ ...baseParams, timeoutMs: 20 })).rejects.toThrow(
      "IOPaint 局部重绘请求超时"
    );
  });

  it("prefers the inpaint_region tauri contract and falls back to http when missing", async () => {
    enterTauriEnvironment();

    // 契约命令可用：直接返回，不发 HTTP
    mockedInvoke.mockResolvedValue({ success: true, image: "RkwE" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(inpaintRegion(baseParams)).resolves.toEqual({ image: "RkwE" });
    expect(fetchMock).not.toHaveBeenCalled();

    // 契约命令缺失：回退直连 IOPaint
    mockedInvoke.mockRejectedValue("command inpaint_region not found");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(mockResponse(true, 200, { bytes: new Uint8Array([1]) }))
    );
    await expect(inpaintRegion(baseParams)).resolves.toEqual({ image: "AQ==" });
  });
});

// ==================== AI 能力编排 ====================

describe("upscaleImage (img2img channel)", () => {
  it("routes through editImage with the upscale prompt and matched aspect ratio", async () => {
    mockedEditImage.mockResolvedValue({ imageData: "RkwE" });

    const { upscaleImage } = await import("@/services/imageEditService");
    const result = await upscaleImage({
      imageBase64: "QUJD",
      options: { aspectRatio: pickClosestAspectRatio(1920, 1080), imageSize: "2K" },
    });

    expect(result).toEqual({ imageData: "RkwE" });
    expect(mockedEditImage).toHaveBeenCalledWith(
      expect.objectContaining({
        model: DEFAULT_IMAGE_EDIT_MODEL,
        inputImages: ["QUJD"],
        aspectRatio: "16:9",
        imageSize: "2K",
      }),
      "imageGeneratorPro"
    );
    const params = mockedEditImage.mock.calls[0][0];
    expect(params.prompt).toContain("放大");
  });

  it("rejects empty image data without calling the provider", async () => {
    const { upscaleImage } = await import("@/services/imageEditService");
    const result = await upscaleImage({ imageBase64: " " });
    expect(result.error).toContain("缺少图片数据");
    expect(mockedEditImage).not.toHaveBeenCalled();
  });
});

describe("interrogateImagePrompt (llmService vision input)", () => {
  it("sends the image as vision file input and trims the returned prompt", async () => {
    mockedGenerateText.mockResolvedValue({ content: "  a cat on a windowsill, cinematic light  " });

    const { interrogateImagePrompt } = await import("@/services/imageEditService");
    const result = await interrogateImagePrompt({ imageBase64: "QUJD", mimeType: "image/jpeg" });

    expect(result).toEqual({ prompt: "a cat on a windowsill, cinematic light" });
    expect(mockedGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: DEFAULT_INTERROGATE_MODEL,
        files: [{ data: "QUJD", mimeType: "image/jpeg", fileName: "interrogate-input" }],
      })
    );
  });

  it("surfaces llm errors and empty content", async () => {
    const { interrogateImagePrompt } = await import("@/services/imageEditService");

    mockedGenerateText.mockResolvedValue({ error: "配额不足" });
    expect((await interrogateImagePrompt({ imageBase64: "QUJD" })).error).toBe("配额不足");

    mockedGenerateText.mockResolvedValue({ content: "   " });
    expect((await interrogateImagePrompt({ imageBase64: "QUJD" })).error).toContain("未返回提示词");
  });
});

// ==================== canvas 编辑（数据注入模拟 DOM 边界） ====================

/** 最小可解析 PNG base64（仅作为不透明数据载荷使用，不会真的解码） */
const PNG_PAYLOAD = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

interface RecordedCanvasContext {
  drawImage: Mock;
  fillRect: Mock;
  translate: Mock;
  rotate: Mock;
}

interface RecordedCanvas {
  width: number;
  height: number;
  ctx: RecordedCanvasContext;
}

/** 注入假 document.createElement("canvas")：记录尺寸与绘制调用，导出固定载荷 */
function installCanvasStub(): RecordedCanvas[] {
  const canvases: RecordedCanvas[] = [];
  vi.stubGlobal("document", {
    createElement: (tag: string) => {
      if (tag !== "canvas") throw new Error(`unexpected createElement tag: ${tag}`);
      const canvas: RecordedCanvas = {
        width: 0,
        height: 0,
        ctx: { drawImage: vi.fn(), fillRect: vi.fn(), translate: vi.fn(), rotate: vi.fn() },
      };
      canvases.push(canvas);
      return {
        get width() {
          return canvas.width;
        },
        set width(value: number) {
          canvas.width = value;
        },
        get height() {
          return canvas.height;
        },
        set height(value: number) {
          canvas.height = value;
        },
        getContext: () => canvas.ctx,
        toDataURL: (format: string) => `data:${format};base64,${PNG_PAYLOAD}`,
      };
    },
  });
  return canvases;
}

/** 注入假 Image：设置 src 后异步触发 onload，携带声明的自然尺寸 */
function installImageStub(naturalWidth: number, naturalHeight: number) {
  vi.stubGlobal(
    "Image",
    class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = naturalWidth;
      naturalHeight = naturalHeight;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
  );
}

describe("canvas edit ops with injected DOM stubs", () => {
  const source = () => ({ dataUrl: toDataUrl(PNG_PAYLOAD) });

  it("cropImage draws the computed rect into a canvas of the crop size", async () => {
    const canvases = installCanvasStub();
    installImageStub(200, 100);

    const { cropImage: crop } = await import("@/services/imageEditService");
    const output = await crop(source(), { x: 20, y: 20, width: 100, height: 50 });

    expect(canvases).toHaveLength(1);
    expect(canvases[0].width).toBe(100);
    expect(canvases[0].height).toBe(50);
    expect(canvases[0].ctx.drawImage).toHaveBeenCalledWith(
      expect.anything(), 20, 20, 100, 50, 0, 0, 100, 50
    );
    expect(output).toEqual({
      base64: PNG_PAYLOAD,
      dataUrl: `data:image/png;base64,${PNG_PAYLOAD}`,
      mimeType: "image/png",
      width: 100,
      height: 50,
    });
  });

  it("rotateImage swaps the canvas size and applies the quarter-turn transform", async () => {
    const canvases = installCanvasStub();
    installImageStub(200, 100);

    const { rotateImage: rotate } = await import("@/services/imageEditService");
    const output = await rotate(source(), 90);

    expect(canvases[0].width).toBe(100);
    expect(canvases[0].height).toBe(200);
    expect(canvases[0].ctx.translate).toHaveBeenCalledWith(50, 100);
    expect(canvases[0].ctx.rotate).toHaveBeenCalledWith(Math.PI / 2);
    expect(canvases[0].ctx.drawImage).toHaveBeenCalledWith(
      expect.anything(), -100, -50, 200, 100
    );
    expect(output.width).toBe(100);
    expect(output.height).toBe(200);
  });

  it("resizeImage lays white under jpeg exports to avoid black transparency", async () => {
    const canvases = installCanvasStub();
    installImageStub(200, 100);

    const { resizeImage: resize } = await import("@/services/imageEditService");

    await resize(source(), { mode: "width", width: 400 }, "image/png");
    expect(canvases[0].ctx.fillRect).not.toHaveBeenCalled();

    const jpegOutput = await resize(source(), { mode: "width", width: 400 }, "image/jpeg");
    expect(canvases[1].width).toBe(400);
    expect(canvases[1].height).toBe(200);
    expect(canvases[1].ctx.drawImage).toHaveBeenCalledWith(
      expect.anything(), 0, 0, 200, 100, 0, 0, 400, 200
    );
    expect(canvases[1].ctx.fillRect).toHaveBeenCalledWith(0, 0, 400, 200);
    expect(jpegOutput.mimeType).toBe("image/jpeg");
  });

  it("splitImageIntoGrid exports one canvas per tile aligned with computeGridSlices", async () => {
    const canvases = installCanvasStub();
    installImageStub(300, 200);

    const { splitImageIntoGrid: split } = await import("@/services/imageEditService");
    const outputs = await split(source(), 3, 3);

    expect(outputs).toHaveLength(9);
    expect(canvases).toHaveLength(9);

    const slices = computeGridSlices(300, 200, 3, 3);
    slices.forEach((slice, index) => {
      expect(canvases[index].width).toBe(slice.width);
      expect(canvases[index].height).toBe(slice.height);
      expect(canvases[index].ctx.drawImage).toHaveBeenCalledWith(
        expect.anything(),
        slice.x, slice.y, slice.width, slice.height,
        0, 0, slice.width, slice.height
      );
      expect(outputs[index].width).toBe(slice.width);
      expect(outputs[index].height).toBe(slice.height);
    });
  });

  it("propagates decode failures as explicit errors", async () => {
    installCanvasStub();
    vi.stubGlobal(
      "Image",
      class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_value: string) {
          queueMicrotask(() => this.onerror?.());
        }
      }
    );

    const { cropImage: crop } = await import("@/services/imageEditService");
    await expect(crop(source(), { x: 0, y: 0, width: 10, height: 10 })).rejects.toThrow("图片解码失败");
  });
});
