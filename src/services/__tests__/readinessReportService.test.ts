import { describe, expect, it } from "vitest";
import {
  getAgenticReadinessHeadline,
  parseAgenticReadinessReportJson,
} from "@/services/readinessReportService";

describe("readinessReportService", () => {
  it("parses agentic readiness reports with blocked MuAPI state", () => {
    const report = parseAgenticReadinessReportJson(JSON.stringify({
      ok: false,
      releasable: true,
      checkedAt: "2026-07-06T03:55:10.229Z",
      includeBuild: false,
      allowBlocked: true,
      requireMuApi: false,
      summary: { passed: 6, failed: 0, blocked: 1 },
      steps: [
        { id: "tests", label: "Unit test suite", status: "passed" },
        {
          id: "muapi-real",
          label: "MuAPI real service verification",
          status: "blocked",
          detail: {
            reason: "Missing MUAPI_API_KEY",
            envChecks: [
              { id: "api-key", status: "failed" },
              { id: "chat-probe", status: "failed" },
            ],
            blockingEvidenceIds: ["configured", "remote-job-id"],
            evidenceChecklist: [{ id: "configured" }, { id: "remote-job-id" }],
            strictEvidenceReady: false,
            nextCommand: "npm run verify:muapi",
          },
        },
        {
          id: "brand-spec",
          label: "Brand template spec export",
          status: "passed",
          detail: {
            score: 100,
            deliverableCount: 1,
            acceptanceCriteriaCount: 1,
            templateCapabilityReady: true,
            templateCapabilityVariantCount: 3,
            templateCapabilityRequiredWorkflowNodes: ["promptNode", "imageGeneratorProNode"],
            templateCapabilityRequiredDeliverables: ["poster-image"],
            templateCapabilityCheckCount: 11,
            templateCapabilityChecksPassed: 11,
            templateCatalogTemplateCount: 5,
            templateCatalogReadyTemplateCount: 5,
            templateCatalogVariantCount: 15,
            templateCatalogWorkflowNodeTypes: [
              "imageGeneratorProNode",
              "pptAssemblerNode",
              "pptContentNode",
              "promptNode",
              "videoGeneratorNode",
            ],
            templateCatalogCheckCount: 2,
            templateCatalogChecksPassed: 2,
          },
        },
        {
          id: "brand-templates",
          label: "Brand template catalog verification",
          status: "passed",
          detail: {
            brandTemplateReportOk: true,
            brandTemplateRequiredKinds: ["social-image", "poster", "brand-board", "ppt", "video-cover"],
            brandTemplateTemplateCount: 5,
            brandTemplateTemplateIds: [
              "social-square-launch",
              "poster-vertical-campaign",
              "brand-board-starter",
              "ppt-business-deck",
              "video-cover-landscape",
            ],
            brandTemplateReadyTemplateIds: [
              "social-square-launch",
              "poster-vertical-campaign",
              "brand-board-starter",
              "ppt-business-deck",
              "video-cover-landscape",
            ],
            brandTemplateKindBreakdown: {
              "social-image": 1,
              poster: 1,
              "brand-board": 1,
              ppt: 1,
              "video-cover": 1,
            },
            brandTemplateKindCount: 5,
            brandTemplatePassedTemplates: 5,
            brandTemplateFailedTemplates: 0,
            brandTemplateVariantCount: 15,
            brandTemplateVariantIdsByTemplate: {
              "social-square-launch": ["balanced", "bold", "systematic"],
              "ppt-business-deck": ["balanced", "executive", "systematic"],
            },
            brandTemplateFailedVariantTemplates: 0,
            brandTemplateCapabilityTemplateCount: 5,
            brandTemplateReadyTemplateCount: 5,
            brandTemplateCapabilityVariantCount: 15,
            brandTemplatePassedChecks: 11,
            brandTemplateFailedChecks: 0,
            brandTemplateWorkflowNodeTypes: [
              "imageGeneratorProNode",
              "pptAssemblerNode",
              "pptContentNode",
              "promptNode",
              "videoGeneratorNode",
            ],
            brandTemplateWorkflowNodeTypesByTemplate: {
              "ppt-business-deck": ["promptNode", "pptContentNode", "pptAssemblerNode"],
            },
            brandTemplateDeliverableKinds: ["image", "project", "text", "video", "workflow"],
            brandTemplateDeliverableIdsByTemplate: {
              "ppt-business-deck": ["ppt-workflow", "pptx-file"],
            },
            brandTemplateOutputKinds: ["image", "video", "workflow"],
            brandTemplateCapabilityCheckIdsByTemplate: {
              "ppt-business-deck": ["required-deliverable", "ppt-nodes"],
            },
            brandTemplateMissingKinds: [],
            brandTemplateFailedTemplateIds: [],
            brandTemplateFailedVariantTemplateIds: [],
          },
        },
        {
          id: "local-bridge",
          label: "In-app Local Agent Bridge self-test",
          status: "passed",
          detail: {
            localBridgeReportOk: true,
            localBridgeToolCount: 6,
            localBridgeOperationCount: 15,
            localBridgeBrandTemplateCount: 5,
            localBridgeBrandTemplateReadyCount: 5,
            localBridgeBrandTemplateVariantCount: 15,
            localBridgeBrandSpecToolReady: true,
            localBridgeBrandTemplateToolReady: true,
            localBridgeFailedStepIds: [],
            localBridgeReadOnlyBrandTools: [
              "nextlemon.listBrandTemplates",
              "nextlemon.createBrandSpec",
            ],
            localBridgeWriteTools: ["nextlemon.requestApproval"],
          },
        },
        {
          id: "local-mcp",
          label: "Local MCP self-test",
          status: "passed",
          detail: {
            localMcpReportOk: true,
            localMcpTransportInputs: ["content-length", "newline-json"],
            localMcpToolCount: 11,
            localMcpToolNames: [
              "nextlemon.get_manifest",
              "nextlemon.list_canvas_agent_ops",
              "nextlemon.create_approval_request",
            ],
            localMcpApprovalToolNames: [
              "nextlemon.validate_approval_request",
              "nextlemon.create_approval_request",
            ],
            localMcpApprovalSchemaOneOfCount: 15,
            localMcpOperationCount: 15,
            localMcpOperationTypes: [
              "asset.add",
              "asset.update",
              "asset.delete",
              "canvas.addItem",
              "canvas.updateItem",
              "canvas.deleteItem",
              "canvas.moveItem",
              "canvas.selectItems",
              "canvas.setViewport",
              "workflow.addNode",
              "workflow.updateNode",
              "workflow.connectNodes",
              "workflow.runNode",
              "workflow.selectNodes",
              "library.saveWorkflowNode",
            ],
            localMcpOperationCategories: ["asset", "canvas", "library", "workflow"],
            localMcpOperationCategoryCounts: { asset: 3, canvas: 6, library: 1, workflow: 5 },
            localMcpOperationDrift: [],
            localMcpBrandTemplateCount: 5,
            localMcpBrandTemplateVariantCount: 15,
            localMcpBrandTemplateReadyCount: 5,
            localMcpMuApiEnvReady: false,
            localMcpMuApiRealEvidenceReady: false,
            localMcpReleaseStatus: "web-prerelease-ready",
            localMcpBlockerIds: ["muapi-env", "muapi-real-evidence", "strict-release"],
            localMcpApprovalRequestHash: "b".repeat(64),
            localMcpApprovalOpSummary: "asset.add 1",
            localMcpApprovalOperationTypes: ["asset.add"],
            localMcpApprovalWritesExecuteDirectly: false,
            localMcpApprovalImportRequired: true,
            localMcpApprovalRequiresUserApproval: true,
            localMcpApprovalAuditOk: true,
          },
        },
      ],
    }));

    expect(report.releasable).toBe(true);
    expect(report.summary.blocked).toBe(1);
    expect(report.steps[1].id).toBe("muapi-real");
    expect(report.steps[1].detailSummary?.reason).toBe("Missing MUAPI_API_KEY");
    expect(report.steps[1].detailSummary?.failedEnvKeys).toEqual(["api-key", "chat-probe"]);
    expect(report.steps[1].detailSummary?.blockingEvidenceIds).toEqual(["configured", "remote-job-id"]);
    expect(report.steps[1].detailSummary?.evidenceChecklistCount).toBe(2);
    expect(report.steps[1].detailSummary?.strictEvidenceReady).toBe(false);
    expect(report.steps[2].detailSummary?.brandSpecScore).toBe(100);
    expect(report.steps[2].detailSummary?.templateCapabilityReady).toBe(true);
    expect(report.steps[2].detailSummary?.templateCapabilityVariantCount).toBe(3);
    expect(report.steps[2].detailSummary?.templateCapabilityRequiredWorkflowNodes).toEqual(["promptNode", "imageGeneratorProNode"]);
    expect(report.steps[2].detailSummary?.templateCatalogTemplateCount).toBe(5);
    expect(report.steps[2].detailSummary?.templateCatalogReadyTemplateCount).toBe(5);
    expect(report.steps[2].detailSummary?.templateCatalogVariantCount).toBe(15);
    expect(report.steps[2].detailSummary?.templateCatalogWorkflowNodeTypes).toEqual([
      "imageGeneratorProNode",
      "pptAssemblerNode",
      "pptContentNode",
      "promptNode",
      "videoGeneratorNode",
    ]);
    expect(report.steps[3].detailSummary?.brandTemplateReportOk).toBe(true);
    expect(report.steps[3].detailSummary?.brandTemplateRequiredKinds).toEqual(["social-image", "poster", "brand-board", "ppt", "video-cover"]);
    expect(report.steps[3].detailSummary?.brandTemplateTemplateCount).toBe(5);
    expect(report.steps[3].detailSummary?.brandTemplateTemplateIds).toContain("ppt-business-deck");
    expect(report.steps[3].detailSummary?.brandTemplateReadyTemplateIds).toContain("video-cover-landscape");
    expect(report.steps[3].detailSummary?.brandTemplateKindBreakdown).toMatchObject({ ppt: 1, "video-cover": 1 });
    expect(report.steps[3].detailSummary?.brandTemplateKindCount).toBe(5);
    expect(report.steps[3].detailSummary?.brandTemplatePassedTemplates).toBe(5);
    expect(report.steps[3].detailSummary?.brandTemplateFailedTemplates).toBe(0);
    expect(report.steps[3].detailSummary?.brandTemplateVariantCount).toBe(15);
    expect(report.steps[3].detailSummary?.brandTemplateVariantIdsByTemplate["ppt-business-deck"]).toEqual([
      "balanced",
      "executive",
      "systematic",
    ]);
    expect(report.steps[3].detailSummary?.brandTemplateFailedVariantTemplates).toBe(0);
    expect(report.steps[3].detailSummary?.brandTemplateReadyTemplateCount).toBe(5);
    expect(report.steps[3].detailSummary?.brandTemplateCapabilityVariantCount).toBe(15);
    expect(report.steps[3].detailSummary?.brandTemplatePassedChecks).toBe(11);
    expect(report.steps[3].detailSummary?.brandTemplateFailedChecks).toBe(0);
    expect(report.steps[3].detailSummary?.brandTemplateWorkflowNodeTypes).toEqual([
      "imageGeneratorProNode",
      "pptAssemblerNode",
      "pptContentNode",
      "promptNode",
      "videoGeneratorNode",
    ]);
    expect(report.steps[3].detailSummary?.brandTemplateWorkflowNodeTypesByTemplate["ppt-business-deck"]).toEqual([
      "promptNode",
      "pptContentNode",
      "pptAssemblerNode",
    ]);
    expect(report.steps[3].detailSummary?.brandTemplateDeliverableKinds).toEqual(["image", "project", "text", "video", "workflow"]);
    expect(report.steps[3].detailSummary?.brandTemplateDeliverableIdsByTemplate["ppt-business-deck"]).toEqual([
      "ppt-workflow",
      "pptx-file",
    ]);
    expect(report.steps[3].detailSummary?.brandTemplateOutputKinds).toEqual(["image", "video", "workflow"]);
    expect(report.steps[3].detailSummary?.brandTemplateCapabilityCheckIdsByTemplate["ppt-business-deck"]).toEqual([
      "required-deliverable",
      "ppt-nodes",
    ]);
    expect(report.steps[4].detailSummary?.localBridgeReportOk).toBe(true);
    expect(report.steps[4].detailSummary?.localBridgeToolCount).toBe(6);
    expect(report.steps[4].detailSummary?.localBridgeOperationCount).toBe(15);
    expect(report.steps[4].detailSummary?.localBridgeBrandTemplateCount).toBe(5);
    expect(report.steps[4].detailSummary?.localBridgeBrandTemplateReadyCount).toBe(5);
    expect(report.steps[4].detailSummary?.localBridgeBrandTemplateVariantCount).toBe(15);
    expect(report.steps[4].detailSummary?.localBridgeBrandSpecToolReady).toBe(true);
    expect(report.steps[4].detailSummary?.localBridgeBrandTemplateToolReady).toBe(true);
    expect(report.steps[4].detailSummary?.localBridgeReadOnlyBrandTools).toEqual([
      "nextlemon.listBrandTemplates",
      "nextlemon.createBrandSpec",
    ]);
    expect(report.steps[4].detailSummary?.localBridgeWriteTools).toEqual(["nextlemon.requestApproval"]);
    expect(report.steps[5].detailSummary?.localMcpReportOk).toBe(true);
    expect(report.steps[5].detailSummary?.localMcpTransportInputs).toEqual(["content-length", "newline-json"]);
    expect(report.steps[5].detailSummary?.localMcpToolCount).toBe(11);
    expect(report.steps[5].detailSummary?.localMcpApprovalToolNames).toEqual([
      "nextlemon.validate_approval_request",
      "nextlemon.create_approval_request",
    ]);
    expect(report.steps[5].detailSummary?.localMcpApprovalSchemaOneOfCount).toBe(15);
    expect(report.steps[5].detailSummary?.localMcpOperationCount).toBe(15);
    expect(report.steps[5].detailSummary?.localMcpOperationTypes).toContain("workflow.connectNodes");
    expect(report.steps[5].detailSummary?.localMcpOperationCategories).toEqual(["asset", "canvas", "library", "workflow"]);
    expect(report.steps[5].detailSummary?.localMcpOperationCategoryCounts).toEqual({ asset: 3, canvas: 6, library: 1, workflow: 5 });
    expect(report.steps[5].detailSummary?.localMcpBrandTemplateCount).toBe(5);
    expect(report.steps[5].detailSummary?.localMcpBrandTemplateReadyCount).toBe(5);
    expect(report.steps[5].detailSummary?.localMcpBrandTemplateVariantCount).toBe(15);
    expect(report.steps[5].detailSummary?.localMcpMuApiEnvReady).toBe(false);
    expect(report.steps[5].detailSummary?.localMcpMuApiRealEvidenceReady).toBe(false);
    expect(report.steps[5].detailSummary?.localMcpReleaseStatus).toBe("web-prerelease-ready");
    expect(report.steps[5].detailSummary?.localMcpBlockerIds).toEqual(["muapi-env", "muapi-real-evidence", "strict-release"]);
    expect(report.steps[5].detailSummary?.localMcpApprovalRequestHash).toBe("b".repeat(64));
    expect(report.steps[5].detailSummary?.requestHash).toBe("b".repeat(64));
    expect(report.steps[5].detailSummary?.localMcpApprovalOpSummary).toBe("asset.add 1");
    expect(report.steps[5].detailSummary?.operationTypes).toEqual(["asset.add"]);
    expect(report.steps[5].detailSummary?.localMcpApprovalWritesExecuteDirectly).toBe(false);
    expect(report.steps[5].detailSummary?.localMcpApprovalImportRequired).toBe(true);
    expect(report.steps[5].detailSummary?.localMcpApprovalRequiresUserApproval).toBe(true);
    expect(report.steps[5].detailSummary?.localMcpApprovalAuditOk).toBe(true);
    expect(getAgenticReadinessHeadline(report)).toBe("存在阻塞项");
  });

  it("rejects invalid readiness reports", () => {
    expect(() => parseAgenticReadinessReportJson(JSON.stringify({ ok: true }))).toThrow("steps");
    expect(() => parseAgenticReadinessReportJson(JSON.stringify({
      steps: [{ id: "bad", status: "unknown" }],
    }))).toThrow("状态无效");
  });
});
