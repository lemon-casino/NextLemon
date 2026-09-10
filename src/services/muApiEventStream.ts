// MuAPI 事件流游标状态机（纯函数，参考 Open-AI-Design-Agent 的事件轮询设计）：
// ?since= 游标断点续传 + 按 event id 去重 + 死空看门狗（超过 dead-air 时限无新事件判 stalled）。

export interface MuApiEventPollState {
  cursor: string | null;
  lastEventAt: number;
  seenEventIds: string[];
  pollCount: number;
  done: boolean;
}

export interface MuApiEventPollResult {
  events: Array<Record<string, unknown>>;
  cursor?: string | null;
  done?: boolean;
}

export const MUAPI_DEAD_AIR_MS = 6 * 60 * 1000;
const MAX_SEEN_EVENT_IDS = 500;

export function createMuApiEventPollState(now = Date.now()): MuApiEventPollState {
  return {
    cursor: null,
    lastEventAt: now,
    seenEventIds: [],
    pollCount: 0,
    done: false,
  };
}

export function extractMuApiEventId(event: Record<string, unknown>): string | null {
  const candidates = [event.id, event.event_id, event.eventId];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate;
    if (typeof candidate === "number" && Number.isFinite(candidate)) return String(candidate);
  }
  return null;
}

// 应用一次轮询结果：返回新增事件（去重后）与下一个游标状态。
export function applyMuApiEventPollResult(
  state: MuApiEventPollState,
  result: MuApiEventPollResult,
  now = Date.now()
): { state: MuApiEventPollState; newEvents: Array<Record<string, unknown>> } {
  const seen = new Set(state.seenEventIds);
  const newEvents: Array<Record<string, unknown>> = [];

  for (const event of result.events) {
    const id = extractMuApiEventId(event);
    if (id === null) {
      newEvents.push(event);
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    newEvents.push(event);
  }

  const nextSeenEventIds = state.seenEventIds
    .concat(newEvents.map((event) => extractMuApiEventId(event)).filter((id): id is string => Boolean(id)))
    .slice(-MAX_SEEN_EVENT_IDS);

  const nextState: MuApiEventPollState = {
    cursor: typeof result.cursor === "string" && result.cursor.trim() ? result.cursor : state.cursor,
    lastEventAt: newEvents.length > 0 ? now : state.lastEventAt,
    seenEventIds: nextSeenEventIds,
    pollCount: state.pollCount + 1,
    done: result.done === true,
  };

  return { state: nextState, newEvents };
}

// 死空看门狗：job 未完成且超过时限没有收到任何新事件，判定 stalled。
export function isMuApiEventPollStalled(
  state: MuApiEventPollState,
  now = Date.now(),
  maxDeadAirMs = MUAPI_DEAD_AIR_MS
): boolean {
  if (state.done) return false;
  return now - state.lastEventAt > maxDeadAirMs;
}

// 断点续传判定：会话挂着一个远端 job，且尚未完成。
export function shouldResumeMuApiEventPolling(session: {
  status?: string;
  metadata?: Record<string, unknown>;
}): boolean {
  const remoteJobId = session.metadata?.remoteJobId;
  if (typeof remoteJobId !== "string" || !remoteJobId) return false;
  const poll = session.metadata?.eventPoll as MuApiEventPollState | undefined;
  if (poll?.done) return false;
  return session.status === "running" || session.status === "awaiting_approval";
}
