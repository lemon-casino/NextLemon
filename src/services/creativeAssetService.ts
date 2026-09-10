import { formatFileSize, getImageUrl, isTauriEnvironment } from "@/services/fileStorageService";
import type { CreativeAsset, CreativeAssetKind } from "@/types/creative";

export const CREATIVE_ASSET_KIND_LABELS: Record<CreativeAssetKind, string> = {
  text: "文本",
  image: "图片",
  video: "视频",
  audio: "音频",
};

export const CREATIVE_ASSET_SOURCE_LABELS: Record<CreativeAsset["source"], string> = {
  manual: "手动",
  upload: "上传",
  workflow: "工作流",
  agent: "Agent",
  import: "导入",
};

const MIME_EXTENSION: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/ogg": "ogg",
  "text/plain": "txt",
};

export function getCreativeAssetPreviewUrl(asset: CreativeAsset): string {
  if (asset.storagePath) return getImageUrl(asset.storagePath);
  return asset.dataUrl || "";
}

export function normalizeAssetTags(input: string | string[] | undefined): string[] {
  const values = Array.isArray(input)
    ? input
    : (input || "").split(/[,，\n]/);

  return Array.from(
    new Set(
      values
        .map((tag) => tag.trim())
        .filter(Boolean)
    )
  );
}

export function getCreativeAssetFileName(asset: CreativeAsset): string {
  if (asset.fileName?.trim()) return sanitizeFileName(asset.fileName);

  const extension =
    asset.kind === "text"
      ? "txt"
      : asset.mimeType
        ? MIME_EXTENSION[asset.mimeType] || asset.mimeType.split("/")[1]
        : asset.kind;

  return `${sanitizeFileName(asset.title || "creative-asset")}.${extension || "asset"}`;
}

export function getCreativeAssetSizeLabel(asset: CreativeAsset): string {
  return typeof asset.bytes === "number" ? formatFileSize(asset.bytes) : "未知大小";
}

export async function downloadCreativeAsset(asset: CreativeAsset): Promise<boolean> {
  const fileName = getCreativeAssetFileName(asset);

  if (asset.kind === "text") {
    triggerDownload(
      URL.createObjectURL(new Blob([asset.text || ""], { type: "text/plain;charset=utf-8" })),
      fileName,
      true
    );
    return true;
  }

  if (asset.storagePath && isTauriEnvironment()) {
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const { readFile, writeFile } = await import("@tauri-apps/plugin-fs");
      const filePath = await save({ defaultPath: fileName });
      if (!filePath) return false;
      const content = await readFile(asset.storagePath);
      await writeFile(filePath, content);
      return true;
    } catch (error) {
      console.warn("[CreativeAssetService] Tauri 文件导出失败，尝试浏览器下载:", error);
    }
  }

  const url = getCreativeAssetPreviewUrl(asset);
  if (!url) {
    throw new Error("素材没有可下载的数据");
  }

  triggerDownload(url, fileName);
  return true;
}

function triggerDownload(url: string, fileName: string, revoke = false) {
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  if (revoke) URL.revokeObjectURL(url);
}

function sanitizeFileName(value: string): string {
  const trimmed = value.trim() || "creative-asset";
  return trimmed.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 120);
}

// 派生素材并排落位（参考 Open-AI-Design-Agent placeNextToSource）：
// 优先放在同源素材最右侧实例的右边 32px，保持源与派生并排可对比；
// 没有同源实例时放在画布最右侧，空画布回退到默认起点。
export function computeNextToSourcePosition(
  items: Array<{ assetId: string; position: { x: number; y: number }; width: number }>,
  sourceAssetId?: string
): { x: number; y: number } {
  const candidates = sourceAssetId
    ? items.filter((item) => item.assetId === sourceAssetId)
    : items;

  const base = candidates.length > 0 ? candidates : items;
  if (base.length === 0) return { x: 120, y: 120 };

  const rightmost = base.reduce((acc, item) =>
    item.position.x + item.width > acc.position.x + acc.width ? item : acc
  );

  return {
    x: Math.round(rightmost.position.x + rightmost.width + 32),
    y: Math.round(rightmost.position.y),
  };
}

export interface OrphanFileCandidate {
  path: string;
  size: number;
  scope: "media" | "creative-image";
}

export interface OrphanCleanupPlan {
  orphanMediaPaths: string[];
  orphanImagePaths: string[];
  orphanBytes: number;
}

// 引用计数式孤儿文件判定（纯函数）：候选文件必须恰好落在创作素材专属目录
// （media/ 与 images/creative-canvas/），且未被任何素材的 storagePath 引用。
export function collectOrphanCreativeFiles(
  referencedPaths: Array<string | undefined>,
  candidates: OrphanFileCandidate[]
): OrphanCleanupPlan {
  const referenced = new Set(
    referencedPaths.filter((path): path is string => Boolean(path && path.trim()))
  );

  const plan: OrphanCleanupPlan = {
    orphanMediaPaths: [],
    orphanImagePaths: [],
    orphanBytes: 0,
  };

  for (const candidate of candidates) {
    if (referenced.has(candidate.path)) continue;
    if (candidate.scope === "media") {
      plan.orphanMediaPaths.push(candidate.path);
    } else {
      plan.orphanImagePaths.push(candidate.path);
    }
    plan.orphanBytes += candidate.size;
  }

  return plan;
}

// 孤儿素材文件清理（运行时，仅 Tauri 环境）：
// 扫描 media/ 与 images/creative-canvas/ 两个创作素材专属目录，
// 删除未被任何素材 storagePath 引用的文件，返回清理统计。
export async function cleanupOrphanCreativeFiles(): Promise<OrphanCleanupPlan & { deletedCount: number }> {
  const { deleteImage, listCanvasImages, listMediaFiles, deleteMediaFile } =
    await import("@/services/fileStorageService");
  const { useCreativeStore } = await import("@/stores/creativeStore");

  const assets = useCreativeStore.getState().assets;
  const referencedPaths = assets.map((asset) => asset.storagePath);

  const candidates: OrphanFileCandidate[] = [];
  try {
    const mediaFiles = await listMediaFiles();
    mediaFiles.forEach((file) =>
      candidates.push({ path: file.path, size: file.size, scope: "media" })
    );
  } catch (error) {
    console.warn("[creativeAssetService] 列出媒体文件失败:", error);
  }
  try {
    const imageFiles = await listCanvasImages("creative-canvas");
    imageFiles.forEach((file) =>
      candidates.push({ path: file.path, size: file.size, scope: "creative-image" })
    );
  } catch (error) {
    console.warn("[creativeAssetService] 列出创作画布图片失败:", error);
  }

  const plan = collectOrphanCreativeFiles(referencedPaths, candidates);
  let deletedCount = 0;

  for (const path of plan.orphanMediaPaths) {
    try {
      await deleteMediaFile(path);
      deletedCount += 1;
    } catch (error) {
      console.warn("[creativeAssetService] 删除孤儿媒体文件失败:", path, error);
    }
  }
  for (const path of plan.orphanImagePaths) {
    try {
      await deleteImage(path);
      deletedCount += 1;
    } catch (error) {
      console.warn("[creativeAssetService] 删除孤儿图片文件失败:", path, error);
    }
  }

  return { ...plan, deletedCount };
}

const ASSET_LABEL_PATTERN = /^asset_(\d+)$/;

// 为新素材分配规范寻址标签：asset_0、asset_1…，复用已删除标签之后的下一个序号。
export function nextAssetLabel(assets: Array<{ label?: string }>): string {
  let max = -1;
  for (const asset of assets) {
    const match = asset.label?.match(ASSET_LABEL_PATTERN);
    if (match) {
      max = Math.max(max, Number.parseInt(match[1], 10));
    }
  }
  return `asset_${max + 1}`;
}

// 解析 Agent 引用的素材标识：优先精确 id，其次规范标签（如 asset_3）。
// 返回真实素材 id；无法解析时返回 null。
export function findAssetIdByRef(
  assets: Array<{ id: string; label?: string }>,
  ref: string
): string | null {
  const trimmed = ref.trim();
  if (!trimmed) return null;
  const byId = assets.find((asset) => asset.id === trimmed);
  if (byId) return byId.id;
  const byLabel = assets.find((asset) => asset.label && asset.label === trimmed);
  return byLabel?.id ?? null;
}

const ASSET_MENTION_PATTERN = /@\[(asset_\d+)\]/g;

// @提及引用：文本中可用 @[asset_N] 内嵌引用素材（infinite-canvas canvas-resource-references）。
export function extractAssetMentions(text: string): string[] {
  const mentions: string[] = [];
  for (const match of text.matchAll(ASSET_MENTION_PATTERN)) {
    if (!mentions.includes(match[1])) mentions.push(match[1]);
  }
  return mentions;
}

// 解析文本中的提及：返回无法解析（素材库中不存在）的标签列表，空数组表示全部有效。
export function findUnresolvedAssetMentions(
  text: string,
  assets: Array<{ label?: string }>
): string[] {
  const labels = new Set(assets.map((asset) => asset.label).filter(Boolean));
  return extractAssetMentions(text).filter((label) => !labels.has(label));
}

export interface UpstreamAssetRef {
  nodeId: string;
  assetId: string;
  label?: string;
}

// 从工作流连线拓扑推导某节点的上游素材引用（沿入边反向遍历，
// 收集携带 assetId 的节点数据字段），供提示词注入 @提及。
export function deriveUpstreamAssetRefs(
  nodeId: string,
  nodes: Array<{ id: string; data?: Record<string, unknown> }>,
  edges: Array<{ source: string; target: string }>,
  labelByAssetId: Record<string, string> = {}
): UpstreamAssetRef[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, string[]>();
  for (const edge of edges) {
    incoming.set(edge.target, [...(incoming.get(edge.target) || []), edge.source]);
  }

  const refs: UpstreamAssetRef[] = [];
  const seen = new Set<string>();
  const visit = (current: string) => {
    if (seen.has(current)) return;
    seen.add(current);
    for (const parent of incoming.get(current) || []) {
      const parentNode = nodeById.get(parent);
      const assetId = findAssetIdInRecord(parentNode?.data);
      if (assetId) {
        refs.push({ nodeId: parent, assetId, label: labelByAssetId[assetId] });
      }
      visit(parent);
    }
  };
  visit(nodeId);
  return refs;
}

function findAssetIdInRecord(value: unknown, depth = 0): string | null {
  if (!value || typeof value !== "object" || depth > 3) return null;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if ((key === "assetId" || key === "asset_id") && typeof child === "string" && child.trim()) {
      return child;
    }
    if (child && typeof child === "object") {
      const nested = findAssetIdInRecord(child, depth + 1);
      if (nested) return nested;
    }
  }
  return null;
}

// assetId -> asset_N 标签映射，供规划器与快照构建使用
export function assetLabelMap(assets: Array<{ id: string; label?: string }>): Record<string, string> {
  const map: Record<string, string> = {};
  for (const asset of assets) {
    if (asset.label) map[asset.id] = asset.label;
  }
  return map;
}
