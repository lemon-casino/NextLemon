import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { v4 as uuidv4 } from "uuid";
import type {
  CreativeAsset,
  CreativeAssetDraft,
  CreativeCanvasData,
  CreativeCanvasItem,
  CreativeCanvasItemDraft,
  CreativeViewport,
} from "@/types/creative";
import {
  canRedoCreativeHistory,
  canUndoCreativeHistory,
  createCreativeHistory,
  pushCreativeHistory,
  redoCreativeHistory,
  undoCreativeHistory,
  withLiveViewport,
  type CreativeHistoryState,
} from "@/services/creativeHistory";
import { nextAssetLabel } from "@/services/creativeAssetService";
import type { CreativeTombstone } from "@/types/projectPackage";
import { tauriStorage } from "@/utils/tauriStorage";

const DEFAULT_VIEWPORT: CreativeViewport = { x: 120, y: 120, zoom: 1 };
const DEFAULT_ITEM_SIZE = {
  text: { width: 280, height: 180 },
  image: { width: 320, height: 240 },
  video: { width: 360, height: 240 },
  audio: { width: 300, height: 96 },
} as const;

interface CreativeStore {
  assets: CreativeAsset[];
  canvas: CreativeCanvasData;
  selectedItemIds: string[];
  tombstones: CreativeTombstone[];
  _hasHydrated: boolean;
  _history: CreativeHistoryState;
  canUndo: boolean;
  canRedo: boolean;

  addAsset: (draft: CreativeAssetDraft) => string;
  updateAsset: (assetId: string, patch: Partial<CreativeAsset>) => void;
  removeAssets: (assetIds: string[]) => void;
  addTextAsset: (text?: string, position?: { x: number; y: number }) => string;
  addAssetToCanvas: (assetId: string, draft?: CreativeCanvasItemDraft) => string | null;
  updateItem: (itemId: string, patch: Partial<CreativeCanvasItem>, tag?: string) => void;
  moveItem: (itemId: string, position: { x: number; y: number }) => void;
  resizeItem: (itemId: string, size: { width: number; height: number }) => void;
  removeItems: (itemIds: string[]) => void;
  selectItems: (itemIds: string[]) => void;
  clearSelection: () => void;
  setViewport: (viewport: CreativeViewport) => void;
  bringToFront: (itemId: string) => void;
  sendToBack: (itemId: string) => void;
  toggleItemLock: (itemId: string) => void;
  toggleItemHidden: (itemId: string) => void;
  clearCanvas: () => void;
  undoCanvas: () => void;
  redoCanvas: () => void;
  resetCanvasHistory: () => void;
  restoreWorkspaceState: (next: {
    assets: CreativeAsset[];
    canvas: CreativeCanvasData;
    selectedItemIds: string[];
  }) => void;
  exportSnapshot: () => { canvas: CreativeCanvasData; assets: CreativeAsset[] };
}

function now() {
  return Date.now();
}

function createInitialCanvas(): CreativeCanvasData {
  const timestamp = now();
  return {
    id: "creative-main",
    title: "素材创作画布",
    items: [],
    viewport: DEFAULT_VIEWPORT,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

const TOMBSTONE_LIMIT = 500;

function recordTombstones(
  existing: CreativeTombstone[],
  ids: string[],
  kind: CreativeTombstone["kind"],
  deletedAt = Date.now()
): CreativeTombstone[] {
  const next = [
    ...existing.filter((tombstone) => !ids.includes(tombstone.id)),
    ...ids.map((id) => ({ id, kind, deletedAt })),
  ];
  return next.slice(-TOMBSTONE_LIMIT);
}

function nextZIndex(items: CreativeCanvasItem[]) {
  return items.length ? Math.max(...items.map((item) => item.zIndex)) + 1 : 1;
}

function defaultTitle(kind: CreativeAsset["kind"]) {
  if (kind === "text") return "文本素材";
  if (kind === "image") return "图片素材";
  if (kind === "video") return "视频素材";
  return "音频素材";
}

function createAsset(draft: CreativeAssetDraft): CreativeAsset {
  const timestamp = now();
  return {
    id: draft.id || uuidv4(),
    kind: draft.kind,
    title: draft.title?.trim() || draft.fileName || defaultTitle(draft.kind),
    text: draft.text,
    dataUrl: draft.dataUrl,
    storagePath: draft.storagePath,
    mimeType: draft.mimeType,
    fileName: draft.fileName,
    width: draft.width,
    height: draft.height,
    durationMs: draft.durationMs,
    bytes: draft.bytes,
    tags: draft.tags || [],
    source: draft.source || "manual",
    note: draft.note,
    createdAt: timestamp,
    updatedAt: timestamp,
    metadata: draft.metadata,
  };
}

function createCanvasItem(
  asset: CreativeAsset,
  items: CreativeCanvasItem[],
  draft?: CreativeCanvasItemDraft
): CreativeCanvasItem {
  const timestamp = now();
  const size = DEFAULT_ITEM_SIZE[asset.kind];
  return {
    id: draft?.id || uuidv4(),
    assetId: asset.id,
    kind: draft?.kind || asset.kind,
    title: draft?.title || asset.title,
    position: draft?.position || { x: items.length * 36, y: items.length * 24 },
    width: draft?.width || asset.width || size.width,
    height: draft?.height || asset.height || size.height,
    zIndex: draft?.zIndex || nextZIndex(items),
    locked: draft?.locked || false,
    hidden: draft?.hidden || false,
    createdAt: timestamp,
    updatedAt: timestamp,
    metadata: draft?.metadata,
  };
}

// 撤销/重做仅覆盖画布实例变更（增删、移动、缩放、层级、锁定、隐藏），
// 素材库本身的增删改不属于画布历史范围。
export const useCreativeStore = create<CreativeStore>()(
  persist(
    (set, get) => {
      const commitCanvas = (
        updater: (canvas: CreativeCanvasData) => CreativeCanvasData,
        tag?: string
      ) => {
        const state = get();
        const history = pushCreativeHistory(
          state._history,
          state.canvas,
          tag ? { tag } : undefined
        );
        set({
          canvas: updater(state.canvas),
          _history: history,
          canUndo: canUndoCreativeHistory(history),
          canRedo: canRedoCreativeHistory(history),
        });
      };

      const applyHistory = (history: CreativeHistoryState) => {
        set({
          canvas: withLiveViewport(history, get().canvas),
          _history: history,
          canUndo: canUndoCreativeHistory(history),
          canRedo: canRedoCreativeHistory(history),
        });
      };

      return {
      assets: [],
      canvas: createInitialCanvas(),
      selectedItemIds: [],
      tombstones: [],
      _hasHydrated: false,
      _history: createCreativeHistory(createInitialCanvas()),
      canUndo: false,
      canRedo: false,

      addAsset: (draft) => {
        const asset = createAsset(draft);
        set((state) => ({
          assets: [{ ...asset, label: nextAssetLabel(state.assets) }, ...state.assets],
        }));
        return asset.id;
      },

      updateAsset: (assetId, patch) => {
        set((state) => ({
          assets: state.assets.map((asset) =>
            asset.id === assetId
              ? { ...asset, ...patch, updatedAt: now() }
              : asset
          ),
          canvas: {
            ...state.canvas,
            items: state.canvas.items.map((item) =>
              item.assetId === assetId && patch.title
                ? { ...item, title: patch.title, updatedAt: now() }
                : item
            ),
            updatedAt: now(),
          },
        }));
      },

      removeAssets: (assetIds) => {
        const ids = new Set(assetIds);
        set((state) => {
          const removedItemIds = state.canvas.items
            .filter((item) => ids.has(item.assetId))
            .map((item) => item.id);
          return {
            assets: state.assets.filter((asset) => !ids.has(asset.id)),
            canvas: {
              ...state.canvas,
              items: state.canvas.items.filter((item) => !ids.has(item.assetId)),
              updatedAt: now(),
            },
            selectedItemIds: state.selectedItemIds.filter((id) =>
              state.canvas.items.some((item) => item.id === id && !ids.has(item.assetId))
            ),
            tombstones: recordTombstones(
              recordTombstones(state.tombstones, assetIds, "asset", now()),
              removedItemIds,
              "item",
              now()
            ),
          };
        });
      },

      addTextAsset: (text = "双击编辑文本", position) => {
        const assetId = get().addAsset({
          kind: "text",
          title: text.slice(0, 18) || "文本素材",
          text,
          source: "manual",
        });
        get().addAssetToCanvas(assetId, { position });
        return assetId;
      },

      addAssetToCanvas: (assetId, draft) => {
        const asset = get().assets.find((item) => item.id === assetId);
        if (!asset) return null;
        const item = createCanvasItem(asset, get().canvas.items, draft);
        commitCanvas((canvas) => ({
          ...canvas,
          items: [...canvas.items, item],
          updatedAt: now(),
        }));
        set({ selectedItemIds: [item.id] });
        return item.id;
      },

      updateItem: (itemId, patch, tag) => {
        commitCanvas(
          (canvas) => ({
            ...canvas,
            items: canvas.items.map((item) =>
              item.id === itemId
                ? { ...item, ...patch, updatedAt: now() }
                : item
            ),
            updatedAt: now(),
          }),
          tag
        );
      },

      moveItem: (itemId, position) => {
        get().updateItem(itemId, { position }, `move:${itemId}`);
      },

      resizeItem: (itemId, size) => {
        get().updateItem(
          itemId,
          {
            width: Math.max(80, size.width),
            height: Math.max(60, size.height),
          },
          `resize:${itemId}`
        );
      },

      removeItems: (itemIds) => {
        const ids = new Set(itemIds);
        commitCanvas((canvas) => ({
          ...canvas,
          items: canvas.items.filter((item) => !ids.has(item.id)),
          updatedAt: now(),
        }));
        set((state) => ({
          selectedItemIds: state.selectedItemIds.filter((id) => !ids.has(id)),
          tombstones: recordTombstones(state.tombstones, itemIds, "item", now()),
        }));
      },

      selectItems: (itemIds) => {
        set({ selectedItemIds: itemIds });
      },

      clearSelection: () => {
        set({ selectedItemIds: [] });
      },

      setViewport: (viewport) => {
        set((state) => ({
          canvas: {
            ...state.canvas,
            viewport: {
              x: viewport.x,
              y: viewport.y,
              zoom: Math.min(4, Math.max(0.12, viewport.zoom)),
            },
            updatedAt: now(),
          },
        }));
      },

      bringToFront: (itemId) => {
        const item = get().canvas.items.find((canvasItem) => canvasItem.id === itemId);
        if (!item) return;
        get().updateItem(itemId, { zIndex: nextZIndex(get().canvas.items) });
      },

      sendToBack: (itemId) => {
        const minZ = get().canvas.items.length
          ? Math.min(...get().canvas.items.map((item) => item.zIndex))
          : 0;
        get().updateItem(itemId, { zIndex: minZ - 1 });
      },

      toggleItemLock: (itemId) => {
        const item = get().canvas.items.find((canvasItem) => canvasItem.id === itemId);
        if (!item) return;
        get().updateItem(itemId, { locked: !item.locked });
      },

      toggleItemHidden: (itemId) => {
        const item = get().canvas.items.find((canvasItem) => canvasItem.id === itemId);
        if (!item) return;
        get().updateItem(itemId, { hidden: !item.hidden });
      },

      clearCanvas: () => {
        const removedItemIds = get().canvas.items.map((item) => item.id);
        commitCanvas((canvas) => ({
          ...canvas,
          items: [],
          updatedAt: now(),
        }));
        set((state) => ({
          selectedItemIds: [],
          tombstones: recordTombstones(state.tombstones, removedItemIds, "item", now()),
        }));
      },

      undoCanvas: () => {
        const history = undoCreativeHistory(get()._history);
        if (history === get()._history) return;
        applyHistory(history);
      },

      redoCanvas: () => {
        const history = redoCreativeHistory(get()._history);
        if (history === get()._history) return;
        applyHistory(history);
      },

      resetCanvasHistory: () => {
        set({
          _history: createCreativeHistory(get().canvas),
          canUndo: false,
          canRedo: false,
        });
      },

      restoreWorkspaceState: ({ assets, canvas, selectedItemIds }) => {
        set({
          assets,
          canvas,
          selectedItemIds,
          _history: createCreativeHistory(canvas),
          canUndo: false,
          canRedo: false,
        });
      },

      exportSnapshot: () => {
        const state = get();
        const usedAssetIds = new Set(state.canvas.items.map((item) => item.assetId));
        return {
          canvas: state.canvas,
          assets: state.assets.filter((asset) => usedAssetIds.has(asset.id)),
        };
      },
      };
    },
    {
      name: "nextlemon-creative-workspace",
      storage: createJSONStorage(() => tauriStorage),
      partialize: (state) => ({
        assets: state.assets.map((asset) =>
          asset.storagePath
            ? { ...asset, dataUrl: undefined }
            : asset
        ),
        canvas: state.canvas,
        selectedItemIds: state.selectedItemIds,
        tombstones: state.tombstones,
      }),
      onRehydrateStorage: () => () => {
        useCreativeStore.setState({
          _hasHydrated: true,
          _history: createCreativeHistory(useCreativeStore.getState().canvas),
          canUndo: false,
          canRedo: false,
        });
      },
    }
  )
);
