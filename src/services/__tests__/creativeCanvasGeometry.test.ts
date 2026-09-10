import { describe, expect, it } from "vitest";
import {
  computeCreativeCanvasExportBounds,
  computeMinimapFrame,
  computeSnapAdjustment,
  findItemsInRect,
} from "@/services/creativeCanvasGeometry";
import type { CreativeCanvasItem } from "@/types/creative";

function item(
  id: string,
  x: number,
  y: number,
  width = 100,
  height = 80,
  hidden = false
): CreativeCanvasItem {
  return {
    id,
    assetId: `asset-${id}`,
    kind: "text",
    title: id,
    position: { x, y },
    width,
    height,
    zIndex: 1,
    locked: false,
    hidden,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("creativeCanvasGeometry", () => {
  it("finds items intersecting the marquee rect regardless of drag direction", () => {
    const items = [item("a", 0, 0), item("b", 200, 200), item("c", 1000, 1000)];
    expect(findItemsInRect(items, { x: 0, y: 0, width: 150, height: 150 }).map((i) => i.id)).toEqual(["a"]);
    // 反向拖拽（负宽高）同样命中
    expect(findItemsInRect(items, { x: 250, y: 250, width: -100, height: -100 }).map((i) => i.id)).toEqual(["b"]);
    expect(findItemsInRect(items, { x: 5000, y: 5000, width: 10, height: 10 })).toEqual([]);
  });

  it("computes export bounds covering all visible items with padding", () => {
    const bounds = computeCreativeCanvasExportBounds([item("a", 100, 200), item("b", 400, 600)], 48);
    expect(bounds).toEqual({ x: 52, y: 152, width: 496, height: 576 });
  });

  it("ignores hidden items and returns null for an empty canvas", () => {
    const bounds = computeCreativeCanvasExportBounds([
      item("a", 0, 0),
      item("hidden", -5000, -5000, 100, 80, true),
    ]);
    expect(bounds).toEqual({ x: -48, y: -48, width: 196, height: 176 });
    expect(computeCreativeCanvasExportBounds([])).toBeNull();
  });
  it("snaps dragged edges onto nearby alignment lines", () => {
    const others = [item("anchor", 300, 300)];
    // 目标左边缘 304，与 anchor 左边缘 300 相差 4（阈值 6）→ 吸附
    const snapped = computeSnapAdjustment(
      { id: "drag", width: 100, height: 80 },
      { x: 304, y: 304 },
      others
    );
    expect(snapped.x).toBe(300);
    expect(snapped.y).toBe(300);
    expect(snapped.guides).toEqual([
      { orientation: "vertical", at: 300 },
      { orientation: "horizontal", at: 300 },
    ]);
  });

  it("leaves positions unchanged when nothing is within threshold", () => {
    const others = [item("anchor", 300, 300)];
    // 拖拽左边缘 420，距 anchor 右边缘 400 为 20，超出阈值
    const result = computeSnapAdjustment(
      { id: "drag", width: 100, height: 80 },
      { x: 420, y: 420 },
      others
    );
    expect(result.x).toBe(420);
    expect(result.y).toBe(420);
    expect(result.guides).toEqual([]);
  });

  it("computes minimap frame from visible items unioned with the viewport", () => {
    const items = [item("a", 0, 0, 100, 100), item("gone", 9000, 9000, 50, 50, true)];
    const frame = computeMinimapFrame(
      items,
      { x: -200, y: -100, zoom: 2 },
      800,
      600,
      168,
      112
    );
    // 视口世界范围 x:[100,500] y:[50,350]，实例 [0,100]^2 并入后 x:[0,500] y:[0,350]
    expect(frame.union.x).toBe(0);
    expect(frame.union.y).toBe(0);
    expect(frame.union.width).toBeCloseTo(500);
    expect(frame.union.height).toBeCloseTo(350);
    expect(frame.scale).toBeCloseTo(Math.min(152 / 500, 96 / 350));
  });
});
