import type { CreativeCanvasData } from "@/types/creative";

export interface CreativeHistoryState {
  past: CreativeCanvasData[];
  present: CreativeCanvasData;
  future: CreativeCanvasData[];
  lastTag: string | null;
  lastPushAt: number;
}

export const CREATIVE_HISTORY_LIMIT = 50;
export const CREATIVE_HISTORY_COALESCE_MS = 800;

export function createCreativeHistory(present: CreativeCanvasData): CreativeHistoryState {
  return {
    past: [],
    present: cloneCanvas(present),
    future: [],
    lastTag: null,
    lastPushAt: 0,
  };
}

export function pushCreativeHistory(
  state: CreativeHistoryState,
  nextCanvas: CreativeCanvasData,
  options: { tag?: string; now?: number } = {}
): CreativeHistoryState {
  const timestamp = options.now ?? Date.now();
  const tag = options.tag ?? null;

  if (tag && tag === state.lastTag && timestamp - state.lastPushAt <= CREATIVE_HISTORY_COALESCE_MS) {
    return {
      ...state,
      present: cloneCanvas(nextCanvas),
      lastTag: tag,
      lastPushAt: timestamp,
    };
  }

  const past = [...state.past, state.present];
  if (past.length > CREATIVE_HISTORY_LIMIT) {
    past.splice(0, past.length - CREATIVE_HISTORY_LIMIT);
  }

  return {
    past,
    present: cloneCanvas(nextCanvas),
    future: [],
    lastTag: tag,
    lastPushAt: timestamp,
  };
}

export function undoCreativeHistory(state: CreativeHistoryState): CreativeHistoryState {
  const previous = state.past[state.past.length - 1];
  if (!previous) return state;

  return {
    past: state.past.slice(0, -1),
    present: previous,
    future: [state.present, ...state.future],
    lastTag: null,
    lastPushAt: 0,
  };
}

export function redoCreativeHistory(state: CreativeHistoryState): CreativeHistoryState {
  const next = state.future[0];
  if (!next) return state;

  return {
    past: [...state.past, state.present],
    present: next,
    future: state.future.slice(1),
    lastTag: null,
    lastPushAt: 0,
  };
}

export function canUndoCreativeHistory(state: CreativeHistoryState): boolean {
  return state.past.length > 0;
}

export function canRedoCreativeHistory(state: CreativeHistoryState): boolean {
  return state.future.length > 0;
}

export function withLiveViewport(
  history: CreativeHistoryState,
  liveCanvas: CreativeCanvasData
): CreativeCanvasData {
  return {
    ...history.present,
    viewport: liveCanvas.viewport,
  };
}

function cloneCanvas(canvas: CreativeCanvasData): CreativeCanvasData {
  return { ...canvas, viewport: { ...canvas.viewport } };
}
