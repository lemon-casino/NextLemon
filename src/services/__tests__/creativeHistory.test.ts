import { describe, expect, it } from "vitest";
import {
  canRedoCreativeHistory,
  canUndoCreativeHistory,
  createCreativeHistory,
  CREATIVE_HISTORY_COALESCE_MS,
  pushCreativeHistory,
  redoCreativeHistory,
  undoCreativeHistory,
  withLiveViewport,
} from "@/services/creativeHistory";
import type { CreativeCanvasData, CreativeCanvasItem } from "@/types/creative";

function createCanvas(itemCount: number): CreativeCanvasData {
  const items: CreativeCanvasItem[] = Array.from({ length: itemCount }, (_, index) => ({
    id: `item-${index}`,
    assetId: `asset-${index}`,
    kind: "text",
    title: `素材 ${index}`,
    position: { x: index * 10, y: index * 10 },
    width: 100,
    height: 80,
    zIndex: index + 1,
    locked: false,
    hidden: false,
    createdAt: 1,
    updatedAt: 1,
  }));
  return {
    id: "creative-main",
    title: "素材创作画布",
    items,
    viewport: { x: 10, y: 20, zoom: 1.5 },
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("creativeHistory", () => {
  it("pushes past entries and clears future on new change", () => {
    const canvasA = createCanvas(1);
    const canvasB = createCanvas(2);
    const canvasC = createCanvas(3);

    let history = createCreativeHistory(canvasA);
    history = pushCreativeHistory(history, canvasB, { now: 1000 });
    expect(history.past).toHaveLength(1);
    expect(history.present.items).toHaveLength(2);
    expect(canUndoCreativeHistory(history)).toBe(true);
    expect(canRedoCreativeHistory(history)).toBe(false);

    history = pushCreativeHistory(history, canvasC, { now: 1100 });
    expect(history.past).toHaveLength(2);
    expect(history.present.items).toHaveLength(3);

    history = undoCreativeHistory(history);
    expect(history.present.items).toHaveLength(2);
    expect(history.future).toHaveLength(1);
    expect(canRedoCreativeHistory(history)).toBe(true);

    history = redoCreativeHistory(history);
    expect(history.present.items).toHaveLength(3);
    expect(history.future).toHaveLength(0);
  });

  it("coalesces consecutive pushes sharing a tag within the time window", () => {
    const canvasA = createCanvas(1);
    let history = createCreativeHistory(canvasA);

    const movedOnce = createCanvas(1);
    movedOnce.items[0].position = { x: 5, y: 5 };
    history = pushCreativeHistory(history, movedOnce, { tag: "move:item-0", now: 1000 });
    expect(history.past).toHaveLength(1);

    const movedAgain = createCanvas(1);
    movedAgain.items[0].position = { x: 9, y: 9 };
    history = pushCreativeHistory(history, movedAgain, {
      tag: "move:item-0",
      now: 1000 + CREATIVE_HISTORY_COALESCE_MS,
    });
    expect(history.past).toHaveLength(1);
    expect(history.present.items[0].position).toEqual({ x: 9, y: 9 });

    const lateMove = createCanvas(1);
    lateMove.items[0].position = { x: 20, y: 20 };
    history = pushCreativeHistory(history, lateMove, {
      tag: "move:item-0",
      now: 1000 + CREATIVE_HISTORY_COALESCE_MS + CREATIVE_HISTORY_COALESCE_MS + 1,
    });
    expect(history.past).toHaveLength(2);
  });

  it("does not coalesce pushes with different tags", () => {
    let history = createCreativeHistory(createCanvas(1));
    history = pushCreativeHistory(history, createCanvas(1), { tag: "move:item-0", now: 1000 });
    history = pushCreativeHistory(history, createCanvas(1), { tag: "resize:item-0", now: 1050 });
    expect(history.past).toHaveLength(2);
  });

  it("caps the past stack at the history limit", () => {
    let history = createCreativeHistory(createCanvas(0));
    for (let index = 0; index < 60; index += 1) {
      history = pushCreativeHistory(history, createCanvas(index + 1), {
        tag: `step-${index}`,
        now: index * 10_000,
      });
    }
    expect(history.past).toHaveLength(50);
  });

  it("undo/redo are no-ops at the boundaries and keep the live viewport", () => {
    const canvas = createCanvas(1);
    const history = createCreativeHistory(canvas);
    expect(undoCreativeHistory(history)).toBe(history);
    expect(redoCreativeHistory(history)).toBe(history);

    let next = pushCreativeHistory(history, createCanvas(2), { now: 1000 });
    next = undoCreativeHistory(next);
    const restored = withLiveViewport(next, {
      ...createCanvas(9),
      viewport: { x: 0, y: 0, zoom: 2 },
    });
    expect(restored.viewport).toEqual({ x: 0, y: 0, zoom: 2 });
    expect(next.present.viewport).toEqual({ x: 10, y: 20, zoom: 1.5 });
  });
});
