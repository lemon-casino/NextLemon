import { describe, expect, it } from "vitest";
import {
  applyMuApiEventPollResult,
  createMuApiEventPollState,
  extractMuApiEventId,
  isMuApiEventPollStalled,
  isMuApiJobStatusTerminal,
  isMuApiSessionJobSettled,
  MUAPI_DEAD_AIR_MS,
  resolveAgentApprovalResolutions,
  shouldPollMuApiSessionJob,
} from "@/services/muApiEventStream";
import type { AgentEvent } from "@/types/agent";

function event(id: string, extra: Record<string, unknown> = {}) {
  return { id, type: "text", content: `content-${id}`, ...extra };
}

function approvalEvent(id: string): AgentEvent {
  return { id, type: "approval_required", sessionId: "s1", title: "确认", ops: [], createdAt: 1 };
}

function toolResultEvent(id: string, toolName: string, ok = true): AgentEvent {
  return { id, type: "tool_result", sessionId: "s1", toolName, ok, createdAt: 2 };
}

describe("muApiEventStream", () => {
  it("extracts event ids from common field names", () => {
    expect(extractMuApiEventId({ id: "e1" })).toBe("e1");
    expect(extractMuApiEventId({ event_id: 42 })).toBe("42");
    expect(extractMuApiEventId({})).toBeNull();
  });

  it("advances the cursor and dedups events across polls", () => {
    let state = createMuApiEventPollState(1000);
    const first = applyMuApiEventPollResult(
      state,
      { events: [event("e1"), event("e2")], cursor: "cursor-1" },
      1100
    );
    state = first.state;
    expect(first.newEvents).toHaveLength(2);
    expect(state.cursor).toBe("cursor-1");
    expect(state.lastEventAt).toBe(1100);
    expect(state.pollCount).toBe(1);

    const second = applyMuApiEventPollResult(
      state,
      { events: [event("e2"), event("e3")], cursor: "cursor-2" },
      1200
    );
    expect(second.newEvents.map((item) => item.id)).toEqual(["e3"]);
    expect(second.state.cursor).toBe("cursor-2");
    expect(second.state.seenEventIds).toEqual(["e1", "e2", "e3"]);
  });

  it("keeps lastEventAt unchanged on empty polls and records completion", () => {
    let state = createMuApiEventPollState(1000);
    const empty = applyMuApiEventPollResult(state, { events: [], cursor: "cursor-1" }, 5000);
    state = empty.state;
    expect(state.lastEventAt).toBe(1000);
    expect(state.pollCount).toBe(1);

    const done = applyMuApiEventPollResult(state, { events: [], done: true }, 6000);
    expect(done.state.done).toBe(true);
    expect(isMuApiEventPollStalled(done.state, 6000 + MUAPI_DEAD_AIR_MS + 1)).toBe(false);
  });

  it("flags stalled polls only after the dead-air window on an unfinished job", () => {
    const state = createMuApiEventPollState(1000);
    expect(isMuApiEventPollStalled(state, 1000 + MUAPI_DEAD_AIR_MS)).toBe(false);
    expect(isMuApiEventPollStalled(state, 1000 + MUAPI_DEAD_AIR_MS + 1)).toBe(true);
  });

  it("treats done/error/cancelled aliases as terminal job statuses", () => {
    expect(isMuApiJobStatusTerminal("done")).toBe(true);
    expect(isMuApiJobStatusTerminal("Completed")).toBe(true);
    expect(isMuApiJobStatusTerminal(" error ")).toBe(true);
    expect(isMuApiJobStatusTerminal("failed")).toBe(true);
    expect(isMuApiJobStatusTerminal("cancelled")).toBe(true);
    expect(isMuApiJobStatusTerminal("canceled")).toBe(true);
    expect(isMuApiJobStatusTerminal("processing")).toBe(false);
    expect(isMuApiJobStatusTerminal("pending")).toBe(false);
    expect(isMuApiJobStatusTerminal("")).toBe(false);
    expect(isMuApiJobStatusTerminal(undefined)).toBe(false);
    expect(isMuApiJobStatusTerminal(42)).toBe(false);
  });

  it("settles a session job from eventPoll.done or a terminal remoteJobStatus", () => {
    expect(
      isMuApiSessionJobSettled({ metadata: { remoteJobId: "job-1", eventPoll: { done: true } } })
    ).toBe(true);
    expect(isMuApiSessionJobSettled({ metadata: { remoteJobId: "job-1", remoteJobStatus: "error" } })).toBe(true);
    expect(
      isMuApiSessionJobSettled({ metadata: { remoteJobId: "job-1", remoteJobStatus: "processing" } })
    ).toBe(false);
    expect(isMuApiSessionJobSettled({ metadata: { remoteJobId: "job-1" } })).toBe(false);
    expect(isMuApiSessionJobSettled({ metadata: {} })).toBe(false);
  });

  it("polls only sessions with an unfinished, non-stalled remote job", () => {
    expect(shouldPollMuApiSessionJob({ metadata: { remoteJobId: "job-1" } })).toBe(true);
    expect(shouldPollMuApiSessionJob({ metadata: {} })).toBe(false);
    expect(shouldPollMuApiSessionJob({ metadata: { remoteJobId: "job-1", remoteJobStatus: "done" } })).toBe(false);
    expect(
      shouldPollMuApiSessionJob({
        metadata: { remoteJobId: "job-1", eventPoll: { done: true, lastEventAt: Date.now() } },
      })
    ).toBe(false);

    const now = Date.now();
    expect(
      shouldPollMuApiSessionJob({
        metadata: {
          remoteJobId: "job-1",
          eventPoll: { cursor: null, lastEventAt: now, seenEventIds: [], pollCount: 1, done: false },
        },
      })
    ).toBe(true);
    expect(
      shouldPollMuApiSessionJob({
        metadata: {
          remoteJobId: "job-1",
          eventPoll: {
            cursor: null,
            lastEventAt: now - MUAPI_DEAD_AIR_MS - 1,
            seenEventIds: [],
            pollCount: 10,
            done: false,
          },
        },
      })
    ).toBe(false);
  });

  it("resolves approval events after later approve/reject evidence arrives", () => {
    const approval = approvalEvent("a1");
    expect(resolveAgentApprovalResolutions([approval])).toEqual({});
    expect(resolveAgentApprovalResolutions([approval, toolResultEvent("r1", "muapi.approve")])["a1"]).toEqual({
      resolved: true,
      outcome: "approved",
    });
    // 本地拒绝路径：agentStore.rejectPendingOps 产出的 approval.reject 为 ok=false，同样收敛
    expect(
      resolveAgentApprovalResolutions([approval, toolResultEvent("r1", "approval.reject", false)])["a1"]
    ).toEqual({ resolved: true, outcome: "rejected" });
    // 远端拒绝路径：muapi.reject 以 ok=true 落盘，亦收敛
    expect(resolveAgentApprovalResolutions([approval, toolResultEvent("r1", "muapi.reject")])["a1"]).toEqual({
      resolved: true,
      outcome: "rejected",
    });
    expect(resolveAgentApprovalResolutions([approval, toolResultEvent("r1", "muapi.cancel")])["a1"]).toEqual({
      resolved: true,
      outcome: "cancelled",
    });
    // 失败的审批动作不算 resolved 证据
    expect(resolveAgentApprovalResolutions([approval, toolResultEvent("r1", "muapi.approve", false)])).toEqual({});
    // 无关 tool_result 不收敛
    expect(resolveAgentApprovalResolutions([approval, toolResultEvent("r1", "muapi.verify")])).toEqual({});
  });

  it("resolves remaining approval events when the job settles and keeps later approvals pending", () => {
    const first = approvalEvent("a1");
    const resolution = toolResultEvent("r1", "muapi.approve");
    const second = approvalEvent("a2");

    const resolutions = resolveAgentApprovalResolutions([first, resolution, second]);
    expect(resolutions["a1"]).toEqual({ resolved: true, outcome: "approved" });
    expect(resolutions["a2"]).toBeUndefined();

    // 任务整体终态后，仍未收敛的审批事件收敛为 completed
    const settled = resolveAgentApprovalResolutions([second], true);
    expect(settled["a2"]).toEqual({ resolved: true, outcome: "completed" });
  });
});
