import { createCreativeAssetDraftsFromWorkflowNode } from "@/services/workflowAssetService";
import { computeNextToSourcePosition } from "@/services/creativeAssetService";
import { useCreativeStore } from "@/stores/creativeStore";
import type { CustomNode } from "@/types";

// 生成结果自动沉淀（参考 Open-AI-Design-Agent 的执行占位 + 非破坏性并排落位）：
// 开关开启时，工作流节点开始执行先在创作画布放"生成中"占位实例，
// 执行完成后用节点产物素材替换占位（并排放置），失败/无产物则移除占位。

const PLACEHOLDER_TITLE = "生成中…";

const placeholders = new Map<string, string>();

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
    tags: ["auto-sink", "pending"],
  });
  const position = computeNextToSourcePosition(items);
  const itemId = creative.addAssetToCanvas(assetId, {
    title: PLACEHOLDER_TITLE,
    position,
    width: 220,
    height: 120,
  });
  if (itemId) placeholders.set(nodeId, itemId);
}

// 执行完成：用节点产物替换占位；无产物时移除占位。
export function completeAutoSinkPlaceholder(nodeId: string, node: CustomNode | undefined): void {
  const placeholderItemId = placeholders.get(nodeId);
  if (!placeholderItemId) return;
  placeholders.delete(nodeId);

  const creative = useCreativeStore.getState();
  if (!creative.autoSinkEnabled) {
    removePlaceholder(placeholderItemId);
    return;
  }

  const drafts = node ? createCreativeAssetDraftsFromWorkflowNode(node) : [];
  const placeholderItem = creative.canvas.items.find((item) => item.id === placeholderItemId);

  if (drafts.length === 0) {
    removePlaceholder(placeholderItemId);
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
  removePlaceholder(placeholderItemId);
}

// 执行失败/中断：移除占位。
export function failAutoSinkPlaceholder(nodeId: string): void {
  const placeholderItemId = placeholders.get(nodeId);
  if (!placeholderItemId) return;
  placeholders.delete(nodeId);
  removePlaceholder(placeholderItemId);
}

function removePlaceholder(itemId: string) {
  const creative = useCreativeStore.getState();
  if (creative.canvas.items.some((item) => item.id === itemId)) {
    creative.removeItems([itemId]);
  }
  const assetId = creative.assets.find(
    (asset) => asset.tags.includes("auto-sink") && asset.text === PLACEHOLDER_TITLE
  )?.id;
  if (assetId) creative.removeAssets([assetId]);
}
