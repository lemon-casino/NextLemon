import type { CreativeCanvasItem, CreativeViewport } from "@/types/creative";

export interface CreativeCanvasRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function normalizeRect(rect: CreativeCanvasRect): CreativeCanvasRect {
  return {
    x: rect.width >= 0 ? rect.x : rect.x + rect.width,
    y: rect.height >= 0 ? rect.y : rect.y + rect.height,
    width: Math.abs(rect.width),
    height: Math.abs(rect.height),
  };
}

// 框选命中：与矩形相交（含部分相交）的画布实例即被选中。
export function findItemsInRect(
  items: CreativeCanvasItem[],
  rect: CreativeCanvasRect
): CreativeCanvasItem[] {
  const box = normalizeRect(rect);
  return items.filter((item) => {
    const itemRight = item.position.x + item.width;
    const itemBottom = item.position.y + item.height;
    return (
      item.position.x < box.x + box.width &&
      itemRight > box.x &&
      item.position.y < box.y + box.height &&
      itemBottom > box.y
    );
  });
}

// 导出边界：覆盖全部可见实例的最小矩形，四周留 padding；空画布返回 null。
export function computeCreativeCanvasExportBounds(
  items: CreativeCanvasItem[],
  padding = 48
): CreativeCanvasRect | null {
  const visible = items.filter((item) => !item.hidden);
  if (visible.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const item of visible) {
    minX = Math.min(minX, item.position.x);
    minY = Math.min(minY, item.position.y);
    maxX = Math.max(maxX, item.position.x + item.width);
    maxY = Math.max(maxY, item.position.y + item.height);
  }

  return {
    x: minX - padding,
    y: minY - padding,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
  };
}

export interface SnapGuide {
  orientation: "vertical" | "horizontal";
  at: number;
}

export interface SnapAdjustment {
  x: number;
  y: number;
  guides: SnapGuide[];
}

const SNAP_EDGES = [0, 0.5, 1] as const;

// 吸附参考线（纯函数）：拖拽目标的左/中/右、上/中/下与其他实例的对应边
// 距离不超过 threshold 时吸附到该边，并返回需要对齐的参考线。
export function computeSnapAdjustment(
  dragItem: { id: string; width: number; height: number },
  targetPosition: { x: number; y: number },
  otherItems: CreativeCanvasItem[],
  threshold = 6
): SnapAdjustment {
  let bestX: { delta: number; at: number } | null = null;
  let bestY: { delta: number; at: number } | null = null;

  for (const other of otherItems) {
    if (other.id === dragItem.id) continue;
    for (const fraction of SNAP_EDGES) {
      const otherX = other.position.x + other.width * fraction;
      const otherY = other.position.y + other.height * fraction;
      for (const dragFraction of SNAP_EDGES) {
        const dragX = targetPosition.x + dragItem.width * dragFraction;
        const deltaX = otherX - dragX;
        if (Math.abs(deltaX) <= threshold && (!bestX || Math.abs(deltaX) < Math.abs(bestX.delta))) {
          bestX = { delta: deltaX, at: otherX };
        }
        const dragY = targetPosition.y + dragItem.height * dragFraction;
        const deltaY = otherY - dragY;
        if (Math.abs(deltaY) <= threshold && (!bestY || Math.abs(deltaY) < Math.abs(bestY.delta))) {
          bestY = { delta: deltaY, at: otherY };
        }
      }
    }
  }

  const guides: SnapGuide[] = [];
  const adjusted = {
    x: targetPosition.x + (bestX?.delta ?? 0),
    y: targetPosition.y + (bestY?.delta ?? 0),
  };
  if (bestX) guides.push({ orientation: "vertical", at: bestX.at });
  if (bestY) guides.push({ orientation: "horizontal", at: bestY.at });
  return { ...adjusted, guides };
}

export interface MinimapFrame {
  // 世界坐标下的内容范围（可见实例 ∪ 视口，保证视口指示框始终可见）
  union: CreativeCanvasRect;
  // minimap 像素 / 世界像素
  scale: number;
  offsetX: number;
  offsetY: number;
}

// 小地图取景（纯函数）：由实例边界与当前视口推导联合范围和缩放比例。
export function computeMinimapFrame(
  items: CreativeCanvasItem[],
  viewport: CreativeViewport,
  containerWidth: number,
  containerHeight: number,
  mapWidth: number,
  mapHeight: number,
  padding = 8
): MinimapFrame {
  const visible = items.filter((item) => !item.hidden);
  let minX = (-viewport.x) / viewport.zoom;
  let minY = (-viewport.y) / viewport.zoom;
  let maxX = minX + containerWidth / viewport.zoom;
  let maxY = minY + containerHeight / viewport.zoom;

  for (const item of visible) {
    minX = Math.min(minX, item.position.x);
    minY = Math.min(minY, item.position.y);
    maxX = Math.max(maxX, item.position.x + item.width);
    maxY = Math.max(maxY, item.position.y + item.height);
  }

  const unionWidth = Math.max(1, maxX - minX);
  const unionHeight = Math.max(1, maxY - minY);
  const scale = Math.min(
    (mapWidth - padding * 2) / unionWidth,
    (mapHeight - padding * 2) / unionHeight
  );

  return {
    union: { x: minX, y: minY, width: unionWidth, height: unionHeight },
    scale,
    offsetX: padding,
    offsetY: padding,
  };
}
