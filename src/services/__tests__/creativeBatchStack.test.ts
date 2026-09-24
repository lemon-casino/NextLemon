import { beforeEach, describe, expect, it } from "vitest";
import {
  collectCollapsedBatchChildIds,
  computeBatchGridOffsets,
  isItemVisibleInViewport,
  pickBatchReselectAfterRemoval,
  repairBatchStacksAfterRemoval,
  resolveBatchImageSource,
  useCreativeStore,
} from "@/stores/creativeStore";
import type { CreativeCanvasItem } from "@/types/creative";

function item(
  id: string,
  x: number,
  y: number,
  width = 100,
  height = 80,
  extra: Partial<CreativeCanvasItem> = {}
): CreativeCanvasItem {
  return {
    id,
    assetId: `asset-${id}`,
    kind: "image",
    title: id,
    position: { x, y },
    width,
    height,
    zIndex: 1,
    locked: false,
    hidden: false,
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  };
}

function stack(): CreativeCanvasItem[] {
  // 主图 r 置顶（zIndex 最高），子图 c1/c2 折叠叠放于同一位置
  return [
    item("r", 100, 100, 320, 240, {
      isBatchRoot: true,
      batchChildIds: ["c1", "c2"],
      batchExpanded: false,
      zIndex: 3,
    }),
    item("c1", 100, 100, 320, 240, { parentBatchRootId: "r", zIndex: 1 }),
    item("c2", 100, 100, 320, 240, { parentBatchRootId: "r", zIndex: 2 }),
  ];
}

describe("creativeBatchStack viewport culling", () => {
  const viewport = { x: -100, y: -50, zoom: 1 }; // 视口世界范围 x:[100,900] y:[50,650]
  const container = { width: 800, height: 600 };

  it("keeps items intersecting the viewport", () => {
    expect(isItemVisibleInViewport(item("in", 300, 200), viewport, container)).toBe(true);
    expect(isItemVisibleInViewport(item("edge", 850, 200), viewport, container)).toBe(true);
  });

  it("culls items fully outside the viewport", () => {
    expect(isItemVisibleInViewport(item("far", 2000, 200), viewport, container)).toBe(false);
    expect(isItemVisibleInViewport(item("above", 100, -900), viewport, container)).toBe(false);
  });

  it("keeps items inside the screen-pixel buffer band", () => {
    // 右边缘 900 + 缓冲 200（zoom 1）→ x ≤ 1100 起始的实例仍保留
    expect(isItemVisibleInViewport(item("near", 1050, 200), viewport, container)).toBe(true);
    expect(isItemVisibleInViewport(item("out", 1400, 200), viewport, container)).toBe(false);
    // 缓冲按屏幕像素换算：zoom 0.5 时视口世界范围 x:[200,1800]，世界缓冲为 400
    const half = { x: -100, y: -50, zoom: 0.5 };
    expect(isItemVisibleInViewport(item("zoomed", 2000, 200), half, container)).toBe(true);
    expect(isItemVisibleInViewport(item("zoomed-out", 2400, 200), half, container)).toBe(false);
  });
});

describe("creativeBatchStack grid layout", () => {
  it("keeps the primary image at offset zero", () => {
    expect(computeBatchGridOffsets(1, { width: 320, height: 240 })).toEqual([{ x: 0, y: 0 }]);
  });

  it("lays out a square-ish grid for 4 images", () => {
    expect(computeBatchGridOffsets(4, { width: 100, height: 80 }, 20)).toEqual([
      { x: 0, y: 0 },
      { x: 120, y: 0 },
      { x: 0, y: 100 },
      { x: 120, y: 100 },
    ]);
  });

  it("wraps long rows by ceil(sqrt(count)) columns", () => {
    const offsets = computeBatchGridOffsets(5, { width: 100, height: 80 }, 16);
    expect(offsets).toHaveLength(5);
    // ceil(sqrt(5)) = 3 列：第 4/5 张换行
    expect(offsets[3]).toEqual({ x: 0, y: 96 });
    expect(offsets[4]).toEqual({ x: 116, y: 96 });
  });
});

describe("creativeBatchStack collapsed children", () => {
  it("collects children of collapsed roots only", () => {
    expect([...collectCollapsedBatchChildIds(stack())].sort()).toEqual(["c1", "c2"]);

    const expanded = stack().map((entry) =>
      entry.id === "r" ? { ...entry, batchExpanded: true } : entry
    );
    expect(collectCollapsedBatchChildIds(expanded).size).toBe(0);
    expect(collectCollapsedBatchChildIds([item("solo", 0, 0)]).size).toBe(0);
  });
});

describe("creativeBatchStack removal repair", () => {
  it("drops removed children from the root", () => {
    const next = repairBatchStacksAfterRemoval(stack(), ["c1"]);
    const root = next.find((entry) => entry.id === "r");
    expect(root?.batchChildIds).toEqual(["c2"]);
    expect(next.map((entry) => entry.id).sort()).toEqual(["c2", "r"]);
  });

  it("promotes the first surviving child when the root is removed", () => {
    const next = repairBatchStacksAfterRemoval(stack(), ["r"]);
    const promoted = next.find((entry) => entry.id === "c1");
    const follower = next.find((entry) => entry.id === "c2");
    expect(promoted?.isBatchRoot).toBe(true);
    expect(promoted?.parentBatchRootId).toBeUndefined();
    expect(promoted?.batchChildIds).toEqual(["c2"]);
    expect(promoted?.batchExpanded).toBe(false);
    expect(follower?.parentBatchRootId).toBe("c1");
  });

  it("raises the promoted primary above every surviving item", () => {
    const next = repairBatchStacksAfterRemoval(stack(), ["r"]);
    const promoted = next.find((entry) => entry.id === "c1");
    // 存活实例 zIndex 为 c1=1 / c2=2，晋升后主图必须严格最大（折叠态导出由主图覆盖子图）
    const maxOther = Math.max(...next.filter((entry) => entry.id !== "c1").map((entry) => entry.zIndex));
    expect(promoted?.zIndex).toBeGreaterThan(maxOther);
  });

  it("clears batch fields when a root loses its last child", () => {
    const next = repairBatchStacksAfterRemoval(stack(), ["c1", "c2"]);
    const root = next.find((entry) => entry.id === "r");
    expect(root?.isBatchRoot).toBe(false);
    expect(root?.batchChildIds).toBeUndefined();
    expect(root?.batchExpanded).toBeUndefined();
  });

  it("leaves unrelated items untouched", () => {
    const items = [...stack(), item("plain", 0, 0)];
    const next = repairBatchStacksAfterRemoval(items, ["plain"]);
    expect(next.find((entry) => entry.id === "plain")).toBeUndefined();
    expect(next.find((entry) => entry.id === "r")).toEqual(items.find((entry) => entry.id === "r"));
  });
});

describe("creativeBatchStack reselect after removal", () => {
  it("reselects the root when a child is removed", () => {
    expect(pickBatchReselectAfterRemoval(stack(), ["c1"])).toBe("r");
  });

  it("reselects the promoted child when the root is removed", () => {
    expect(pickBatchReselectAfterRemoval(stack(), ["r"])).toBe("c1");
  });

  it("returns null for non-batch removals", () => {
    expect(pickBatchReselectAfterRemoval(stack(), ["r", "c1", "c2"])).toBeNull();
    expect(pickBatchReselectAfterRemoval([item("a", 0, 0)], ["a"])).toBeNull();
  });
});

describe("creativeBatchStack image source resolution", () => {
  const assets = [{ id: "asset-1" }, { id: "asset-2" }];

  it("reuses existing asset ids", () => {
    expect(resolveBatchImageSource(" asset-1 ", assets)).toEqual({
      kind: "asset",
      assetId: "asset-1",
    });
  });

  it("maps data urls to image drafts", () => {
    const resolved = resolveBatchImageSource("data:image/jpeg;base64,AAAA", assets);
    expect(resolved?.kind).toBe("draft");
    if (resolved?.kind === "draft") {
      expect(resolved.draft.dataUrl).toBe("data:image/jpeg;base64,AAAA");
      expect(resolved.draft.source).toBe("workflow");
    }
  });

  it("maps file paths to storage-path drafts", () => {
    const windows = resolveBatchImageSource("C:\\media\\gen\\out.png", assets);
    if (windows?.kind === "draft") {
      expect(windows.draft.storagePath).toBe("C:\\media\\gen\\out.png");
      expect(windows.draft.title).toBe("out.png");
    } else {
      expect.unreachable("Windows 路径应解析为草稿");
    }
    const unix = resolveBatchImageSource("/media/gen/out.png", assets);
    if (unix?.kind === "draft") {
      expect(unix.draft.storagePath).toBe("/media/gen/out.png");
    } else {
      expect.unreachable("Unix 路径应解析为草稿");
    }
    // 不带扩展名的短 Unix 路径（长度 < 64，不满足 base64 启发式）仍按路径处理
    const extensionless = resolveBatchImageSource("/usr/local/bin", assets);
    if (extensionless?.kind === "draft") {
      expect(extensionless.draft.storagePath).toBe("/usr/local/bin");
    } else {
      expect.unreachable("短 Unix 路径应解析为草稿");
    }
  });

  it("treats JPEG bare base64 payloads as base64, not unix paths", () => {
    // Gemini inlineData 的裸 base64 以 "/9j/" 开头（imageService 原样透传），
    // 不得命中 Unix 路径分支建成 storagePath
    const jpeg = resolveBatchImageSource(`/9j/${"A".repeat(60)}`, assets);
    expect(jpeg?.kind).toBe("draft");
    if (jpeg?.kind === "draft") {
      expect(jpeg.draft.dataUrl).toBe(`data:image/jpeg;base64,/9j/${"A".repeat(60)}`);
      expect(jpeg.draft.storagePath).toBeUndefined();
    }
    const webp = resolveBatchImageSource(`UklGR${"A".repeat(59)}`, assets);
    if (webp?.kind === "draft") {
      expect(webp.draft.dataUrl?.startsWith("data:image/webp;base64,")).toBe(true);
    } else {
      expect.unreachable("WEBP 裸 base64 应解析为草稿");
    }
  });

  it("wraps bare base64 payloads as png data urls", () => {
    const resolved = resolveBatchImageSource("iVBORw0KGgo=", assets);
    expect(resolved?.kind).toBe("draft");
    if (resolved?.kind === "draft") {
      expect(resolved.draft.dataUrl).toBe("data:image/png;base64,iVBORw0KGgo=");
    }
  });

  it("rejects empty sources", () => {
    expect(resolveBatchImageSource("", assets)).toBeNull();
    expect(resolveBatchImageSource("   ", assets)).toBeNull();
  });
});

// ===== store 动作层（useCreativeStore 直调）=====

function makeDataUrl(index: number): string {
  return `data:image/png;base64,Q0FQ${String(index).repeat(8)}==`;
}

function resetCreativeState() {
  useCreativeStore.setState({
    assets: [],
    canvas: {
      id: "creative-main",
      title: "素材创作画布",
      items: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      createdAt: 1,
      updatedAt: 1,
    },
    selectedItemIds: [],
    tombstones: [],
  });
}

function landStack(imageCount: number): string {
  const images = Array.from({ length: imageCount }, (_, index) => makeDataUrl(index));
  const rootId = useCreativeStore.getState().addImageBatchToCanvas(images);
  if (!rootId) throw new Error("批量落位应返回栈根 id");
  return rootId;
}

describe("creativeBatchStack store actions", () => {
  beforeEach(resetCreativeState);

  it("lands an images array as a collapsed stack with the primary on top", () => {
    const rootId = landStack(3);
    const state = useCreativeStore.getState();
    expect(state.assets).toHaveLength(3);
    expect(state.assets.every((asset) => asset.kind === "image" && asset.source === "workflow")).toBe(true);
    expect(state.canvas.items).toHaveLength(3);

    const root = state.canvas.items.find((entry) => entry.id === rootId);
    expect(root?.isBatchRoot).toBe(true);
    expect(root?.batchExpanded).toBe(false);
    expect(root?.batchChildIds).toHaveLength(2);
    // 建栈不变量：主图 zIndex 严格高于全部子图（折叠态导出由主图覆盖子图）
    const maxChildZ = Math.max(
      ...state.canvas.items.filter((entry) => entry.id !== rootId).map((entry) => entry.zIndex)
    );
    expect(root?.zIndex).toBeGreaterThan(maxChildZ);
    // 建栈即选中主图
    expect(state.selectedItemIds).toEqual([rootId]);
  });

  it("moves batch children together with the primary image", () => {
    const rootId = landStack(2);
    const before = useCreativeStore.getState().canvas.items;
    const root = before.find((entry) => entry.id === rootId)!;
    const child = before.find((entry) => entry.id === root.batchChildIds![0])!;

    useCreativeStore
      .getState()
      .moveItem(rootId, { x: root.position.x + 120, y: root.position.y + 60 });

    const after = useCreativeStore.getState().canvas.items;
    const movedRoot = after.find((entry) => entry.id === rootId)!;
    const movedChild = after.find((entry) => entry.id === child.id)!;
    expect(movedRoot.position).toEqual({ x: root.position.x + 120, y: root.position.y + 60 });
    expect(movedChild.position.x - child.position.x).toBe(120);
    expect(movedChild.position.y - child.position.y).toBe(60);
  });

  it("updates the root batch ids and reselects the primary after a child is removed", () => {
    const rootId = landStack(3);
    const childId = useCreativeStore
      .getState()
      .canvas.items.find((entry) => entry.id === rootId)!
      .batchChildIds![0];
    useCreativeStore.getState().selectItems([childId]);

    useCreativeStore.getState().removeItems([childId]);

    const state = useCreativeStore.getState();
    const root = state.canvas.items.find((entry) => entry.id === rootId);
    expect(root?.batchChildIds).toHaveLength(1);
    expect(state.canvas.items.some((entry) => entry.id === childId)).toBe(false);
    // 删除子图自动重选主图
    expect(state.selectedItemIds).toEqual([rootId]);
  });

  it("promotes a child with topmost z-order and reselects it after the primary is removed", () => {
    const rootId = landStack(3);
    useCreativeStore.getState().selectItems([rootId]);

    useCreativeStore.getState().removeItems([rootId]);

    const state = useCreativeStore.getState();
    const promoted = state.canvas.items.find((entry) => entry.isBatchRoot);
    expect(promoted).toBeTruthy();
    expect(promoted?.parentBatchRootId).toBeUndefined();
    expect(state.selectedItemIds).toContain(promoted!.id);
    const maxOtherZ = Math.max(
      ...state.canvas.items
        .filter((entry) => entry.id !== promoted!.id)
        .map((entry) => entry.zIndex)
    );
    expect(promoted!.zIndex).toBeGreaterThan(maxOtherZ);
  });

  it("expands into a grid and restores child positions on collapse", () => {
    const rootId = landStack(3);
    const before = useCreativeStore.getState().canvas.items;
    const childIds = before.find((entry) => entry.id === rootId)!.batchChildIds!;
    const rootPosition = before.find((entry) => entry.id === rootId)!.position;
    const collapsedPositions = before
      .filter((entry) => childIds.includes(entry.id))
      .map((entry) => entry.position);

    useCreativeStore.getState().setBatchExpanded(rootId, true);
    const expanded = useCreativeStore.getState().canvas.items;
    // 主图锚点保持原位，子图进入网格（不再与主图同位叠放）
    expect(expanded.find((entry) => entry.id === rootId)!.position).toEqual(rootPosition);
    expect(
      expanded
        .filter((entry) => childIds.includes(entry.id))
        .every(
          (entry) =>
            entry.position.x !== rootPosition.x || entry.position.y !== rootPosition.y
        )
    ).toBe(true);

    useCreativeStore.getState().setBatchExpanded(rootId, false);
    const restored = useCreativeStore
      .getState()
      .canvas.items.filter((entry) => childIds.includes(entry.id))
      .map((entry) => entry.position);
    expect(restored).toEqual(collapsedPositions);
  });

  it("sizes expanded grid cells by the largest image in the stack", () => {
    const rootId = landStack(2);
    // 主图被缩小（resizeItem 只作用于被操作实例，子图保持 320×240）
    useCreativeStore.getState().resizeItem(rootId, { width: 80, height: 60 });
    useCreativeStore.getState().setBatchExpanded(rootId, true);

    const items = useCreativeStore.getState().canvas.items;
    const root = items.find((entry) => entry.id === rootId)!;
    const child = items.find((entry) => entry.parentBatchRootId === rootId)!;
    // 格距按栈内最大尺寸（320）+ 间距（16），而非缩小后主图的 80
    expect(child.position.x - root.position.x).toBe(320 + 16);
  });
});
