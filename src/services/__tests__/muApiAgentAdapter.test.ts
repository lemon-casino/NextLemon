import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchMuApiJobStatus,
  findActiveMuApiJob,
  mapMuApiEvents,
  verifyMuApiConnection,
} from "@/services/muApiAgentAdapter";
import type { AgentProviderConfig } from "@/types/agent";

const config: AgentProviderConfig = {
  kind: "muapi",
  enabled: true,
  name: "MuAPI",
  baseUrl: "https://muapi.test",
  apiKey: "test-key",
  model: "gpt-4o",
};

describe("muApiAgentAdapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps remote plan and approval events into unified agent events", () => {
    const events = mapMuApiEvents(
      [
        { type: "plan_propose", data: { title: "Plan", brief: "Brief", steps: [] } },
        { type: "approval_required", data: { title: "Approve", ops: [{ type: "workflow.selectNodes", nodeIds: [] }] } },
      ],
      "local-session"
    );

    expect(events[0].type).toBe("plan_propose");
    expect(events[1].type).toBe("approval_required");
  });

  it("verifies configured MuAPI service with real endpoint sequence", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(url);
      if (url.endsWith("/api/v1/account/balance")) {
        return jsonResponse({ data: { balance: 10 } });
      }
      if (url.endsWith("/api/v1/creative-agent/agent-skills")) {
        return jsonResponse({ data: [{ name: "plan" }] });
      }
      if (url.endsWith("/api/v1/creative-agent/sessions")) {
        return jsonResponse({ data: { id: "remote-session" } });
      }
      return jsonResponse({ detail: "missing" }, 404);
    }));

    const result = await verifyMuApiConnection(config);

    expect(result.ok).toBe(true);
    expect(result.remoteSessionId).toBe("remote-session");
    expect(result.realService).toBe(true);
    expect(result.redaction.secretValuesReturned).toBe(false);
    expect(result.redaction.redactedKeys).toContain("MUAPI_API_KEY");
    expect(result.endpointLog.map((entry) => entry.path)).toContain("/api/v1/account/balance");
    expect(result.steps.map((step) => step.id)).toEqual(["config", "account", "skills", "session", "chat"]);
    expect(result.strictEvidenceReady).toBe(false);
    expect(result.evidenceChecklist).toHaveLength(18);
    expect(result.blockingEvidenceIds).toEqual(expect.arrayContaining(["remote-job-id", "step-events", "endpoint-chat", "endpoint-events"]));
    expect(result.endpointEvidence.account.has2xx).toBe(true);
    expect(calls.some((url) => url.endsWith("/api/v1/account/balance"))).toBe(true);
  });

  it("requires chat probe when strict verification is enabled", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/api/v1/account/balance")) return jsonResponse({ data: { balance: 10 } });
      if (url.endsWith("/api/v1/creative-agent/agent-skills")) return jsonResponse({ data: [] });
      if (url.endsWith("/api/v1/creative-agent/sessions")) return jsonResponse({ data: { id: "remote-session" } });
      return jsonResponse({ detail: "missing" }, 404);
    }));

    const result = await verifyMuApiConnection(config, { requireChat: true });

    expect(result.ok).toBe(false);
    expect(result.requireChat).toBe(true);
    expect(result.steps.find((step) => step.id === "chat")?.status).toBe("failed");
  });

  it("runs chat probe and job events during strict verification", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(url);
      if (url.endsWith("/api/v1/account/balance")) return jsonResponse({ data: { balance: 10 } });
      if (url.endsWith("/api/v1/creative-agent/agent-skills")) return jsonResponse({ data: [] });
      if (url.endsWith("/api/v1/creative-agent/sessions")) return jsonResponse({ data: { id: "remote-session" } });
      if (url.endsWith("/api/v1/creative-agent/sessions/remote-session/chat")) {
        return jsonResponse({ data: { job_id: "job-1", events: [{ type: "text", data: { content: "ok" } }] } });
      }
      if (url.endsWith("/api/v1/creative-agent/jobs/job-1/events")) {
        return jsonResponse({ data: [{ type: "tool_result", data: { ok: true } }] });
      }
      return jsonResponse({ detail: "missing" }, 404);
    }));

    const result = await verifyMuApiConnection(config, { chatProbe: "ping", requireChat: true });

    expect(result.ok).toBe(true);
    expect(result.strictEvidenceReady).toBe(true);
    expect(result.blockingEvidenceIds).toEqual([]);
    expect(result.remoteJobId).toBe("job-1");
    expect(result.steps.map((step) => step.id)).toContain("events");
    expect(result.endpointEvidence.events.has2xx).toBe(true);
    expect(result.endpointLog.some((entry) => entry.path.endsWith("/jobs/job-1/events"))).toBe(true);
    expect(calls.some((url) => url.endsWith("/api/v1/creative-agent/sessions/remote-session/chat"))).toBe(true);
  });

  it("fails strict verification when chat does not return a job id for events", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/api/v1/account/balance")) return jsonResponse({ data: { balance: 10 } });
      if (url.endsWith("/api/v1/creative-agent/agent-skills")) return jsonResponse({ data: [] });
      if (url.endsWith("/api/v1/creative-agent/sessions")) return jsonResponse({ data: { id: "remote-session" } });
      if (url.endsWith("/api/v1/creative-agent/sessions/remote-session/chat")) {
        return jsonResponse({ data: { events: [{ type: "text", data: { content: "ok" } }] } });
      }
      return jsonResponse({ detail: "missing" }, 404);
    }));

    const result = await verifyMuApiConnection(config, { chatProbe: "ping", requireChat: true });

    expect(result.ok).toBe(false);
    expect(result.remoteJobId).toBeUndefined();
    expect(result.steps.find((step) => step.id === "events")?.status).toBe("failed");
    expect(result.blockingEvidenceIds).toEqual(expect.arrayContaining(["remote-job-id", "step-events", "endpoint-events"]));
  });

  it("fails verification before network calls when API key is missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await verifyMuApiConnection({ ...config, apiKey: "" });

    expect(result.ok).toBe(false);
    expect(result.steps[0].id).toBe("config");
    expect(result.steps[0].status).toBe("failed");
    expect(result.realService).toBe(false);
    expect(result.redaction.secretValuesReturned).toBe(false);
    expect(result.endpointLog).toHaveLength(0);
    expect(result.evidenceChecklist).toHaveLength(18);
    expect(result.blockingEvidenceIds).toContain("configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("findActiveMuApiJob", () => {
  it("returns null for empty or fully terminal job lists", () => {
    expect(findActiveMuApiJob([])).toBeNull();
    expect(
      findActiveMuApiJob([{ id: "job-1", status: "done" }, { id: "job-2", status: "cancelled" }])
    ).toBeNull();
  });

  it("picks the most recently updated non-terminal job", () => {
    const job = findActiveMuApiJob([
      { id: "job-old", status: "processing", updated_at: "2026-01-01T00:00:00Z" },
      { id: "job-done", status: "completed" },
      { id: "job-new", status: "pending", updated_at: "2026-01-02T00:00:00Z" },
    ]);
    expect(job?.id).toBe("job-new");
  });

  it("treats jobs without a status as active", () => {
    const job = findActiveMuApiJob([{ id: "job-1" }]);
    expect(job?.id).toBe("job-1");
  });

  it("fetchMuApiJobStatus returns null when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network down");
    }));

    await expect(fetchMuApiJobStatus(config, "job-1")).resolves.toBeNull();
  });

  it("fetchMuApiJobStatus returns the job payload on success", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      expect(url).toBe("https://muapi.test/api/v1/creative-agent/jobs/job-1/status");
      return jsonResponse({ data: { id: "job-1", status: "processing" } });
    }));

    const job = await fetchMuApiJobStatus(config, "job-1");
    expect(job?.id).toBe("job-1");
    expect(job?.status).toBe("processing");
  });
});

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    text: async () => JSON.stringify(body),
  } as Response;
}
