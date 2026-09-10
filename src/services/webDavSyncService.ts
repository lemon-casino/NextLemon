import {
  createProjectPackage,
  importProjectPackage,
  parseProjectPackageJson,
  syncProjectPackage,
} from "@/services/projectPackageService";
import { useWebDavSyncStore } from "@/stores/webDavSyncStore";
import type { ImportProjectPackageResult, NextLemonProjectPackage, WebDavSyncConfig } from "@/types/projectPackage";

export async function uploadProjectPackageToWebDav(projectPackage = createProjectPackage()) {
  const store = useWebDavSyncStore.getState();
  const config = store.config;
  assertWebDavConfig(config);
  store.setSyncStatus("uploading");

  try {
    const response = await fetch(buildWebDavUrl(config), {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...buildAuthHeaders(config),
      },
      body: JSON.stringify(projectPackage, null, 2),
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

export async function downloadProjectPackageFromWebDav(): Promise<NextLemonProjectPackage> {
  const store = useWebDavSyncStore.getState();
  const config = store.config;
  assertWebDavConfig(config);
  store.setSyncStatus("downloading");

  try {
    const response = await fetch(buildWebDavUrl(config), {
      method: "GET",
      headers: buildAuthHeaders(config),
    });
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

export async function importProjectPackageFromWebDav(): Promise<ImportProjectPackageResult> {
  const projectPackage = await downloadProjectPackageFromWebDav();
  return importProjectPackage(projectPackage);
}

// 拉取并按 id/updatedAt 合并同步（替代整包覆盖式导入）。
// Agent 会话不参与合并；删除操作没有墓碑机制，无法跨端同步。
export async function syncProjectPackageFromWebDav(): Promise<{ warnings: string[] }> {
  const projectPackage = await downloadProjectPackageFromWebDav();
  return syncProjectPackage(projectPackage);
}

function assertWebDavConfig(config: WebDavSyncConfig) {
  if (!config.enabled) throw new Error("WebDAV 同步未启用");
  if (!config.endpoint.trim()) throw new Error("缺少 WebDAV 地址");
  if (!config.remotePath.trim()) throw new Error("缺少远端文件路径");
}

function buildWebDavUrl(config: WebDavSyncConfig) {
  const endpoint = config.endpoint.trim().replace(/\/+$/, "");
  const remotePath = config.remotePath.trim().replace(/^\/+/, "");
  return `${endpoint}/${remotePath}`;
}

function buildAuthHeaders(config: WebDavSyncConfig): Record<string, string> {
  if (!config.username?.trim() && !config.password?.trim()) return {};
  const raw = `${config.username || ""}:${config.password || ""}`;
  return {
    Authorization: `Basic ${btoa(unescape(encodeURIComponent(raw)))}`,
  };
}
