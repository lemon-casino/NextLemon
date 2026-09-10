import { describe, expect, it } from "vitest";
import {
  applyMuApiEventPollResult,
  createMuApiEventPollState,
  extractMuApiEventId,
  isMuApiEventPollStalled,
  MUAPI_DEAD_AIR_MS,
  shouldResumeMuApiEventPolling,
} from "@/services/muApiEventStream";

function event(id: string, extra: Record<string, unknown> = {}) {
  return { id, type: "text", content: `content-${id}`, ...extra };
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

  it("only resumes polling for sessions with a remote job that is not done", () => {
    expect(
      shouldResumeMuApiEventPolling({ status: "running", metadata: { remoteJobId: "job-1" } })
    ).toBe(true);
    expect(
      shouldResumeMuApiEventPolling({
        status: "awaiting_approval",
        metadata: { remoteJobId: "job-1", eventPoll: { done: true } },
      })
    ).toBe(false);
    expect(shouldResumeMuApiEventPolling({ status: "idle", metadata: { remoteJobId: "job-1" } })).toBe(false);
    expect(shouldResumeMuApiEventPolling({ status: "running", metadata: {} })).toBe(false);
  });
});
