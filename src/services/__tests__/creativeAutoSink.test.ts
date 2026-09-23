import { beforeEach, describe, expect, it } from "vitest";
import {
  autoSinkNodeTag,
  cleanupStaleAutoSinkPlaceholders,
  completeAutoSinkPlaceholder,
  failAutoSinkPlaceholder,
  resolveAutoSinkPlaceholder,
  startAutoSinkPlaceholder,
} from "@/services/creativeAutoSink";
import { useCreativeStore } from "@/stores/creativeStore";
import type { CustomNode } from "@/types";

const PLACEHOLDER_TITLE = "生成中…";

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
    autoSinkEnabled: true,
  });
}

// 用户素材对照项：与占位素材共享 "auto-sink" 标签和占位标题，
// 用于证明新的精确回收不会像旧的模糊匹配那样误删它。
function addDecoyAssetWithItem(): { assetId: string; itemId: string } {
  const creative = useCreativeStore.getState();
  const assetId = creative.addAsset({
    kind: "text",
    title: PLACEHOLDER_TITLE,
    text: PLACEHOLDER_TITLE,
    source: "manual",
    tags: ["auto-sink"],
  });
  const itemId = creative.addAssetToCanvas(assetId, {
    title: PLACEHOLDER_TITLE,
    position: { x: -500, y: -500 },
    width: 220,
    height: 120,
  }) as string;
  return { assetId, itemId };
}

function findPlaceholderAsset(nodeId: string) {
  return useCreativeStore
    .getState()
    .assets.find((asset) => asset.tags.includes(autoSinkNodeTag(nodeId)));
}

function makePromptNode(prompt: string): CustomNode {
  return {
    id: "node-under-test",
    type: "promptNode",
    position: { x: 0, y: 0 },
    data: { label: "提示词", prompt } as never,
  } as unknown as CustomNode;
}

describe("resolveAutoSinkPlaceholder", () => {
  it("resolves by exact tracked ids when the in-memory ref is alive", () => {
    const assets = [
      { id: "asset-placeholder", tags: ["auto-sink", autoSinkNodeTag("node-1")] },
      { id: "asset-decoy", tags: ["auto-sink"] },
    ];
    const items = [
      { id: "item-placeholder", assetId: "asset-placeholder" },
      { id: "item-decoy", assetId: "asset-decoy" },
    ];

    const { assetIds, itemIds } = resolveAutoSinkPlaceholder(assets, items, "node-1", {
      assetId: "asset-placeholder",
      itemId: "item-placeholder",
    });

    expect(assetIds).toEqual(["asset-placeholder"]);
    expect(itemIds).toEqual(["item-placeholder"]);
  });

  it("falls back to the per-node tag after the in-memory map is lost (restart)", () => {
    const assets = [
      { id: "asset-stale", tags: [autoSinkNodeTag("node-1")] },
      { id: "asset-retried", tags: [autoSinkNodeTag("node-1")] },
      { id: "asset-other-node", tags: [autoSinkNodeTag("node-2")] },
      { id: "asset-decoy", tags: ["auto-sink"] },
    ];
    const items = [
      { id: "item-stale", assetId: "asset-stale" },
      { id: "item-retried", assetId: "asset-retried" },
      { id: "item-other-node", assetId: "asset-other-node" },
    ];

    // ref 缺失（重启失联）：按节点专属标签命中本节点全部占位，不碰其它节点或用户素材
    const { assetIds, itemIds } = resolveAutoSinkPlaceholder(assets, items, "node-1");

    expect(assetIds.sort()).toEqual(["asset-retried", "asset-stale"]);
    expect(itemIds.sort()).toEqual(["item-retried", "item-stale"]);
  });

  it("returns empty resolution when nothing matches exactly", () => {
    const assets = [{ id: "asset-decoy", tags: ["auto-sink"] }];
    const items = [{ id: "item-decoy", assetId: "asset-decoy" }];

    expect(resolveAutoSinkPlaceholder(assets, items, "node-1")).toEqual({
      assetIds: [],
      itemIds: [],
    });
  });
});

describe("creativeAutoSink", () => {
  beforeEach(() => {
    resetCreativeState();
  });

  it("places a tagged placeholder asset and canvas item", () => {
    startAutoSinkPlaceholder("node-1");

    const state = useCreativeStore.getState();
    const placeholderAsset = findPlaceholderAsset("node-1");
    expect(placeholderAsset).toBeDefined();
    expect(placeholderAsset?.text).toBe(PLACEHOLDER_TITLE);
    expect(state.canvas.items).toHaveLength(1);
    expect(state.canvas.items[0].assetId).toBe(placeholderAsset?.id);
  });

  it("does nothing when auto sink is disabled", () => {
    useCreativeStore.setState({ autoSinkEnabled: false });

    startAutoSinkPlaceholder("node-1");

    expect(useCreativeStore.getState().assets).toHaveLength(0);
    expect(useCreativeStore.getState().canvas.items).toHaveLength(0);
  });

  it("removes only the placeholder by exact ids on failure and keeps the decoy", () => {
    const decoy = addDecoyAssetWithItem();

    startAutoSinkPlaceholder("node-1");
    failAutoSinkPlaceholder("node-1");

    const state = useCreativeStore.getState();
    expect(findPlaceholderAsset("node-1")).toBeUndefined();
    expect(state.canvas.items.some((item) => item.assetId === decoy.assetId)).toBe(true);
    // 对照素材（同标签同标题）未被模糊匹配误删
    expect(state.assets.some((asset) => asset.id === decoy.assetId)).toBe(true);
    // 被删除的占位记录了墓碑，对照素材没有
    expect(state.tombstones.some((tombstone) => tombstone.id === decoy.assetId)).toBe(false);
  });

  it("replaces the placeholder with node outputs on completion", () => {
    startAutoSinkPlaceholder("node-1");
    const placeholderItem = useCreativeStore.getState().canvas.items[0];

    completeAutoSinkPlaceholder("node-1", makePromptNode("生成的提示词内容"));

    const state = useCreativeStore.getState();
    // 占位素材与实例都被移除
    expect(findPlaceholderAsset("node-1")).toBeUndefined();
    expect(state.canvas.items.some((item) => item.id === placeholderItem.id)).toBe(false);
    // 产物素材落画布，并排放置在占位原位置
    const outputAsset = state.assets.find((asset) => asset.text === "生成的提示词内容");
    expect(outputAsset).toBeDefined();
    const outputItem = state.canvas.items.find((item) => item.assetId === outputAsset?.id);
    expect(outputItem?.position).toEqual(placeholderItem.position);
  });

  it("removes the placeholder when completion finds no node outputs", () => {
    startAutoSinkPlaceholder("node-1");

    // 无产物节点：complete 退化为移除占位
    completeAutoSinkPlaceholder("node-1", undefined);

    const state = useCreativeStore.getState();
    expect(findPlaceholderAsset("node-1")).toBeUndefined();
    expect(state.canvas.items).toHaveLength(0);
  });

  it("recycles the placeholder asset when canvas placement fails", () => {
    // 直接向 store 注入 stub：zustand 的 actions 就是 state 属性，creativeAutoSink
    // 每次都通过 getState() 取最新快照，因此 setState 覆盖 addAssetToCanvas 即可
    // 模拟"落画布失败"（返回 null），无需模块级 mock（doMock 需要重置模块注册表
    // 并对齐动态导入实例，脆弱且此前已实测失稳）。
    const originalAddAssetToCanvas = useCreativeStore.getState().addAssetToCanvas;
    useCreativeStore.setState({ addAssetToCanvas: () => null });
    try {
      startAutoSinkPlaceholder("node-recycle");
    } finally {
      useCreativeStore.setState({ addAssetToCanvas: originalAddAssetToCanvas });
    }

    // 落画布失败：刚创建的占位素材被回收，不留孤儿素材
    expect(findPlaceholderAsset("node-recycle")).toBeUndefined();
    expect(useCreativeStore.getState().assets).toHaveLength(0);
    // 内存追踪无残留：后续 fail 为无害空操作
    failAutoSinkPlaceholder("node-recycle");
    expect(useCreativeStore.getState().assets).toHaveLength(0);
  });

  it("cleans up stale placeholders left after a restart without touching live ones", () => {
    // 活跃占位：内存 Map 命中（当前执行中的节点）
    startAutoSinkPlaceholder("node-live");
    // 遗留占位：绕过内存 Map 直接写入 store，等价于应用重启后 Map 失联的落盘状态
    const creative = useCreativeStore.getState();
    const staleAssetId = creative.addAsset({
      kind: "text",
      title: PLACEHOLDER_TITLE,
      text: PLACEHOLDER_TITLE,
      source: "workflow",
      tags: ["auto-sink", "pending", autoSinkNodeTag("node-stale")],
    });
    creative.addAssetToCanvas(staleAssetId, {
      title: PLACEHOLDER_TITLE,
      position: { x: 0, y: 0 },
      width: 220,
      height: 120,
    });

    const cleaned = cleanupStaleAutoSinkPlaceholders();

    expect(cleaned).toEqual(["node-stale"]);
    const state = useCreativeStore.getState();
    expect(findPlaceholderAsset("node-stale")).toBeUndefined();
    // 活跃占位（内存追踪命中的节点）不被误清
    expect(findPlaceholderAsset("node-live")).toBeDefined();
    expect(state.canvas.items).toHaveLength(1);
    // 清理动作自身也是精确回收：再次调用无残留可清
    expect(cleanupStaleAutoSinkPlaceholders()).toEqual([]);
  });
});
