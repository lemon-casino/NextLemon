import type { CustomNodeData } from "@/types";

export const CREATIVE_ASSET_DRAG_TYPE = "application/nextlemon/creative-asset";

export type CreativeAssetKind = "text" | "image" | "video" | "audio";

export interface CreativeViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface CreativeAsset {
  id: string;
  // 规范寻址标签（asset_0、asset_1…），供 Agent 工具调用与画布快照使用，
  // 避免模型直接引用不稳定的内部 UUID。
  label?: string;
  kind: CreativeAssetKind;
  title: string;
  text?: string;
  dataUrl?: string;
  storagePath?: string;
  mimeType?: string;
  fileName?: string;
  width?: number;
  height?: number;
  durationMs?: number;
  bytes?: number;
  tags: string[];
  source: "manual" | "upload" | "workflow" | "agent" | "import";
  note?: string;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

export interface CreativeCanvasItem {
  id: string;
  assetId: string;
  kind: CreativeAssetKind;
  title: string;
  position: {
    x: number;
    y: number;
  };
  width: number;
  height: number;
  zIndex: number;
  locked: boolean;
  hidden: boolean;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

export interface CreativeCanvasData {
  id: string;
  title: string;
  items: CreativeCanvasItem[];
  viewport: CreativeViewport;
  createdAt: number;
  updatedAt: number;
}

export interface CreativeAssetDraft {
  id?: string;
  kind: CreativeAssetKind;
  title?: string;
  text?: string;
  dataUrl?: string;
  storagePath?: string;
  mimeType?: string;
  fileName?: string;
  width?: number;
  height?: number;
  durationMs?: number;
  bytes?: number;
  tags?: string[];
  source?: CreativeAsset["source"];
  note?: string;
  metadata?: Record<string, unknown>;
}

export interface CreativeCanvasItemDraft {
  id?: string;
  assetId?: string;
  kind?: CreativeAssetKind;
  title?: string;
  position?: {
    x: number;
    y: number;
  };
  width?: number;
  height?: number;
  zIndex?: number;
  locked?: boolean;
  hidden?: boolean;
  metadata?: Record<string, unknown>;
}

export type CanvasAgentOp =
  | { type: "asset.add"; asset: CreativeAssetDraft; canvasItem?: CreativeCanvasItemDraft }
  | { type: "asset.update"; assetId: string; patch: Partial<CreativeAsset> }
  | { type: "asset.delete"; assetIds: string[] }
  | { type: "canvas.addItem"; assetId: string; item?: CreativeCanvasItemDraft }
  | { type: "canvas.updateItem"; itemId: string; patch: Partial<CreativeCanvasItem> }
  | { type: "canvas.deleteItem"; itemIds: string[] }
  | { type: "canvas.moveItem"; itemId: string; position: { x: number; y: number } }
  | { type: "canvas.selectItems"; itemIds: string[] }
  | { type: "canvas.setViewport"; viewport: CreativeViewport }
  | {
      type: "workflow.addNode";
      nodeId?: string;
      nodeType: string;
      position: { x: number; y: number };
      data?: Partial<CustomNodeData>;
    }
  | { type: "workflow.updateNode"; nodeId: string; data: Partial<CustomNodeData> }
  | {
      type: "workflow.connectNodes";
      source: string;
      target: string;
      sourceHandle?: string;
      targetHandle?: string;
    }
  | { type: "workflow.runNode"; nodeId: string }
  | { type: "workflow.selectNodes"; nodeIds: string[] }
  | { type: "library.saveWorkflowNode"; nodeId: string };

export interface DesignPlanStep {
  id: string;
  title: string;
  description?: string;
  tool: string;
  outputKind: CreativeAssetKind | "workflow";
  dependsOn: string[];
  modelHint?: string;
  status: "pending" | "approved" | "running" | "completed" | "failed" | "skipped";
  estimatedCost?: string;
  metadata?: Record<string, unknown>;
}

export interface DesignPlan {
  id: string;
  title: string;
  brief: string;
  steps: DesignPlanStep[];
  status: "draft" | "awaiting_approval" | "approved" | "running" | "completed" | "failed" | "cancelled";
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}
