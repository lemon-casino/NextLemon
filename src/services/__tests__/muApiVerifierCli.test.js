import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const SCRIPT_PATH = "scripts/verify-muapi.mjs";

describe("verify-muapi CLI", () => {
  it("reports missing API keys with strict evidence blockers and without secrets", () => {
    const child = spawnSync(
      process.execPath,
      [SCRIPT_PATH, "--json", "--require-chat"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          MUAPI_BASE_URL: "https://api.muapi.ai",
          MUAPI_API_KEY: "",
          MUAPI_MODEL: "gpt-4o",
          MUAPI_CHAT_PROBE: "strict probe",
          MUAPI_REQUIRE_CHAT: "1",
          MUAPI_VERIFY_REPORT: "",
        },
      }
    );
    const report = JSON.parse(child.stdout);

    expect(child.status).toBe(1);
    expect(report.ok).toBe(false);
    expect(report.configured).toBe(false);
    expect(report.realService).toBe(false);
    expect(report.strictEvidenceReady).toBe(false);
    expect(report.evidenceChecklist).toHaveLength(18);
    expect(report.blockingEvidenceIds).toEqual(
      expect.arrayContaining(["configured", "step-config", "endpoint-account", "remote-session-id", "remote-job-id"])
    );
    expect(report.failedStepIds).toEqual(["config"]);
    expect(report.missingStepIds).toEqual(expect.arrayContaining(["account", "skills", "session", "chat", "events"]));
    expect(report.endpointLog).toEqual([]);
    expect(report.redaction.secretValuesReturned).toBe(false);
    expect(JSON.stringify(report)).not.toContain("strict probe");
  });
});
