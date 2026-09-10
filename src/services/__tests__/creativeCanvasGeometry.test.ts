import { describe, expect, it } from "vitest";
import {
  computeCreativeCanvasExportBounds,
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
});
