import { describe, expect, it } from "vitest";
import { findAssetIdByRef, nextAssetLabel } from "@/services/creativeAssetService";

describe("asset label addressing", () => {
  it("assigns sequential labels starting from asset_0", () => {
    expect(nextAssetLabel([])).toBe("asset_0");
    expect(nextAssetLabel([{ label: "asset_0" }])).toBe("asset_1");
    expect(nextAssetLabel([{ label: "asset_0" }, { label: "asset_3" }])).toBe("asset_4");
  });

  it("ignores non-label values and gaps resolve to max+1", () => {
    expect(nextAssetLabel([{ label: undefined }, { label: "custom" }, { label: "asset_7" }])).toBe("asset_8");
    expect(nextAssetLabel([{}, {}])).toBe("asset_0");
  });

  it("resolves references by exact id first, then by canonical label", () => {
    const assets = [
      { id: "uuid-a", label: "asset_0" },
      { id: "uuid-b", label: "asset_1" },
    ];
    expect(findAssetIdByRef(assets, "uuid-b")).toBe("uuid-b");
    expect(findAssetIdByRef(assets, "asset_1")).toBe("uuid-b");
    expect(findAssetIdByRef(assets, "asset_9")).toBeNull();
    expect(findAssetIdByRef(assets, "  ")).toBeNull();
  });
});
