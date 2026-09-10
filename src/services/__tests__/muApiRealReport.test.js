import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateReport } from "../../../scripts/assert-muapi-real-report.mjs";

describe("assert-muapi-real-report", () => {
  it("reports missing real evidence files with a machine-readable blocker", () => {
    const result = validateReport(path.join(os.tmpdir(), "nextlemon-missing-real-muapi-report.json"));

    expect(result.ok).toBe(false);
    expect(result.blockingEvidenceIds).toEqual(["report-readable"]);
    expect(result.evidenceChecklist[0].id).toBe("report-readable");
  });

  it("accepts strict real MuAPI evidence with all required endpoints", () => {
    const result = validateReport(writeReport(createReport()));

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.endpointCount).toBe(5);
    expect(result.endpoint2xxCount).toBe(5);
    expect(result.missingStepIds).toEqual([]);
    expect(result.failedStepIds).toEqual([]);
    expect(result.missingEndpointIds).toEqual([]);
    expect(result.failedEndpoint2xxIds).toEqual([]);
    expect(result.stepEvidence.chat.passed).toBe(true);
    expect(result.endpointEvidence.events.has2xx).toBe(true);
    expect(result.evidencePolicy.requiredEndpoints).toEqual(["account", "skills", "session", "chat", "events"]);
    expect(result.blockingEvidenceIds).toEqual([]);
    expect(result.evidenceChecklist.length).toBe(18);
    expect(result.evidenceChecklist.every((item) => item.status === "passed")).toBe(true);
    expect(result.evidenceChecklist.map((item) => item.id)).toEqual(
      expect.arrayContaining(["remote-session-id", "remote-job-id", "step-chat", "endpoint-events", "redaction"])
    );
  });

  it("rejects localhost reports", () => {
    const result = validateReport(writeReport(createReport({ baseUrl: "http://127.0.0.1:7788" })));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("baseUrl points to localhost; this is not a real MuAPI service.");
    expect(result.blockingEvidenceIds).toContain("non-localhost-base-url");
  });

  it("rejects endpoint evidence without a successful status", () => {
    const report = createReport();
    report.endpointLog = report.endpointLog.map((entry) =>
      entry.path === "/api/v1/creative-agent/jobs/job-1/events" ? { ...entry, status: 500 } : entry
    );

    const result = validateReport(writeReport(report));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("Endpoint evidence matching /^GET \\/api\\/v1\\/creative-agent\\/jobs\\/[^/]+\\/events$/ must include a 2xx status.");
    expect(result.endpointEvidence.events.seen).toBe(true);
    expect(result.endpointEvidence.events.has2xx).toBe(false);
    expect(result.failedEndpoint2xxIds).toContain("events");
    expect(result.missingEndpointIds).toEqual([]);
    expect(result.blockingEvidenceIds).toContain("endpoint-events");
    expect(result.evidenceChecklist.find((item) => item.id === "endpoint-events")?.evidence.statuses).toEqual([500]);
  });

  it("rejects reports that leak secret fields or configured secret values", () => {
    const previousApiKey = process.env.MUAPI_API_KEY;
    process.env.MUAPI_API_KEY = "sk-real-secret-123456789";
    try {
      const report = createReport();
      report.steps[0] = {
        ...report.steps[0],
        detail: {
          apiKey: process.env.MUAPI_API_KEY,
        },
      };

      const result = validateReport(writeReport(report));

      expect(result.ok).toBe(false);
      expect(result.redaction.secretValuesReturned).toBe(true);
      expect(result.redaction.secretFieldPaths).toContain("$.steps[0].detail.apiKey");
      expect(result.redaction.literalSecretMatches).toContain("MUAPI_API_KEY");
      expect(result.blockingEvidenceIds).toContain("redaction");
      expect(result.errors.some((error) => error.includes("sensitive field"))).toBe(true);
      expect(result.errors.some((error) => error.includes("unredacted secret"))).toBe(true);
    } finally {
      if (previousApiKey === undefined) delete process.env.MUAPI_API_KEY;
      else process.env.MUAPI_API_KEY = previousApiKey;
    }
  });
});

function createReport(patch = {}) {
  return {
    ok: true,
    configured: true,
    realService: true,
    checkedAt: "2026-07-06T00:00:00.000Z",
    baseUrl: "https://api.muapi.ai",
    remoteSessionId: "remote-session",
    remoteJobId: "job-1",
    steps: [
      { id: "config", status: "passed" },
      { id: "account", status: "passed" },
      { id: "skills", status: "passed" },
      { id: "session", status: "passed" },
      { id: "chat", status: "passed" },
      { id: "events", status: "passed" },
    ],
    endpointLog: [
      { method: "GET", path: "/api/v1/account/balance", status: 200, durationMs: 1 },
      { method: "GET", path: "/api/v1/creative-agent/agent-skills", status: 200, durationMs: 1 },
      { method: "POST", path: "/api/v1/creative-agent/sessions", status: 201, durationMs: 1 },
      { method: "POST", path: "/api/v1/creative-agent/sessions/remote-session/chat", status: 200, durationMs: 1 },
      { method: "GET", path: "/api/v1/creative-agent/jobs/job-1/events", status: 200, durationMs: 1 },
    ],
    ...patch,
  };
}

function writeReport(report) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "nextlemon-muapi-real-report-"));
  const filePath = path.join(dir, "report.json");
  writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`);
  return filePath;
}
