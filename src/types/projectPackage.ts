import type { AgentSession } from "@/types/agent";
import type { BrandKit } from "@/types/brand";
import type { CreativeAsset, CreativeCanvasData } from "@/types/creative";
import type { CustomEdge, CustomNode } from "@/types";
import type { WorkspaceMode } from "@/types/workspace";

export interface ProjectPackageCanvas {
  id: string;
  name: string;
  nodes: CustomNode[];
  edges: CustomEdge[];
  createdAt: number;
  updatedAt: number;
}

export interface ProjectAssetManifestItem {
  id: string;
  source: "creative-asset" | "workflow-node";
  kind: "text" | "image" | "video" | "audio" | "file" | "unknown";
  title: string;
  ownerId?: string;
  fieldPath?: string;
  storagePath?: string;
  url?: string;
  embedded: boolean;
  bytes?: number;
  mimeType?: string;
}

export interface NextLemonProjectPackage {
  packageType: "nextlemon.project";
  schemaVersion: 1;
  exportedAt: number;
  app: {
    name: "NextLemon";
    packageVersion: string;
  };
  manifest: {
    title: string;
    canvasCount: number;
    workflowNodeCount: number;
    creativeAssetCount: number;
    creativeItemCount: number;
    brandKitCount: number;
    agentSessionCount: number;
    assetManifestCount: number;
  };
  workspace: {
    mode: WorkspaceMode;
  };
  workflow: {
    canvases: ProjectPackageCanvas[];
    activeCanvasId: string | null;
  };
  creative: {
    assets: CreativeAsset[];
    canvas: CreativeCanvasData;
    // schemaVersion 1 可选扩展：旧包无此字段，解析与校验保持兼容
    tombstones?: CreativeTombstone[];
  };
  brand: {
    brandKits: BrandKit[];
    activeBrandKitId: string | null;
    tombstones?: CreativeTombstone[];
  };
  agent: {
    sessions: AgentSession[];
    activeSessionId: string | null;
  };
  assetManifest: ProjectAssetManifestItem[];
  notes?: string[];
}

export interface ImportProjectPackageResult {
  importedCanvases: number;
  importedCreativeAssets: number;
  importedCreativeItems: number;
  importedBrandKits: number;
  importedAgentSessions: number;
  warnings: string[];
}

export interface WebDavSyncConfig {
  enabled: boolean;
  endpoint: string;
  username?: string;
  password?: string;
  remotePath: string;
}

// 同步墓碑：记录实体删除事件，使合并同步时删除操作能跨端传播。
// deletedAt 晚于实体 updatedAt 时，合并结果中该实体被视为已删除。
export interface CreativeTombstone {
  id: string;
  kind: "asset" | "item" | "brandKit";
  deletedAt: number;
}
