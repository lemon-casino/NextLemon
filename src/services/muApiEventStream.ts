// MuAPI 事件流游标状态机（纯函数，参考 Open-AI-Design-Agent 的事件轮询设计）：
// ?since= 游标断点续传 + 按 event id 去重 + 死空看门狗（超过 dead-air 时限无新事件判 stalled）。

import type { AgentEvent } from "@/types/agent";

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

// 断点续传判定已由 shouldPollMuApiSessionJob 取代（后者不依赖本地 session.status，
// 且同时覆盖持续轮询与停滞停轮），为避免两者判定不一致造成误用，旧函数已删除。

// job 终态集合：done/error/cancelled（含服务端常见的 completed/failed/canceled 别名）。
export const MUAPI_JOB_TERMINAL_STATUSES = [
  "done",
  "completed",
  "error",
  "failed",
  "cancelled",
  "canceled",
] as const;

export function isMuApiJobStatusTerminal(status: unknown): boolean {
  if (typeof status !== "string") return false;
  return (MUAPI_JOB_TERMINAL_STATUSES as readonly string[]).includes(status.trim().toLowerCase());
}

// 会话上的远端任务是否已收敛：事件流标记 done，或最近一次 job 状态为终态。
export function isMuApiSessionJobSettled(session: {
  metadata?: Record<string, unknown>;
}): boolean {
  const poll = session.metadata?.eventPoll as MuApiEventPollState | undefined;
  if (poll?.done) return true;
  return isMuApiJobStatusTerminal(session.metadata?.remoteJobStatus);
}

// 持续轮询判定：会话挂着远端 job、尚未收敛、且未进入死空停滞。
export function shouldPollMuApiSessionJob(session: {
  metadata?: Record<string, unknown>;
}): boolean {
  const remoteJobId = session.metadata?.remoteJobId;
  if (typeof remoteJobId !== "string" || !remoteJobId) return false;
  if (isMuApiSessionJobSettled(session)) return false;
  const poll = session.metadata?.eventPoll as MuApiEventPollState | undefined;
  return poll ? !isMuApiEventPollStalled(poll) : true;
}

export type AgentApprovalOutcome = "approved" | "rejected" | "cancelled" | "completed";

export interface AgentApprovalEventResolution {
  resolved: boolean;
  outcome: AgentApprovalOutcome | null;
}

// 审批 resolved 证据：后续到达的批准/拒绝/取消类 tool_result 事件。
const APPROVAL_OUTCOME_BY_TOOL: Record<string, AgentApprovalOutcome> = {
  "approval.approve": "approved",
  "approval.execute": "approved",
  "muapi.approve": "approved",
  "approval.reject": "rejected",
  "muapi.reject": "rejected",
  "muapi.cancel": "cancelled",
};

// 审批卡生命周期收敛：approval_required 事件在后续 resolved 证据（批准/拒绝/取消的
// tool_result，或任务整体终态 jobSettled）到达后收敛，不再静态悬挂。
export function resolveAgentApprovalResolutions(
  events: AgentEvent[],
  jobSettled = false
): Record<string, AgentApprovalEventResolution> {
  const resolutions: Record<string, AgentApprovalEventResolution> = {};
  let pendingEventIds: string[] = [];

  for (const event of events) {
    if (event.type === "approval_required") {
      pendingEventIds.push(event.id);
      continue;
    }
    if (pendingEventIds.length === 0 || event.type !== "tool_result") continue;
    const outcome = APPROVAL_OUTCOME_BY_TOOL[event.toolName];
    if (!outcome) continue;
    // 拒绝/取消类结果在生产中即以 ok=false 落盘（如 agentStore.rejectPendingOps 硬编码
    // approval.reject 的 ok=false），同样视为 resolved 证据；其余失败结果不算收敛。
    if (!event.ok && outcome !== "rejected" && outcome !== "cancelled") continue;
    for (const eventId of pendingEventIds) {
      resolutions[eventId] = { resolved: true, outcome };
    }
    pendingEventIds = [];
  }

  if (jobSettled) {
    for (const eventId of pendingEventIds) {
      resolutions[eventId] = { resolved: true, outcome: "completed" };
    }
  }

  return resolutions;
}
