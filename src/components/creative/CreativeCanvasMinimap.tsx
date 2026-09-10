import { useMemo, type RefObject } from "react";
import { computeMinimapFrame, type MinimapFrame } from "@/services/creativeCanvasGeometry";
import { useCreativeStore } from "@/stores/creativeStore";

const MAP_WIDTH = 168;
const MAP_HEIGHT = 112;

// 创作画布小地图：可见实例缩略 + 当前视口指示框，点击可把对应世界点居中。
export function CreativeCanvasMinimap({
  containerRef,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
}) {
  const items = useCreativeStore((state) => state.canvas.items);
  const viewport = useCreativeStore((state) => state.canvas.viewport);
  const setViewport = useCreativeStore((state) => state.setViewport);

  const frame = useMemo(
    () =>
      computeMinimapFrame(
        items,
        viewport,
        containerRef.current?.clientWidth || window.innerWidth,
        containerRef.current?.clientHeight || window.innerHeight,
        MAP_WIDTH,
        MAP_HEIGHT
      ),
    [containerRef, items, viewport]
  );

  const viewportRect = worldToMap(
    {
      x: (-viewport.x) / viewport.zoom,
      y: (-viewport.y) / viewport.zoom,
      width: (containerRef.current?.clientWidth || window.innerWidth) / viewport.zoom,
      height: (containerRef.current?.clientHeight || window.innerHeight) / viewport.zoom,
    },
    frame
  );

  const handleJump = (event: React.MouseEvent<HTMLDivElement>) => {
    const mapRect = event.currentTarget.getBoundingClientRect();
    const worldX = (event.clientX - mapRect.left - frame.offsetX) / frame.scale + frame.union.x;
    const worldY = (event.clientY - mapRect.top - frame.offsetY) / frame.scale + frame.union.y;
    const containerWidth = containerRef.current?.clientWidth || window.innerWidth;
    const containerHeight = containerRef.current?.clientHeight || window.innerHeight;
    setViewport({
      x: containerWidth / 2 - worldX * viewport.zoom,
      y: containerHeight / 2 - worldY * viewport.zoom,
      zoom: viewport.zoom,
    });
  };

  return (
    <div
      className="absolute bottom-4 left-4 z-10 cursor-pointer overflow-hidden rounded-lg border border-base-300 bg-base-100/85 shadow-md backdrop-blur"
      style={{ width: MAP_WIDTH, height: MAP_HEIGHT }}
      onClick={handleJump}
      title="小地图：点击将对应位置居中"
    >
      <div className="relative h-full w-full">
        {items
          .filter((item) => !item.hidden)
          .map((item) => {
            const rect = worldToMap(
              {
                x: item.position.x,
                y: item.position.y,
                width: item.width,
                height: item.height,
              },
              frame
            );
            return (
              <div
                key={item.id}
                className={`absolute rounded-[1px] ${
                  item.kind === "text" ? "bg-base-content/30" : "bg-primary/50"
                }`}
                style={rect}
              />
            );
          })}
        <div
          className="pointer-events-none absolute border-2 border-primary/80"
          style={viewportRect}
        />
      </div>
    </div>
  );
}

function worldToMap(
  rect: { x: number; y: number; width: number; height: number },
  frame: MinimapFrame
) {
  return {
    left: frame.offsetX + (rect.x - frame.union.x) * frame.scale,
    top: frame.offsetY + (rect.y - frame.union.y) * frame.scale,
    width: Math.max(2, rect.width * frame.scale),
    height: Math.max(2, rect.height * frame.scale),
  };
}
