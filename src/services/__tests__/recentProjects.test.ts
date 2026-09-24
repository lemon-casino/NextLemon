import { describe, expect, it } from "vitest";
import {
  SESSION_ASSET_WINDOW_MS,
  buildCoverTiles,
  collectRecentProjects,
  collectSessionAssets,
  formatRelativeTime,
} from "@/components/RecentProjectsPanel";
import type { AgentSession } from "@/types/agent";
import type { CreativeAsset } from "@/types/creative";

const SESSION_START = 1_000_000;
const SESSION_END = 2_000_000;

function makeSession(overrides: Partial<AgentSession> & Pick<AgentSession, "id">): AgentSession {
  return {
    title: `会话 ${overrides.id}`,
    providerKind: "local",
    messages: [],
    status: "idle",
    createdAt: SESSION_START,
    updatedAt: SESSION_END,
    ...overrides,
  };
}

function makeAsset(
  overrides: Partial<CreativeAsset> & Pick<CreativeAsset, "id">
): CreativeAsset {
  return {
    kind: "image",
    title: `素材 ${overrides.id}`,
    tags: [],
    source: "agent",
    createdAt: 1_500_000,
    updatedAt: 1_500_000,
    ...overrides,
  };
}

describe("collectSessionAssets", () => {
  it("links assets listed in session.metadata.assetIds explicitly", () => {
    const session = makeSession({
      id: "s1",
      metadata: { assetIds: ["a1", "a3"] },
    });
    const assets = [
      makeAsset({ id: "a1", createdAt: 1_200_000, updatedAt: 1_200_000 }),
      // manual 来源且窗口内的素材不应被兜底规则卷入，保证用例只验证显式关联
      makeAsset({ id: "a2", source: "manual", createdAt: 1_300_000, updatedAt: 1_300_000 }),
      makeAsset({ id: "a3", createdAt: 1_400_000, updatedAt: 1_400_000 }),
    ];

    expect(collectSessionAssets(session, assets).map((asset) => asset.id)).toEqual([
      "a3",
      "a1",
    ]);
  });

  it("links assets whose own metadata.sessionId matches the session", () => {
    const session = makeSession({ id: "s1" });
    const assets = [
      // manual 来源不触发时间窗口兜底，保证用例只验证 metadata.sessionId 反向关联
      makeAsset({ id: "a1", source: "manual", metadata: { sessionId: "other" } }),
      makeAsset({ id: "a2", metadata: { sessionId: "s1" } }),
    ];

    expect(collectSessionAssets(session, assets).map((asset) => asset.id)).toEqual([
      "a2",
    ]);
  });

  it("falls back to agent-source assets within the session activity window", () => {
    const session = makeSession({ id: "s1" });
    const assets = [
      makeAsset({ id: "in-window", source: "agent", createdAt: SESSION_START + 1 }),
      makeAsset({
        id: "within-tolerance",
        source: "agent",
        createdAt: SESSION_START - 1,
      }),
      makeAsset({ id: "manual-source", source: "manual", createdAt: SESSION_START + 1 }),
      makeAsset({
        id: "outside-window",
        source: "agent",
        createdAt: SESSION_START - SESSION_ASSET_WINDOW_MS - 1,
      }),
      // 上界：超过 session.updatedAt + 容差的 agent 素材同样被排除
      makeAsset({
        id: "beyond-end-window",
        source: "agent",
        createdAt: SESSION_END + SESSION_ASSET_WINDOW_MS + 1,
      }),
    ];

    expect(collectSessionAssets(session, assets).map((asset) => asset.id)).toEqual([
      "in-window",
      "within-tolerance",
    ]);
  });

  it("dedupes assets matched by multiple rules and sorts by createdAt desc", () => {
    const session = makeSession({
      id: "s1",
      metadata: { assetIds: ["both", "a1"] },
    });
    const assets = [
      makeAsset({
        id: "both",
        createdAt: 1_600_000,
        updatedAt: 1_600_000,
        metadata: { sessionId: "s1" },
      }),
      makeAsset({ id: "a1", createdAt: 1_200_000, updatedAt: 1_200_000 }),
    ];

    const matched = collectSessionAssets(session, assets);
    expect(matched).toHaveLength(2);
    expect(matched.map((asset) => asset.id)).toEqual(["both", "a1"]);
  });
});

describe("buildCoverTiles", () => {
  it("keeps up to 4 urls", () => {
    expect(buildCoverTiles(["u1", "u2", "u3", "u4"]).map((tile) => tile.url)).toEqual([
      "u1",
      "u2",
      "u3",
      "u4",
    ]);
  });

  it("truncates beyond 4 urls", () => {
    expect(buildCoverTiles(["u1", "u2", "u3", "u4", "u5", "u6"])).toHaveLength(4);
  });

  it("pads missing urls with null placeholders", () => {
    const tiles = buildCoverTiles(["u1"]);
    expect(tiles.map((tile) => tile.url)).toEqual(["u1", null, null, null]);
  });

  it("returns all-null tiles for empty input", () => {
    expect(buildCoverTiles([]).map((tile) => tile.url)).toEqual([null, null, null, null]);
  });
});

describe("collectRecentProjects", () => {
  it("orders projects by session updatedAt desc and applies the limit", () => {
    const sessions = [
      makeSession({ id: "old", updatedAt: SESSION_END }),
      makeSession({ id: "new", updatedAt: SESSION_END + 5_000 }),
      makeSession({ id: "older", updatedAt: SESSION_END - 5_000 }),
    ];

    const projects = collectRecentProjects(sessions, [], { limit: 2 });
    expect(projects.map((project) => project.sessionId)).toEqual(["new", "old"]);
  });

  it("uses image assets with preview urls as cover tiles but counts all linked assets", () => {
    const session = makeSession({
      id: "s1",
      metadata: { assetIds: ["img1", "img2", "img3", "img4", "img5", "text1"] },
    });
    const assets = [
      makeAsset({ id: "img1", dataUrl: "data:image/png;base64,a" }),
      makeAsset({ id: "img2", dataUrl: "data:image/png;base64,b" }),
      makeAsset({ id: "img3", dataUrl: "data:image/png;base64,c" }),
      makeAsset({ id: "img4", dataUrl: "data:image/png;base64,d" }),
      makeAsset({ id: "img5", dataUrl: "data:image/png;base64,e" }),
      makeAsset({ id: "text1", kind: "text", source: "manual" }),
    ];

    const [project] = collectRecentProjects([session], assets);
    expect(project.assetCount).toBe(6);
    expect(project.coverTiles).toHaveLength(4);
    expect(project.coverTiles.every((tile) => tile.url !== null)).toBe(true);
  });

  it("returns all-null cover tiles for sessions without linked assets", () => {
    const session = makeSession({ id: "s1" });

    const [project] = collectRecentProjects([session], []);
    expect(project.assetCount).toBe(0);
    expect(project.coverTiles.map((tile) => tile.url)).toEqual([null, null, null, null]);
  });

  it("ignores non-image assets as cover sources", () => {
    const session = makeSession({
      id: "s1",
      metadata: { assetIds: ["text1", "img1"] },
    });
    const assets = [
      makeAsset({ id: "text1", kind: "text", dataUrl: "data:text/plain;base64,a" }),
      makeAsset({ id: "img1", dataUrl: "data:image/png;base64,b" }),
    ];

    const [project] = collectRecentProjects([session], assets);
    expect(
      project.coverTiles.map((tile) => tile.url).filter(Boolean)
    ).toEqual(["data:image/png;base64,b"]);
  });
});

describe("formatRelativeTime", () => {
  const now = 10_000_000;

  it("renders 刚刚 within one minute", () => {
    expect(formatRelativeTime(now - 30_000, now)).toBe("刚刚");
  });

  it("renders minutes below one hour", () => {
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe("5 分钟前");
  });

  it("renders hours below one day", () => {
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe("3 小时前");
  });

  it("renders days below one week", () => {
    expect(formatRelativeTime(now - 2 * 86_400_000, now)).toBe("2 天前");
  });

  it("falls back to locale date beyond one week", () => {
    const timestamp = now - 10 * 86_400_000;
    expect(formatRelativeTime(timestamp, now)).toBe(
      new Date(timestamp).toLocaleDateString()
    );
  });
});
