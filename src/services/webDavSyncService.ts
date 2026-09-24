import {
  createProjectPackage,
  importProjectPackage,
  parseProjectPackageJson,
  syncProjectPackage,
} from "@/services/projectPackageService";
import type {
  NextLemonProjectPackageWithMedia,
} from "@/services/projectPackageService";
import type { MediaSyncProgress } from "@/services/mediaSyncService";
import { useWebDavSyncStore } from "@/stores/webDavSyncStore";
import type { ImportProjectPackageResult, WebDavSyncConfig } from "@/types/projectPackage";

export async function uploadProjectPackageToWebDav(
  projectPackage: NextLemonProjectPackageWithMedia = createProjectPackage(),
  options?: WebDavSyncOptions
) {
  const store = useWebDavSyncStore.getState();
  const config = store.config;
  assertWebDavConfig(config);
  store.setSyncStatus("uploading");

  try {
    // 媒体差量同步：先上传本地有而远端缺的媒体文件，再把含 sha/ext/bytes 的
    // mediaManifest 合入包 JSON 一起上传；媒体失败只记警告，不阻塞 JSON 同步
    const packageToUpload = await enrichPackageWithMediaManifest(
      projectPackage,
      config,
      options?.onMediaProgress
    );
    const response = await webDavRequest(config, buildWebDavFileUrl(config), "PUT", {
      body: JSON.stringify(packageToUpload, null, 2),
      contentType: "application/json",
    });
    if (!response.ok) {
      throw new Error(`WebDAV 上传失败：${response.status} ${response.statusText}`);
    }
    store.setSyncStatus("success");
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "WebDAV 上传失败";
    store.setSyncStatus("error", message);
    throw error;
  }
}

export async function downloadProjectPackageFromWebDav(): Promise<NextLemonProjectPackageWithMedia> {
  const store = useWebDavSyncStore.getState();
  const config = store.config;
  assertWebDavConfig(config);
  store.setSyncStatus("downloading");

  try {
    const response = await webDavRequest(config, buildWebDavFileUrl(config), "GET");
    if (!response.ok) {
      throw new Error(`WebDAV 拉取失败：${response.status} ${response.statusText}`);
    }
    const text = await response.text();
    const projectPackage = parseProjectPackageJson(text);
    store.setSyncStatus("success");
    return projectPackage;
  } catch (error) {
    const message = error instanceof Error ? error.message : "WebDAV 拉取失败";
    store.setSyncStatus("error", message);
    throw error;
  }
}

export async function importProjectPackageFromWebDav(
  options?: WebDavSyncOptions
): Promise<ImportProjectPackageResult> {
  const projectPackage = await downloadProjectPackageFromWebDav();
  const result = importProjectPackage(projectPackage);
  // 导入时触发缺失媒体回填（远端 mediaManifest 有而本地缺的内容 key）
  const mediaWarnings = await backfillMissingMediaAfterImport(projectPackage, options?.onMediaProgress);
  return { ...result, warnings: [...result.warnings, ...mediaWarnings] };
}

// 拉取并按 id/updatedAt 合并同步（替代整包覆盖式导入）。
// Agent 会话不参与合并；素材/画布条目/品牌 Kit 的删除通过墓碑（CreativeTombstone）
// 裁决后跨端传播（见 projectPackageService.applyTombstones），之后的重新编辑可复活。
export async function syncProjectPackageFromWebDav(
  options?: WebDavSyncOptions
): Promise<{ warnings: string[] }> {
  const projectPackage = await downloadProjectPackageFromWebDav();
  const result = syncProjectPackage(projectPackage);
  // 合并后触发缺失媒体回填（远端 mediaManifest 有而本地缺的内容 key）
  const mediaWarnings = await backfillMissingMediaAfterImport(projectPackage, options?.onMediaProgress);
  return { warnings: [...result.warnings, ...mediaWarnings] };
}

// ---------- 通用 WebDAV 动词 ----------

export interface WebDavRequestInit {
  body?: BodyInit;
  contentType?: string;
  headers?: Record<string, string>;
}

// 通用 WebDAV 动词（PUT/GET/PROPFIND 等）：项目包 JSON 同步与媒体同步
// （mediaSyncService）共用同一 URL 拼接与 Basic 鉴权规则
export async function webDavRequest(
  config: WebDavSyncConfig,
  url: string,
  method: string,
  init: WebDavRequestInit = {}
): Promise<Response> {
  return fetch(url, {
    method,
    headers: {
      ...(init.contentType ? { "Content-Type": init.contentType } : {}),
      ...(init.headers || {}),
      ...buildAuthHeaders(config),
    },
    body: init.body,
  });
}

// 远端项目包文件 URL（既有 JSON 同步行为不变）
export function buildWebDavFileUrl(config: WebDavSyncConfig): string {
  const endpoint = config.endpoint.trim().replace(/\/+$/, "");
  const remotePath = config.remotePath.trim().replace(/^\/+/, "");
  return `${endpoint}/${remotePath}`;
}

// 媒体集合远端目录：与项目包文件同目录下的 /media/
// （保留 remotePath 的目录部分，纯文件名时直接挂在 endpoint 下）
export function buildWebDavMediaCollectionUrl(config: WebDavSyncConfig): string {
  const endpoint = config.endpoint.trim().replace(/\/+$/, "");
  const remotePath = config.remotePath.trim().replace(/^\/+/, "");
  const directory = remotePath.includes("/") ? remotePath.slice(0, remotePath.lastIndexOf("/")) : "";
  return `${endpoint}/${directory ? `${directory}/` : ""}media`;
}

export interface WebDavSyncOptions {
  // 媒体差量同步进度回调（扫描/上传/下载阶段，见 mediaSyncService.MediaSyncProgress）
  onMediaProgress?: (progress: MediaSyncProgress) => void;
}

// ---------- 媒体同步接线 ----------

// 媒体清单填充：上传前差量同步本地媒体并生成 mediaManifest 合入包 JSON。
// 动态 import 加载 mediaSyncService（后者静态引用本文件的通用动词，避免运行时循环依赖）；
// 任何媒体侧失败只记警告，不阻塞项目包 JSON 上传。
async function enrichPackageWithMediaManifest(
  projectPackage: NextLemonProjectPackageWithMedia,
  config: WebDavSyncConfig,
  onMediaProgress?: (progress: MediaSyncProgress) => void
): Promise<NextLemonProjectPackageWithMedia> {
  try {
    const mediaSync = await import("@/services/mediaSyncService");
    if (!mediaSync.isMediaSyncEnabled(config)) return projectPackage;
    const result = await mediaSync.syncMediaForUpload({
      projectPackage,
      config,
      onProgress: onMediaProgress,
    });
    if (result.mediaManifest.length === 0) return projectPackage;
    return { ...projectPackage, mediaManifest: result.mediaManifest };
  } catch (error) {
    console.warn("[webDavSync] 媒体同步失败，继续上传项目包 JSON：", error);
    return projectPackage;
  }
}

// 导入/合并后的缺失媒体回填；返回追加到 warnings 的说明行（浏览器环境降级原因等）。
// 未开启“同步媒体文件”时不做任何请求。
async function backfillMissingMediaAfterImport(
  projectPackage: NextLemonProjectPackageWithMedia,
  onMediaProgress?: (progress: MediaSyncProgress) => void
): Promise<string[]> {
  const config = useWebDavSyncStore.getState().config;
  try {
    const mediaSync = await import("@/services/mediaSyncService");
    if (!mediaSync.isMediaSyncEnabled(config)) return [];
    const result = await mediaSync.backfillMissingMedia({
      projectPackage,
      config,
      onProgress: onMediaProgress,
    });
    if (result.status === "skipped") return result.reason ? [result.reason] : [];
    return [
      `媒体回填：下载 ${result.downloaded} 个，本地已有跳过 ${result.downloadSkipped} 个，失败 ${result.failed} 个`,
      ...result.warnings,
    ];
  } catch (error) {
    return [`媒体回填失败：${error instanceof Error ? error.message : "未知错误"}`];
  }
}

function assertWebDavConfig(config: WebDavSyncConfig) {
  if (!config.enabled) throw new Error("WebDAV 同步未启用");
  if (!config.endpoint.trim()) throw new Error("缺少 WebDAV 地址");
  if (!config.remotePath.trim()) throw new Error("缺少远端文件路径");
}

function buildAuthHeaders(config: WebDavSyncConfig): Record<string, string> {
  if (!config.username?.trim() && !config.password?.trim()) return {};
  const raw = `${config.username || ""}:${config.password || ""}`;
  return {
    Authorization: `Basic ${btoa(unescape(encodeURIComponent(raw)))}`,
  };
}
