import type { CreativeCanvasItem } from "@/types/creative";

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
