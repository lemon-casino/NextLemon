import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shouldPollMuApiSessionJob } from "@/services/muApiEventStream";
import {
  MUAPI_ACTIVE_POLL_INTERVAL_MS,
  pollActiveMuApiJob,
  recoverMuApiSessionJobs,
  startMuApiJobPolling,
} from "@/services/muApiJobRecovery";
import { useAgentStore } from "@/stores/agentStore";
import type { AgentProviderConfig, AgentSession } from "@/types/agent";

const toastSpies = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));

vi.mock("@/stores/toastStore", () => ({
  toast: toastSpies,
}));

const config: AgentProviderConfig = {
  kind: "muapi",
  enabled: true,
  name: "MuAPI",
  baseUrl: "https://muapi.test",
  apiKey: "test-key",
  model: "gpt-4o",
};

function seedSession(metadata: Record<string, unknown>, status: AgentSession["status"] = "idle") {
  useAgentStore.setState({
    sessions: [
      {
        id: "s1",
        title: "MuAPI 会话",
        providerKind: "muapi",
        messages: [],
        status,
        createdAt: 1,
        updatedAt: 1,
        metadata,
      },
    ],
    activeSessionId: "s1",
  });
}

function expectSession(): AgentSession {
  const session = useAgentStore.getState().sessions.find((item) => item.id === "s1");
  if (!session) throw new Error("session s1 missing");
  return session;
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    text: async () => JSON.stringify(body),
  } as Response;
}

function stubJobStatus(sequence: string[]) {
  let statusCalls = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: unknown) => {
    const urlText = String(url);
    if (urlText.includes("/jobs/job-1/events")) {
      return jsonResponse({ events: [], cursor: null });
    }
    if (urlText.includes("/jobs/job-1/status")) {
      const status = sequence[Math.min(statusCalls, sequence.length - 1)];
      statusCalls += 1;
      return jsonResponse({ data: { id: "job-1", status } });
    }
    throw new Error(`unexpected url ${urlText}`);
  }));
  return () => statusCalls;
}

function stubSessionJobs(jobs: unknown[]) {
  vi.stubGlobal("fetch", vi.fn(async (url: unknown) => {
    const urlText = String(url);
    if (urlText.includes("/sessions/rs1/jobs")) {
      return jsonResponse({ data: jobs });
    }
    throw new Error(`unexpected url ${urlText}`);
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("pollActiveMuApiJob", () => {
  beforeEach(() => {
    seedSession({
      remoteSessionId: "rs1",
      remoteJobId: "job-1",
      eventPoll: { cursor: "c0", lastEventAt: Date.now(), seenEventIds: [], pollCount: 0, done: false },
    });
  });

  it("settles the session when the job status reaches a terminal state", async () => {
    const getStatusCalls = stubJobStatus(["done"]);

    await pollActiveMuApiJob("s1", config);

    const session = expectSession();
    expect(getStatusCalls()).toBe(1);
    expect(session.metadata?.remoteJobStatus).toBe("done");
    expect(session.status).toBe("idle");
    expect(toastSpies.success).toHaveBeenCalledTimes(1);
    expect(shouldPollMuApiSessionJob(session)).toBe(false);
  });

  it("maps error and cancelled terminal statuses to failed/cancelled local states", async () => {
    stubJobStatus(["error"]);
    await pollActiveMuApiJob("s1", config);
    expect(expectSession().status).toBe("failed");
    expect(toastSpies.error).toHaveBeenCalledWith("远端任务已结束：error");

    seedSession({
      remoteSessionId: "rs1",
      remoteJobId: "job-1",
      eventPoll: { cursor: null, lastEventAt: Date.now(), seenEventIds: [], pollCount: 0, done: false },
    });
    stubJobStatus(["cancelled"]);
    await pollActiveMuApiJob("s1", config);
    expect(expectSession().status).toBe("cancelled");
    expect(toastSpies.info).toHaveBeenCalledWith("远端任务已取消");
  });

  it("does not update or toast again once a terminal status was recorded", async () => {
    seedSession({
      remoteSessionId: "rs1",
      remoteJobId: "job-1",
      remoteJobStatus: "done",
      eventPoll: { cursor: null, lastEventAt: Date.now(), seenEventIds: [], pollCount: 0, done: false },
    });
    stubJobStatus(["done"]);

    await pollActiveMuApiJob("s1", config);

    expect(toastSpies.success).not.toHaveBeenCalled();
    expect(toastSpies.error).not.toHaveBeenCalled();
    expect(expectSession().status).toBe("idle");
  });

  it("keeps polling state untouched for non-terminal job statuses", async () => {
    stubJobStatus(["processing"]);

    await pollActiveMuApiJob("s1", config);

    expect(expectSession().metadata?.remoteJobStatus).toBeUndefined();
    expect(expectSession().status).toBe("idle");
    expect(toastSpies.success).not.toHaveBeenCalled();
  });
});

describe("recoverMuApiSessionJobs", () => {
  it("refreshes the watchdog clock for the same job so polling can resume after restart", async () => {
    const staleLastEventAt = Date.now() - 10 * 60 * 1000; // 超过 6 分钟死空时限
    seedSession({
      remoteSessionId: "rs1",
      remoteJobId: "job-1",
      eventPoll: { cursor: "c9", lastEventAt: staleLastEventAt, seenEventIds: ["e1"], pollCount: 3, done: false },
    });
    stubSessionJobs([{ id: "job-1", status: "processing" }]);

    await recoverMuApiSessionJobs("s1", "rs1", config);

    const session = expectSession();
    const poll = session.metadata?.eventPoll as { cursor: string | null; lastEventAt: number; done?: boolean };
    expect(poll.lastEventAt).toBeGreaterThan(staleLastEventAt);
    expect(poll.cursor).toBe("c9"); // cursor 保留，继续增量续传
    expect(poll.done).toBe(false);
    expect(session.metadata?.remoteJobStatus).toBe("processing");
    expect(session.status).toBe("running");
    // 评审指出的核心场景：不再因过期的 lastEventAt 判定 stalled 而永不自动续听
    expect(shouldPollMuApiSessionJob(session)).toBe(true);
  });

  it("converges the local session when the server has no active job", async () => {
    seedSession({
      remoteSessionId: "rs1",
      remoteJobId: "job-1",
      eventPoll: { cursor: null, lastEventAt: Date.now(), seenEventIds: [], pollCount: 1, done: false },
    });
    stubSessionJobs([]);

    await recoverMuApiSessionJobs("s1", "rs1", config);

    const session = expectSession();
    expect(session.metadata?.remoteJobStatus).toBe("done");
    expect((session.metadata?.eventPoll as { done?: boolean }).done).toBe(true);
    expect(session.status).toBe("idle");
    expect(shouldPollMuApiSessionJob(session)).toBe(false);
  });

  it("switches to a newly active job id and restarts the poll cursor", async () => {
    seedSession({
      remoteSessionId: "rs1",
      remoteJobId: "job-old",
      eventPoll: { cursor: "c-old", lastEventAt: Date.now(), seenEventIds: [], pollCount: 5, done: false },
    });
    stubSessionJobs([{ id: "job-new", status: "pending" }]);

    await recoverMuApiSessionJobs("s1", "rs1", config);

    const session = expectSession();
    expect(session.metadata?.remoteJobId).toBe("job-new");
    expect((session.metadata?.eventPoll as { cursor?: string | null }).cursor ?? null).toBeNull();
    expect(session.metadata?.remoteJobStatus).toBe("pending");
    expect(session.status).toBe("running");
    expect(shouldPollMuApiSessionJob(session)).toBe(true);
  });

  it("falls back silently to local metadata when the server query fails", async () => {
    const metadata = {
      remoteSessionId: "rs1",
      remoteJobId: "job-1",
      eventPoll: { cursor: "c0", lastEventAt: Date.now(), seenEventIds: [], pollCount: 0, done: false },
    };
    seedSession({ ...metadata });
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network down");
    }));

    await recoverMuApiSessionJobs("s1", "rs1", config);

    const session = expectSession();
    expect(session.metadata).toEqual(metadata);
    expect(session.status).toBe("idle");
  });
});

describe("startMuApiJobPolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    seedSession({
      remoteSessionId: "rs1",
      remoteJobId: "job-1",
      eventPoll: { cursor: null, lastEventAt: Date.now(), seenEventIds: [], pollCount: 0, done: false },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("ticks immediately, keeps the ~2s cadence and stops itself after a terminal state", async () => {
    const getStatusCalls = stubJobStatus(["processing", "processing", "done"]);

    const handle = startMuApiJobPolling("s1", config);
    await vi.advanceTimersByTimeAsync(0); // flush 首轮 tick
    expect(getStatusCalls()).toBe(1);

    await vi.advanceTimersByTimeAsync(MUAPI_ACTIVE_POLL_INTERVAL_MS - 1);
    expect(getStatusCalls()).toBe(1); // 未到周期，无新 tick

    await vi.advanceTimersByTimeAsync(1);
    expect(getStatusCalls()).toBe(2);

    await vi.advanceTimersByTimeAsync(MUAPI_ACTIVE_POLL_INTERVAL_MS); // 第 3 次状态为 done
    expect(getStatusCalls()).toBe(3);
    expect(expectSession().metadata?.remoteJobStatus).toBe("done");

    await vi.advanceTimersByTimeAsync(MUAPI_ACTIVE_POLL_INTERVAL_MS * 3);
    expect(getStatusCalls()).toBe(3); // 终态后自停，不再轮询

    handle.stop();
  });

  it("stops polling and clears the timer when stop() is called", async () => {
    const getStatusCalls = stubJobStatus(["processing"]);

    const handle = startMuApiJobPolling("s1", config);
    await vi.advanceTimersByTimeAsync(0);
    expect(getStatusCalls()).toBe(1);

    handle.stop();
    await vi.advanceTimersByTimeAsync(MUAPI_ACTIVE_POLL_INTERVAL_MS * 3);
    expect(getStatusCalls()).toBe(1);
  });
});
