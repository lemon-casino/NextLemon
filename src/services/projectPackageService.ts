import { v4 as uuidv4 } from "uuid";
import { isTauriEnvironment } from "@/services/fileStorageService";
import { useAgentStore } from "@/stores/agentStore";
import { useBrandKitStore } from "@/stores/brandKitStore";
import { useCanvasStore } from "@/stores/canvasStore";
import { useCreativeStore } from "@/stores/creativeStore";
import { useFlowStore } from "@/stores/flowStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import type { AgentEvent, AgentMessage, AgentSession } from "@/types/agent";
import type { BrandKit } from "@/types/brand";
import type { CreativeAsset, CreativeCanvasItem } from "@/types/creative";
import type { CustomNode, ImageGeneratorNodeData, ImageInputNodeData } from "@/types";
import type {
  CreativeTombstone,
  ImportProjectPackageResult,
  NextLemonProjectPackage,
  ProjectAssetManifestItem,
  ProjectPackageCanvas,
} from "@/types/projectPackage";

const PROJECT_PACKAGE_VERSION = "1.0.0";

export function createProjectPackage(): NextLemonProjectPackage {
  const exportedAt = Date.now();
  const workspace = useWorkspaceStore.getState();
  const canvasStore = useCanvasStore.getState();
  const flow = useFlowStore.getState();
  const creative = useCreativeStore.getState();
  const brand = useBrandKitStore.getState();
  const agent = useAgentStore.getState();

  const canvases = canvasStore.canvases.map((canvas) => {
    const active = canvas.id === canvasStore.activeCanvasId;
    return sanitizeCanvas({
      ...canvas,
      nodes: active ? flow.nodes : canvas.nodes,
      edges: active ? flow.edges : canvas.edges,
      updatedAt: active ? exportedAt : canvas.updatedAt,
    });
  });
  const creativeAssets = creative.assets.map(sanitizeCreativeAsset);
  const creativeCanvas = {
    ...creative.canvas,
    items: creative.canvas.items.map((item) => ({ ...item })),
  };
  const assetManifest = buildAssetManifest(canvases, creativeAssets);
  const workflowNodeCount = canvases.reduce((count, canvas) => count + canvas.nodes.length, 0);
  const workflowEdgeCount = canvases.reduce((count, canvas) => count + canvas.edges.length, 0);

  return {
    packageType: "nextlemon.project",
    schemaVersion: 1,
    exportedAt,
    app: {
      name: "NextLemon",
      packageVersion: PROJECT_PACKAGE_VERSION,
    },
    manifest: {
      title: `NextLemon Project ${new Date(exportedAt).toLocaleString()}`,
      canvasCount: canvases.length,
      workflowNodeCount,
      creativeAssetCount: creativeAssets.length,
      creativeItemCount: creativeCanvas.items.length,
      brandKitCount: brand.brandKits.length,
      agentSessionCount: agent.sessions.length,
      assetManifestCount: assetManifest.length,
    },
    workspace: {
      mode: workspace.mode,
    },
    workflow: {
      canvases,
      activeCanvasId: canvasStore.activeCanvasId,
    },
    creative: {
      assets: creativeAssets,
      canvas: creativeCanvas,
      tombstones: creative.tombstones.map((tombstone) => ({ ...tombstone })),
    },
    brand: {
      brandKits: brand.brandKits.map((brandKit) => ({ ...brandKit })),
      activeBrandKitId: brand.activeBrandKitId,
      tombstones: brand.tombstones.map((tombstone) => ({ ...tombstone })),
    },
    agent: {
      sessions: agent.sessions.map(cloneAgentSession),
      activeSessionId: agent.activeSessionId,
    },
    assetManifest,
    notes: [
      `Workflow edge count: ${workflowEdgeCount}`,
      "External files are referenced in assetManifest and are not duplicated into this JSON package.",
    ],
  };
}

export async function exportProjectPackageToFile(projectPackage = createProjectPackage()) {
  const json = JSON.stringify(projectPackage, null, 2);
  const fileName = `nextlemon-project-${projectPackage.exportedAt}.json`;

  if (isTauriEnvironment()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    const filePath = await save({
      defaultPath: fileName,
      filters: [{ name: "NextLemon Project", extensions: ["json"] }],
    });
    if (!filePath) return false;
    await writeTextFile(filePath, json);
    return true;
  }

  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  return true;
}

export function parseProjectPackageJson(json: string): NextLemonProjectPackage {
  const parsed = JSON.parse(json) as unknown;
  if (!isProjectPackage(parsed)) {
    throw new Error("不是有效的 NextLemon 项目包");
  }
  return parsed;
}

export function importProjectPackage(projectPackage: NextLemonProjectPackage): ImportProjectPackageResult {
  const suffix = Date.now().toString(36);
  const warnings = getProjectPackageWarnings(projectPackage);

  const canvasStore = useCanvasStore.getState();
  const currentCreative = useCreativeStore.getState();
  const currentBrand = useBrandKitStore.getState();
  const currentAgent = useAgentStore.getState();

  const importedCanvases = projectPackage.workflow.canvases.map((canvas) =>
    remapCanvas(canvas, new Set(canvasStore.canvases.map((item) => item.id)), suffix)
  );
  const activeImportedCanvas =
    importedCanvases.find((canvas) => canvas.id === projectPackage.workflow.activeCanvasId) ||
    importedCanvases[0] ||
    null;

  const assetIdMap = new Map<string, string>();
  const existingAssetIds = new Set(currentCreative.assets.map((asset) => asset.id));
  const importedAssets = projectPackage.creative.assets.map((asset) => {
    const nextId = existingAssetIds.has(asset.id) ? `import-${suffix}-${asset.id}` : asset.id;
    assetIdMap.set(asset.id, nextId);
    existingAssetIds.add(nextId);
    return {
      ...asset,
      id: nextId,
      source: asset.source || "import",
      updatedAt: Date.now(),
    };
  });

  const existingItemIds = new Set(currentCreative.canvas.items.map((item) => item.id));
  const importedItems = projectPackage.creative.canvas.items.map((item, index) =>
    remapCreativeItem(item, assetIdMap, existingItemIds, suffix, index)
  );

  const brandKitIdMap = new Map<string, string>();
  const existingBrandIds = new Set(currentBrand.brandKits.map((brandKit) => brandKit.id));
  const importedBrandKits = projectPackage.brand.brandKits.map((brandKit) =>
    remapBrandKit(brandKit, assetIdMap, brandKitIdMap, existingBrandIds, suffix)
  );

  const sessionIdMap = new Map<string, string>();
  const existingSessionIds = new Set(currentAgent.sessions.map((session) => session.id));
  const importedSessions = projectPackage.agent.sessions.map((session) =>
    remapAgentSession(session, sessionIdMap, existingSessionIds, suffix)
  );

  useCanvasStore.setState({
    canvases: [...canvasStore.canvases, ...importedCanvases],
    activeCanvasId: activeImportedCanvas?.id || canvasStore.activeCanvasId,
  });
  if (activeImportedCanvas) {
    useFlowStore.setState({
      nodes: activeImportedCanvas.nodes,
      edges: activeImportedCanvas.edges,
      selectedNodeId: null,
      selectedNodeIds: [],
      selectedEdgeIds: [],
    });
  }

  useCreativeStore.setState((state) => ({
    assets: [...state.assets, ...importedAssets],
    canvas: {
      ...state.canvas,
      items: [...state.canvas.items, ...importedItems],
      updatedAt: Date.now(),
    },
    selectedItemIds: [],
    tombstones: mergeById(
      state.tombstones,
      projectPackage.creative.tombstones || [],
      (tombstone) => tombstone.id,
      (tombstone) => tombstone.deletedAt
    ),
  }));

  useBrandKitStore.setState((state) => ({
    brandKits: [...state.brandKits, ...importedBrandKits],
    activeBrandKitId: importedBrandKits[0]?.id || state.activeBrandKitId,
    tombstones: mergeById(
      state.tombstones,
      projectPackage.brand.tombstones || [],
      (tombstone) => tombstone.id,
      (tombstone) => tombstone.deletedAt
    ),
  }));

  useAgentStore.setState((state) => ({
    sessions: [...importedSessions, ...state.sessions],
    activeSessionId: importedSessions[0]?.id || state.activeSessionId,
  }));

  if (projectPackage.workspace.mode) {
    useWorkspaceStore.getState().setMode(projectPackage.workspace.mode);
  }

  return {
    importedCanvases: importedCanvases.length,
    importedCreativeAssets: importedAssets.length,
    importedCreativeItems: importedItems.length,
    importedBrandKits: importedBrandKits.length,
    importedAgentSessions: importedSessions.length,
    warnings,
  };
}

export function getProjectPackageWarnings(projectPackage: NextLemonProjectPackage): string[] {
  return projectPackage.assetManifest
    .filter((item) => !item.embedded && (item.storagePath || item.url))
    .map((item) => `外部素材未内嵌：${item.title} (${item.storagePath || item.url})`);
}

// 分域清单式合并（纯函数，参考 infinite-canvas app-sync 的 mergeById）：
// 按 id 并集、updatedAt 最新者胜。Agent 会话不参与合并（会话是本地优先数据，
// 远端整包覆盖会破坏对话）；没有墓碑机制，删除操作无法跨端同步。
export function mergeProjectPackages(
  local: NextLemonProjectPackage,
  incoming: NextLemonProjectPackage
): NextLemonProjectPackage {
  const canvases = mergeById(
    local.workflow.canvases,
    incoming.workflow.canvases,
    (canvas) => canvas.id,
    (canvas) => canvas.updatedAt
  );
  const creativeTombstones = mergeById(
    local.creative.tombstones || [],
    incoming.creative.tombstones || [],
    (tombstone) => tombstone.id,
    (tombstone) => tombstone.deletedAt
  );
  const brandTombstones = mergeById(
    local.brand.tombstones || [],
    incoming.brand.tombstones || [],
    (tombstone) => tombstone.id,
    (tombstone) => tombstone.deletedAt
  );
  // 墓碑裁决：deletedAt 晚于实体 updatedAt 的实体在合并结果中被视为已删除
  const assets = applyTombstones(
    mergeById(
      local.creative.assets,
      incoming.creative.assets,
      (asset) => asset.id,
      (asset) => asset.updatedAt
    ),
    creativeTombstones,
    "asset"
  );
  const creativeCanvasUpdatedAt = Math.max(
    local.creative.canvas.updatedAt,
    incoming.creative.canvas.updatedAt
  );
  const items = applyTombstones(
    mergeById(
      local.creative.canvas.items,
      incoming.creative.canvas.items,
      (item) => item.id,
      (item) => item.updatedAt
    ),
    creativeTombstones,
    "item"
  );
  const creativeCanvasSource =
    local.creative.canvas.updatedAt >= incoming.creative.canvas.updatedAt
      ? local.creative.canvas
      : incoming.creative.canvas;
  const brandKits = applyTombstones(
    mergeById(
      local.brand.brandKits,
      incoming.brand.brandKits,
      (brandKit) => brandKit.id,
      (brandKit) => brandKit.updatedAt
    ),
    brandTombstones,
    "brandKit"
  );
  const brandKitIds = new Set(brandKits.map((brandKit) => brandKit.id));
  const activeBrandKitId =
    local.brand.activeBrandKitId && brandKitIds.has(local.brand.activeBrandKitId)
      ? local.brand.activeBrandKitId
      : incoming.brand.activeBrandKitId && brandKitIds.has(incoming.brand.activeBrandKitId)
        ? incoming.brand.activeBrandKitId
        : brandKits[0]?.id || null;
  const assetManifest = mergeById(
    local.assetManifest,
    incoming.assetManifest,
    (item) => item.id,
    () => 0
  );

  return {
    ...local,
    exportedAt: Date.now(),
    manifest: {
      ...local.manifest,
      canvasCount: canvases.length,
      workflowNodeCount: canvases.reduce((count, canvas) => count + canvas.nodes.length, 0),
      creativeAssetCount: assets.length,
      creativeItemCount: items.length,
      brandKitCount: brandKits.length,
      agentSessionCount: local.agent.sessions.length,
      assetManifestCount: assetManifest.length,
    },
    workflow: {
      canvases,
      activeCanvasId: local.workflow.activeCanvasId,
    },
    creative: {
      assets,
      canvas: {
        ...creativeCanvasSource,
        items,
        updatedAt: creativeCanvasUpdatedAt,
      },
      tombstones: creativeTombstones,
    },
    brand: {
      brandKits,
      activeBrandKitId,
      tombstones: brandTombstones,
    },
    agent: local.agent,
    assetManifest,
  };
}

// 墓碑裁决：deletedAt 晚于实体 updatedAt 的实体在合并结果中被视为已删除；
// 之后又有更新的修改（updatedAt 晚于 deletedAt）则实体复活。
function applyTombstones<T extends { id: string; updatedAt: number }>(
  entities: T[],
  tombstones: CreativeTombstone[],
  kind: CreativeTombstone["kind"]
): T[] {
  const tombstoneById = new Map(
    tombstones.filter((tombstone) => tombstone.kind === kind).map((tombstone) => [tombstone.id, tombstone])
  );
  if (tombstoneById.size === 0) return entities;
  return entities.filter((entity) => {
    const tombstone = tombstoneById.get(entity.id);
    return !tombstone || tombstone.deletedAt <= entity.updatedAt;
  });
}

function mergeById<T>(
  localItems: T[],
  incomingItems: T[],
  getId: (item: T) => string,
  getUpdatedAt: (item: T) => number
): T[] {
  const byId = new Map<string, T>();
  for (const item of localItems) {
    byId.set(getId(item), item);
  }
  for (const item of incomingItems) {
    const existing = byId.get(getId(item));
    if (!existing || getUpdatedAt(item) > getUpdatedAt(existing)) {
      byId.set(getId(item), item);
    }
  }
  return Array.from(byId.values());
}

// WebDAV 拉取同步：本地全量 + 远端全量 -> 按 id/updatedAt 合并 -> 直接应用合并结果。
// 与 importProjectPackage 的"冲突改名追加"不同，合并后同 id 实体不会产生重复副本。
export function syncProjectPackage(remote: NextLemonProjectPackage): { warnings: string[] } {
  const warnings = getProjectPackageWarnings(remote);
  const local = createProjectPackage();
  const merged = mergeProjectPackages(local, remote);

  const canvasStore = useCanvasStore.getState();
  const creativeStore = useCreativeStore.getState();
  useCanvasStore.setState({
    canvases: merged.workflow.canvases,
    activeCanvasId: canvasStore.activeCanvasId,
  });
  const activeCanvas = merged.workflow.canvases.find(
    (canvas) => canvas.id === canvasStore.activeCanvasId
  );
  if (activeCanvas) {
    useFlowStore.setState({
      nodes: activeCanvas.nodes,
      edges: activeCanvas.edges,
    });
  }

  const itemIds = new Set(merged.creative.canvas.items.map((item) => item.id));
  useCreativeStore.setState((state) => ({
    assets: merged.creative.assets,
    canvas: {
      ...state.canvas,
      title: merged.creative.canvas.title,
      items: merged.creative.canvas.items,
      updatedAt: Date.now(),
    },
    selectedItemIds: state.selectedItemIds.filter((id) => itemIds.has(id)),
    tombstones: merged.creative.tombstones || state.tombstones,
  }));
  creativeStore.resetCanvasHistory();

  useBrandKitStore.setState({
    brandKits: merged.brand.brandKits,
    activeBrandKitId: merged.brand.activeBrandKitId,
    tombstones: merged.brand.tombstones || [],
  });

  return { warnings };
}

function buildAssetManifest(
  canvases: ProjectPackageCanvas[],
  assets: CreativeAsset[]
): ProjectAssetManifestItem[] {
  const manifest: ProjectAssetManifestItem[] = [];

  for (const asset of assets) {
    manifest.push({
      id: asset.id,
      source: "creative-asset",
      kind: asset.kind,
      title: asset.title,
      ownerId: asset.id,
      storagePath: asset.storagePath,
      url: asset.storagePath ? undefined : asset.dataUrl?.startsWith("http") ? asset.dataUrl : undefined,
      embedded: Boolean(asset.dataUrl && !asset.storagePath),
      bytes: asset.bytes,
      mimeType: asset.mimeType,
    });
  }

  for (const canvas of canvases) {
    for (const node of canvas.nodes) {
      const refs = collectFileReferences(node.data);
      refs.forEach((ref, index) => {
        manifest.push({
          id: `${node.id}-${index}`,
          source: "workflow-node",
          kind: inferReferenceKind(ref.fieldPath),
          title: `${String(node.data.label || node.type || "工作流节点")} ${ref.fieldPath}`,
          ownerId: node.id,
          fieldPath: ref.fieldPath,
          storagePath: ref.storagePath,
          url: ref.url,
          embedded: false,
        });
      });
    }
  }

  return manifest;
}

function sanitizeCanvas(canvas: ProjectPackageCanvas): ProjectPackageCanvas {
  return {
    ...canvas,
    nodes: canvas.nodes.map(sanitizeNode),
    edges: canvas.edges.map((edge) => ({ ...edge })),
  };
}

function sanitizeNode(node: CustomNode): CustomNode {
  const data = { ...node.data } as CustomNode["data"];
  if (
    (node.type === "imageGeneratorProNode" || node.type === "imageGeneratorFastNode") &&
    (data as ImageGeneratorNodeData).outputImagePath
  ) {
    (data as ImageGeneratorNodeData).outputImage = undefined;
  }
  if (node.type === "imageInputNode" && (data as ImageInputNodeData).imagePath) {
    (data as ImageInputNodeData).imageData = undefined;
  }
  return {
    ...node,
    data,
    selected: false,
  };
}

function sanitizeCreativeAsset(asset: CreativeAsset): CreativeAsset {
  return asset.storagePath ? { ...asset, dataUrl: undefined } : { ...asset };
}

function collectFileReferences(value: unknown, prefix = "", depth = 0): Array<{ fieldPath: string; storagePath?: string; url?: string }> {
  if (!value || typeof value !== "object" || depth > 6) return [];
  const refs: Array<{ fieldPath: string; storagePath?: string; url?: string }> = [];
  Object.entries(value as Record<string, unknown>).forEach(([key, child]) => {
    const fieldPath = prefix ? `${prefix}.${key}` : key;
    if (typeof child === "string" && child.trim()) {
      const lowerKey = key.toLowerCase();
      if (lowerKey.includes("path") && !child.startsWith("data:")) {
        refs.push({ fieldPath, storagePath: child });
      } else if (lowerKey.includes("url") && !child.startsWith("data:")) {
        refs.push({ fieldPath, url: child });
      }
      return;
    }
    if (child && typeof child === "object") {
      refs.push(...collectFileReferences(child, fieldPath, depth + 1));
    }
  });
  return refs;
}

function inferReferenceKind(fieldPath: string): ProjectAssetManifestItem["kind"] {
  const lower = fieldPath.toLowerCase();
  if (lower.includes("image") || lower.includes("thumbnail")) return "image";
  if (lower.includes("video")) return "video";
  if (lower.includes("audio")) return "audio";
  return "file";
}

function remapCanvas(canvas: ProjectPackageCanvas, existingCanvasIds: Set<string>, suffix: string): ProjectPackageCanvas {
  const hasConflict = existingCanvasIds.has(canvas.id);
  const nextId = hasConflict ? `import-${suffix}-${canvas.id}` : canvas.id;
  existingCanvasIds.add(nextId);
  return {
    ...canvas,
    id: nextId,
    name: hasConflict ? `${canvas.name} 导入` : canvas.name,
    nodes: canvas.nodes.map((node) => ({ ...node, selected: false })),
    edges: canvas.edges.map((edge) => ({ ...edge })),
    updatedAt: Date.now(),
  };
}

function remapCreativeItem(
  item: CreativeCanvasItem,
  assetIdMap: Map<string, string>,
  existingItemIds: Set<string>,
  suffix: string,
  index: number
): CreativeCanvasItem {
  const nextId = existingItemIds.has(item.id) ? `import-${suffix}-${item.id}` : item.id;
  existingItemIds.add(nextId);
  return {
    ...item,
    id: nextId,
    assetId: assetIdMap.get(item.assetId) || item.assetId,
    position: {
      x: item.position.x + 48 + index * 8,
      y: item.position.y + 48 + index * 8,
    },
    updatedAt: Date.now(),
  };
}

function remapBrandKit(
  brandKit: BrandKit,
  assetIdMap: Map<string, string>,
  brandKitIdMap: Map<string, string>,
  existingBrandIds: Set<string>,
  suffix: string
): BrandKit {
  const nextId = existingBrandIds.has(brandKit.id) ? `import-${suffix}-${brandKit.id}` : brandKit.id;
  brandKitIdMap.set(brandKit.id, nextId);
  existingBrandIds.add(nextId);
  return {
    ...brandKit,
    id: nextId,
    logoAssetId: brandKit.logoAssetId ? assetIdMap.get(brandKit.logoAssetId) || brandKit.logoAssetId : undefined,
    referenceAssetIds: brandKit.referenceAssetIds.map((assetId) => assetIdMap.get(assetId) || assetId),
    updatedAt: Date.now(),
  };
}

function remapAgentSession(
  session: AgentSession,
  sessionIdMap: Map<string, string>,
  existingSessionIds: Set<string>,
  suffix: string
): AgentSession {
  const hasConflict = existingSessionIds.has(session.id);
  const nextId = hasConflict ? `import-${suffix}-${session.id}` : session.id;
  sessionIdMap.set(session.id, nextId);
  existingSessionIds.add(nextId);
  return {
    ...session,
    id: nextId,
    title: hasConflict ? `${session.title} 导入` : session.title,
    messages: session.messages.map((message) => remapAgentMessage(message, session.id, nextId)),
    pendingOps: undefined,
    status: session.status === "awaiting_approval" || session.status === "running" ? "idle" : session.status,
    updatedAt: Date.now(),
  };
}

function remapAgentMessage(message: AgentMessage, previousSessionId: string, nextSessionId: string): AgentMessage {
  return {
    ...message,
    id: uuidv4(),
    events: message.events?.map((event) => remapAgentEvent(event, previousSessionId, nextSessionId)),
  };
}

function remapAgentEvent(event: AgentEvent, previousSessionId: string, nextSessionId: string): AgentEvent {
  return {
    ...event,
    id: uuidv4(),
    sessionId: event.sessionId === previousSessionId ? nextSessionId : event.sessionId,
  } as AgentEvent;
}

function cloneAgentSession(session: AgentSession): AgentSession {
  return JSON.parse(JSON.stringify(session)) as AgentSession;
}

function isProjectPackage(value: unknown): value is NextLemonProjectPackage {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<NextLemonProjectPackage>;
  return (
    record.packageType === "nextlemon.project" &&
    record.schemaVersion === 1 &&
    Boolean(record.workflow) &&
    Array.isArray(record.workflow?.canvases) &&
    Boolean(record.creative) &&
    Array.isArray(record.creative?.assets) &&
    Boolean(record.creative?.canvas) &&
    Boolean(record.brand) &&
    Array.isArray(record.brand?.brandKits) &&
    Boolean(record.agent) &&
    Array.isArray(record.agent?.sessions) &&
    Array.isArray(record.assetManifest)
  );
}
