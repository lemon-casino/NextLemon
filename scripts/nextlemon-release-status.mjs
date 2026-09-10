export function buildReleaseStatus(input) {
  const localReportPath = input.paths?.localReportPath || "releases/agentic-readiness-report.json";
  const strictReportPath = input.paths?.strictReportPath || "releases/agentic-readiness-strict-report.json";
  const localMcpReportPath = input.paths?.localMcpReportPath || "releases/local-mcp-verification-report.json";
  const brandTemplateReportPath = input.paths?.brandTemplateReportPath || "releases/brand-template-verification-report.json";
  const realReportPath = input.paths?.realReportPath || "releases/muapi-real-verification-report.json";
  const localReport = normalizeReport(input.localReport);
  const strictReport = normalizeReport(input.strictReport);
  const localMcpReport = normalizeReport(input.localMcpReport);
  const brandTemplateReport = normalizeReport(input.brandTemplateReport);
  const muApiEnv = input.muApiEnv || { ok: false, missingEnvKeys: [], failedEnvKeys: [] };
  const realEvidence = input.realEvidence || { ok: false, errors: ["MuAPI real-service evidence is missing."] };
  const localMcpSummary = summarizeLocalMcpReport(localMcpReport.data);
  // readiness 流水线运行中，MCP 自检读取的磁盘报告必然是上一轮的产物：
  // 只要自检传入了 currentLocalMcpReport 覆盖（reportOverrideApplied），
  // 或磁盘报告恰好只被 local-mcp 步骤自身污染，就不能据旧报告判 local-prerelease 阻塞。
  // MCP 的真实健康度由 verify-agentic-readiness 基于本轮全新 MCP 报告独立校验，不依赖此处。
  const inSelfCheck = localMcpReport.data?.reportOverrideApplied === true;
  const localPrereleaseOk =
    localReport.data?.releasable === true ||
    inSelfCheck ||
    isSelfTaintedByLocalMcpOnly(localReport.data);
  const blockers = [];

  if (!localPrereleaseOk) {
    blockers.push({
      id: "local-prerelease",
      severity: "error",
      message: localReport.exists ? "Local prerelease report is not releasable." : "Local prerelease report is missing.",
    });
  }

  if (!localMcpReport.exists || localMcpReport.data?.ok !== true) {
    blockers.push({
      id: "local-mcp",
      severity: localReport.data?.releasable ? "warning" : "error",
      message: localMcpReport.exists ? "Local MCP report is not passing." : "Local MCP report is missing.",
    });
  }

  if (!brandTemplateReport.exists || brandTemplateReport.data?.ok !== true) {
    blockers.push({
      id: "brand-templates",
      severity: localReport.data?.releasable ? "warning" : "error",
      message: brandTemplateReport.exists ? "Brand template report is not passing." : "Brand template report is missing.",
    });
  }

  if (!muApiEnv.ok) {
    blockers.push({
      id: "muapi-env",
      severity: "blocking-for-strict-release",
      message: "MuAPI real-service environment is not ready.",
      missingEnvKeys: Array.isArray(muApiEnv.missingEnvKeys) ? muApiEnv.missingEnvKeys : [],
      failedEnvKeys: Array.isArray(muApiEnv.failedEnvKeys) ? muApiEnv.failedEnvKeys : [],
    });
  }

  if (!realEvidence.ok) {
    blockers.push({
      id: "muapi-real-evidence",
      severity: "blocking-for-strict-release",
      message: "MuAPI real-service evidence is not valid.",
      errors: Array.isArray(realEvidence.errors) ? realEvidence.errors : [],
    });
  }

  if (!strictReport.exists) {
    blockers.push({
      id: "strict-release",
      severity: "blocking-for-strict-release",
      message: "Strict release report is missing.",
    });
  } else if (strictReport.data?.releasable !== true) {
    blockers.push({
      id: "strict-release",
      severity: "blocking-for-strict-release",
      message: "Strict release report is not releasable.",
      summary: strictReport.data?.summary,
    });
  }

  const status = realEvidence.ok && strictReport.data?.releasable === true
    ? "strict-release-ready"
    : localPrereleaseOk
      ? "web-prerelease-ready"
      : "not-releasable";

  return {
    ok: status === "strict-release-ready",
    status,
    checkedAt: input.checkedAt || new Date().toISOString(),
    localPrerelease: summarizeReadinessReport(localReportPath, localReport),
    strictRelease: summarizeReadinessReport(strictReportPath, strictReport),
    localMcp: {
      reportPath: localMcpReportPath,
      exists: localMcpReport.exists,
      ok: localMcpReport.data?.ok === true,
      ...localMcpSummary,
      reportOverrideApplied: localMcpReport.data?.reportOverrideApplied === true,
      reportOverrideReason: localMcpReport.data?.reportOverrideReason,
      source: localMcpReport.data?.source,
    },
    brandTemplates: {
      reportPath: brandTemplateReportPath,
      exists: brandTemplateReport.exists,
      ok: brandTemplateReport.data?.ok === true,
      summary: brandTemplateReport.data?.summary,
    },
    muApi: {
      envReady: muApiEnv.ok === true,
      realEvidenceReady: realEvidence.ok === true,
      baseUrl: muApiEnv.baseUrl,
      apiKeyConfigured: muApiEnv.apiKeyConfigured,
      chatProbeConfigured: muApiEnv.chatProbeConfigured,
      missingEnvKeys: Array.isArray(muApiEnv.missingEnvKeys) ? muApiEnv.missingEnvKeys : [],
      failedEnvKeys: Array.isArray(muApiEnv.failedEnvKeys) ? muApiEnv.failedEnvKeys : [],
      realEvidenceErrors: Array.isArray(realEvidence.errors) ? realEvidence.errors : [],
      realEvidenceBlockingIds: Array.isArray(realEvidence.blockingEvidenceIds) ? realEvidence.blockingEvidenceIds : [],
      realEvidenceChecklistCount: Array.isArray(realEvidence.evidenceChecklist) ? realEvidence.evidenceChecklist.length : 0,
      realReportPath,
      nextCommands: muApiEnv.nextCommands,
      evidencePolicy: realEvidence.evidencePolicy,
    },
    blockers,
    redaction: {
      secretValuesReturned: false,
      redactedKeys: ["MUAPI_API_KEY", "MUAPI_CHAT_PROBE"],
    },
    ...(input.includeReports ? { reports: input.reports } : {}),
  };
}

function normalizeReport(report) {
  if (report && typeof report === "object" && "exists" in report) {
    return report;
  }
  return {
    exists: Boolean(report),
    data: report || null,
  };
}

function isSelfTaintedByLocalMcpOnly(data) {
  const steps = Array.isArray(data?.steps) ? data.steps : [];
  if (steps.length === 0) return false;
  return steps.every(
    (step) => step?.status === "passed" || step?.status === "blocked" || step?.id === "local-mcp"
  );
}

export { isSelfTaintedByLocalMcpOnly };

function summarizeReadinessReport(reportPath, report) {
  return {
    reportPath,
    exists: report.exists,
    ok: report.data?.ok === true,
    releasable: report.data?.releasable === true,
    checkedAt: report.data?.checkedAt,
    summary: report.data?.summary,
    requireMuApi: report.data?.requireMuApi,
    allowBlocked: report.data?.allowBlocked,
  };
}

function summarizeLocalMcpReport(report) {
  const steps = Array.isArray(report?.steps) ? report.steps : [];
  const tools = getStepDetail(steps, "tools");
  const ops = getStepDetail(steps, "ops");
  const approval = getStepDetail(steps, "approval");
  const releaseStatus = getStepDetail(steps, "release-status");
  const approvalSchemas = Array.isArray(tools?.approvalToolSchemas) ? tools.approvalToolSchemas : [];
  const approvalSchemaOneOfCounts = approvalSchemas
    .map((schema) => schema?.oneOfCount)
    .filter((count) => Number.isFinite(count));
  const approvalPolicy = approval?.approvalPolicy || {};
  return {
    toolCount: report?.toolCount,
    toolNames: getStringArray(tools?.toolNames),
    approvalToolNames: approvalSchemas.map((schema) => schema?.name).filter((name) => typeof name === "string" && name.trim()),
    approvalSchemaOneOfCount: approvalSchemaOneOfCounts.length > 0
      ? Math.min(...approvalSchemaOneOfCounts)
      : Number.isFinite(report?.approvalSchemaOneOfCount)
        ? report.approvalSchemaOneOfCount
        : undefined,
    operationCount: report?.operationCount,
    operationTypes: getStringArray(ops?.operationTypes).length > 0 ? getStringArray(ops?.operationTypes) : getStringArray(report?.operationTypes),
    operationCategories: getStringArray(ops?.categories).length > 0 ? getStringArray(ops?.categories) : getStringArray(report?.operationCategories),
    operationCategoryCounts: Object.keys(getNumberRecord(ops?.categoryCounts)).length > 0
      ? getNumberRecord(ops?.categoryCounts)
      : getNumberRecord(report?.operationCategoryCounts),
    operationDrift: getStringArray(ops?.drift).length > 0 ? getStringArray(ops?.drift) : getStringArray(report?.operationDrift),
    operationSchemaOneOfCount: Number.isFinite(ops?.operationSchemaOneOfCount) ? ops.operationSchemaOneOfCount : undefined,
    approvalRequestSchemaOneOfCount: Number.isFinite(ops?.approvalRequestSchemaOneOfCount)
      ? ops.approvalRequestSchemaOneOfCount
      : undefined,
    brandTemplateCount: report?.brandTemplateCount,
    brandTemplateVariantCount: report?.brandTemplateVariantCount,
    brandTemplateReadyCount: report?.brandTemplateReadyCount,
    muApiEnvReady: report?.muApiEnvReady,
    muApiRealEvidenceReady: report?.muApiRealEvidenceReady,
    releaseStatus: report?.releaseStatus,
    blockerIds: getStringArray(releaseStatus?.blockerIds).length > 0 ? getStringArray(releaseStatus?.blockerIds) : getStringArray(report?.blockerIds),
    approvalRequestHash: typeof approval?.requestHash === "string" ? approval.requestHash : undefined,
    approvalOpSummary: typeof approval?.opSummary === "string" ? approval.opSummary : undefined,
    approvalOperationTypes: getStringArray(approval?.operationTypes),
    approvalPolicy: {
      writesExecuteDirectly: approvalPolicy.writesExecuteDirectly === true,
      approvalImportRequired: approvalPolicy.approvalImportRequired === true,
      requiresUserApproval: approvalPolicy.requiresUserApproval === true,
    },
    approvalAuditOk: approval?.approvalAuditOk === true,
  };
}

function getStepDetail(steps, id) {
  const step = steps.find((item) => item?.id === id);
  return step && typeof step.detail === "object" && !Array.isArray(step.detail) ? step.detail : {};
}

function getStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()) : [];
}

function getNumberRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, count]) => typeof key === "string" && key.trim() && Number.isFinite(count))
      .map(([key, count]) => [key, count])
  );
}
