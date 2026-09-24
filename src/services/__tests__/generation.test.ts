import { describe, expect, it } from "vitest";

// 生成参数与 PPT 取消的纯函数测试：
// 张数归一化、张数请求计划（n 直传 vs 按张数拆分）、组装取消 token 与取消文案。
import {
  DEFAULT_IMAGE_COUNT,
  IMAGE_COUNT_OPTIONS,
  buildAssemblyCancelMessage,
  createAssemblyCancelToken,
  normalizeImageCount,
  planImageCountRequests,
} from "@/types/generation";

describe("normalizeImageCount", () => {
  it("合法张数 1-4 原样返回", () => {
    expect(normalizeImageCount(1)).toBe(1);
    expect(normalizeImageCount(2)).toBe(2);
    expect(normalizeImageCount(3)).toBe(3);
    expect(normalizeImageCount(4)).toBe(4);
  });

  it("缺省/非法值回退 1 张（旧数据与外部输入兜底）", () => {
    expect(normalizeImageCount(undefined)).toBe(DEFAULT_IMAGE_COUNT);
    expect(normalizeImageCount(null)).toBe(DEFAULT_IMAGE_COUNT);
    expect(normalizeImageCount(0)).toBe(DEFAULT_IMAGE_COUNT);
    expect(normalizeImageCount(-2)).toBe(DEFAULT_IMAGE_COUNT);
    expect(normalizeImageCount(2.5)).toBe(DEFAULT_IMAGE_COUNT);
    expect(normalizeImageCount(Number.NaN)).toBe(DEFAULT_IMAGE_COUNT);
    expect(normalizeImageCount("abc")).toBe(DEFAULT_IMAGE_COUNT);
  });

  it("数字字符串可解析，超过上限收敛到 4", () => {
    expect(normalizeImageCount("3")).toBe(3);
    expect(normalizeImageCount(99)).toBe(4);
    expect(normalizeImageCount("99")).toBe(4);
  });

  it("张数可选值与面板选择一致（1-4）", () => {
    expect(IMAGE_COUNT_OPTIONS).toEqual([1, 2, 3, 4]);
  });
});

describe("planImageCountRequests", () => {
  it("上游支持 n 且张数 > 1 时单次请求直传", () => {
    expect(planImageCountRequests(4, true)).toEqual({
      mode: "upstream-n",
      n: 4,
      requestCount: 1,
    });
    expect(planImageCountRequests(2, true)).toEqual({
      mode: "upstream-n",
      n: 2,
      requestCount: 1,
    });
  });

  it("上游不支持 n 时按张数拆分请求", () => {
    expect(planImageCountRequests(4, false)).toEqual({
      mode: "parallel-requests",
      requestCount: 4,
    });
    expect(planImageCountRequests(3, false)).toEqual({
      mode: "parallel-requests",
      requestCount: 3,
    });
  });

  it("单张时无论是否支持 n 都只发一次请求", () => {
    expect(planImageCountRequests(1, true)).toEqual({
      mode: "parallel-requests",
      requestCount: 1,
    });
    expect(planImageCountRequests(1, false)).toEqual({
      mode: "parallel-requests",
      requestCount: 1,
    });
  });
});

describe("createAssemblyCancelToken", () => {
  it("默认生成非空随机 token，且两次生成互不相同", () => {
    const a = createAssemblyCancelToken();
    const b = createAssemblyCancelToken();
    expect(typeof a).toBe("string");
    expect(a.length).toBeGreaterThan(0);
    expect(a).not.toBe(b);
  });

  it("支持注入随机源（便于测试与复现）", () => {
    expect(createAssemblyCancelToken(() => "fixed-id")).toBe("fixed-id");
  });
});

describe("buildAssemblyCancelMessage", () => {
  it("取消文案呈现已完成页数", () => {
    expect(buildAssemblyCancelMessage(0)).toBe("已取消，已完成 0 页");
    expect(buildAssemblyCancelMessage(3)).toBe("已取消，已完成 3 页");
  });
});
