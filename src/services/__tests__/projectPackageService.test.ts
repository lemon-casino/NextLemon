import { describe, expect, it } from "vitest";
import {
  getProjectPackageWarnings,
  mergeProjectPackages,
  mergeWorkflowCanvases,
  parseProjectPackageJson,
} from "@/services/projectPackageService";
import type { CreativeAsset, CreativeCanvasItem } from "@/types/creative";
import type { NextLemonProjectPackage } from "@/types/projectPackage";

function createPackageFixture(): NextLemonProjectPackage {
  return {
    packageType: "nextlemon.project",
    schemaVersion: 1,
    exportedAt: 1,
    app: { name: "NextLemon", packageVersion: "test" },
    manifest: {
      title: "fixture",
      canvasCount: 0,
      workflowNodeCount: 0,
      creativeAssetCount: 0,
      creativeItemCount: 0,
      brandKitCount: 0,
      agentSessionCount: 0,
      assetManifestCount: 1,
    },
    workspace: { mode: "workflow" },
    workflow: { canvases: [], activeCanvasId: null },
    creative: {
      assets: [],
      canvas: {
        id: "creative-main",
        title: "素材创作画布",
        items: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        createdAt: 1,
        updatedAt: 1,
      },
    },
    brand: { brandKits: [], activeBrandKitId: null },
    agent: { sessions: [], activeSessionId: null },
    assetManifest: [
      {
        id: "asset-1",
        source: "creative-asset",
        kind: "image",
        title: "External Image",
        storagePath: "C:/tmp/image.png",
        embedded: false,
      },
    ],
  };
}

describe("projectPackageService", () => {
  it("parses valid NextLemon project packages", () => {
    const fixture = createPackageFixture();
    expect(parseProjectPackageJson(JSON.stringify(fixture)).manifest.title).toBe("fixture");
  });

  it("rejects invalid package json", () => {
    expect(() => parseProjectPackageJson(JSON.stringify({ packageType: "unknown" }))).toThrow(
      "不是有效的 NextLemon 项目包"
    );
  });

  it("reports external asset references that are not embedded", () => {
    const warnings = getProjectPackageWarnings(createPackageFixture());
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("External Image");
  });

  it("merges two packages with newest-wins per id and keeps local agent sessions", () => {
    const localAsset = makeAsset("asset-1", 100, "本地标题");
    const remoteAsset = makeAsset("asset-1", 200, "远端标题");
    const localOnly = makeAsset("asset-local", 50, "仅本地");
    const remoteOnly = makeAsset("asset-remote", 60, "仅远端");

    const local = createPackageFixture();
    local.creative.assets = [localAsset, localOnly];
    local.creative.canvas.items = [makeItem("item-1", "asset-1", 100), makeItem("item-shared", "asset-1", 100)];
    local.brand.brandKits = [{ ...makeBrandKit("brand-1", 10) }];
    local.brand.activeBrandKitId = "brand-1";
    local.agent.sessions = [{ id: "session-local" } as never];

    const incoming = createPackageFixture();
    incoming.creative.assets = [remoteAsset, remoteOnly];
    incoming.creative.canvas.items = [makeItem("item-2", "asset-1", 200), makeItem("item-shared", "asset-1", 50)];
    incoming.brand.brandKits = [{ ...makeBrandKit("brand-1", 99), name: "远端品牌" }, makeBrandKit("brand-2", 20)];
    incoming.agent.sessions = [{ id: "session-remote" } as never];

    const merged = mergeProjectPackages(local, incoming);

    const assetsById = new Map(merged.creative.assets.map((asset) => [asset.id, asset]));
    expect(assetsById.get("asset-1")?.title).toBe("远端标题");
    expect(assetsById.has("asset-local")).toBe(true);
    expect(assetsById.has("asset-remote")).toBe(true);

    const itemsById = new Map(merged.creative.canvas.items.map((item) => [item.id, item]));
    expect(itemsById.has("item-1")).toBe(true);
    expect(itemsById.has("item-2")).toBe(true);
    expect(itemsById.get("item-shared")?.updatedAt).toBe(100);

    expect(merged.brand.brandKits.map((brandKit) => brandKit.id).sort()).toEqual(["brand-1", "brand-2"]);
    const brand1 = merged.brand.brandKits.find((brandKit) => brandKit.id === "brand-1");
    expect(brand1?.name).toBe("远端品牌");
    expect(merged.brand.activeBrandKitId).toBe("brand-1");

    expect(merged.agent.sessions.map((session) => session.id)).toEqual(["session-local"]);

    expect(merged.manifest.creativeAssetCount).toBe(3);
    expect(merged.manifest.creativeItemCount).toBe(3);
    expect(merged.manifest.brandKitCount).toBe(2);
    expect(parseProjectPackageJson(JSON.stringify(merged)).packageType).toBe("nextlemon.project");
  });

  it("merges workflow canvases by newest updatedAt and keeps the local active canvas", () => {
    const local = createPackageFixture();
    local.workflow = {
      activeCanvasId: "canvas-a",
      canvases: [
        makeCanvas("canvas-a", 10, [{ id: "node-local" } as never]),
        makeCanvas("canvas-b", 5, []),
      ],
    };
    const incoming = createPackageFixture();
    incoming.workflow = {
      activeCanvasId: "canvas-b",
      canvases: [
        makeCanvas("canvas-a", 5, [{ id: "node-stale" } as never]),
        makeCanvas("canvas-b", 20, [{ id: "node-remote-b" } as never]),
        makeCanvas("canvas-c", 1, []),
      ],
    };

    const merged = mergeProjectPackages(local, incoming);
    const canvasById = new Map(merged.workflow.canvases.map((canvas) => [canvas.id, canvas]));
    expect(canvasById.get("canvas-a")?.updatedAt).toBe(10);
    expect((canvasById.get("canvas-a")?.nodes[0] as { id: string }).id).toBe("node-local");
    expect(canvasById.get("canvas-b")?.updatedAt).toBe(20);
    expect((canvasById.get("canvas-b")?.nodes[0] as { id: string }).id).toBe("node-remote-b");
    expect(canvasById.has("canvas-c")).toBe(true);
    expect(merged.workflow.activeCanvasId).toBe("canvas-a");
  });

  it("merges shared workflow canvases at node/edge level instead of whole-canvas overwrite", () => {
    const local = createPackageFixture();
    local.workflow = {
      activeCanvasId: "canvas-a",
      canvases: [
        makeCanvas(
          "canvas-a",
          20,
          [
            { id: "node-local", position: { x: 1, y: 1 }, data: { label: "本地节点" } },
            { id: "node-shared", position: { x: 3, y: 3 }, data: { label: "本地共享" } },
          ],
          [
            makeEdge("edge-local", "node-local", "node-shared"),
            makeEdge("edge-conflict", "node-local", "node-shared", "local"),
          ]
        ),
      ],
    };
    const incoming = createPackageFixture();
    incoming.workflow = {
      activeCanvasId: "canvas-a",
      canvases: [
        makeCanvas(
          "canvas-a",
          10,
          [
            { id: "node-remote", position: { x: 2, y: 2 }, data: { label: "远端节点" } },
            { id: "node-shared", position: { x: 9, y: 9 }, data: { label: "远端共享" } },
          ],
          [
            makeEdge("edge-remote", "node-remote", "node-shared"),
            makeEdge("edge-conflict", "node-remote", "node-shared", "remote"),
          ]
        ),
      ],
    };

    const merged = mergeProjectPackages(local, incoming);
    const canvas = merged.workflow.canvases.find((item) => item.id === "canvas-a");
    expect(canvas).toBeDefined();

    // 节点按 id 并集：两端独有的节点都保留，同 id 冲突以画布 updatedAt 新者（本地）为准
    expect(canvas!.nodes.map((node) => node.id).sort()).toEqual([
      "node-local",
      "node-remote",
      "node-shared",
    ]);
    const sharedNode = canvas!.nodes.find((node) => node.id === "node-shared") as {
      position: { x: number };
    };
    expect(sharedNode.position.x).toBe(3);

    // 边按 id 并集，同 id 冲突同样以新画布为准；共有画布 updatedAt 取两端较大值
    const edgeById = new Map(canvas!.edges.map((edge) => [edge.id, edge]));
    expect(edgeById.size).toBe(3);
    expect(edgeById.get("edge-conflict")?.label).toBe("local");
    expect(edgeById.has("edge-local")).toBe(true);
    expect(edgeById.has("edge-remote")).toBe(true);
    expect(canvas!.updatedAt).toBe(20);
    expect(merged.manifest.workflowNodeCount).toBe(3);
  });

  it("drops dangling edges whose endpoints are missing after node-level merge", () => {
    const local = createPackageFixture();
    local.workflow = {
      activeCanvasId: "canvas-a",
      canvases: [
        makeCanvas("canvas-a", 20, [{ id: "node-a" }], [makeEdge("edge-ghost", "node-a", "node-ghost")]),
      ],
    };
    const incoming = createPackageFixture();
    incoming.workflow = {
      activeCanvasId: "canvas-a",
      canvases: [
        makeCanvas(
          "canvas-a",
          10,
          [{ id: "node-b" }],
          [
            makeEdge("edge-kept", "node-b", "node-a"),
            makeEdge("edge-remote-ghost", "node-b", "node-vanished"),
          ]
        ),
      ],
    };

    const merged = mergeProjectPackages(local, incoming);
    const canvas = merged.workflow.canvases.find((item) => item.id === "canvas-a");
    expect(canvas!.nodes.map((node) => node.id).sort()).toEqual(["node-a", "node-b"]);
    // 端点缺失的悬挂边被丢弃，端点齐全的边保留
    expect(canvas!.edges.map((edge) => edge.id)).toEqual(["edge-kept"]);
  });

  it("propagates node/edge deletions from the newer canvas when the older canvas is untouched since its last sync", () => {
    // 设备 A 删除了 node-gone 及其边（画布变新）；设备 B 自基线 20 以来静止，仍持有旧实体。
    // 较旧一端 updatedAt(20) <= 基线(20) → 回退整画布覆盖，删除得以传播（无节点/边墓碑时的补偿）。
    const localCanvas = makeCanvas(
      "canvas-a",
      30,
      [{ id: "node-a" }, { id: "node-b" }],
      [makeEdge("edge-kept", "node-a", "node-b")]
    );
    const staleCanvas = makeCanvas(
      "canvas-a",
      20,
      [{ id: "node-a" }, { id: "node-b" }, { id: "node-gone" }],
      [
        makeEdge("edge-kept", "node-a", "node-b"),
        makeEdge("edge-gone", "node-a", "node-gone"),
      ]
    );

    // 两个方向合并结果一致：删除传播不依赖端序
    for (const [local, incoming] of [
      [localCanvas, staleCanvas],
      [staleCanvas, localCanvas],
    ] as const) {
      const merged = mergeWorkflowCanvases([local], [incoming], () => 20);
      expect(merged).toHaveLength(1);
      expect(merged[0].nodes.map((node) => node.id).sort()).toEqual(["node-a", "node-b"]);
      expect(merged[0].edges.map((edge) => edge.id)).toEqual(["edge-kept"]);
      expect(merged[0].updatedAt).toBe(30);
    }
  });

  it("keeps node-level union when both canvases changed since last sync", () => {
    // 两端 updatedAt 都晚于基线 → 双端都有编辑 → 节点/边并集（不做整画布覆盖）
    const localCanvas = makeCanvas(
      "canvas-a",
      30,
      [{ id: "node-a" }, { id: "node-local-only" }],
      [makeEdge("edge-a", "node-a", "node-local-only")]
    );
    const incomingCanvas = makeCanvas(
      "canvas-a",
      25,
      [{ id: "node-a" }, { id: "node-remote-only" }],
      [makeEdge("edge-b", "node-a", "node-remote-only")]
    );

    const merged = mergeWorkflowCanvases([localCanvas], [incomingCanvas], () => 20);
    expect(merged[0].nodes.map((node) => node.id).sort()).toEqual([
      "node-a",
      "node-local-only",
      "node-remote-only",
    ]);
    expect(merged[0].edges.map((edge) => edge.id).sort()).toEqual(["edge-a", "edge-b"]);
  });

  it("falls back to node-level union when no sync baseline exists (e.g. first sync after restart)", () => {
    // 无基线（如应用重启后首次同步）：安全降级为节点/边并集，可能复活已删节点
    const localCanvas = makeCanvas("canvas-a", 30, [{ id: "node-a" }], []);
    const incomingCanvas = makeCanvas(
      "canvas-a",
      20,
      [{ id: "node-a" }, { id: "node-gone" }],
      [makeEdge("edge-gone", "node-a", "node-gone")]
    );

    const merged = mergeWorkflowCanvases([localCanvas], [incomingCanvas], () => undefined);
    expect(merged[0].nodes.map((node) => node.id).sort()).toEqual(["node-a", "node-gone"]);
    expect(merged[0].edges.map((edge) => edge.id)).toEqual(["edge-gone"]);
  });
  it("propagates deletions across devices via tombstones", () => {
    // 设备 A 删除了 asset-1（墓碑晚于实体）；设备 B 同时编辑了 asset-1（更旧）
    const local = createPackageFixture();
    local.creative.assets = [makeAsset("asset-1", 100, "A 端已删除"), makeAsset("asset-keep", 50, "保留")];
    local.creative.tombstones = [{ id: "asset-1", kind: "asset", deletedAt: 300 }];
    local.brand.tombstones = [{ id: "brand-1", kind: "brandKit", deletedAt: 300 }];

    const incoming = createPackageFixture();
    incoming.creative.assets = [makeAsset("asset-1", 90, "B 端旧编辑")];
    incoming.creative.canvas.items = [makeItem("item-gone", "asset-1", 90)];
    incoming.creative.tombstones = [];
    incoming.brand.brandKits = [makeBrandKit("brand-1", 10)];

    const merged = mergeProjectPackages(local, incoming);

    // 被墓碑覆盖的实体从合并结果中消失
    expect(merged.creative.assets.map((asset) => asset.id)).toEqual(["asset-keep"]);
    expect(merged.brand.brandKits).toEqual([]);
    expect(merged.brand.activeBrandKitId).toBeNull();
    // 墓碑保留在合并包中，继续向下一轮同步传播
    expect(merged.creative.tombstones).toEqual([{ id: "asset-1", kind: "asset", deletedAt: 300 }]);
    expect(merged.brand.tombstones).toEqual([{ id: "brand-1", kind: "brandKit", deletedAt: 300 }]);
  });

  it("revives entities edited after the tombstone was recorded", () => {
    const local = createPackageFixture();
    local.creative.assets = [];
    local.creative.tombstones = [{ id: "asset-1", kind: "asset", deletedAt: 100 }];

    const incoming = createPackageFixture();
    // 远端在删除之后又更新了该素材（updatedAt 300 > deletedAt 100）→ 复活
    incoming.creative.assets = [makeAsset("asset-1", 300, "删除后重建")];

    const merged = mergeProjectPackages(local, incoming);
    expect(merged.creative.assets.map((asset) => asset.id)).toEqual(["asset-1"]);
    expect(merged.creative.assets[0].title).toBe("删除后重建");
  });
});


function makeAsset(id: string, updatedAt: number, title: string): CreativeAsset {
  return {
    id,
    kind: "text",
    title,
    text: `content-${id}`,
    tags: [],
    source: "manual",
    createdAt: 1,
    updatedAt,
  };
}

function makeItem(id: string, assetId: string, updatedAt: number): CreativeCanvasItem {
  return {
    id,
    assetId,
    kind: "text",
    title: `item-${id}`,
    position: { x: 0, y: 0 },
    width: 100,
    height: 80,
    zIndex: 1,
    locked: false,
    hidden: false,
    createdAt: 1,
    updatedAt,
  };
}

function makeBrandKit(id: string, updatedAt: number) {
  return {
    id,
    name: `品牌 ${id}`,
    colors: [],
    fonts: {},
    tone: "professional" as const,
    referenceAssetIds: [],
    createdAt: 1,
    updatedAt,
  };
}

function makeCanvas(
  id: string,
  updatedAt: number,
  nodes: Array<Record<string, unknown>>,
  edges: Array<Record<string, unknown>> = []
): NextLemonProjectPackage["workflow"]["canvases"][number] {
  return {
    id,
    name: `画布 ${id}`,
    nodes: nodes as never,
    edges: edges as never,
    createdAt: 1,
    updatedAt,
  };
}

function makeEdge(id: string, source: string, target: string, label?: string) {
  return { id, source, target, ...(label ? { label } : {}) };
}
