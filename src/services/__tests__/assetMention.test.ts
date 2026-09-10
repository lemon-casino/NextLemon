import { describe, expect, it } from "vitest";
import {
  assetLabelMap,
  deriveUpstreamAssetRefs,
  extractAssetMentions,
  findUnresolvedAssetMentions,
} from "@/services/creativeAssetService";

describe("asset mentions", () => {
  it("extracts unique @[asset_N] mentions from text", () => {
    const text = "参考 @[asset_2] 的构图，配色沿用 @[asset_5] 与 @[asset_2]。";
    expect(extractAssetMentions(text)).toEqual(["asset_2", "asset_5"]);
    expect(extractAssetMentions("没有提及")).toEqual([]);
  });

  it("flags mentions that do not resolve to known labels", () => {
    const assets = [{ id: "a", label: "asset_0" }, { id: "b", label: "asset_1" }];
    expect(findUnresolvedAssetMentions("用 @[asset_0] 和 @[asset_9]", assets)).toEqual(["asset_9"]);
    expect(findUnresolvedAssetMentions("用 @[asset_0]", assets)).toEqual([]);
  });

  it("derives upstream asset refs by walking incoming edges", () => {
    const nodes = [
      { id: "img", data: { imagePath: "x", assetId: "asset-src" } },
      { id: "mid", data: {} },
      { id: "prompt", data: {} },
    ];
    const edges = [
      { source: "img", target: "mid" },
      { source: "mid", target: "prompt" },
    ];
    const refs = deriveUpstreamAssetRefs("prompt", nodes, edges, { "asset-src": "asset_3" });
    expect(refs).toEqual([{ nodeId: "img", assetId: "asset-src", label: "asset_3" }]);
  });

  it("guards against cycles when walking the topology", () => {
    const nodes = [{ id: "a", data: { assetId: "x" } }, { id: "b", data: {} }];
    const edges = [
      { source: "a", target: "b" },
      { source: "b", target: "a" },
    ];
    expect(deriveUpstreamAssetRefs("b", nodes, edges)).toHaveLength(1);
  });

  it("builds an assetId to label map skipping unlabeled assets", () => {
    expect(assetLabelMap([{ id: "a", label: "asset_0" }, { id: "b" }])).toEqual({ a: "asset_0" });
  });
});
