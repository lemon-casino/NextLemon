import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const SCRIPT_PATH = "scripts/check-muapi-env.mjs";

describe("check-muapi-env CLI", () => {
  it("reports missing strict MuAPI env keys without exposing secrets", () => {
    const result = runEnvCheck({
      MUAPI_API_KEY: "",
      MUAPI_CHAT_PROBE: "",
      MUAPI_REQUIRE_CHAT: "1",
    });

    expect(result.status).toBe(1);
    expect(result.report.ok).toBe(false);
    expect(result.report.apiKeyConfigured).toBe(false);
    expect(result.report.chatProbeConfigured).toBe(false);
    expect(result.report.missingEnvKeys).toEqual(expect.arrayContaining(["MUAPI_API_KEY", "MUAPI_CHAT_PROBE"]));
    expect(result.report.failedEnvKeys).toEqual(expect.arrayContaining(["MUAPI_API_KEY", "MUAPI_CHAT_PROBE"]));
    expect(result.report.redaction.secretValuesReturned).toBe(false);
    expect(JSON.stringify(result.report)).not.toContain("sk-");
  });

  it("treats placeholder API keys as not configured", () => {
    const result = runEnvCheck({
      MUAPI_API_KEY: "your-api-key-placeholder",
      MUAPI_CHAT_PROBE: "strict probe",
      MUAPI_REQUIRE_CHAT: "1",
    });

    expect(result.status).toBe(1);
    expect(result.report.ok).toBe(false);
    expect(result.report.apiKeyConfigured).toBe(false);
    expect(result.report.chatProbeConfigured).toBe(true);
    expect(result.report.missingEnvKeys).toContain("MUAPI_API_KEY");
    expect(JSON.stringify(result.report)).not.toContain("your-api-key-placeholder");
  });
});

function runEnvCheck(envPatch) {
  const child = spawnSync(
    process.execPath,
    [SCRIPT_PATH, "--json", "--require-real", "--require-chat"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        MUAPI_BASE_URL: "https://api.muapi.ai",
        MUAPI_MODEL: "gpt-4o",
        ...envPatch,
      },
    }
  );

  return {
    status: child.status,
    report: JSON.parse(child.stdout),
    stderr: child.stderr,
  };
}
