#!/usr/bin/env node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const argv = process.argv.slice(2);
const root = process.cwd();
const releaseDir = path.join(root, "releases");
const reportPath = getArgValue("--report") || path.join("releases", "agentic-readiness-report.json");
const jsonOutput = argv.includes("--json");
const includeBuild = argv.includes("--include-build");
const allowBlocked = argv.includes("--allow-blocked");
const requireMuApi = argv.includes("--require-muapi");
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const requiredMuApiStepIds = ["config", "account", "skills", "session", "chat", "events"];
const requiredMuApiEndpointRules = [
  { id: "account", pattern: /^GET \/api\/v1\/account\/balance$/ },
  { id: "skills", pattern: /^GET \/api\/v1\/creative-agent\/agent-skills$/ },
  { id: "session", pattern: /^POST \/api\/v1\/creative-agent\/sessions$/ },
  { id: "chat", pattern: /^POST \/api\/v1\/creative-agent\/sessions\/[^/]+\/chat$/ },
  { id: "events", pattern: /^GET \/api\/v1\/creative-agent\/jobs\/[^/]+\/events$/ },
];

mkdirSync(releaseDir, { recursive: true });
loadEnvFiles();

const steps = [];

if (includeBuild) {
  steps.push(runCommandStep("build", "Production build", [npmCmd, ["run", "build"]]));
  steps.push(runCommandStep("web-package", "Web release package", [
    npmCmd,
    ["run", "release:web", "--", "--output", path.join("releases", "NextLemon-v0.0.7-web.zip")],
  ]));
}

steps.push(runCommandStep("tests", "Unit test suite", [npmCmd, ["test"]]));
steps.push(runBrandSpecStep());
steps.push(runBrandTemplatesStep());
steps.push(checkMuApiPreflightStep());
steps.push(runCommandStep("muapi-contract", "MuAPI mock contract verification", [
  npmCmd,
  ["run", "verify:muapi:mock", "--", "--json", "--report", path.join("releases", "muapi-mock-verification-report.json")],
]));
steps.push(runMuApiStep());
steps.push(runLocalBridgeStep());
steps.push(runLocalMcpStep());
steps.push(checkFileStep("docs-plan", "Agentic enhancement plan document", "docs/nextlemon-agentic-canvas-enhancement-plan.md"));
steps.push(checkFileStep("docs-verification", "Agent/MCP/MuAPI verification guide", "docs/agent-muapi-verification-guide.md"));
steps.push(checkFileStep("docs-release", "Release notes", "docs/release-v0.0.7.md"));
steps.push(checkFileStep("web-release", "Web release zip", "releases/NextLemon-v0.0.7-web.zip", { minBytes: 1_000_000 }));

const failed = steps.filter((step) => step.status === "failed");
const blocked = steps.filter((step) => step.status === "blocked");
const result = {
  ok: failed.length === 0 && blocked.length === 0,
  releasable: failed.length === 0 && (blocked.length === 0 || allowBlocked),
  checkedAt: new Date().toISOString(),
  includeBuild,
  allowBlocked,
  requireMuApi,
  summary: {
    passed: steps.filter((step) => step.status === "passed").length,
    failed: failed.length,
    blocked: blocked.length,
  },
  steps,
};

writeFileSync(path.resolve(root, reportPath), `${JSON.stringify(result, null, 2)}\n`);

if (jsonOutput) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(result.releasable ? "Agentic readiness checks completed." : "Agentic readiness checks did not pass.");
  console.log(`Report: ${reportPath}`);
  for (const step of steps) console.log(`${step.status.toUpperCase()} ${step.id}: ${step.label}`);
}

process.exit(result.releasable ? 0 : 1);

function runCommandStep(id, label, command) {
  const startedAt = Date.now();
  const [cmd, args] = command;
  const child = spawnSync(cmd, args, {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    shell: process.platform === "win32",
  });
  return {
    id,
    label,
    status: child.status === 0 ? "passed" : "failed",
    durationMs: Date.now() - startedAt,
    detail: {
      command: [cmd, ...args].join(" "),
      exitCode: child.status,
      error: child.error instanceof Error ? child.error.message : undefined,
      stdoutTail: tail(child.stdout),
      stderrTail: tail(child.stderr),
    },
  };
}

function runBrandSpecStep() {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "nextlemon-brand-readiness-"));
  const inputPath = path.join(tempDir, "brand-input.json");
  const outputPath = path.join(tempDir, "brand-spec.json");
  writeFileSync(inputPath, `${JSON.stringify(createBrandInput(), null, 2)}\n`);

  const step = runCommandStep("brand-spec", "Brand template spec export", [
    npmCmd,
    ["run", "brand:spec", "--", "--input", inputPath, "--output", outputPath],
  ]);
  if (step.status !== "passed") return step;

  const spec = safeJsonParse(readFileSync(outputPath, "utf8"));
  const deliverables = spec?.template?.deliverables;
  const criteria = spec?.template?.acceptanceCriteria;
  const capability = spec?.templateCapability;
  const capabilityChecks = Array.isArray(capability?.checks) ? capability.checks : [];
  const catalog = spec?.templateCatalog;
  const catalogWorkflowNodes = Array.isArray(catalog?.workflowNodeTypes) ? catalog.workflowNodeTypes : [];
  const catalogChecks = Array.isArray(catalog?.checks) ? catalog.checks : [];
  const capabilityOk =
    capability?.ready === true &&
    Array.isArray(capability?.requiredWorkflowNodeTypes) &&
    capability.requiredWorkflowNodeTypes.includes("promptNode") &&
    capability.requiredWorkflowNodeTypes.includes("imageGeneratorProNode") &&
    Array.isArray(capability?.requiredDeliverableIds) &&
    capability.requiredDeliverableIds.length > 0 &&
    capability?.variantCount === 3 &&
    capabilityChecks.length > 0 &&
    capabilityChecks.every((check) => check.status === "passed");
  const catalogOk =
    catalog?.templateCount === 5 &&
    catalog?.readyTemplateCount === 5 &&
    catalog?.variantCount === 15 &&
    Array.isArray(catalog?.missingKinds) &&
    catalog.missingKinds.length === 0 &&
    ["promptNode", "imageGeneratorProNode", "pptContentNode", "pptAssemblerNode", "videoGeneratorNode"].every((nodeType) =>
      catalogWorkflowNodes.includes(nodeType)
    ) &&
    catalogChecks.length > 0 &&
    catalogChecks.every((check) => check.status === "passed");
  const ok =
    spec?.validation?.score === 100 &&
    Array.isArray(deliverables) &&
    deliverables.length > 0 &&
    Array.isArray(criteria) &&
    criteria.length > 0 &&
    capabilityOk &&
    catalogOk;
  return {
    ...step,
    status: ok ? "passed" : "failed",
    detail: {
      ...step.detail,
      score: spec?.validation?.score,
      deliverableCount: Array.isArray(deliverables) ? deliverables.length : 0,
      acceptanceCriteriaCount: Array.isArray(criteria) ? criteria.length : 0,
      templateCapabilityReady: capability?.ready === true,
      templateCapabilityVariantCount: capability?.variantCount || 0,
      templateCapabilityRequiredWorkflowNodes: capability?.requiredWorkflowNodeTypes || [],
      templateCapabilityRequiredDeliverables: capability?.requiredDeliverableIds || [],
      templateCapabilityCheckCount: capabilityChecks.length,
      templateCapabilityChecksPassed: capabilityChecks.filter((check) => check.status === "passed").length,
      templateCatalogTemplateCount: catalog?.templateCount || 0,
      templateCatalogReadyTemplateCount: catalog?.readyTemplateCount || 0,
      templateCatalogVariantCount: catalog?.variantCount || 0,
      templateCatalogWorkflowNodeTypes: catalogWorkflowNodes,
      templateCatalogCheckCount: catalogChecks.length,
      templateCatalogChecksPassed: catalogChecks.filter((check) => check.status === "passed").length,
    },
  };
}

function runBrandTemplatesStep() {
  const reportRelativePath = path.join("releases", "brand-template-verification-report.json");
  const step = runCommandStep("brand-templates", "Brand template catalog verification", [
    npmCmd,
    ["run", "verify:brand:templates", "--", "--json", "--report", reportRelativePath],
  ]);
  const report = safeJsonParse(readIfExists(path.join(root, reportRelativePath)) || step.detail.stdoutTail);
  const summary = report?.summary || {};
  const capabilityMatrix = report?.capabilityMatrix || {};
  const templates = Array.isArray(report?.templates) ? report.templates : [];
  const failedTemplateIds = templates.filter((template) => template?.ok !== true).map((template) => template?.id).filter(Boolean);
  const failedVariantTemplateIds = templates
    .filter((template) => template?.detail?.variantOk !== true)
    .map((template) => template?.id)
    .filter(Boolean);
  const requiredKinds = Array.isArray(report?.requiredKinds) ? report.requiredKinds.filter(Boolean) : [];
  const missingKinds = Array.isArray(capabilityMatrix?.missingKinds) ? capabilityMatrix.missingKinds.filter(Boolean) : [];
  const workflowNodeTypes = Array.isArray(capabilityMatrix?.workflowNodeTypes) ? capabilityMatrix.workflowNodeTypes.filter(Boolean) : [];
  const deliverableKinds = Array.isArray(capabilityMatrix?.deliverableKinds) ? capabilityMatrix.deliverableKinds.filter(Boolean) : [];
  const outputKinds = Array.isArray(capabilityMatrix?.outputKinds) ? capabilityMatrix.outputKinds.filter(Boolean) : [];
  const templateIds = getStringArray(summary.templateIds).length > 0
    ? getStringArray(summary.templateIds)
    : templates.map((template) => template?.id).filter(Boolean);
  const readyTemplateIds = getStringArray(summary.readyTemplateIds).length > 0
    ? getStringArray(summary.readyTemplateIds)
    : Array.isArray(capabilityMatrix?.templates)
      ? capabilityMatrix.templates.filter((template) => template?.ready === true).map((template) => template.id).filter(Boolean)
      : [];
  const kindBreakdown = getNumberRecord(summary.kindBreakdown);
  const variantIdsByTemplate = Object.keys(getStringArrayRecord(summary.variantIdsByTemplate)).length > 0
    ? getStringArrayRecord(summary.variantIdsByTemplate)
    : Object.fromEntries(templates.map((template) => [template?.id, getStringArray(template?.detail?.variantIds)]).filter(([id]) => Boolean(id)));
  const workflowNodeTypesByTemplate = getStringArrayRecord(summary.workflowNodeTypesByTemplate);
  const deliverableIdsByTemplate = getStringArrayRecord(summary.deliverableIdsByTemplate);
  const capabilityCheckIdsByTemplate = getStringArrayRecord(summary.capabilityCheckIdsByTemplate);
  const allTemplatesHaveThreeVariants =
    templateIds.length === 5 &&
    templateIds.every((id) => Array.isArray(variantIdsByTemplate[id]) && variantIdsByTemplate[id].length === 3);
  const ok =
    step.status === "passed" &&
    report?.ok === true &&
    summary.templateCount === 5 &&
    templateIds.length === 5 &&
    readyTemplateIds.length === 5 &&
    summary.kindCount === 5 &&
    summary.passedTemplates === 5 &&
    summary.failedTemplates === 0 &&
    summary.variantCount === 15 &&
    allTemplatesHaveThreeVariants &&
    summary.failedVariantTemplates === 0 &&
    summary.readyTemplateCount === 5 &&
    summary.capabilityVariantCount === 15 &&
    summary.failedChecks === 0 &&
    requiredKinds.length === 5 &&
    missingKinds.length === 0 &&
    failedTemplateIds.length === 0 &&
    failedVariantTemplateIds.length === 0 &&
    ["promptNode", "imageGeneratorProNode", "pptContentNode", "pptAssemblerNode", "videoGeneratorNode"].every((nodeType) =>
      workflowNodeTypes.includes(nodeType)
    );

  return {
    ...step,
    status: ok ? "passed" : "failed",
    detail: {
      ...step.detail,
      reportPath: reportRelativePath,
      brandTemplateReportOk: report?.ok === true,
      brandTemplateRequiredKinds: requiredKinds,
      brandTemplateTemplateCount: summary.templateCount || 0,
      brandTemplateTemplateIds: templateIds,
      brandTemplateReadyTemplateIds: readyTemplateIds,
      brandTemplateKindBreakdown: kindBreakdown,
      brandTemplateKindCount: summary.kindCount || 0,
      brandTemplatePassedTemplates: summary.passedTemplates || 0,
      brandTemplateFailedTemplates: summary.failedTemplates || 0,
      brandTemplateVariantCount: summary.variantCount || 0,
      brandTemplateVariantIdsByTemplate: variantIdsByTemplate,
      brandTemplateFailedVariantTemplates: summary.failedVariantTemplates || 0,
      brandTemplateCapabilityTemplateCount: summary.capabilityTemplateCount || 0,
      brandTemplateReadyTemplateCount: summary.readyTemplateCount || 0,
      brandTemplateCapabilityVariantCount: summary.capabilityVariantCount || 0,
      brandTemplatePassedChecks: summary.passedChecks || 0,
      brandTemplateFailedChecks: summary.failedChecks || 0,
      brandTemplateWorkflowNodeTypes: workflowNodeTypes,
      brandTemplateWorkflowNodeTypesByTemplate: workflowNodeTypesByTemplate,
      brandTemplateDeliverableKinds: deliverableKinds,
      brandTemplateDeliverableIdsByTemplate: deliverableIdsByTemplate,
      brandTemplateOutputKinds: outputKinds,
      brandTemplateCapabilityCheckIdsByTemplate: capabilityCheckIdsByTemplate,
      brandTemplateMissingKinds: missingKinds,
      brandTemplateFailedTemplateIds: failedTemplateIds,
      brandTemplateFailedVariantTemplateIds: failedVariantTemplateIds,
    },
  };
}

function runMuApiStep() {
  const envStep = runCommandStep("muapi-env", "MuAPI real verification environment", [
    npmCmd,
    ["run", "verify:muapi:env", "--", "--json", "--require-real", "--require-chat", "--report", path.join("releases", "muapi-env-report.json")],
  ]);
  const envReport = safeJsonParse(readIfExists(path.join(releaseDir, "muapi-env-report.json")) || envStep.detail.stdoutTail);
  const hasApiKey = Boolean((process.env.MUAPI_API_KEY || "").trim());
  if (!hasApiKey) {
    const report = attachMuApiStrictEvidence({
      ok: false,
      checkedAt: new Date().toISOString(),
      baseUrl: normalizeBaseUrl(process.env.MUAPI_BASE_URL || "https://api.muapi.ai"),
      model: (process.env.MUAPI_MODEL || "gpt-4o").trim(),
      realService: false,
      requireChat: true,
      chatProbeConfigured: Boolean((process.env.MUAPI_CHAT_PROBE || "").trim()),
      redaction: {
        secretValuesReturned: false,
        redactedKeys: ["MUAPI_API_KEY", "MUAPI_CHAT_PROBE", "x-api-key"],
        note: "API key values and chat probe text are not written to readiness reports.",
      },
      envReportPath: "releases/muapi-env-report.json",
      envReport,
      steps: [
        {
          id: "config",
          label: "Configuration",
          status: "failed",
          durationMs: 0,
          error: "Missing MUAPI_API_KEY. Real MuAPI verification is blocked.",
        },
      ],
      endpointLog: [],
    });
    writeFileSync(path.join(releaseDir, "muapi-missing-key-report.json"), `${JSON.stringify(report, null, 2)}\n`);
    return {
      id: "muapi-real",
      label: "MuAPI real service verification",
      status: requireMuApi ? "failed" : "blocked",
      durationMs: 0,
      detail: {
        reportPath: "releases/muapi-missing-key-report.json",
        envReportPath: "releases/muapi-env-report.json",
        envStatus: envStep.status,
        envChecks: summarizeEnvChecks(envReport),
        reason: "Missing MUAPI_API_KEY",
        nextPreflightCommand: "npm run verify:muapi:env -- --json --require-real --require-chat",
        nextCommand: "npm run verify:muapi -- --json --require-chat --report releases\\muapi-real-verification-report.json",
      },
    };
  }

  if (envStep.status !== "passed") {
    return {
      id: "muapi-real",
      label: "MuAPI real service verification",
      status: "failed",
      durationMs: envStep.durationMs,
      detail: {
        envReportPath: "releases/muapi-env-report.json",
        envStatus: envStep.status,
        envChecks: summarizeEnvChecks(envReport),
        reason: "MuAPI real verification environment is not ready.",
        envStep,
      },
    };
  }

  const step = runCommandStep("muapi-real", "MuAPI real service verification", [
    npmCmd,
    ["run", "verify:muapi", "--", "--json", "--require-chat", "--report", path.join("releases", "muapi-real-verification-report.json")],
  ]);
  if (step.status !== "passed") return step;

  const assertion = runCommandStep("muapi-real-assert", "MuAPI real evidence assertion", [
    npmCmd,
    ["run", "verify:muapi:assert-real", "--", "--json", "--report", path.join("releases", "muapi-real-verification-report.json")],
  ]);
  const report = safeJsonParse(readFileSync(path.join(releaseDir, "muapi-real-verification-report.json"), "utf8"));
  const assertionReport = safeJsonFromStdout(assertion.detail.stdoutTail);
  const ok =
    report?.ok === true &&
    report?.realService === true &&
    Array.isArray(report?.endpointLog) &&
    report.endpointLog.length > 0 &&
    assertion.status === "passed";
  return {
    ...step,
    status: ok ? "passed" : "failed",
    detail: {
      ...step.detail,
      envReportPath: "releases/muapi-env-report.json",
      envChecks: summarizeEnvChecks(envReport),
      assertion,
      assertionReport,
      remoteSessionId: report?.remoteSessionId,
      remoteJobId: report?.remoteJobId,
      endpointCount: Array.isArray(report?.endpointLog) ? report.endpointLog.length : 0,
    },
  };
}

function runLocalBridgeStep() {
  const reportRelativePath = path.join("releases", "local-agent-bridge-verification-report.json");
  const step = runCommandStep("local-bridge", "In-app Local Agent Bridge self-test", [
    npmCmd,
    ["run", "verify:local-bridge", "--", "--json", "--report", reportRelativePath],
  ]);
  const report = safeJsonParse(readIfExists(path.join(root, reportRelativePath)) || step.detail.stdoutTail);
  const toolCatalogDetail = getStepDetail(report, "tool-catalog");
  const brandBridgeDetail = getStepDetail(report, "brand-bridge");
  const writeSafetyDetail = getStepDetail(report, "write-safety");
  const failedStepIds = Array.isArray(report?.failedStepIds) ? report.failedStepIds.filter(Boolean) : [];
  const ok =
    step.status === "passed" &&
    report?.ok === true &&
    report?.toolCount === 6 &&
    report?.operationCount === 15 &&
    report?.brandTemplateCount === 5 &&
    report?.brandTemplateReadyCount === 5 &&
    report?.brandTemplateVariantCount === 15 &&
    report?.brandSpecToolReady === true &&
    report?.brandTemplateToolReady === true &&
    failedStepIds.length === 0 &&
    Array.isArray(writeSafetyDetail?.writeTools) &&
    writeSafetyDetail.writeTools.length === 1 &&
    writeSafetyDetail.writeTools[0] === "nextlemon.requestApproval";

  return {
    ...step,
    status: ok ? "passed" : "failed",
    detail: {
      ...step.detail,
      reportPath: reportRelativePath,
      localBridgeReportOk: report?.ok === true,
      localBridgeToolCount: report?.toolCount || 0,
      localBridgeOperationCount: report?.operationCount || 0,
      localBridgeBrandTemplateCount: report?.brandTemplateCount || 0,
      localBridgeBrandTemplateReadyCount: report?.brandTemplateReadyCount || 0,
      localBridgeBrandTemplateVariantCount: report?.brandTemplateVariantCount || 0,
      localBridgeBrandSpecToolReady: report?.brandSpecToolReady === true,
      localBridgeBrandTemplateToolReady: report?.brandTemplateToolReady === true,
      localBridgeFailedStepIds: failedStepIds,
      localBridgeReadOnlyBrandTools: Array.isArray(brandBridgeDetail?.readOnlyBrandTools)
        ? brandBridgeDetail.readOnlyBrandTools
        : Array.isArray(toolCatalogDetail?.readOnlyBrandTools)
          ? toolCatalogDetail.readOnlyBrandTools
          : [],
      localBridgeWriteTools: Array.isArray(writeSafetyDetail?.writeTools)
        ? writeSafetyDetail.writeTools
        : Array.isArray(toolCatalogDetail?.writeTools)
          ? toolCatalogDetail.writeTools
          : [],
    },
  };
}

function runLocalMcpStep() {
  const reportRelativePath = path.join("releases", "local-mcp-verification-report.json");
  const step = runCommandStep("local-mcp", "Local MCP self-test", [
    npmCmd,
    ["run", "verify:mcp", "--", "--json", "--report", reportRelativePath],
  ]);
  const report = safeJsonParse(readIfExists(path.join(root, reportRelativePath)) || step.detail.stdoutTail);
  const toolsDetail = getStepDetail(report, "tools");
  const opsDetail = getStepDetail(report, "ops");
  const approvalDetail = getStepDetail(report, "approval");
  const releaseStatusDetail = getStepDetail(report, "release-status");
  const approvalToolSchemas = Array.isArray(toolsDetail?.approvalToolSchemas) ? toolsDetail.approvalToolSchemas : [];
  const approvalToolNames = approvalToolSchemas.map((schema) => schema?.name).filter(Boolean);
  const approvalSchemaOneOfCounts = approvalToolSchemas
    .map((schema) => schema?.oneOfCount)
    .filter((count) => typeof count === "number");
  const approvalSchemaOneOfCount = approvalSchemaOneOfCounts.length > 0
    ? Math.min(...approvalSchemaOneOfCounts)
    : 0;
  const approvalPolicy = approvalDetail?.approvalPolicy || {};
  const operationDrift = Array.isArray(opsDetail?.drift) ? opsDetail.drift.filter(Boolean) : [];
  const operationTypes = getStringArray(opsDetail?.operationTypes).length > 0
    ? getStringArray(opsDetail.operationTypes)
    : getStringArray(report?.operationTypes);
  const operationCategoryCounts = Object.keys(getNumberRecord(opsDetail?.categoryCounts)).length > 0
    ? getNumberRecord(opsDetail.categoryCounts)
    : getNumberRecord(report?.operationCategoryCounts);
  const blockerIds = Array.isArray(releaseStatusDetail?.blockerIds) ? releaseStatusDetail.blockerIds.filter(Boolean) : [];
  const ok =
    step.status === "passed" &&
    report?.ok === true &&
    report?.toolCount === 11 &&
    report?.operationCount === 15 &&
    report?.brandTemplateCount === 5 &&
    report?.brandTemplateReadyCount === 5 &&
    report?.brandTemplateVariantCount === 15 &&
    report?.muApiEnvReady === false &&
    report?.muApiRealEvidenceReady === false &&
    report?.releaseStatus === "web-prerelease-ready" &&
    approvalToolSchemas.length === 2 &&
    approvalToolSchemas.every((schema) => schema?.oneOfCount === 15 && schema?.minItems === 1) &&
    opsDetail?.approvalRequestSchemaOneOfCount === 15 &&
    opsDetail?.operationSchemaOneOfCount === 15 &&
    operationDrift.length === 0 &&
    operationTypes.length === 15 &&
    Object.values(operationCategoryCounts).reduce((sum, count) => sum + count, 0) === 15 &&
    approvalDetail?.approvalAuditOk === true &&
    approvalDetail?.requestHashOk === true &&
    typeof approvalDetail?.requestHash === "string" &&
    /^[a-f0-9]{64}$/.test(approvalDetail.requestHash) &&
    approvalPolicy.writesExecuteDirectly === false &&
    approvalPolicy.approvalImportRequired === true &&
    approvalPolicy.requiresUserApproval === true &&
    blockerIds.includes("muapi-env") &&
    blockerIds.includes("muapi-real-evidence") &&
    blockerIds.includes("strict-release") &&
    !blockerIds.includes("local-mcp");

  return {
    ...step,
    status: ok ? "passed" : "failed",
    detail: {
      ...step.detail,
      reportPath: reportRelativePath,
      localMcpReportOk: report?.ok === true,
      localMcpTransportInputs: Array.isArray(report?.transportInputs) ? report.transportInputs : [],
      localMcpToolCount: report?.toolCount || 0,
      localMcpToolNames: Array.isArray(toolsDetail?.toolNames) ? toolsDetail.toolNames : [],
      localMcpApprovalToolNames: approvalToolNames,
      localMcpApprovalSchemaOneOfCount: approvalSchemaOneOfCount,
      localMcpOperationCount: report?.operationCount || 0,
      localMcpOperationTypes: operationTypes,
      localMcpOperationCategories: Array.isArray(opsDetail?.categories) ? opsDetail.categories : [],
      localMcpOperationCategoryCounts: operationCategoryCounts,
      localMcpOperationDrift: operationDrift,
      localMcpBrandTemplateCount: report?.brandTemplateCount || 0,
      localMcpBrandTemplateVariantCount: report?.brandTemplateVariantCount || 0,
      localMcpBrandTemplateReadyCount: report?.brandTemplateReadyCount || 0,
      localMcpMuApiEnvReady: report?.muApiEnvReady === true,
      localMcpMuApiRealEvidenceReady: report?.muApiRealEvidenceReady === true,
      localMcpReleaseStatus: typeof report?.releaseStatus === "string" ? report.releaseStatus : "",
      localMcpBlockerIds: blockerIds,
      localMcpApprovalRequestHash: typeof approvalDetail?.requestHash === "string" ? approvalDetail.requestHash : "",
      localMcpApprovalOpSummary: typeof approvalDetail?.opSummary === "string" ? approvalDetail.opSummary : "",
      localMcpApprovalOperationTypes: Array.isArray(approvalDetail?.operationTypes) ? approvalDetail.operationTypes : [],
      localMcpApprovalWritesExecuteDirectly: approvalPolicy.writesExecuteDirectly === true,
      localMcpApprovalImportRequired: approvalPolicy.approvalImportRequired === true,
      localMcpApprovalRequiresUserApproval: approvalPolicy.requiresUserApproval === true,
      localMcpApprovalAuditOk: approvalDetail?.approvalAuditOk === true,
      requestHash: typeof approvalDetail?.requestHash === "string" ? approvalDetail.requestHash : undefined,
      opSummary: typeof approvalDetail?.opSummary === "string" ? approvalDetail.opSummary : undefined,
      operationTypes: Array.isArray(approvalDetail?.operationTypes) ? approvalDetail.operationTypes : [],
    },
  };
}

function checkFileStep(id, label, relativePath, options = {}) {
  const absolutePath = path.join(root, relativePath);
  const exists = existsSync(absolutePath);
  const size = exists ? statSync(absolutePath).size : 0;
  const ok = exists && size >= (options.minBytes || 1);
  return {
    id,
    label,
    status: ok ? "passed" : "failed",
    durationMs: 0,
    detail: {
      path: relativePath,
      size,
      minBytes: options.minBytes || 1,
      sha256: exists && options.sha256 !== false ? hashFile(absolutePath) : undefined,
    },
  };
}

function summarizeEnvChecks(envReport) {
  if (!envReport || !Array.isArray(envReport.checks)) return [];
  return envReport.checks.map((check) => ({
    id: check.id,
    status: check.status,
    error: check.error,
  }));
}

function checkMuApiPreflightStep() {
  const envExamplePath = path.join(root, ".env.example");
  const gitignorePath = path.join(root, ".gitignore");
  const envExample = existsSync(envExamplePath) ? readFileSync(envExamplePath, "utf8") : "";
  const gitignore = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf8") : "";
  const requiredEnvKeys = [
    "MUAPI_BASE_URL",
    "MUAPI_API_KEY",
    "MUAPI_MODEL",
    "MUAPI_CHAT_PROBE",
    "MUAPI_REQUIRE_CHAT",
    "MUAPI_VERIFY_REPORT",
    "MUAPI_ENV_REPORT",
  ];
  const missingEnvKeys = requiredEnvKeys.filter((key) => !new RegExp(`^${key}=`, "m").test(envExample));
  const protectsLocalEnv = /^\.env\.local$/m.test(gitignore) || /^\*\.local$/m.test(gitignore);
  const ok = envExample.length > 0 && missingEnvKeys.length === 0 && protectsLocalEnv;
  return {
    id: "muapi-preflight",
    label: "MuAPI env template and secret hygiene",
    status: ok ? "passed" : "failed",
    durationMs: 0,
    detail: {
      envExamplePath: ".env.example",
      requiredEnvKeys,
      missingEnvKeys,
      gitignoreProtectsEnvLocal: protectsLocalEnv,
      envLocalExists: existsSync(path.join(root, ".env.local")),
    },
  };
}

function createBrandInput() {
  return {
    brandKit: {
      id: "brand-readiness",
      name: "NextLemon Readiness",
      colors: ["#111827", "#22c55e"],
      fonts: { heading: "Inter", body: "Inter" },
      tone: "professional",
      logoAssetId: "logo",
      referenceAssetIds: ["ref"],
    },
    assets: [
      { id: "logo", kind: "image", title: "Logo" },
      { id: "ref", kind: "image", title: "Reference" },
    ],
    template: {
      id: "poster-readiness",
      kind: "poster",
      planKind: "image",
      name: "Readiness Poster",
      outputKind: "image",
      aspectRatio: "3:4",
      deliverables: [
        {
          id: "poster-image",
          title: "竖版海报",
          kind: "image",
          required: true,
          description: "可直接复用的 3:4 海报图。",
        },
      ],
      recommendedWorkflowNodes: [
        {
          nodeType: "promptNode",
          label: "海报提示词",
          required: true,
          purpose: "沉淀海报主题、品牌和版式约束。",
        },
        {
          nodeType: "imageGeneratorProNode",
          label: "海报生成",
          required: true,
          purpose: "输出 3:4 竖版海报。",
        },
      ],
      acceptanceCriteria: ["标题、主体、底部信息区层级清楚"],
      promptGuidance: ["保持层级清晰"],
      tags: ["poster"],
      modelHint: "gemini-3-pro-image-preview",
    },
  };
}

function loadEnvFiles() {
  for (const fileName of [".env.local", ".env"]) {
    const filePath = path.join(root, fileName);
    if (!existsSync(filePath)) continue;
    const content = readFileSync(filePath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const [key, ...rest] = trimmed.split("=");
      if (!key || process.env[key] !== undefined) continue;
      process.env[key] = rest.join("=").replace(/^['"]|['"]$/g, "");
    }
  }
}

function normalizeBaseUrl(value) {
  return value.trim().replace(/\/+$/, "");
}

function attachMuApiStrictEvidence(report) {
  const steps = Array.isArray(report.steps) ? report.steps : [];
  const endpointLog = Array.isArray(report.endpointLog) ? report.endpointLog : [];
  const stepEvidence = Object.fromEntries(
    requiredMuApiStepIds.map((id) => {
      const step = steps.find((item) => item && item.id === id);
      return [
        id,
        {
          seen: Boolean(step),
          passed: step?.status === "passed",
          status: step?.status,
        },
      ];
    })
  );
  const endpointEvidence = Object.fromEntries(
    requiredMuApiEndpointRules.map((rule) => {
      const matches = endpointLog.filter((entry) => rule.pattern.test(`${entry.method || "GET"} ${entry.path || ""}`));
      return [
        rule.id,
        {
          seen: matches.length > 0,
          has2xx: matches.some((entry) => isSuccessStatus(entry.status)),
          count: matches.length,
          statuses: [...new Set(matches.map((entry) => entry.status).filter((status) => status !== undefined))],
        },
      ];
    })
  );
  const evidenceChecklist = [
    muApiEvidenceItem("report-ok", "Verification report succeeded", report.ok === true, { value: report.ok }),
    muApiEvidenceItem("configured", "MuAPI API key was configured for verification", report.configured === true, {
      value: report.configured,
    }),
    muApiEvidenceItem("real-service", "Verification reached a MuAPI-compatible service", report.realService === true, {
      value: report.realService,
    }),
    muApiEvidenceItem("non-localhost-base-url", "Base URL is not localhost", !isLocalhostUrl(report.baseUrl), {
      baseUrl: report.baseUrl,
    }),
    muApiEvidenceItem("remote-session-id", "Remote session id is present", Boolean(report.remoteSessionId), {
      present: Boolean(report.remoteSessionId),
    }),
    muApiEvidenceItem("remote-job-id", "Remote job id is present for strict chat verification", Boolean(report.remoteJobId), {
      present: Boolean(report.remoteJobId),
    }),
    muApiEvidenceItem("redaction", "Report contains no secret values", report.redaction?.secretValuesReturned === false, {
      secretValuesReturned: report.redaction?.secretValuesReturned,
    }),
  ];

  for (const id of requiredMuApiStepIds) {
    const evidence = stepEvidence[id] || { seen: false, passed: false, status: undefined };
    evidenceChecklist.push(
      muApiEvidenceItem(`step-${id}`, `Required step ${id} passed`, evidence.seen === true && evidence.passed === true, {
        seen: evidence.seen,
        status: evidence.status,
      })
    );
  }

  for (const rule of requiredMuApiEndpointRules) {
    const evidence = endpointEvidence[rule.id] || { seen: false, has2xx: false, count: 0, statuses: [] };
    evidenceChecklist.push(
      muApiEvidenceItem(`endpoint-${rule.id}`, `Endpoint ${rule.id} has 2xx evidence`, evidence.seen === true && evidence.has2xx === true, {
        seen: evidence.seen,
        has2xx: evidence.has2xx,
        count: evidence.count,
        statuses: evidence.statuses,
      })
    );
  }

  return {
    ...report,
    strictEvidenceReady: evidenceChecklist.every((item) => item.status === "passed"),
    stepEvidence,
    missingStepIds: Object.entries(stepEvidence)
      .filter(([, evidence]) => evidence.seen !== true)
      .map(([id]) => id),
    failedStepIds: Object.entries(stepEvidence)
      .filter(([, evidence]) => evidence.seen === true && evidence.passed !== true)
      .map(([id]) => id),
    endpointEvidence,
    missingEndpointIds: Object.entries(endpointEvidence)
      .filter(([, evidence]) => evidence.seen !== true)
      .map(([id]) => id),
    failedEndpoint2xxIds: Object.entries(endpointEvidence)
      .filter(([, evidence]) => evidence.seen === true && evidence.has2xx !== true)
      .map(([id]) => id),
    evidenceChecklist,
    blockingEvidenceIds: evidenceChecklist.filter((item) => item.status !== "passed").map((item) => item.id),
  };
}

function muApiEvidenceItem(id, label, passed, evidence) {
  return {
    id,
    label,
    required: true,
    status: passed ? "passed" : "failed",
    evidence,
  };
}

function isLocalhostUrl(value) {
  if (typeof value !== "string" || !value.trim()) return true;
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return true;
  }
}

function isSuccessStatus(value) {
  return typeof value === "number" && value >= 200 && value < 300;
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function readIfExists(filePath) {
  return existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
}

function safeJsonFromStdout(value) {
  const text = String(value || "").trim();
  const start = text.indexOf("{");
  if (start < 0) return null;
  return safeJsonParse(text.slice(start));
}

function getStepDetail(report, stepId) {
  if (!report || !Array.isArray(report.steps)) return null;
  const step = report.steps.find((item) => item && item.id === stepId);
  return step && typeof step.detail === "object" && !Array.isArray(step.detail) ? step.detail : null;
}

function getStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()) : [];
}

function getStringArrayRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, items]) => [key, getStringArray(items)])
      .filter(([key, items]) => typeof key === "string" && key.trim() && items.length > 0)
  );
}

function getNumberRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, count]) => typeof key === "string" && key.trim() && Number.isFinite(count))
      .map(([key, count]) => [key, count])
  );
}

function tail(value, max = 1600) {
  const text = String(value || "").trim();
  return text.length > max ? text.slice(-max) : text;
}

function hashFile(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function getArgValue(name) {
  const exact = argv.find((item) => item.startsWith(`${name}=`));
  if (exact) return exact.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || "" : "";
}
