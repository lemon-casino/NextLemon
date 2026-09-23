import { createCreativeAssetDraftsFromWorkflowNode } from "@/services/workflowAssetService";
import { computeNextToSourcePosition } from "@/services/creativeAssetService";
import { useCreativeStore } from "@/stores/creativeStore";
import type { CreativeAsset, CreativeCanvasItem } from "@/types/creative";
import type { CustomNode } from "@/types";

// 生成结果自动沉淀（参考 Open-AI-Design-Agent 的执行占位 + 非破坏性并排落位）：
// 开关开启时，工作流节点开始执行先在创作画布放"生成中"占位实例，
// 执行完成后用节点产物素材替换占位（并排放置），失败/无产物则移除占位。

const PLACEHOLDER_TITLE = "生成中…";
const AUTO_SINK_TAG = "auto-sink";
const AUTO_SINK_NODE_TAG_PREFIX = "auto-sink-node:";

// 节点专属标签：占位素材打上 `auto-sink-node:${nodeId}`，应用重启后内存追踪
// 失联时仍能按该唯一标签精确回收本节点的占位（替代旧的"标签+标题"模糊匹配）。
export function autoSinkNodeTag(nodeId: string): string {
  return `${AUTO_SINK_NODE_TAG_PREFIX}${nodeId}`;
}

// 内存追踪：nodeId -> 占位素材/实例的精确 id。
// 仅内存存活（应用重启后清空）：失联时 resolveAutoSinkPlaceholder 可按节点标签
// 回退定位，但该回退只在"同节点再次执行 complete/fail"时触达；重启后不再执行的
// 节点占位需由 cleanupStaleAutoSinkPlaceholders 在启动时扫描回收。
interface AutoSinkPlaceholderRef {
  assetId: string;
  itemId: string;
}

const placeholders = new Map<string, AutoSinkPlaceholderRef>();

export function startAutoSinkPlaceholder(nodeId: string): void {
  const creative = useCreativeStore.getState();
  if (!creative.autoSinkEnabled) return;
  if (placeholders.has(nodeId)) return;

  const items = creative.canvas.items;
  const assetId = creative.addAsset({
    kind: "text",
    title: PLACEHOLDER_TITLE,
    text: PLACEHOLDER_TITLE,
    source: "workflow",
    tags: [AUTO_SINK_TAG, "pending", autoSinkNodeTag(nodeId)],
  });
  const position = computeNextToSourcePosition(items);
  const itemId = creative.addAssetToCanvas(assetId, {
    title: PLACEHOLDER_TITLE,
    position,
    width: 220,
    height: 120,
  });
  if (!itemId) {
    // 落画布失败：回收刚创建的占位素材，避免孤儿素材残留
    creative.removeAssets([assetId]);
    return;
  }
  placeholders.set(nodeId, { assetId, itemId });
}

// 执行完成：用节点产物替换占位；无产物时移除占位。
export function completeAutoSinkPlaceholder(nodeId: string, node: CustomNode | undefined): void {
  const ref = placeholders.get(nodeId);
  if (!ref) return;
  placeholders.delete(nodeId);

  const creative = useCreativeStore.getState();
  if (!creative.autoSinkEnabled) {
    removePlaceholder(nodeId, ref);
    return;
  }

  const drafts = node ? createCreativeAssetDraftsFromWorkflowNode(node) : [];
  const placeholderItem = creative.canvas.items.find((item) => item.id === ref.itemId);

  if (drafts.length === 0) {
    removePlaceholder(nodeId, ref);
    return;
  }

  for (let index = 0; index < drafts.length; index += 1) {
    const assetId = creative.addAsset(drafts[index]);
    creative.addAssetToCanvas(assetId, {
      position: {
        x: (placeholderItem?.position.x ?? computeNextToSourcePosition(creative.canvas.items).x) + index * 32,
        y: (placeholderItem?.position.y ?? computeNextToSourcePosition(creative.canvas.items).y) + index * 32,
      },
      width: 320,
      height: 240,
    });
  }
  removePlaceholder(nodeId, ref);
}

// 执行失败/中断：移除占位。
export function failAutoSinkPlaceholder(nodeId: string): void {
  const ref = placeholders.get(nodeId);
  if (!ref) return;
  placeholders.delete(nodeId);
  removePlaceholder(nodeId, ref);
}

// 占位回收定位（纯函数，便于单测）：优先内存追踪的精确 assetId/itemId；
// 内存追踪失联（如应用重启后 Map 清空）时，回退到节点专属标签
// `auto-sink-node:${nodeId}` 精确定位（该标签按节点唯一，可覆盖重启期间
// 重复放置的多个占位）。拿不到任何精确匹配则返回空集——调用方跳过删除，
// 绝不做"auto-sink 标签 + 占位标题"式的模糊匹配，避免误删同标签的用户素材。
export function resolveAutoSinkPlaceholder(
  assets: Array<Pick<CreativeAsset, "id" | "tags">>,
  items: Array<Pick<CreativeCanvasItem, "id" | "assetId">>,
  nodeId: string,
  ref?: AutoSinkPlaceholderRef
): { assetIds: string[]; itemIds: string[] } {
  const nodeTag = autoSinkNodeTag(nodeId);
  const assetIds = new Set<string>();
  if (ref && assets.some((asset) => asset.id === ref.assetId)) {
    assetIds.add(ref.assetId);
  }
  assets.forEach((asset) => {
    if (asset.tags.includes(nodeTag)) assetIds.add(asset.id);
  });

  const itemIds =
    ref || assetIds.size > 0
      ? items
          .filter((item) => (ref && item.id === ref.itemId) || assetIds.has(item.assetId))
          .map((item) => item.id)
      : [];

  return { assetIds: Array.from(assetIds), itemIds };
}

function removePlaceholder(nodeId: string, ref?: AutoSinkPlaceholderRef): void {
  const creative = useCreativeStore.getState();
  const { assetIds, itemIds } = resolveAutoSinkPlaceholder(
    creative.assets,
    creative.canvas.items,
    nodeId,
    ref
  );
  if (itemIds.length > 0) creative.removeItems(itemIds);
  if (assetIds.length > 0) creative.removeAssets(assetIds);
}

// 遗留占位清理：扫描全部带 auto-sink-node:* 标签的占位素材并按精确 id 回收
// （素材 + 其画布实例），返回被清理的 nodeId 列表。覆盖应用重启后内存 Map 失联、
// 且节点不再执行 complete/fail 的残留场景（removePlaceholder 无法触达的路径）。
// 注意：应在应用启动、且无工作流执行时调用（当前尚未接线，由上层在启动流程中
// 调用）；活跃占位（内存 Map 命中的节点）会被跳过，不误删执行中的占位。
export function cleanupStaleAutoSinkPlaceholders(): string[] {
  const creative = useCreativeStore.getState();
  const activeNodeIds = new Set(placeholders.keys());
  const staleAssetIds: string[] = [];
  const staleNodeIds = new Set<string>();
  creative.assets.forEach((asset) => {
    const nodeTag = asset.tags.find((tag) => tag.startsWith(AUTO_SINK_NODE_TAG_PREFIX));
    if (!nodeTag) return;
    const nodeId = nodeTag.slice(AUTO_SINK_NODE_TAG_PREFIX.length);
    if (activeNodeIds.has(nodeId)) return;
    staleAssetIds.push(asset.id);
    staleNodeIds.add(nodeId);
  });
  if (staleAssetIds.length === 0) return [];

  const staleAssetIdSet = new Set(staleAssetIds);
  const staleItemIds = creative.canvas.items
    .filter((item) => staleAssetIdSet.has(item.assetId))
    .map((item) => item.id);
  if (staleItemIds.length > 0) creative.removeItems(staleItemIds);
  creative.removeAssets(staleAssetIds);
  return Array.from(staleNodeIds);
}
