/**
 * WebDAV 媒体差量同步服务
 *
 * 对创意素材 storagePath 引用的本地媒体做内容寻址同步：
 * - 上传：经跨包契约命令 read_media_file 读取字节（Rust 包提供，限定 media 目录白名单），
 *   WebCrypto sha-256 作内容 key，PUT 到 WebDAV /media/<sha256>.<ext>；
 *   远端已存在且长度一致（PROPFIND 判断）时跳过。
 * - 下载：远端 mediaManifest 有而本地缺的内容 key，GET 后经既有 save_media_file 写回，
 *   并把本地不可读、originPaths 匹配的素材 storagePath 重写为新的本地路径。
 * - 固定并发 MEDIA_SYNC_CONCURRENCY=3，全程 onProgress 进度回调。
 * - 浏览器环境（无 Tauri invoke）自动降级为整体跳过，原因随结果返回供 UI 说明。
 */
import { invoke } from "@tauri-apps/api/core";
import { isTauriEnvironment, saveMediaFile } from "@/services/fileStorageService";
import { buildWebDavMediaCollectionUrl, webDavRequest } from "@/services/webDavSyncService";
import type { WebDavRequestInit } from "@/services/webDavSyncService";
import { useCreativeStore } from "@/stores/creativeStore";
import type { CreativeAsset } from "@/types/creative";
import type { WebDavSyncConfig } from "@/types/projectPackage";
import type {
  MediaManifestEntry,
  NextLemonProjectPackageWithMedia,
} from "@/services/projectPackageService";

// 媒体读写的固定并发（任务契约约定为 3）
export const MEDIA_SYNC_CONCURRENCY = 3;

// 浏览器环境自动降级原因（UI 直接展示）
export const MEDIA_SYNC_BROWSER_SKIP_REASON =
  "浏览器环境缺少 Tauri invoke，无法读取本地媒体文件，媒体同步已跳过（仅同步项目包 JSON）";

export interface MediaSyncProgress {
  phase: "collect" | "upload" | "download" | "done" | "skipped";
  total: number;
  completed: number;
  uploaded: number;
  uploadSkipped: number;
  downloaded: number;
  downloadSkipped: number;
  failed: number;
  current?: string;
  message?: string;
}

export type MediaSyncProgressListener = (progress: MediaSyncProgress) => void;

export interface MediaSyncResult {
  status: "synced" | "skipped";
  // status 为 skipped 时的原因（浏览器环境降级等）
  reason?: string;
  uploaded: number;
  uploadSkipped: number;
  downloaded: number;
  downloadSkipped: number;
  failed: number;
  warnings: string[];
  // 上传方向：应嵌入项目包的媒体清单（sha/ext/bytes/originPaths）
  mediaManifest: MediaManifestEntry[];
}

// 可注入依赖：单测中替换 Tauri 命令、WebDAV 动词与 WebCrypto
export interface MediaSyncDeps {
  isTauri?: () => boolean;
  readMediaFile?: (path: string) => Promise<Uint8Array>;
  saveFile?: (base64: string, ext: string) => Promise<{ path: string }>;
  request?: (
    config: WebDavSyncConfig,
    url: string,
    method: string,
    init: WebDavRequestInit
  ) => Promise<Response>;
  buildMediaCollectionUrl?: (config: WebDavSyncConfig) => string;
  digest?: (algorithm: string, data: BufferSource) => Promise<ArrayBuffer>;
  getAssets?: () => CreativeAsset[];
  updateAssets?: (updater: (assets: CreativeAsset[]) => CreativeAsset[]) => void;
}

export interface MediaSyncOptions {
  config: WebDavSyncConfig;
  onProgress?: MediaSyncProgressListener;
  deps?: MediaSyncDeps;
}

// ---------- 纯函数 ----------

// 内容 key：sha-256 hex。digest 默认走平台 WebCrypto（crypto.subtle），可注入 mock。
export async function computeSha256Hex(
  bytes: Uint8Array,
  digest: (algorithm: string, data: BufferSource) => Promise<ArrayBuffer> = (algorithm, data) =>
    crypto.subtle.digest(algorithm, data)
): Promise<string> {
  const hash = await digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const MIME_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "application/pdf": "pdf",
};

// 扩展名推断：文件名/路径扩展优先（小写、仅字母数字、≤8 位，与 save_media_file
// 的“只保留字母数字”约定一致），其次 mimeType 映射，最后回退 bin
export function resolveMediaExtension(ref: { path?: string; fileName?: string; mimeType?: string }): string {
  const name = ref.fileName?.trim() || ref.path?.trim() || "";
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex >= 0 && dotIndex < name.length - 1) {
    const ext = name.slice(dotIndex + 1).toLowerCase();
    if (/^[a-z0-9]{1,8}$/.test(ext)) return ext;
  }
  const mime = ref.mimeType?.split(";")[0]?.trim().toLowerCase() || "";
  return MIME_EXTENSIONS[mime] || "bin";
}

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

// mediaManifest 条目来自不可信的项目包 JSON（文件导入或远端拉取）：
// sha/ext 校验不过会令 GET URL 逃出 /media/ 前缀，必须先校验再下载
const MEDIA_EXT_PATTERN = /^[a-z0-9]{1,8}$/;

function isValidManifestEntry(entry: MediaManifestEntry): boolean {
  return SHA256_HEX_PATTERN.test(entry.sha256) && MEDIA_EXT_PATTERN.test(entry.ext);
}

// 拼进 warning/日志前截断，防止恶意超长字段刷屏
function describeManifestEntry(entry: MediaManifestEntry): string {
  return `${entry.sha256.slice(0, 32)}.${entry.ext.slice(0, 16)}`;
}

// 远端媒体对象名：<sha256>.<ext>
export function buildMediaObjectKey(sha256: string, ext: string): string {
  return ext ? `${sha256}.${ext}` : sha256;
}

// 解析远端媒体对象名，非内容寻址命名（如 readme.txt）返回 null
export function parseMediaObjectKey(name: string): { sha256: string; ext: string } | null {
  const dotIndex = name.lastIndexOf(".");
  const sha256 = (dotIndex > 0 ? name.slice(0, dotIndex) : name).toLowerCase();
  if (!SHA256_HEX_PATTERN.test(sha256)) return null;
  const ext = dotIndex > 0 ? name.slice(dotIndex + 1).toLowerCase() : "";
  return { sha256, ext };
}

// 差量：本地有远端无 → toUpload；远端有本地无 → toDownload。
// key 可为纯 sha（清单 diff）或 sha.ext（对象名 diff）
export function diffMediaKeys(localKeys: string[], remoteKeys: string[]): { toUpload: string[]; toDownload: string[] } {
  const remoteSet = new Set(remoteKeys);
  const localSet = new Set(localKeys);
  return {
    toUpload: localKeys.filter((key) => !remoteSet.has(key)),
    toDownload: remoteKeys.filter((key) => !localSet.has(key)),
  };
}

// 固定并发执行器：最多 limit 个 worker 同时在跑；worker 内部需自行兜错，
// 未捕获的异常会整体失败（编排层已按单个媒体兜错）
export async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  let nextIndex = 0;
  const runnerCount = Math.max(1, Math.min(limit, items.length));
  const runners = Array.from({ length: runnerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

const BASE64_CHUNK_SIZE = 0x8000;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK_SIZE));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

// PROPFIND multistatus 浅解析：node 测试环境没有 DOMParser，且各 WebDAV 服务器
// 命名空间前缀不一（D:/d:/oc…），用前缀无关的正则提取 response/href/getcontentlength
export function parsePropfindMediaEntries(xml: string): Array<{ key: string; bytes?: number }> {
  const entries: Array<{ key: string; bytes?: number }> = [];
  for (const responseMatch of xml.matchAll(
    /<(?:[\w.-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?response>/gi
  )) {
    const block = responseMatch[1] || "";
    const hrefMatch = /<(?:[\w.-]+:)?href\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?href>/i.exec(block);
    const href = hrefMatch?.[1]?.trim();
    if (!href) continue;
    const fileName =
      safeDecodeURIComponent(href.split(/[?#]/)[0])
        .replace(/\/+$/, "")
        .split("/")
        .pop() || "";
    const parsed = parseMediaObjectKey(fileName);
    if (!parsed) continue;
    const lengthMatch =
      /<(?:[\w.-]+:)?getcontentlength\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?getcontentlength>/i.exec(block);
    const lengthText = lengthMatch?.[1]?.trim();
    entries.push({
      key: buildMediaObjectKey(parsed.sha256, parsed.ext),
      bytes: lengthText && /^\d+$/.test(lengthText) ? Number(lengthText) : undefined,
    });
  }
  return entries;
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// 契约：types/projectPackage.ts 的 WebDavSyncConfig 暂无可选 syncMedia 字段
// （该类型文件不在本包可编辑范围，待类型补齐后移除下方宽松读取）；
// 未持久化该字段时视为关闭，UI 开关写入经交集类型注入 updateConfig。
export function isMediaSyncEnabled(config: WebDavSyncConfig): boolean {
  return Boolean((config as { syncMedia?: boolean }).syncMedia);
}

// ---------- 本地媒体收集 ----------

export interface LocalMediaRef {
  storagePath: string;
  title: string;
  ext: string;
  mimeType?: string;
}

// 收集素材引用的本地媒体（text 素材与空 storagePath 除外），按 storagePath 去重
export function collectLocalMediaRefs(assets: CreativeAsset[]): LocalMediaRef[] {
  const seen = new Set<string>();
  const refs: LocalMediaRef[] = [];
  for (const asset of assets) {
    const storagePath = asset.storagePath?.trim();
    if (!storagePath || asset.kind === "text" || seen.has(storagePath)) continue;
    seen.add(storagePath);
    refs.push({
      storagePath,
      title: asset.title,
      ext: resolveMediaExtension({ path: storagePath, fileName: asset.fileName, mimeType: asset.mimeType }),
      mimeType: asset.mimeType,
    });
  }
  return refs;
}

// ---------- 默认依赖实现 ----------

// 跨包契约（Rust 包提供，限定 media 目录白名单内读取）：
// invoke("read_media_file", { path }) → { base64: string }。
// 以宽松对象接住返回值：若 Rust 命令最终缺失，运行时在此抛错并按单个媒体失败计，
// 不影响项目包 JSON 同步。
async function defaultReadMediaFile(path: string): Promise<Uint8Array> {
  const result = (await invoke("read_media_file", { path })) as { base64?: string } | null;
  const base64 = result?.base64;
  if (!base64) throw new Error(`read_media_file 未返回数据：${path}`);
  return base64ToBytes(base64);
}

// 下载写回复用既有 save_media_file 命令（经 fileStorageService.saveMediaFile）
async function defaultSaveFile(base64: string, ext: string): Promise<{ path: string }> {
  const info = await saveMediaFile(base64, ext);
  return { path: info.path };
}

function defaultUpdateAssets(updater: (assets: CreativeAsset[]) => CreativeAsset[]) {
  useCreativeStore.setState((state) => ({ assets: updater(state.assets) }));
}

function resolveDeps(deps?: MediaSyncDeps): Required<MediaSyncDeps> {
  return {
    isTauri: deps?.isTauri || isTauriEnvironment,
    readMediaFile: deps?.readMediaFile || defaultReadMediaFile,
    saveFile: deps?.saveFile || defaultSaveFile,
    request: deps?.request || webDavRequest,
    buildMediaCollectionUrl: deps?.buildMediaCollectionUrl || buildWebDavMediaCollectionUrl,
    digest: deps?.digest || ((algorithm, data) => crypto.subtle.digest(algorithm, data)),
    getAssets: deps?.getAssets || (() => useCreativeStore.getState().assets),
    updateAssets: deps?.updateAssets || defaultUpdateAssets,
  };
}

// ---------- 编排：上传方向 ----------

const PROPFIND_BODY =
  '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:getcontentlength/></d:prop></d:propfind>';

interface MediaSyncAccumulator {
  uploaded: number;
  uploadSkipped: number;
  downloaded: number;
  downloadSkipped: number;
  failed: number;
  warnings: string[];
  mediaManifest: Map<string, MediaManifestEntry>;
}

function createAccumulator(): MediaSyncAccumulator {
  return {
    uploaded: 0,
    uploadSkipped: 0,
    downloaded: 0,
    downloadSkipped: 0,
    failed: 0,
    warnings: [],
    mediaManifest: new Map(),
  };
}

type MediaSyncPhase = MediaSyncProgress["phase"];

function emitProgress(
  onProgress: MediaSyncProgressListener | undefined,
  phase: MediaSyncPhase,
  acc: MediaSyncAccumulator,
  extra: Partial<MediaSyncProgress> = {}
) {
  if (!onProgress) return;
  onProgress({
    phase,
    total: 0,
    completed: 0,
    uploaded: acc.uploaded,
    uploadSkipped: acc.uploadSkipped,
    downloaded: acc.downloaded,
    downloadSkipped: acc.downloadSkipped,
    failed: acc.failed,
    ...extra,
  });
}

function finishResult(acc: MediaSyncAccumulator, status: MediaSyncResult["status"], reason?: string): MediaSyncResult {
  return {
    status,
    reason,
    uploaded: acc.uploaded,
    uploadSkipped: acc.uploadSkipped,
    downloaded: acc.downloaded,
    downloadSkipped: acc.downloadSkipped,
    failed: acc.failed,
    warnings: acc.warnings,
    mediaManifest: Array.from(acc.mediaManifest.values()),
  };
}

function skippedResult(reason: string, onProgress?: MediaSyncProgressListener): MediaSyncResult {
  const acc = createAccumulator();
  // 浏览器降级等跳过场景也发出一次进度事件，UI 进度区才能说明原因（面板"已跳过"分支）
  emitProgress(onProgress, "skipped", acc, { message: reason });
  return finishResult(acc, "skipped", reason);
}

function rememberManifestEntry(manifest: Map<string, MediaManifestEntry>, entry: MediaManifestEntry) {
  const existing = manifest.get(entry.sha256);
  if (!existing) {
    manifest.set(entry.sha256, entry);
    return;
  }
  const originPaths = Array.from(
    new Set([...(existing.originPaths || []), ...(entry.originPaths || [])])
  );
  manifest.set(entry.sha256, originPaths.length > 0 ? { ...existing, originPaths } : existing);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// PROPFIND 结果：entries 为远端已有对象（key → 字节数）；collectionMissing 表示
// 远端 /media 集合不存在（PROPFIND 404）
interface PropfindResult {
  entries: Map<string, number | undefined>;
  collectionMissing: boolean;
}

// PROPFIND 远端 media 目录已有的对象；404 视为空目录，其余失败记警告
async function propfindRemoteMediaEntries(
  config: WebDavSyncConfig,
  collectionUrl: string,
  deps: Required<MediaSyncDeps>,
  acc: MediaSyncAccumulator
): Promise<PropfindResult> {
  const entries = new Map<string, number | undefined>();
  try {
    const response = await deps.request(config, collectionUrl, "PROPFIND", {
      body: PROPFIND_BODY,
      contentType: "application/xml",
      headers: { Depth: "1" },
    });
    if (response.status === 404) return { entries, collectionMissing: true };
    if (!response.ok) {
      acc.warnings.push(`媒体清单探测失败（PROPFIND）：HTTP ${response.status}`);
      return { entries, collectionMissing: false };
    }
    for (const entry of parsePropfindMediaEntries(await response.text())) {
      entries.set(entry.key, entry.bytes);
    }
  } catch (error) {
    acc.warnings.push(`媒体清单探测失败（PROPFIND）：${toErrorMessage(error)}`);
  }
  return { entries, collectionMissing: false };
}

// 首次同步时远端通常没有 /media 集合：RFC 4918 下多数服务器（Apache mod_dav、
// Nextcloud、nginx dav 模块等）对父集合缺失的 PUT 直接回 409 Conflict，
// 因此 PROPFIND 404 后先 MKCOL 创建。2xx 创建成功、405 表示集合已存在，均可继续；
// 其余失败记 warning 并继续走逐条上传（各条目将按现有失败路径计数）。
async function ensureRemoteMediaCollection(
  config: WebDavSyncConfig,
  collectionUrl: string,
  deps: Required<MediaSyncDeps>,
  acc: MediaSyncAccumulator
): Promise<void> {
  try {
    const response = await deps.request(config, collectionUrl, "MKCOL", {});
    if (response.ok || response.status === 405) return;
    acc.warnings.push(`远端 /media 集合创建失败（MKCOL）：HTTP ${response.status}`);
  } catch (error) {
    acc.warnings.push(`远端 /media 集合创建失败（MKCOL）：${toErrorMessage(error)}`);
  }
}

// 上传方向：本地素材媒体 → WebDAV /media/<sha256>.<ext>；
// 远端已存在且长度一致时跳过；返回应嵌入项目包 JSON 的 mediaManifest。
export async function syncMediaForUpload(
  options: MediaSyncOptions & { projectPackage: NextLemonProjectPackageWithMedia }
): Promise<MediaSyncResult> {
  const deps = resolveDeps(options.deps);
  const acc = createAccumulator();
  if (!deps.isTauri()) return skippedResult(MEDIA_SYNC_BROWSER_SKIP_REASON, options.onProgress);

  const refs = collectLocalMediaRefs(options.projectPackage.creative.assets);
  if (refs.length === 0) return finishResult(acc, "synced");

  emitProgress(options.onProgress, "collect", acc, { total: refs.length, message: "扫描本地媒体" });
  const collectionUrl = deps.buildMediaCollectionUrl(options.config);
  const { entries: remoteEntries, collectionMissing } = await propfindRemoteMediaEntries(
    options.config,
    collectionUrl,
    deps,
    acc
  );
  if (collectionMissing) {
    await ensureRemoteMediaCollection(options.config, collectionUrl, deps, acc);
  }
  emitProgress(options.onProgress, "upload", acc, { total: refs.length, completed: 0, message: "上传媒体文件" });

  let completed = 0;
  await runWithConcurrency(refs, MEDIA_SYNC_CONCURRENCY, async (ref) => {
    try {
      const bytes = await deps.readMediaFile(ref.storagePath);
      const sha256 = await computeSha256Hex(bytes, deps.digest);
      const key = buildMediaObjectKey(sha256, ref.ext);
      let manifestEligible = false;
      const remoteBytes = remoteEntries.get(key);
      if (remoteBytes !== undefined && remoteBytes === bytes.length) {
        acc.uploadSkipped += 1;
        manifestEligible = true;
      } else {
        emitProgress(options.onProgress, "upload", acc, { total: refs.length, completed, current: key });
        const response = await deps.request(options.config, `${collectionUrl}/${key}`, "PUT", {
          body: bytes,
          contentType: "application/octet-stream",
        });
        if (!response.ok) {
          acc.failed += 1;
          acc.warnings.push(`上传媒体失败 ${key}：HTTP ${response.status}`);
        } else {
          acc.uploaded += 1;
          manifestEligible = true;
        }
      }
      // 仅 PUT 成功或远端已存在而跳过时记入清单：PUT 失败的媒体在远端并不存在，
      // 记入会误导导入端按清单回填（GET 必然 404）
      if (manifestEligible) {
        rememberManifestEntry(acc.mediaManifest, {
          sha256,
          ext: ref.ext,
          bytes: bytes.length,
          originPaths: [ref.storagePath],
        });
      }
    } catch (error) {
      acc.failed += 1;
      acc.warnings.push(`读取媒体失败 ${ref.storagePath}：${toErrorMessage(error)}`);
    } finally {
      completed += 1;
      emitProgress(options.onProgress, "upload", acc, { total: refs.length, completed });
    }
  });

  emitProgress(options.onProgress, "done", acc, { total: refs.length, completed });
  return finishResult(acc, "synced");
}

// ---------- 编排：下载方向（缺失回填） ----------

// 下载方向：远端 mediaManifest 有而本地缺的内容 key → GET + save_media_file 写回，
// 并把本地不可读、originPaths 匹配的素材 storagePath 重写为新的本地路径。
// 重写不更新 updatedAt：storagePath 是设备本地绝对路径，跨端传播会破坏对端既有引用。
export async function backfillMissingMedia(
  options: MediaSyncOptions & { projectPackage: NextLemonProjectPackageWithMedia }
): Promise<MediaSyncResult> {
  const deps = resolveDeps(options.deps);
  const acc = createAccumulator();
  if (!deps.isTauri()) return skippedResult(MEDIA_SYNC_BROWSER_SKIP_REASON, options.onProgress);

  const remoteManifest = options.projectPackage.mediaManifest || [];
  // 清单来自不可信的项目包 JSON：先校验 sha/ext 再拼 GET URL，
  // 防止 sha=../../x 之类逃出 /media/ 前缀从服务器任意路径拉取内容
  const validManifest = remoteManifest.filter(isValidManifestEntry);
  const invalidEntries = remoteManifest.filter((entry) => !isValidManifestEntry(entry));
  for (const entry of invalidEntries) {
    acc.failed += 1;
    acc.warnings.push(`清单条目不合法，已跳过回填：${describeManifestEntry(entry)}`);
  }
  if (validManifest.length === 0) {
    emitProgress(options.onProgress, "done", acc, {
      message: invalidEntries.length > 0 ? "清单条目均不合法，已跳过回填" : "远端清单不含媒体条目",
    });
    return finishResult(acc, "synced");
  }

  const refs = collectLocalMediaRefs(deps.getAssets());
  emitProgress(options.onProgress, "collect", acc, { total: refs.length, message: "校验本地媒体" });

  // 本地已有内容 key（缺失/不可读的媒体不在其中，即需要回填）
  const localKeys = new Set<string>();
  const unreadablePaths = new Set<string>();
  await runWithConcurrency(refs, MEDIA_SYNC_CONCURRENCY, async (ref) => {
    try {
      const bytes = await deps.readMediaFile(ref.storagePath);
      localKeys.add(await computeSha256Hex(bytes, deps.digest));
    } catch {
      unreadablePaths.add(ref.storagePath);
    }
  });

  const { toDownload } = diffMediaKeys(
    Array.from(localKeys),
    validManifest.map((entry) => entry.sha256)
  );
  const entryBySha = new Map(validManifest.map((entry) => [entry.sha256, entry]));
  const downloadEntries = toDownload
    .map((sha) => entryBySha.get(sha))
    .filter((entry): entry is MediaManifestEntry => Boolean(entry));
  acc.downloadSkipped = validManifest.length - downloadEntries.length;
  if (downloadEntries.length === 0) {
    emitProgress(options.onProgress, "done", acc, {
      total: remoteManifest.length,
      completed: remoteManifest.length,
      message: "本地媒体齐全，无需回填",
    });
    return finishResult(acc, "synced");
  }

  emitProgress(options.onProgress, "download", acc, {
    total: downloadEntries.length,
    completed: 0,
    message: "下载缺失媒体",
  });
  const collectionUrl = deps.buildMediaCollectionUrl(options.config);
  const savedPathsBySha = new Map<string, string>();
  let completed = 0;
  await runWithConcurrency(downloadEntries, MEDIA_SYNC_CONCURRENCY, async (entry) => {
    const key = buildMediaObjectKey(entry.sha256, entry.ext);
    try {
      emitProgress(options.onProgress, "download", acc, {
        total: downloadEntries.length,
        completed,
        current: key,
      });
      const response = await deps.request(options.config, `${collectionUrl}/${key}`, "GET", {});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const saved = await deps.saveFile(bytesToBase64(bytes), entry.ext);
      savedPathsBySha.set(entry.sha256, saved.path);
      acc.downloaded += 1;
    } catch (error) {
      acc.failed += 1;
      acc.warnings.push(`下载媒体失败 ${key}：${toErrorMessage(error)}`);
    } finally {
      completed += 1;
      emitProgress(options.onProgress, "download", acc, { total: downloadEntries.length, completed });
    }
  });

  // 回填 storagePath：仅替换本地不可读且 originPaths 匹配的素材路径
  let rewritten = 0;
  if (savedPathsBySha.size > 0) {
    const savedPathByOrigin = new Map<string, string>();
    for (const entry of downloadEntries) {
      const savedPath = savedPathsBySha.get(entry.sha256);
      if (!savedPath) continue;
      for (const originPath of entry.originPaths || []) {
        savedPathByOrigin.set(originPath, savedPath);
      }
    }
    if (savedPathByOrigin.size > 0) {
      deps.updateAssets((currentAssets) =>
        currentAssets.map((asset) => {
          const storagePath = asset.storagePath?.trim();
          if (!storagePath || !unreadablePaths.has(storagePath)) return asset;
          const newPath = savedPathByOrigin.get(storagePath);
          if (!newPath || newPath === storagePath) return asset;
          rewritten += 1;
          return { ...asset, storagePath: newPath };
        })
      );
    }
  }

  emitProgress(options.onProgress, "done", acc, {
    total: downloadEntries.length,
    completed,
    message: rewritten > 0 ? `已回填 ${rewritten} 个素材的本地路径` : undefined,
  });
  return finishResult(acc, "synced");
}
