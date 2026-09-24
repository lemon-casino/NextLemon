import { describe, expect, it, vi } from "vitest";

// PPT 组装协作取消的编排层测试：
// - requestAssemblyCancel：验证以任务 token 调用 cancel_ppt_assembly、
//   confirmed 返回、命令缺失（invoke 抛错）时回退 false（不显示取消提示）；
// - resolveAssemblyStopPatch：completedCount 统计、cancelNotice 写入、
//   仅重置 processing 页为 pending；
// - isAssemblyCancelledResult：宽松字段 cancelled 与 Rust 取消错误文案两条识别路径。

import {
  ASSEMBLY_CANCELLED_ERROR_TEXT,
  buildAssemblyCancelMessage,
  createAssemblyCancelToken,
  isAssemblyCancelledResult,
  requestAssemblyCancel,
  resolveAssemblyStopPatch,
} from "@/types/generation";

// 页面最小形状（PPTAssemblerNode 的 PPTPageData 子集）
interface TestPage {
  pageNumber: number;
  processStatus?: "pending" | "processing" | "completed" | "error";
  processError?: string;
}

describe("requestAssemblyCancel（cancel_ppt_assembly 调用编排）", () => {
  it("以任务 token 调用 cancel_ppt_assembly，返回 { cancelled: true } 时确认取消", async () => {
    const invokeFn = vi.fn(async (command: string, args: { token: string }) => {
      expect(command).toBe("cancel_ppt_assembly");
      expect(args).toEqual({ token: "task-token-1" });
      return { cancelled: true };
    });

    await expect(requestAssemblyCancel(invokeFn, "task-token-1")).resolves.toBe(true);
    expect(invokeFn).toHaveBeenCalledTimes(1);
  });

  it("返回 { cancelled: false } 时不确认取消（不显示取消提示）", async () => {
    const invokeFn = vi.fn(async () => ({ cancelled: false }));
    await expect(requestAssemblyCancel(invokeFn, "t")).resolves.toBe(false);
  });

  it("命令缺失（invoke 抛错）时回退 false，走本地停止", async () => {
    const invokeFn = vi.fn(async () => {
      throw new Error("command cancel_ppt_assembly not found");
    });
    await expect(requestAssemblyCancel(invokeFn, "t")).resolves.toBe(false);
  });

  it("返回异常形状（null/undefined/缺字段）时不确认取消", async () => {
    expect(await requestAssemblyCancel(async () => null, "t")).toBe(false);
    expect(await requestAssemblyCancel(async () => undefined, "t")).toBe(false);
    expect(await requestAssemblyCancel(async () => ({}), "t")).toBe(false);
  });
});

describe("resolveAssemblyStopPatch（停止/取消收尾写入）", () => {
  const pages: TestPage[] = [
    { pageNumber: 1, processStatus: "completed" },
    { pageNumber: 2, processStatus: "processing", processError: "中断" },
    { pageNumber: 3, processStatus: "pending" },
  ];

  it("统计已完成页数并写入「已取消，已完成 N 页」提示", () => {
    const patch = resolveAssemblyStopPatch(pages, true);
    expect(patch.completedCount).toBe(1);
    expect(patch.cancelNotice).toBe(buildAssemblyCancelMessage(1));
    expect(patch.cancelNotice).toBe("已取消，已完成 1 页");
  });

  it("仅重置 processing 页为 pending 并清除其错误，其余页保持原状", () => {
    const patch = resolveAssemblyStopPatch(pages, true);
    expect(patch.resetPages).toHaveLength(3);
    expect(patch.resetPages[0].processStatus).toBe("completed");
    expect(patch.resetPages[1].processStatus).toBe("pending");
    expect(patch.resetPages[1].processError).toBeUndefined();
    expect(patch.resetPages[1].pageNumber).toBe(2);
    expect(patch.resetPages[2].processStatus).toBe("pending");
  });

  it("后端未确认取消时不写入取消提示（回退仅重置的既有行为）", () => {
    const patch = resolveAssemblyStopPatch(pages, false);
    expect(patch.completedCount).toBe(1);
    expect(patch.cancelNotice).toBeUndefined();
  });

  it("空页面列表时统计为 0 且不报错", () => {
    const patch = resolveAssemblyStopPatch<TestPage>([], true);
    expect(patch.completedCount).toBe(0);
    expect(patch.cancelNotice).toBe("已取消，已完成 0 页");
    expect(patch.resetPages).toHaveLength(0);
  });

  it("支持注入文案构造器", () => {
    const patch = resolveAssemblyStopPatch(pages, true, (n) => `已停止，完成 ${n} 页`);
    expect(patch.cancelNotice).toBe("已停止，完成 1 页");
  });
});

describe("isAssemblyCancelledResult（取消结果识别）", () => {
  it("识别宽松字段 cancelled=true（透传层补齐 ProcessPageResult.cancelled 后生效）", () => {
    expect(isAssemblyCancelledResult({ cancelled: true })).toBe(true);
    expect(isAssemblyCancelledResult({ cancelled: false })).toBe(false);
    expect(isAssemblyCancelledResult({})).toBe(false);
    expect(isAssemblyCancelledResult(undefined)).toBe(false);
    expect(isAssemblyCancelledResult("text")).toBe(false);
  });

  it("识别 Rust 取消错误文案（透传层按 error 抛出的当前路径）", () => {
    expect(
      isAssemblyCancelledResult(undefined, new Error(ASSEMBLY_CANCELLED_ERROR_TEXT))
    ).toBe(true);
    expect(isAssemblyCancelledResult(undefined, ASSEMBLY_CANCELLED_ERROR_TEXT)).toBe(true);
    expect(
      isAssemblyCancelledResult(undefined, new Error("第 2 页处理失败: OCR 超时"))
    ).toBe(false);
    expect(isAssemblyCancelledResult(undefined, undefined)).toBe(false);
  });

  it("取消错误文案与宽松字段任一命中即识别", () => {
    expect(
      isAssemblyCancelledResult(
        { cancelled: true },
        new Error(ASSEMBLY_CANCELLED_ERROR_TEXT)
      )
    ).toBe(true);
  });
});

describe("createAssemblyCancelToken（随机任务 token）", () => {
  it("默认生成非空随机 token 且互不相同", () => {
    const a = createAssemblyCancelToken();
    const b = createAssemblyCancelToken();
    expect(a.length).toBeGreaterThan(0);
    expect(a).not.toBe(b);
  });

  it("支持注入随机源（便于测试与复现）", () => {
    expect(createAssemblyCancelToken(() => "fixed-id")).toBe("fixed-id");
  });
});
