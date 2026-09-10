import { describe, expect, it } from "vitest";
import { computeNextToSourcePosition } from "@/services/creativeAssetService";

type PlacementItem = Parameters<typeof computeNextToSourcePosition>[0][number];

function item(
  assetId: string,
  x: number,
  y: number,
  width = 200
): PlacementItem {
  return { assetId, position: { x, y }, width };
}

describe("computeNextToSourcePosition", () => {
  it("places derived items to the right of the rightmost same-asset item", () => {
    const items = [
      item("asset-1", 0, 0),
      item("asset-1", 500, 300),
      item("asset-2", 1000, 1000),
    ];
    const position = computeNextToSourcePosition(items, "asset-1");
    expect(position).toEqual({ x: 732, y: 300 });
  });

  it("falls back to the rightmost item when the asset has no instance yet", () => {
    const items = [
      item("asset-1", 0, 0),
      item("asset-2", 640, 120, 320),
    ];
    const position = computeNextToSourcePosition(items, "asset-9");
    expect(position).toEqual({ x: 992, y: 120 });
  });

  it("returns the default start position on an empty canvas", () => {
    expect(computeNextToSourcePosition([], "asset-1")).toEqual({ x: 120, y: 120 });
    expect(computeNextToSourcePosition([], undefined)).toEqual({ x: 120, y: 120 });
  });

  it("uses the rightmost canvas item when no source asset is given", () => {
    const items = [
      item("asset-1", 0, 40, 100),
      item("asset-2", 200, 80, 400),
    ];
    const position = computeNextToSourcePosition(items, undefined);
    expect(position).toEqual({ x: 632, y: 80 });
  });
});
