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
import { computeNextToSourcePosition, nextAssetLabel } from "@/services/creativeAssetService";
import type { CreativeTombstone } from "@/types/projectPackage";
import { flushTauriStorage, tauriStorage } from "@/utils/tauriStorage";

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
  // 工作流生成结果自动沉淀为创作画布实例（含执行占位），默认关闭
  autoSinkEnabled: boolean;
  _hasHydrated: boolean;
  _history: CreativeHistoryState;
  canUndo: boolean;
  canRedo: boolean;

  addAsset: (draft: CreativeAssetDraft) => string;
  updateAsset: (assetId: string, patch: Partial<CreativeAsset>) => void;
  removeAssets: (assetIds: string[]) => void;
  addTextAsset: (text?: string, position?: { x: number; y: number }) => string;
  addAssetToCanvas: (assetId: string, draft?: CreativeCanvasItemDraft) => string | null;
  // 批量图组落位契约：多图作为 images 数组传入（元素可为素材 id / data URL /
  // 图片文件路径 / 裸 base64），折叠为一栈落位，返回栈根（主图）实例 id。
  addImageBatchToCanvas: (images: string[], draft?: CreativeCanvasItemDraft) => string | null;
  // 依据已入库素材直接建批量栈（自动沉淀等路径），返回栈根（主图）实例 id。
  addAssetBatchToCanvas: (assetIds: string[], draft?: CreativeCanvasItemDraft) => string | null;
  // 展开/收起批量栈：展开为主图原位起算的网格，收起时子图回到主图位置叠放。
  setBatchExpanded: (itemId: string, expanded: boolean) => void;
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
  setAutoSinkEnabled: (enabled: boolean) => void;
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

// ===== 批量图组（折叠栈）与视口裁剪纯函数 =====
// 供渲染层（CreativeWorkspace）、多图落位契约与单测共用
// （单测见 src/services/__tests__/creativeBatchStack.test.ts）。

// 批量栈展开网格的格子间距（世界像素）
export const CREATIVE_BATCH_STACK_GAP = 16;

// 视口裁剪（只裁渲染不裁数据）：实例矩形与当前视口相交（含 buffer 屏幕像素
// 的缓冲带）才需要渲染。缓冲按屏幕像素换算为世界单位（buffer / zoom），
// 低缩放下依然覆盖约 200 屏幕像素。
export function isItemVisibleInViewport(
  item: Pick<CreativeCanvasItem, "position" | "width" | "height">,
  viewport: CreativeViewport,
  container: { width: number; height: number },
  buffer = 200
): boolean {
  const zoom = viewport.zoom > 0 ? viewport.zoom : 1;
  const pad = buffer / zoom;
  const viewMinX = -viewport.x / zoom;
  const viewMinY = -viewport.y / zoom;
  const viewMaxX = viewMinX + container.width / zoom;
  const viewMaxY = viewMinY + container.height / zoom;
  return (
    item.position.x - pad < viewMaxX &&
    item.position.x + item.width + pad > viewMinX &&
    item.position.y - pad < viewMaxY &&
    item.position.y + item.height + pad > viewMinY
  );
}

// 折叠态子图 id 集合（纯函数）：折叠栈的子图不参与渲染与框选命中
// （主图已完整覆盖其区域）。
export function collectCollapsedBatchChildIds(items: CreativeCanvasItem[]): Set<string> {
  const rootById = new Map(items.map((item) => [item.id, item]));
  const collapsed = new Set<string>();
  for (const item of items) {
    const parentId = item.parentBatchRootId;
    if (!parentId) continue;
    const parent = rootById.get(parentId);
    if (parent?.isBatchRoot && !parent.batchExpanded) collapsed.add(item.id);
  }
  return collapsed;
}

// 批量栈展开网格布局（纯函数）：共 count 张图（含主图），第 0 格为主图原位
// （保持主图位置不动，吸附/小地图锚点稳定），其余格子按 ceil(sqrt(count)) 列
// 从左到右、从上到下排布，返回每格相对主图位置的偏移。
export function computeBatchGridOffsets(
  count: number,
  cell: { width: number; height: number },
  gap = CREATIVE_BATCH_STACK_GAP
): Array<{ x: number; y: number }> {
  const total = Math.max(1, Math.floor(count));
  const columns = Math.max(1, Math.ceil(Math.sqrt(total)));
  return Array.from({ length: total }, (_, index) => ({
    x: (index % columns) * (cell.width + gap),
    y: Math.floor(index / columns) * (cell.height + gap),
  }));
}

// 删除实例后的批量栈修复（纯函数）：从存活根的 batchChildIds 摘除被删子图；
// 被删根的首个存活子图（zIndex 最小者）晋升为新根并接管其余子图；
// 子图清空的根清除批量字段。只修补批量结构，不做墓碑/选中清理（调用方负责）。
export function repairBatchStacksAfterRemoval(
  items: CreativeCanvasItem[],
  removedIds: string[]
): CreativeCanvasItem[] {
  const removed = new Set(removedIds);
  if (removed.size === 0) return items;
  const remaining = items.filter((item) => !removed.has(item.id));
  const patched = new Map<string, CreativeCanvasItem>();
  const current = (item: CreativeCanvasItem) => patched.get(item.id) ?? item;

  for (const item of remaining) {
    if (!item.isBatchRoot || !item.batchChildIds?.length) continue;
    const nextChildIds = item.batchChildIds.filter((childId) => !removed.has(childId));
    if (nextChildIds.length === item.batchChildIds.length) continue;
    patched.set(
      item.id,
      nextChildIds.length > 0
        ? { ...item, batchChildIds: nextChildIds }
        : {
            ...item,
            isBatchRoot: false,
            batchChildIds: undefined,
            batchExpanded: undefined,
          }
    );
  }

  const orphansByOldRoot = new Map<string, CreativeCanvasItem[]>();
  for (const item of remaining) {
    const parentId = item.parentBatchRootId;
    if (parentId && removed.has(parentId)) {
      orphansByOldRoot.set(parentId, [...(orphansByOldRoot.get(parentId) || []), item]);
    }
  }
  for (const orphans of orphansByOldRoot.values()) {
    const ordered = [...orphans].sort((a, b) => a.zIndex - b.zIndex);
    const [promoted, ...rest] = ordered;
    // 晋升的新主图 zIndex 提到全部存活实例之上：维持建栈时"主图置顶"不变量，
    // 否则折叠态导出（renderCreativeCanvas 按 zIndex 升序绘制）会由子图覆盖主图。
    patched.set(promoted.id, {
      ...current(promoted),
      isBatchRoot: true,
      parentBatchRootId: undefined,
      batchChildIds: rest.map((child) => child.id),
      batchExpanded: false,
      zIndex: nextZIndex(remaining),
    });
    for (const child of rest) {
      patched.set(child.id, { ...current(child), parentBatchRootId: promoted.id });
    }
  }

  if (patched.size === 0) return remaining;
  return remaining.map((item) => patched.get(item.id) ?? item);
}

// 批量栈删除后的重选目标（纯函数）：删除子图 → 重选其所属主图；
// 删除主图 → 重选晋升后的新主图（首个存活子图）。无批量栈关联返回 null。
export function pickBatchReselectAfterRemoval(
  items: CreativeCanvasItem[],
  removedIds: string[]
): string | null {
  const removed = new Set(removedIds);
  if (removed.size === 0) return null;
  const aliveIds = new Set(
    items.filter((item) => !removed.has(item.id)).map((item) => item.id)
  );
  for (const item of items) {
    if (!removed.has(item.id)) continue;
    const parentId = item.parentBatchRootId;
    if (parentId && aliveIds.has(parentId)) return parentId;
  }
  for (const item of items) {
    if (!removed.has(item.id) || !item.isBatchRoot) continue;
    const survivor = (item.batchChildIds || []).find((childId) => aliveIds.has(childId));
    if (survivor) return survivor;
  }
  return null;
}

// 多图落位契约（images 数组）的来源解析（纯函数）：每个元素可为已有素材 id、
// data URL、图片文件路径（Windows/UNC/Unix）或裸 base64 —— 分别映射为
// 复用已有素材或新建图片素材草稿；无法解析的空值返回 null。
// base64 判定须先于 Unix 路径分支：JPEG 的裸 base64 以 "/9j/" 开头
// （imageService 收 Gemini inlineData 原样透传），若按路径处理会建成指向
// 不存在文件的 storagePath 素材，落位后必然显示"图片缺失"。
export type ResolvedBatchImageSource =
  | { kind: "asset"; assetId: string }
  | { kind: "draft"; draft: CreativeAssetDraft };

const BASE64_PAYLOAD_PATTERN = /^[A-Za-z0-9+/=]+$/;

// 裸 base64 头部 → MIME 猜测（覆盖常见图片魔数前缀，未知默认 PNG）
function guessBase64ImageMime(payload: string): string {
  if (payload.startsWith("/9j/")) return "image/jpeg";
  if (payload.startsWith("iVBOR")) return "image/png";
  if (payload.startsWith("R0lGOD")) return "image/gif";
  if (payload.startsWith("UklGR")) return "image/webp";
  return "image/png";
}

// 裸 base64 启发式（纯函数）：去空白后长度 ≥ 64（真实图片 base64 远超此值，
// 排除 "/abc" 这类极短路径）、长度对齐 4（base64 填充规则）且字符集合法。
// 注意含 "."、"-"、"\\" 的字符串必然不是 base64（不在字符集内），路径可安全通过。
export function looksLikeBareBase64(value: string): boolean {
  if (!value || value.length < 64 || value.length % 4 !== 0) return false;
  return BASE64_PAYLOAD_PATTERN.test(value);
}

export function resolveBatchImageSource(
  image: string,
  assets: Array<Pick<CreativeAsset, "id">>
): ResolvedBatchImageSource | null {
  const value = typeof image === "string" ? image.trim() : "";
  if (!value) return null;
  if (assets.some((asset) => asset.id === value)) {
    return { kind: "asset", assetId: value };
  }
  if (/^data:image\//i.test(value)) {
    return {
      kind: "draft",
      draft: { kind: "image", dataUrl: value, source: "workflow", title: "生成图片" },
    };
  }
  // 盘符/UNC 路径含 ":" 与 "\\"，不可能与 base64 字符集混淆，优先判定
  if (/^([a-zA-Z]:[\\/]|\\\\)/.test(value)) {
    return {
      kind: "draft",
      draft: {
        kind: "image",
        storagePath: value,
        source: "workflow",
        title: value.split(/[\\/]/).pop() || "生成图片",
      },
    };
  }
  const payload = value.replace(/\s+/g, "");
  if (looksLikeBareBase64(payload)) {
    return {
      kind: "draft",
      draft: {
        kind: "image",
        dataUrl: `data:${guessBase64ImageMime(payload)};base64,${payload}`,
        source: "workflow",
        title: "生成图片",
      },
    };
  }
  if (value.startsWith("/")) {
    return {
      kind: "draft",
      draft: {
        kind: "image",
        storagePath: value,
        source: "workflow",
        title: value.split(/[\\/]/).pop() || "生成图片",
      },
    };
  }
  // 其余按裸 base64（无 data: 前缀）兜底包装
  return {
    kind: "draft",
    draft: {
      kind: "image",
      dataUrl: `data:image/png;base64,${value}`,
      source: "workflow",
      title: "生成图片",
    },
  };
}

// 批量图组建栈：首个素材为主图（zIndex 置顶），其余为折叠子图（同位叠放于
// 主图下方）。主图 zIndex 高于全部子图，保证折叠态渲染与导出均由主图覆盖子图。
// 单素材退化为普通实例（不带批量字段）。
function createBatchStackItems(
  assets: CreativeAsset[],
  items: CreativeCanvasItem[],
  draft?: CreativeCanvasItemDraft
): CreativeCanvasItem[] | null {
  if (assets.length === 0) return null;
  const position = draft?.position ?? computeNextToSourcePosition(items);
  const baseZ = nextZIndex(items);
  if (assets.length === 1) {
    return [createCanvasItem(assets[0], items, { ...draft, position, zIndex: baseZ })];
  }

  const rootId = draft?.id || uuidv4();
  const size = {
    width: draft?.width || assets[0].width || DEFAULT_ITEM_SIZE.image.width,
    height: draft?.height || assets[0].height || DEFAULT_ITEM_SIZE.image.height,
  };
  const children = assets.slice(1).map((asset, index) => ({
    ...createCanvasItem(asset, items, {
      position,
      width: size.width,
      height: size.height,
      zIndex: baseZ + index,
    }),
    parentBatchRootId: rootId,
  }));
  const root: CreativeCanvasItem = {
    ...createCanvasItem(assets[0], items, {
      id: rootId,
      title: draft?.title,
      position,
      width: size.width,
      height: size.height,
      zIndex: baseZ + children.length,
    }),
    isBatchRoot: true,
    batchChildIds: children.map((child) => child.id),
    batchExpanded: false,
  };
  return [root, ...children];
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
      autoSinkEnabled: false,
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
          // 走批量栈修复：删掉的子图/主图不留下悬空的批量引用
          items: repairBatchStacksAfterRemoval(state.canvas.items, removedItemIds),
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

  // 多图落位契约入口：生成参数包把多图作为 images 数组传入，这里逐个解析
  // （复用已有素材或新建图片素材）后折叠为一栈落位，返回栈根（主图）实例 id。
  addImageBatchToCanvas: (images, draft) => {
    const assets = get().assets;
    const assetIds: string[] = [];
    for (const image of images) {
      const resolved = resolveBatchImageSource(image, assets);
      if (!resolved) continue;
      assetIds.push(resolved.kind === "asset" ? resolved.assetId : get().addAsset(resolved.draft));
    }
    return get().addAssetBatchToCanvas(assetIds, draft);
  },

  // 依据已入库素材建批量栈（如自动沉淀路径已先 addAsset 的场景）。
  addAssetBatchToCanvas: (assetIds, draft) => {
    const stackAssets = assetIds
      .map((assetId) => get().assets.find((asset) => asset.id === assetId))
      .filter((asset): asset is CreativeAsset => Boolean(asset));
    const stackItems = createBatchStackItems(stackAssets, get().canvas.items, draft);
    if (!stackItems) return null;
    const rootId = stackItems[0].id;
    commitCanvas((canvas) => ({
      ...canvas,
      items: [...canvas.items, ...stackItems],
      updatedAt: now(),
    }));
    set({ selectedItemIds: [rootId] });
    return rootId;
  },

  // 展开/收起批量栈：展开为主图原位起算的网格（主图保持位置，锚点稳定），
  // 收起时子图回到主图位置叠放。同标签合并为一步历史。
  setBatchExpanded: (itemId, expanded) => {
    const item = get().canvas.items.find((canvasItem) => canvasItem.id === itemId);
    if (!item?.isBatchRoot || !item.batchChildIds?.length) return;
    if (Boolean(item.batchExpanded) === expanded) return;
    const childIds = item.batchChildIds;
    // 格子尺寸取主图与子图的逐维最大值：子图尺寸在建栈后固定，而 resizeItem
    // 只作用于被操作实例——主图缩小后若按主图尺寸算格距，展开的子图会相互重叠。
    const childItems = get().canvas.items.filter((canvasItem) =>
      childIds.includes(canvasItem.id)
    );
    const cell = {
      width: Math.max(item.width, ...childItems.map((child) => child.width)),
      height: Math.max(item.height, ...childItems.map((child) => child.height)),
    };
    const offsets = expanded ? computeBatchGridOffsets(childIds.length + 1, cell) : null;
    commitCanvas(
      (canvas) => ({
        ...canvas,
        items: canvas.items.map((canvasItem) => {
          if (canvasItem.id === itemId) {
            return { ...canvasItem, batchExpanded: expanded, updatedAt: now() };
          }
          const childIndex = childIds.indexOf(canvasItem.id);
          if (childIndex < 0) return canvasItem;
          const offset = offsets ? offsets[childIndex + 1] : { x: 0, y: 0 };
          return {
            ...canvasItem,
            position: { x: item.position.x + offset.x, y: item.position.y + offset.y },
            updatedAt: now(),
          };
        }),
        updatedAt: now(),
      }),
      `batch-expand:${itemId}`
    );
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
    const item = get().canvas.items.find((canvasItem) => canvasItem.id === itemId);
    if (!item) return;
    const childIds =
      item.isBatchRoot && item.batchChildIds?.length
        ? new Set(item.batchChildIds)
        : null;
    if (!childIds) {
      get().updateItem(itemId, { position }, `move:${itemId}`);
      return;
    }
    // 批量栈整体跟随：主图拖动时子图平移相同增量，共用同一 move 历史标签
    // 合并为一步撤销记录。
    const deltaX = position.x - item.position.x;
    const deltaY = position.y - item.position.y;
    commitCanvas(
      (canvas) => ({
        ...canvas,
        items: canvas.items.map((canvasItem) => {
          if (canvasItem.id === itemId) {
            return { ...canvasItem, position, updatedAt: now() };
          }
          if (!childIds.has(canvasItem.id)) return canvasItem;
          return {
            ...canvasItem,
            position: {
              x: canvasItem.position.x + deltaX,
              y: canvasItem.position.y + deltaY,
            },
            updatedAt: now(),
          };
        }),
        updatedAt: now(),
      }),
      `move:${itemId}`
    );
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
    // 删除子图 → 自动重选其主图；删除主图 → 重选晋升后的新主图
    const reselectId = pickBatchReselectAfterRemoval(get().canvas.items, itemIds);
    commitCanvas((canvas) => ({
      ...canvas,
      items: repairBatchStacksAfterRemoval(canvas.items, itemIds),
      updatedAt: now(),
    }));
    set((state) => ({
      selectedItemIds:
        reselectId && !ids.has(reselectId)
          ? Array.from(
              new Set([...state.selectedItemIds.filter((id) => !ids.has(id)), reselectId])
            )
          : state.selectedItemIds.filter((id) => !ids.has(id)),
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
        // 清空画布属低频破坏性操作，立即落盘防抖窗口内的变更
        void flushTauriStorage();
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

      setAutoSinkEnabled: (enabled) => {
        set({ autoSinkEnabled: enabled });
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
        // 工作区恢复（项目包导入路径）覆盖全量状态，立即落盘防抖窗口内的变更
        void flushTauriStorage();
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
        autoSinkEnabled: state.autoSinkEnabled,
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
