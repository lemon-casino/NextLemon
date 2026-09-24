import { describe, expect, it, vi } from "vitest";

import {
  MEDIA_SYNC_CONCURRENCY,
  MEDIA_SYNC_BROWSER_SKIP_REASON,
  backfillMissingMedia,
  base64ToBytes,
  bytesToBase64,
  buildMediaObjectKey,
  collectLocalMediaRefs,
  computeSha256Hex,
  diffMediaKeys,
  isMediaSyncEnabled,
  parseMediaObjectKey,
  parsePropfindMediaEntries,
  resolveMediaExtension,
  runWithConcurrency,
  syncMediaForUpload,
} from "@/services/mediaSyncService";
import { buildWebDavMediaCollectionUrl } from "@/services/webDavSyncService";
import type { NextLemonProjectPackageWithMedia } from "@/services/projectPackageService";
import type { CreativeAsset } from "@/types/creative";
import type { WebDavSyncConfig } from "@/types/projectPackage";

const webDavConfig: WebDavSyncConfig = {
  enabled: true,
  endpoint: "https://dav.example.com/dav",
  username: "user",
  password: "pass",
  remotePath: "backup/nextlemon-project.json",
};

const SHA_A = "a".repeat(64);
const SHA_C = "c".repeat(64);

function fakeDigestHex(hex: string) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return vi.fn(async () => bytes.buffer as ArrayBuffer);
}

function fakeResponse(init: {
  ok?: boolean;
  status?: number;
  statusText?: string;
  text?: string;
  arrayBuffer?: ArrayBuffer;
}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? "OK",
    text: async () => init.text ?? "",
    arrayBuffer: async () => init.arrayBuffer ?? new ArrayBuffer(0),
  } as unknown as Response;
}

function makePackage(assets: CreativeAsset[], mediaManifest?: NextLemonProjectPackageWithMedia["mediaManifest"]) {
  return { creative: { assets }, mediaManifest } as NextLemonProjectPackageWithMedia;
}

function makeAsset(patch: Partial<CreativeAsset>): CreativeAsset {
  return {
    id: "asset-1",
    kind: "video",
    title: "视频素材",
    tags: [],
    source: "upload",
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  };
}

const helloBytes = () => new TextEncoder().encode("hello");

describe("mediaSyncService 纯函数", () => {
  it("computeSha256Hex 使用注入的 WebCrypto digest 并输出 hex", async () => {
    const digest = vi.fn(async (algorithm: string, data: BufferSource) => {
      expect(algorithm).toBe("SHA-256");
      expect(Array.from(data as unknown as ArrayLike<number>)).toEqual([1, 2, 3]);
      return new Uint8Array([0xde, 0xad]).buffer;
    });
    expect(await computeSha256Hex(new Uint8Array([1, 2, 3]), digest)).toBe("dead");
    expect(digest).toHaveBeenCalledTimes(1);
  });

  it("computeSha256Hex 默认走平台 WebCrypto（sha-256 已知向量）", async () => {
    expect(await computeSha256Hex(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });

  it("resolveMediaExtension 优先文件名扩展，其次 mimeType，最后回退 bin", () => {
    expect(resolveMediaExtension({ path: "/data/media/clip.MP4" })).toBe("mp4");
    expect(resolveMediaExtension({ path: "/data/media/clip", fileName: "song.mp3" })).toBe("mp3");
    expect(resolveMediaExtension({ path: "/data/media/clip", mimeType: "video/mp4; charset=utf-8" })).toBe("mp4");
    expect(resolveMediaExtension({ path: "/data/media/clip", mimeType: "application/unknown" })).toBe("bin");
    expect(resolveMediaExtension({ path: "/data/media/archive.tar.gz" })).toBe("gz");
  });

  it("buildMediaObjectKey 与 parseMediaObjectKey 往返一致，非内容寻址名被拒绝", () => {
    const key = buildMediaObjectKey(SHA_A, "mp4");
    expect(key).toBe(`${SHA_A}.mp4`);
    expect(parseMediaObjectKey(key)).toEqual({ sha256: SHA_A, ext: "mp4" });
    expect(parseMediaObjectKey(key.toUpperCase())).toEqual({ sha256: SHA_A, ext: "mp4" });
    expect(parseMediaObjectKey("readme.txt")).toBeNull();
    expect(parseMediaObjectKey("short.mp4")).toBeNull();
    expect(parseMediaObjectKey(SHA_A)).toEqual({ sha256: SHA_A, ext: "" });
  });

  it("diffMediaKeys 计算双向差集", () => {
    const { toUpload, toDownload } = diffMediaKeys(["a", "b", "c"], ["b", "c", "d"]);
    expect(toUpload).toEqual(["a"]);
    expect(toDownload).toEqual(["d"]);
  });

  it("runWithConcurrency 固定并发 3 并处理全部条目", async () => {
    expect(MEDIA_SYNC_CONCURRENCY).toBe(3);
    let active = 0;
    let maxActive = 0;
    const processed: number[] = [];
    const worker = vi.fn(async (_item: number, index: number) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 0));
      active -= 1;
      processed.push(index);
    });
    await runWithConcurrency([0, 1, 2, 3, 4, 5], MEDIA_SYNC_CONCURRENCY, worker);
    expect(maxActive).toBe(MEDIA_SYNC_CONCURRENCY);
    expect(worker).toHaveBeenCalledTimes(6);
    expect([...processed].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("bytesToBase64/base64ToBytes 往返一致（含跨块大 payload）", () => {
    expect(bytesToBase64(new Uint8Array([104, 105]))).toBe("aGk=");
    expect(base64ToBytes("aGk=")).toEqual(new Uint8Array([104, 105]));
    const bytes = new Uint8Array(0x8000 + 37);
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 251;
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it("parsePropfindMediaEntries 解析 multistatus 中的内容寻址对象并过滤非媒体项", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response><D:href>/dav/backup/media/</D:href></D:response>
  <D:response><D:href>/dav/backup/media/${SHA_A}.mp4</D:href><D:propstat><D:prop><D:getcontentlength>11</D:getcontentlength></D:prop></D:propstat></D:response>
  <D:response><D:href>/dav/backup/media/${SHA_C}.webm</D:href><D:propstat><D:prop></D:prop></D:propstat></D:response>
  <D:response><D:href>/dav/backup/media/readme.txt</D:href></D:response>
</D:multistatus>`;
    expect(parsePropfindMediaEntries(xml)).toEqual([
      { key: `${SHA_A}.mp4`, bytes: 11 },
      { key: `${SHA_C}.webm`, bytes: undefined },
    ]);
  });

  it("parsePropfindMediaEntries 对 href 做百分号解码", () => {
    // %61 = "a"、%34 = "4"
    const xml = `<D:multistatus xmlns:D="DAV:"><D:response><D:href>/dav/media/${SHA_A.slice(0, 63)}%61.mp%34</D:href></D:response></D:multistatus>`;
    const entries = parsePropfindMediaEntries(xml);
    expect(entries).toEqual([{ key: `${SHA_A}.mp4`, bytes: undefined }]);
  });

  it("collectLocalMediaRefs 过滤 text/空路径并按 storagePath 去重", () => {
    const refs = collectLocalMediaRefs([
      makeAsset({ id: "a", kind: "video", storagePath: "/m/a.mp4", fileName: "a.mp4" }),
      makeAsset({ id: "b", kind: "text" }),
      makeAsset({ id: "c", kind: "video", storagePath: " /m/a.mp4 " }),
      makeAsset({ id: "d", kind: "audio", storagePath: "/m/b.wav", mimeType: "audio/wav" }),
    ]);
    expect(refs).toEqual([
      { storagePath: "/m/a.mp4", title: "视频素材", ext: "mp4", mimeType: undefined },
      { storagePath: "/m/b.wav", title: "视频素材", ext: "wav", mimeType: "audio/wav" },
    ]);
  });

  it("isMediaSyncEnabled 读取宽松的 syncMedia 契约字段", () => {
    expect(isMediaSyncEnabled(webDavConfig)).toBe(false);
    expect(isMediaSyncEnabled({ ...webDavConfig, syncMedia: true } as WebDavSyncConfig)).toBe(true);
  });

  it("buildWebDavMediaCollectionUrl 与项目包文件同目录", () => {
    expect(buildWebDavMediaCollectionUrl(webDavConfig)).toBe("https://dav.example.com/dav/backup/media");
    expect(
      buildWebDavMediaCollectionUrl({ ...webDavConfig, remotePath: "nextlemon-project.json" })
    ).toBe("https://dav.example.com/dav/media");
    expect(
      buildWebDavMediaCollectionUrl({ ...webDavConfig, endpoint: "https://dav.example.com/dav/" })
    ).toBe("https://dav.example.com/dav/backup/media");
  });
});

describe("syncMediaForUpload", () => {
  it("浏览器环境整体跳过并给出原因（发出 skipped 进度相位）", async () => {
    const request = vi.fn();
    const onProgress = vi.fn();
    const result = await syncMediaForUpload({
      projectPackage: makePackage([makeAsset({ storagePath: "/m/a.mp4" })]),
      config: webDavConfig,
      onProgress,
      deps: { isTauri: () => false },
    });
    expect(result.status).toBe("skipped");
    expect(result.reason).toBe(MEDIA_SYNC_BROWSER_SKIP_REASON);
    expect(request).not.toHaveBeenCalled();
    expect(onProgress.mock.calls[0]?.[0]?.phase).toBe("skipped");
    expect(onProgress.mock.calls[0]?.[0]?.message).toBe(MEDIA_SYNC_BROWSER_SKIP_REASON);
  });

  it("PROPFIND 404 时先 MKCOL 创建 /media 集合再上传", async () => {
    const methods: string[] = [];
    const request = vi.fn(async (_config: unknown, _url: string, method: string) => {
      methods.push(method);
      if (method === "PROPFIND") return fakeResponse({ status: 404, ok: false });
      return fakeResponse({});
    });
    const result = await syncMediaForUpload({
      projectPackage: makePackage([makeAsset({ storagePath: "/m/clip.mp4" })]),
      config: webDavConfig,
      deps: { isTauri: () => true, request, readMediaFile: async () => helloBytes(), digest: fakeDigestHex(SHA_A) },
    });
    expect(methods).toEqual(["PROPFIND", "MKCOL", "PUT"]);
    expect(result.uploaded).toBe(1);
    expect(result.warnings).toEqual([]);
  });

  it("MKCOL 失败记警告并继续逐条上传", async () => {
    const request = vi.fn(async (_config: unknown, _url: string, method: string) => {
      if (method === "PROPFIND") return fakeResponse({ status: 404, ok: false });
      if (method === "MKCOL") return fakeResponse({ ok: false, status: 403, statusText: "Forbidden" });
      return fakeResponse({ ok: false, status: 409, statusText: "Conflict" });
    });
    const result = await syncMediaForUpload({
      projectPackage: makePackage([makeAsset({ storagePath: "/m/clip.mp4" })]),
      config: webDavConfig,
      deps: { isTauri: () => true, request, readMediaFile: async () => helloBytes(), digest: fakeDigestHex(SHA_A) },
    });
    expect(result.warnings[0]).toContain("MKCOL");
    expect(result.uploaded).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.mediaManifest).toEqual([]);
  });

  it("远端缺失时 PUT 到 /media/<sha256>.<ext> 并生成 mediaManifest", async () => {
    const request = vi.fn(async (_config: unknown, _url: string, method: string) => {
      if (method === "PROPFIND") return fakeResponse({ status: 404, ok: false });
      return fakeResponse({});
    });
    const readMediaFile = vi.fn(async () => helloBytes());
    const onProgress = vi.fn();
    const result = await syncMediaForUpload({
      projectPackage: makePackage([makeAsset({ storagePath: "/m/clip.mp4" })]),
      config: webDavConfig,
      onProgress,
      deps: { isTauri: () => true, request, readMediaFile, digest: fakeDigestHex(SHA_A) },
    });

    expect(result.status).toBe("synced");
    expect(result.uploaded).toBe(1);
    expect(result.mediaManifest).toEqual([
      { sha256: SHA_A, ext: "mp4", bytes: 5, originPaths: ["/m/clip.mp4"] },
    ]);
    const putCall = request.mock.calls.find(([, , method]) => method === "PUT");
    expect(putCall?.[1]).toBe(`https://dav.example.com/dav/backup/media/${SHA_A}.mp4`);
    const phases = onProgress.mock.calls.map(([progress]) => progress.phase);
    expect(phases[0]).toBe("collect");
    expect(phases).toContain("upload");
    expect(phases[phases.length - 1]).toBe("done");
  });

  it("远端已存在且长度一致时跳过上传，但清单仍记录该内容", async () => {
    const request = vi.fn(async (_config: unknown, _url: string, method: string) => {
      expect(method).toBe("PROPFIND");
      return fakeResponse({
        text: `<D:multistatus xmlns:D="DAV:"><D:response><D:href>/dav/media/${SHA_A}.mp4</D:href><D:propstat><D:prop><D:getcontentlength>5</D:getcontentlength></D:prop></D:propstat></D:response></D:multistatus>`,
      });
    });
    const result = await syncMediaForUpload({
      projectPackage: makePackage([makeAsset({ storagePath: "/m/clip.mp4" })]),
      config: webDavConfig,
      deps: { isTauri: () => true, request, readMediaFile: async () => helloBytes(), digest: fakeDigestHex(SHA_A) },
    });

    expect(result.uploaded).toBe(0);
    expect(result.uploadSkipped).toBe(1);
    expect(result.mediaManifest).toEqual([
      { sha256: SHA_A, ext: "mp4", bytes: 5, originPaths: ["/m/clip.mp4"] },
    ]);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("PUT 失败的媒体不记入 mediaManifest（避免导入端按清单回填必然 404）", async () => {
    const request = vi.fn(async (_config: unknown, _url: string, method: string) => {
      if (method === "PROPFIND") return fakeResponse({ status: 404, ok: false });
      if (method === "MKCOL") return fakeResponse({});
      return fakeResponse({ ok: false, status: 500, statusText: "Internal Server Error" });
    });
    const result = await syncMediaForUpload({
      projectPackage: makePackage([makeAsset({ storagePath: "/m/clip.mp4" })]),
      config: webDavConfig,
      deps: { isTauri: () => true, request, readMediaFile: async () => helloBytes(), digest: fakeDigestHex(SHA_A) },
    });

    expect(result.uploaded).toBe(0);
    expect(result.uploadSkipped).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.warnings[0]).toContain("500");
    expect(result.mediaManifest).toEqual([]);
  });

  it("读取失败的媒体按单个失败计，不阻塞其他条目", async () => {
    const readMediaFile = vi.fn(async (path: string) => {
      if (path === "/m/broken.mp4") throw new Error("ENOENT");
      return helloBytes();
    });
    const result = await syncMediaForUpload({
      projectPackage: makePackage([
        makeAsset({ id: "asset-good", storagePath: "/m/ok.mp4" }),
        makeAsset({ id: "asset-bad", storagePath: "/m/broken.mp4" }),
      ]),
      config: webDavConfig,
      deps: {
        isTauri: () => true,
        request: async () => fakeResponse({}),
        readMediaFile,
        digest: fakeDigestHex(SHA_A),
      },
    });

    expect(result.failed).toBe(1);
    expect(result.uploaded).toBe(1);
    expect(result.warnings[0]).toContain("/m/broken.mp4");
    expect(result.mediaManifest).toEqual([
      { sha256: SHA_A, ext: "mp4", bytes: 5, originPaths: ["/m/ok.mp4"] },
    ]);
  });
});

describe("backfillMissingMedia", () => {
  it("下载本地缺失的媒体，写回并重写素材 storagePath", async () => {
    const assets = [makeAsset({ storagePath: "/m/clip.mp4" })];
    const request = vi.fn(async (_config: unknown, url: string, method: string) => {
      expect(method).toBe("GET");
      expect(url).toBe(`https://dav.example.com/dav/backup/media/${SHA_C}.mp4`);
      return fakeResponse({ arrayBuffer: helloBytes().buffer as ArrayBuffer });
    });
    const saveFile = vi.fn(async (base64: string, ext: string) => {
      expect(base64).toBe(bytesToBase64(helloBytes()));
      expect(ext).toBe("mp4");
      return { path: "/new/media/saved.mp4" };
    });
    let storeAssets = assets;
    const updateAssets = vi.fn((updater: (items: CreativeAsset[]) => CreativeAsset[]) => {
      storeAssets = updater(storeAssets);
    });
    const result = await backfillMissingMedia({
      projectPackage: makePackage([], [
        { sha256: SHA_C, ext: "mp4", bytes: 5, originPaths: ["/m/clip.mp4"] },
      ]),
      config: webDavConfig,
      deps: {
        isTauri: () => true,
        request,
        saveFile,
        updateAssets,
        getAssets: () => storeAssets,
        readMediaFile: async () => {
          throw new Error("ENOENT");
        },
      },
    });

    expect(result.status).toBe("synced");
    expect(result.downloaded).toBe(1);
    expect(result.downloadSkipped).toBe(0);
    expect(storeAssets[0]?.storagePath).toBe("/new/media/saved.mp4");
  });

  it("本地已有同内容媒体时跳过下载，不触碰素材", async () => {
    const request = vi.fn();
    const saveFile = vi.fn();
    const updateAssets = vi.fn();
    const result = await backfillMissingMedia({
      projectPackage: makePackage([makeAsset({ storagePath: "/m/clip.mp4" })], [
        { sha256: SHA_C, ext: "mp4", bytes: 5, originPaths: ["/m/clip.mp4"] },
      ]),
      config: webDavConfig,
      deps: {
        isTauri: () => true,
        request,
        saveFile,
        updateAssets,
        getAssets: () => [makeAsset({ storagePath: "/m/clip.mp4" })],
        readMediaFile: async () => helloBytes(),
        digest: fakeDigestHex(SHA_C),
      },
    });

    expect(result.status).toBe("synced");
    expect(result.downloaded).toBe(0);
    expect(result.downloadSkipped).toBe(1);
    expect(request).not.toHaveBeenCalled();
    expect(saveFile).not.toHaveBeenCalled();
    expect(updateAssets).not.toHaveBeenCalled();
  });

  it("远端清单为空时直接完成，浏览器环境跳过并说明原因（skipped 相位）", async () => {
    const empty = await backfillMissingMedia({
      projectPackage: makePackage([]),
      config: webDavConfig,
      deps: { isTauri: () => true },
    });
    expect(empty.status).toBe("synced");
    expect(empty.downloaded).toBe(0);

    const onProgress = vi.fn();
    const skipped = await backfillMissingMedia({
      projectPackage: makePackage([], [{ sha256: SHA_C, ext: "mp4", bytes: 5 }]),
      config: webDavConfig,
      onProgress,
      deps: { isTauri: () => false },
    });
    expect(skipped.status).toBe("skipped");
    expect(skipped.reason).toBe(MEDIA_SYNC_BROWSER_SKIP_REASON);
    expect(onProgress.mock.calls[0]?.[0]?.phase).toBe("skipped");
  });

  it("清单中 sha/ext 不合法的条目计入失败并跳过 GET", async () => {
    const request = vi.fn();
    const saveFile = vi.fn();
    const result = await backfillMissingMedia({
      projectPackage: makePackage([], [
        { sha256: "../../etc/passwd", ext: "mp4", bytes: 5 },
        { sha256: SHA_C, ext: "../x", bytes: 5 },
      ]),
      config: webDavConfig,
      deps: {
        isTauri: () => true,
        request,
        saveFile,
        getAssets: () => [],
      },
    });

    expect(result.failed).toBe(2);
    expect(result.warnings.some((warning) => warning.includes("不合法"))).toBe(true);
    expect(request).not.toHaveBeenCalled();
    expect(saveFile).not.toHaveBeenCalled();
  });

  it("合法与不合法清单条目混合时仅下载合法条目", async () => {
    const request = vi.fn(async (_config: unknown, url: string) => {
      // 只有合法条目对应的 URL 会被请求
      expect(url).toBe(`https://dav.example.com/dav/backup/media/${SHA_C}.mp4`);
      return fakeResponse({ arrayBuffer: helloBytes().buffer as ArrayBuffer });
    });
    const result = await backfillMissingMedia({
      projectPackage: makePackage([], [
        { sha256: "../../etc/passwd", ext: "mp4", bytes: 5 },
        { sha256: SHA_C, ext: "mp4", bytes: 5, originPaths: ["/m/clip.mp4"] },
      ]),
      config: webDavConfig,
      deps: {
        isTauri: () => true,
        request,
        saveFile: async () => ({ path: "/new/media/saved.mp4" }),
        getAssets: () => [],
      },
    });

    expect(result.downloaded).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.warnings.some((warning) => warning.includes("不合法"))).toBe(true);
  });

  it("下载失败的条目按单个失败计并记录警告", async () => {
    const result = await backfillMissingMedia({
      projectPackage: makePackage([], [
        { sha256: SHA_C, ext: "mp4", bytes: 5, originPaths: ["/m/clip.mp4"] },
      ]),
      config: webDavConfig,
      deps: {
        isTauri: () => true,
        request: async () => fakeResponse({ ok: false, status: 404, statusText: "Not Found" }),
        saveFile: async () => ({ path: "/new/media/saved.mp4" }),
        getAssets: () => [makeAsset({ storagePath: "/m/clip.mp4" })],
        readMediaFile: async () => {
          throw new Error("ENOENT");
        },
      },
    });

    expect(result.downloaded).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.warnings[0]).toContain(`${SHA_C}.mp4`);
  });
});
