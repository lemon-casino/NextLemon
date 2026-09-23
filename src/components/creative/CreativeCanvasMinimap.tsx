import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import { computeMinimapFrame, type MinimapFrame } from "@/services/creativeCanvasGeometry";
import { useCreativeStore } from "@/stores/creativeStore";

const MAP_WIDTH = 168;
const MAP_HEIGHT = 112;

// 创作画布小地图：可见实例缩略 + 当前视口指示框，点击或拖拽取景框可把对应世界点居中。
export function CreativeCanvasMinimap({
  containerRef,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
}) {
  const items = useCreativeStore((state) => state.canvas.items);
  const viewport = useCreativeStore((state) => state.canvas.viewport);
  const setViewport = useCreativeStore((state) => state.setViewport);
  const mapRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  // 拖拽期间冻结取景参数：frame 的 union 依赖当前视口（creativeCanvasGeometry.ts:138-141），
  // 若 move 中实时重算 frame，setViewport ↔ frame 互相反馈会让同一光标点换算出的
  // 世界点持续漂移；冻结后映射与被控视口解耦，拖拽稳定 1:1。
  const frozenFrameRef = useRef<MinimapFrame | null>(null);
  // 拖拽取景的 setViewport 按 rAF 合帧
  const pendingPointRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const frameRafRef = useRef<number | null>(null);

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

  // 把地图上的点换算成世界坐标并让主画布视口居中到该点
  const centerViewportOn = useCallback(
    (clientX: number, clientY: number, mapFrame: MinimapFrame) => {
      const mapRect = mapRef.current?.getBoundingClientRect();
      if (!mapRect) return;
      const worldX = (clientX - mapRect.left - mapFrame.offsetX) / mapFrame.scale + mapFrame.union.x;
      const worldY = (clientY - mapRect.top - mapFrame.offsetY) / mapFrame.scale + mapFrame.union.y;
      const containerWidth = containerRef.current?.clientWidth || window.innerWidth;
      const containerHeight = containerRef.current?.clientHeight || window.innerHeight;
      setViewport({
        x: containerWidth / 2 - worldX * viewport.zoom,
        y: containerHeight / 2 - worldY * viewport.zoom,
        zoom: viewport.zoom,
      });
    },
    [containerRef, setViewport, viewport.zoom]
  );

  const applyPendingPoint = useCallback(() => {
    frameRafRef.current = null;
    const point = pendingPointRef.current;
    pendingPointRef.current = null;
    const mapFrame = frozenFrameRef.current;
    if (!point || !mapFrame || !draggingRef.current) return;
    centerViewportOn(point.clientX, point.clientY, mapFrame);
  }, [centerViewportOn]);

  const endDrag = useCallback(() => {
    draggingRef.current = false;
    frozenFrameRef.current = null;
    pendingPointRef.current = null;
    if (frameRafRef.current != null) {
      cancelAnimationFrame(frameRafRef.current);
      frameRafRef.current = null;
    }
  }, []);

  // 兜底复位：指针捕获不可用/丢失时，pointerup 可能不命中小地图元素，
  // window 级监听确保 draggingRef 一定复位（释放前应用最后一次待合帧坐标）
  useEffect(() => {
    const handleWindowPointerUp = () => {
      if (!draggingRef.current) return;
      applyPendingPoint();
      endDrag();
    };
    window.addEventListener("pointerup", handleWindowPointerUp);
    return () => window.removeEventListener("pointerup", handleWindowPointerUp);
  }, [applyPendingPoint, endDrag]);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    // 阻止冒泡到画布容器，避免触发画布平移/清空选区
    event.preventDefault();
    event.stopPropagation();
    draggingRef.current = true;
    frozenFrameRef.current = frame;
    pendingPointRef.current = { clientX: event.clientX, clientY: event.clientY };
    applyPendingPoint();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // 指针捕获不可用时依赖 window pointerup 与 event.buttons 兜底
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    // 无捕获拖拽中按键已释放（buttons === 0）视为拖拽结束，防止之后
    // 划过小地图时持续搬移主画布视口
    if (event.buttons === 0) {
      applyPendingPoint();
      endDrag();
      return;
    }
    event.preventDefault();
    pendingPointRef.current = { clientX: event.clientX, clientY: event.clientY };
    if (frameRafRef.current == null) {
      frameRafRef.current = requestAnimationFrame(applyPendingPoint);
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    applyPendingPoint();
    endDrag();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      ref={mapRef}
      className="absolute bottom-4 left-4 z-10 touch-none cursor-pointer overflow-hidden rounded-lg border border-base-300 bg-base-100/85 shadow-md backdrop-blur"
      style={{ width: MAP_WIDTH, height: MAP_HEIGHT }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      title="小地图：点击或拖拽取景框调整画布视口"
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
