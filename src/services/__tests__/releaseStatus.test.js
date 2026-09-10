import { describe, expect, it } from "vitest";
import { buildReleaseStatus } from "../../../scripts/nextlemon-release-status.mjs";

describe("nextlemon release status", () => {
  it("keeps local prerelease ready while blocking strict release when the strict report is missing", () => {
    const status = buildReleaseStatus({
      checkedAt: "2026-07-06T00:00:00.000Z",
      localReport: readinessReport({ releasable: true, blocked: 1 }),
      strictReport: { exists: false, data: null },
      localMcpReport: {
        ok: true,
        toolCount: 10,
        operationCount: 15,
        operationTypes: operationTypes(),
        brandTemplateCount: 5,
        brandTemplateVariantCount: 15,
        brandTemplateReadyCount: 5,
        approvalSchemaOneOfCount: 15,
        operationCategories: ["asset", "canvas", "library", "workflow"],
        operationCategoryCounts: { asset: 3, canvas: 6, library: 1, workflow: 5 },
        operationDrift: [],
        releaseStatus: "web-prerelease-ready",
        blockerIds: ["muapi-env", "muapi-real-evidence", "strict-release"],
      },
      brandTemplateReport: { ok: true, summary: { templateCount: 5 } },
      muApiEnv: {
        ok: false,
        missingEnvKeys: ["MUAPI_API_KEY", "MUAPI_CHAT_PROBE"],
        failedEnvKeys: ["MUAPI_API_KEY", "MUAPI_CHAT_PROBE"],
      },
      realEvidence: {
        ok: false,
        errors: ["Report missing."],
        blockingEvidenceIds: ["report-readable"],
        evidenceChecklist: [{ id: "report-readable", status: "failed" }],
      },
    });

    expect(status.status).toBe("web-prerelease-ready");
    expect(status.ok).toBe(false);
    expect(status.blockers.map((blocker) => blocker.id)).toEqual(
      expect.arrayContaining(["muapi-env", "muapi-real-evidence", "strict-release"])
    );
    expect(status.localMcp.brandTemplateVariantCount).toBe(15);
    expect(status.localMcp.brandTemplateReadyCount).toBe(5);
    expect(status.localMcp.approvalSchemaOneOfCount).toBe(15);
    expect(status.localMcp.operationTypes).toContain("workflow.connectNodes");
    expect(status.localMcp.operationCategories).toEqual(["asset", "canvas", "library", "workflow"]);
    expect(status.localMcp.operationCategoryCounts).toEqual({ asset: 3, canvas: 6, library: 1, workflow: 5 });
    expect(status.localMcp.operationDrift).toEqual([]);
    expect(status.localMcp.blockerIds).toEqual(["muapi-env", "muapi-real-evidence", "strict-release"]);
    expect(status.muApi.failedEnvKeys).toEqual(expect.arrayContaining(["MUAPI_API_KEY", "MUAPI_CHAT_PROBE"]));
    expect(status.muApi.realEvidenceBlockingIds).toEqual(["report-readable"]);
    expect(status.muApi.realEvidenceChecklistCount).toBe(1);
    expect(status.blockers.find((blocker) => blocker.id === "muapi-env")?.failedEnvKeys).toEqual(
      expect.arrayContaining(["MUAPI_API_KEY", "MUAPI_CHAT_PROBE"])
    );
    expect(status.blockers.find((blocker) => blocker.id === "strict-release")?.message).toBe("Strict release report is missing.");
    expect(status.redaction.secretValuesReturned).toBe(false);
  });

  it("keeps current local MCP self-test overrides separate from stale release blockers", () => {
    const status = buildReleaseStatus({
      localReport: readinessReport({ releasable: true, blocked: 1 }),
      strictReport: readinessReport({ releasable: false, failed: 1, requireMuApi: true }),
      localMcpReport: {
        exists: true,
        data: {
          ok: true,
          toolCount: 10,
          operationCount: 15,
          operationTypes: operationTypes(),
          brandTemplateCount: 5,
          brandTemplateVariantCount: 15,
          brandTemplateReadyCount: 5,
          approvalSchemaOneOfCount: 15,
          operationCategories: ["asset", "canvas", "library", "workflow"],
          operationCategoryCounts: { asset: 3, canvas: 6, library: 1, workflow: 5 },
          operationDrift: [],
          releaseStatus: "web-prerelease-ready",
          blockerIds: ["muapi-env", "muapi-real-evidence", "strict-release"],
          reportOverrideApplied: true,
          reportOverrideReason: "current-local-mcp-self-test",
          source: "verify-local-mcp-in-progress",
        },
      },
      brandTemplateReport: { ok: true, summary: { templateCount: 5 } },
      muApiEnv: {
        ok: false,
        missingEnvKeys: ["MUAPI_API_KEY", "MUAPI_CHAT_PROBE"],
        failedEnvKeys: ["MUAPI_API_KEY", "MUAPI_CHAT_PROBE"],
      },
      realEvidence: {
        ok: false,
        errors: ["Report missing."],
        blockingEvidenceIds: ["report-readable"],
        evidenceChecklist: [{ id: "report-readable", status: "failed" }],
      },
    });

    expect(status.status).toBe("web-prerelease-ready");
    expect(status.localMcp.ok).toBe(true);
    expect(status.localMcp.brandTemplateReadyCount).toBe(5);
    expect(status.localMcp.reportOverrideApplied).toBe(true);
    expect(status.localMcp.reportOverrideReason).toBe("current-local-mcp-self-test");
    expect(status.localMcp.source).toBe("verify-local-mcp-in-progress");
    expect(status.localMcp.approvalSchemaOneOfCount).toBe(15);
    expect(status.localMcp.operationTypes).toContain("library.saveWorkflowNode");
    expect(status.localMcp.operationCategories).toEqual(["asset", "canvas", "library", "workflow"]);
    expect(status.localMcp.operationCategoryCounts).toEqual({ asset: 3, canvas: 6, library: 1, workflow: 5 });
    expect(status.localMcp.blockerIds).toEqual(["muapi-env", "muapi-real-evidence", "strict-release"]);
    expect(status.blockers.map((blocker) => blocker.id)).not.toContain("local-mcp");
    expect(status.blockers.map((blocker) => blocker.id)).toEqual(
      expect.arrayContaining(["muapi-env", "muapi-real-evidence", "strict-release"])
    );
    expect(status.muApi.realEvidenceBlockingIds).toEqual(["report-readable"]);
  });

  it("requires strict report and real MuAPI evidence before marking strict release ready", () => {
    const status = buildReleaseStatus({
      localReport: readinessReport({ releasable: true }),
      strictReport: readinessReport({ releasable: true, requireMuApi: true }),
      localMcpReport: {
        ok: true,
        toolCount: 10,
        operationCount: 15,
        operationTypes: operationTypes(),
        brandTemplateCount: 5,
        brandTemplateVariantCount: 15,
        brandTemplateReadyCount: 5,
        approvalSchemaOneOfCount: 15,
      },
      brandTemplateReport: { ok: true, summary: { templateCount: 5 } },
      muApiEnv: { ok: true, missingEnvKeys: [], failedEnvKeys: [], apiKeyConfigured: true, chatProbeConfigured: true },
      realEvidence: { ok: true, errors: [], endpointCount: 5, evidencePolicy: { mockReportsAccepted: false } },
    });

    expect(status.status).toBe("strict-release-ready");
    expect(status.ok).toBe(true);
    expect(status.blockers).toEqual([]);
    expect(status.muApi.realEvidenceReady).toBe(true);
    expect(status.muApi.failedEnvKeys).toEqual([]);
  });

  it("does not mark a build releasable when the local prerelease gate is failing", () => {
    const status = buildReleaseStatus({
      localReport: readinessReport({ releasable: false, failed: 1 }),
      strictReport: readinessReport({ releasable: false, failed: 1, requireMuApi: true }),
      localMcpReport: { ok: false, toolCount: 10 },
      brandTemplateReport: { ok: true, summary: { templateCount: 5 } },
      muApiEnv: { ok: false, missingEnvKeys: ["MUAPI_API_KEY"], failedEnvKeys: ["MUAPI_API_KEY"] },
      realEvidence: { ok: false, errors: ["Report missing."], blockingEvidenceIds: ["report-readable"] },
    });

    expect(status.status).toBe("not-releasable");
    expect(status.blockers.map((blocker) => blocker.id)).toContain("local-prerelease");
    expect(status.blockers.map((blocker) => blocker.id)).toContain("local-mcp");
  });

  it("ignores the local-prerelease blocker when the on-disk report is only self-tainted by a failed local-mcp step", () => {
    const taintedLocalReport = {
      ok: false,
      releasable: false,
      checkedAt: "2026-07-06T00:00:00.000Z",
      summary: { passed: 12, failed: 1, blocked: 1 },
      steps: [
        { id: "build", status: "passed" },
        { id: "tests", status: "passed" },
        { id: "muapi-real", status: "blocked" },
        { id: "local-mcp", status: "failed" },
      ],
    };

    const status = buildReleaseStatus({
      checkedAt: "2026-07-06T00:00:00.000Z",
      localReport: taintedLocalReport,
      strictReport: { exists: false, data: null },
      localMcpReport: {
        ok: true,
        releaseStatus: "web-prerelease-ready",
        blockerIds: ["muapi-env", "muapi-real-evidence", "strict-release"],
      },
      brandTemplateReport: { ok: true },
      muApiEnv: { ok: false, missingEnvKeys: ["MUAPI_API_KEY"], failedEnvKeys: ["MUAPI_API_KEY"] },
      realEvidence: { ok: false, errors: ["Report missing."] },
    });

    expect(status.status).toBe("web-prerelease-ready");
    expect(status.blockers.some((blocker) => blocker.id === "local-prerelease")).toBe(false);
  });

  it("still blocks local prerelease when the on-disk report has other failing steps", () => {
    const taintedLocalReport = {
      ok: false,
      releasable: false,
      checkedAt: "2026-07-06T00:00:00.000Z",
      summary: { passed: 11, failed: 2, blocked: 1 },
      steps: [
        { id: "build", status: "failed" },
        { id: "tests", status: "passed" },
        { id: "muapi-real", status: "blocked" },
        { id: "local-mcp", status: "failed" },
      ],
    };

    const status = buildReleaseStatus({
      checkedAt: "2026-07-06T00:00:00.000Z",
      localReport: taintedLocalReport,
      strictReport: { exists: false, data: null },
      localMcpReport: { ok: true },
      brandTemplateReport: { ok: true },
      muApiEnv: { ok: false, missingEnvKeys: ["MUAPI_API_KEY"], failedEnvKeys: ["MUAPI_API_KEY"] },
      realEvidence: { ok: false, errors: ["Report missing."] },
    });

    expect(status.status).toBe("not-releasable");
    expect(status.blockers.some((blocker) => blocker.id === "local-prerelease")).toBe(true);
  });

  it("treats the on-disk report as stale while the MCP self-check override is active", () => {
    const staleLocalReport = {
      ok: false,
      releasable: false,
      checkedAt: "2026-07-06T00:00:00.000Z",
      summary: { passed: 11, failed: 1, blocked: 1 },
      steps: [
        { id: "build", status: "failed" },
        { id: "tests", status: "passed" },
        { id: "muapi-real", status: "blocked" },
      ],
    };

    const status = buildReleaseStatus({
      checkedAt: "2026-07-06T00:00:00.000Z",
      localReport: staleLocalReport,
      strictReport: { exists: false, data: null },
      localMcpReport: {
        ok: true,
        releaseStatus: "web-prerelease-ready",
        blockerIds: ["muapi-env", "muapi-real-evidence", "strict-release"],
        reportOverrideApplied: true,
        source: "verify-local-mcp-in-progress",
      },
      brandTemplateReport: { ok: true },
      muApiEnv: { ok: false, missingEnvKeys: ["MUAPI_API_KEY"], failedEnvKeys: ["MUAPI_API_KEY"] },
      realEvidence: { ok: false, errors: ["Report missing."] },
    });

    expect(status.status).toBe("web-prerelease-ready");
    expect(status.blockers.some((blocker) => blocker.id === "local-prerelease")).toBe(false);
  });
});


function readinessReport({ releasable, failed = 0, blocked = 0, requireMuApi = false }) {
  return {
    ok: releasable && failed === 0 && blocked === 0,
    releasable,
    checkedAt: "2026-07-06T00:00:00.000Z",
    requireMuApi,
    summary: {
      passed: 12,
      failed,
      blocked,
    },
  };
}

function operationTypes() {
  return [
    "asset.add",
    "asset.delete",
    "asset.update",
    "canvas.addItem",
    "canvas.deleteItem",
    "canvas.moveItem",
    "canvas.selectItems",
    "canvas.setViewport",
    "canvas.updateItem",
    "library.saveWorkflowNode",
    "workflow.addNode",
    "workflow.connectNodes",
    "workflow.runNode",
    "workflow.selectNodes",
    "workflow.updateNode",
  ];
}
