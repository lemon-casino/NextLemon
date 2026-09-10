import type {
  AgenticReadinessReport,
  AgenticReadinessStepDetailSummary,
  AgenticReadinessStepStatus,
} from "@/types/readiness";

const STEP_STATUSES = new Set<AgenticReadinessStepStatus>(["passed", "failed", "blocked"]);

export function parseAgenticReadinessReportJson(json: string): AgenticReadinessReport {
  const parsed = JSON.parse(json) as unknown;
  const record = getRecord(parsed);
  if (!record) throw new Error("验收报告必须是 JSON 对象");

  if (!Array.isArray(record.steps)) {
    throw new Error("验收报告缺少 steps");
  }

  const steps = record.steps.map((step, index) => {
    const stepRecord = getRecord(step);
    if (!stepRecord) throw new Error(`验收步骤 #${index + 1} 必须是对象`);
    const status = stepRecord.status;
    if (typeof status !== "string" || !STEP_STATUSES.has(status as AgenticReadinessStepStatus)) {
      throw new Error(`验收步骤 #${index + 1} 状态无效`);
    }
    const detail = stepRecord.detail;
    return {
      id: getString(stepRecord.id) || `step-${index + 1}`,
      label: getString(stepRecord.label) || `步骤 ${index + 1}`,
      status: status as AgenticReadinessStepStatus,
      durationMs: typeof stepRecord.durationMs === "number" ? stepRecord.durationMs : undefined,
      detail,
      detailSummary: summarizeReadinessStepDetail(detail),
    };
  });

  const fallbackSummary = steps.reduce(
    (summary, step) => {
      summary[step.status] += 1;
      return summary;
    },
    { passed: 0, failed: 0, blocked: 0 }
  );
  const summaryRecord = getRecord(record.summary);

  return {
    ok: Boolean(record.ok),
    releasable: Boolean(record.releasable),
    checkedAt: getString(record.checkedAt) || new Date(0).toISOString(),
    includeBuild: Boolean(record.includeBuild),
    allowBlocked: Boolean(record.allowBlocked),
    requireMuApi: Boolean(record.requireMuApi),
    summary: {
      passed: getNumber(summaryRecord?.passed) ?? fallbackSummary.passed,
      failed: getNumber(summaryRecord?.failed) ?? fallbackSummary.failed,
      blocked: getNumber(summaryRecord?.blocked) ?? fallbackSummary.blocked,
    },
    steps,
  };
}

export function getAgenticReadinessHeadline(report: AgenticReadinessReport): string {
  if (report.ok) return "全部通过";
  if (report.summary.failed > 0) return "存在失败项";
  if (report.summary.blocked > 0) return "存在阻塞项";
  return report.releasable ? "可发布" : "待确认";
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function getString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function getNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function summarizeReadinessStepDetail(detail: unknown): AgenticReadinessStepDetailSummary | undefined {
  const record = getRecord(detail);
  if (!record) return undefined;

  const failedEnvKeys = getFailedEnvKeys(record);
  const blockingEvidenceIds = [
    ...getStringArray(record.blockingEvidenceIds),
    ...getStringArray(record.realEvidenceBlockingIds),
    ...getStringArray(getRecord(record.muApi)?.realEvidenceBlockingIds),
  ];
  const operationTypes = getStringArray(record.operationTypes);
  const summary: AgenticReadinessStepDetailSummary = {
    command: getString(record.command),
    reason: getString(record.reason) || getString(record.error),
    reportPath: getString(record.reportPath),
    envReportPath: getString(record.envReportPath),
    nextCommand: getString(record.nextCommand),
    nextPreflightCommand: getString(record.nextPreflightCommand),
    failedEnvKeys,
    blockingEvidenceIds: [...new Set(blockingEvidenceIds)],
    evidenceChecklistCount: getEvidenceChecklistCount(record),
    endpoint2xxCount: getEndpoint2xxCount(record),
    strictEvidenceReady: getBoolean(record.strictEvidenceReady),
    brandSpecScore: getNumber(record.score) ?? undefined,
    brandSpecDeliverableCount: getNumber(record.deliverableCount) ?? undefined,
    brandSpecAcceptanceCriteriaCount: getNumber(record.acceptanceCriteriaCount) ?? undefined,
    templateCapabilityReady: getBoolean(record.templateCapabilityReady),
    templateCapabilityVariantCount: getNumber(record.templateCapabilityVariantCount) ?? undefined,
    templateCapabilityRequiredWorkflowNodes: getStringArray(record.templateCapabilityRequiredWorkflowNodes),
    templateCapabilityRequiredDeliverables: getStringArray(record.templateCapabilityRequiredDeliverables),
    templateCapabilityCheckCount: getNumber(record.templateCapabilityCheckCount) ?? undefined,
    templateCapabilityChecksPassed: getNumber(record.templateCapabilityChecksPassed) ?? undefined,
    templateCatalogTemplateCount: getNumber(record.templateCatalogTemplateCount) ?? undefined,
    templateCatalogReadyTemplateCount: getNumber(record.templateCatalogReadyTemplateCount) ?? undefined,
    templateCatalogVariantCount: getNumber(record.templateCatalogVariantCount) ?? undefined,
    templateCatalogWorkflowNodeTypes: getStringArray(record.templateCatalogWorkflowNodeTypes),
    templateCatalogCheckCount: getNumber(record.templateCatalogCheckCount) ?? undefined,
    templateCatalogChecksPassed: getNumber(record.templateCatalogChecksPassed) ?? undefined,
    brandTemplateReportOk: getBoolean(record.brandTemplateReportOk),
    brandTemplateRequiredKinds: getStringArray(record.brandTemplateRequiredKinds),
    brandTemplateTemplateCount: getNumber(record.brandTemplateTemplateCount) ?? undefined,
    brandTemplateTemplateIds: getStringArray(record.brandTemplateTemplateIds),
    brandTemplateReadyTemplateIds: getStringArray(record.brandTemplateReadyTemplateIds),
    brandTemplateKindBreakdown: getNumberRecord(record.brandTemplateKindBreakdown),
    brandTemplateKindCount: getNumber(record.brandTemplateKindCount) ?? undefined,
    brandTemplatePassedTemplates: getNumber(record.brandTemplatePassedTemplates) ?? undefined,
    brandTemplateFailedTemplates: getNumber(record.brandTemplateFailedTemplates) ?? undefined,
    brandTemplateVariantCount: getNumber(record.brandTemplateVariantCount) ?? undefined,
    brandTemplateVariantIdsByTemplate: getStringArrayRecord(record.brandTemplateVariantIdsByTemplate),
    brandTemplateFailedVariantTemplates: getNumber(record.brandTemplateFailedVariantTemplates) ?? undefined,
    brandTemplateCapabilityTemplateCount: getNumber(record.brandTemplateCapabilityTemplateCount) ?? undefined,
    brandTemplateReadyTemplateCount: getNumber(record.brandTemplateReadyTemplateCount) ?? undefined,
    brandTemplateCapabilityVariantCount: getNumber(record.brandTemplateCapabilityVariantCount) ?? undefined,
    brandTemplatePassedChecks: getNumber(record.brandTemplatePassedChecks) ?? undefined,
    brandTemplateFailedChecks: getNumber(record.brandTemplateFailedChecks) ?? undefined,
    brandTemplateWorkflowNodeTypes: getStringArray(record.brandTemplateWorkflowNodeTypes),
    brandTemplateWorkflowNodeTypesByTemplate: getStringArrayRecord(record.brandTemplateWorkflowNodeTypesByTemplate),
    brandTemplateDeliverableKinds: getStringArray(record.brandTemplateDeliverableKinds),
    brandTemplateDeliverableIdsByTemplate: getStringArrayRecord(record.brandTemplateDeliverableIdsByTemplate),
    brandTemplateOutputKinds: getStringArray(record.brandTemplateOutputKinds),
    brandTemplateCapabilityCheckIdsByTemplate: getStringArrayRecord(record.brandTemplateCapabilityCheckIdsByTemplate),
    brandTemplateMissingKinds: getStringArray(record.brandTemplateMissingKinds),
    brandTemplateFailedTemplateIds: getStringArray(record.brandTemplateFailedTemplateIds),
    brandTemplateFailedVariantTemplateIds: getStringArray(record.brandTemplateFailedVariantTemplateIds),
    localBridgeToolCount: getNumber(record.localBridgeToolCount) ?? getNumber(record.toolCount) ?? undefined,
    localBridgeOperationCount: getNumber(record.localBridgeOperationCount) ?? getNumber(record.operationCount) ?? undefined,
    localBridgeBrandTemplateCount: getNumber(record.localBridgeBrandTemplateCount) ?? getNumber(record.brandTemplateCount) ?? undefined,
    localBridgeBrandTemplateReadyCount: getNumber(record.localBridgeBrandTemplateReadyCount) ?? getNumber(record.brandTemplateReadyCount) ?? undefined,
    localBridgeBrandTemplateVariantCount: getNumber(record.localBridgeBrandTemplateVariantCount) ?? getNumber(record.brandTemplateVariantCount) ?? undefined,
    localBridgeBrandSpecToolReady: getBoolean(record.localBridgeBrandSpecToolReady) ?? getBoolean(record.brandSpecToolReady),
    localBridgeBrandTemplateToolReady: getBoolean(record.localBridgeBrandTemplateToolReady) ?? getBoolean(record.brandTemplateToolReady),
    localBridgeReportOk: getBoolean(record.localBridgeReportOk) ?? getBoolean(record.bridgeReportOk),
    localBridgeFailedStepIds: getStringArray(record.localBridgeFailedStepIds).length > 0
      ? getStringArray(record.localBridgeFailedStepIds)
      : getStringArray(record.failedStepIds),
    localBridgeReadOnlyBrandTools: getStringArray(record.localBridgeReadOnlyBrandTools).length > 0
      ? getStringArray(record.localBridgeReadOnlyBrandTools)
      : getStringArray(record.readOnlyBrandTools),
    localBridgeWriteTools: getStringArray(record.localBridgeWriteTools).length > 0
      ? getStringArray(record.localBridgeWriteTools)
      : getStringArray(record.writeTools),
    localMcpReportOk: getBoolean(record.localMcpReportOk),
    localMcpTransportInputs: getStringArray(record.localMcpTransportInputs),
    localMcpToolCount: getNumber(record.localMcpToolCount) ?? undefined,
    localMcpToolNames: getStringArray(record.localMcpToolNames),
    localMcpApprovalToolNames: getStringArray(record.localMcpApprovalToolNames),
    localMcpApprovalSchemaOneOfCount: getNumber(record.localMcpApprovalSchemaOneOfCount) ?? undefined,
    localMcpOperationCount: getNumber(record.localMcpOperationCount) ?? undefined,
    localMcpOperationTypes: getStringArray(record.localMcpOperationTypes),
    localMcpOperationCategories: getStringArray(record.localMcpOperationCategories),
    localMcpOperationCategoryCounts: getNumberRecord(record.localMcpOperationCategoryCounts),
    localMcpOperationDrift: getStringArray(record.localMcpOperationDrift),
    localMcpBrandTemplateCount: getNumber(record.localMcpBrandTemplateCount) ?? undefined,
    localMcpBrandTemplateVariantCount: getNumber(record.localMcpBrandTemplateVariantCount) ?? undefined,
    localMcpBrandTemplateReadyCount: getNumber(record.localMcpBrandTemplateReadyCount) ?? undefined,
    localMcpMuApiEnvReady: getBoolean(record.localMcpMuApiEnvReady),
    localMcpMuApiRealEvidenceReady: getBoolean(record.localMcpMuApiRealEvidenceReady),
    localMcpReleaseStatus: getString(record.localMcpReleaseStatus),
    localMcpBlockerIds: getStringArray(record.localMcpBlockerIds),
    localMcpApprovalRequestHash: getString(record.localMcpApprovalRequestHash),
    localMcpApprovalOpSummary: getString(record.localMcpApprovalOpSummary),
    localMcpApprovalOperationTypes: getStringArray(record.localMcpApprovalOperationTypes),
    localMcpApprovalWritesExecuteDirectly: getBoolean(record.localMcpApprovalWritesExecuteDirectly),
    localMcpApprovalImportRequired: getBoolean(record.localMcpApprovalImportRequired),
    localMcpApprovalRequiresUserApproval: getBoolean(record.localMcpApprovalRequiresUserApproval),
    localMcpApprovalAuditOk: getBoolean(record.localMcpApprovalAuditOk),
    requestHash: getString(record.requestHash) || getString(record.localMcpApprovalRequestHash),
    opSummary: getString(record.opSummary) || getString(record.localMcpApprovalOpSummary),
    operationTypes: operationTypes.length > 0 ? operationTypes : getStringArray(record.localMcpApprovalOperationTypes),
  };

  return hasMeaningfulSummary(summary) ? summary : undefined;
}

function getFailedEnvKeys(record: Record<string, unknown>): string[] {
  const explicit = getStringArray(record.failedEnvKeys);
  if (explicit.length > 0) return explicit;
  const envChecks = Array.isArray(record.envChecks) ? record.envChecks : [];
  return envChecks
    .map(getRecord)
    .filter((check): check is Record<string, unknown> => Boolean(check && getString(check.status) === "failed"))
    .map((check) => getString(check.id))
    .filter(Boolean);
}

function getEvidenceChecklistCount(record: Record<string, unknown>): number | undefined {
  if (Array.isArray(record.evidenceChecklist)) return record.evidenceChecklist.length;
  const direct = getNumber(record.evidenceChecklistCount);
  if (direct !== null) return direct;
  const nested = getNumber(getRecord(record.muApi)?.realEvidenceChecklistCount);
  return nested ?? undefined;
}

function getEndpoint2xxCount(record: Record<string, unknown>): number | undefined {
  const direct = getNumber(record.endpoint2xxCount);
  if (direct !== null) return direct;
  const endpointEvidence = getRecord(record.endpointEvidence);
  if (!endpointEvidence) return undefined;
  return Object.values(endpointEvidence)
    .map(getRecord)
    .filter((evidence) => evidence?.has2xx === true).length;
}

function hasMeaningfulSummary(summary: AgenticReadinessStepDetailSummary): boolean {
  return Boolean(
    summary.command ||
      summary.reason ||
      summary.reportPath ||
      summary.envReportPath ||
      summary.nextCommand ||
      summary.nextPreflightCommand ||
      summary.failedEnvKeys.length > 0 ||
      summary.blockingEvidenceIds.length > 0 ||
      summary.evidenceChecklistCount ||
      summary.endpoint2xxCount ||
      summary.strictEvidenceReady !== undefined ||
      summary.brandSpecScore !== undefined ||
      summary.brandSpecDeliverableCount !== undefined ||
      summary.brandSpecAcceptanceCriteriaCount !== undefined ||
      summary.templateCapabilityReady !== undefined ||
      summary.templateCapabilityVariantCount !== undefined ||
      summary.templateCapabilityRequiredWorkflowNodes.length > 0 ||
      summary.templateCapabilityRequiredDeliverables.length > 0 ||
      summary.templateCapabilityCheckCount !== undefined ||
      summary.templateCapabilityChecksPassed !== undefined ||
      summary.templateCatalogTemplateCount !== undefined ||
      summary.templateCatalogReadyTemplateCount !== undefined ||
      summary.templateCatalogVariantCount !== undefined ||
      summary.templateCatalogWorkflowNodeTypes.length > 0 ||
      summary.templateCatalogCheckCount !== undefined ||
      summary.templateCatalogChecksPassed !== undefined ||
      summary.brandTemplateReportOk !== undefined ||
      summary.brandTemplateRequiredKinds.length > 0 ||
      summary.brandTemplateTemplateCount !== undefined ||
      summary.brandTemplateTemplateIds.length > 0 ||
      summary.brandTemplateReadyTemplateIds.length > 0 ||
      Object.keys(summary.brandTemplateKindBreakdown).length > 0 ||
      summary.brandTemplateKindCount !== undefined ||
      summary.brandTemplatePassedTemplates !== undefined ||
      summary.brandTemplateFailedTemplates !== undefined ||
      summary.brandTemplateVariantCount !== undefined ||
      Object.keys(summary.brandTemplateVariantIdsByTemplate).length > 0 ||
      summary.brandTemplateFailedVariantTemplates !== undefined ||
      summary.brandTemplateCapabilityTemplateCount !== undefined ||
      summary.brandTemplateReadyTemplateCount !== undefined ||
      summary.brandTemplateCapabilityVariantCount !== undefined ||
      summary.brandTemplatePassedChecks !== undefined ||
      summary.brandTemplateFailedChecks !== undefined ||
      summary.brandTemplateWorkflowNodeTypes.length > 0 ||
      Object.keys(summary.brandTemplateWorkflowNodeTypesByTemplate).length > 0 ||
      summary.brandTemplateDeliverableKinds.length > 0 ||
      Object.keys(summary.brandTemplateDeliverableIdsByTemplate).length > 0 ||
      summary.brandTemplateOutputKinds.length > 0 ||
      Object.keys(summary.brandTemplateCapabilityCheckIdsByTemplate).length > 0 ||
      summary.brandTemplateMissingKinds.length > 0 ||
      summary.brandTemplateFailedTemplateIds.length > 0 ||
      summary.brandTemplateFailedVariantTemplateIds.length > 0 ||
      summary.localBridgeToolCount !== undefined ||
      summary.localBridgeOperationCount !== undefined ||
      summary.localBridgeBrandTemplateCount !== undefined ||
      summary.localBridgeBrandTemplateReadyCount !== undefined ||
      summary.localBridgeBrandTemplateVariantCount !== undefined ||
      summary.localBridgeBrandSpecToolReady !== undefined ||
      summary.localBridgeBrandTemplateToolReady !== undefined ||
      summary.localBridgeReportOk !== undefined ||
      summary.localBridgeFailedStepIds.length > 0 ||
      summary.localBridgeReadOnlyBrandTools.length > 0 ||
      summary.localBridgeWriteTools.length > 0 ||
      summary.localMcpReportOk !== undefined ||
      summary.localMcpTransportInputs.length > 0 ||
      summary.localMcpToolCount !== undefined ||
      summary.localMcpToolNames.length > 0 ||
      summary.localMcpApprovalToolNames.length > 0 ||
      summary.localMcpApprovalSchemaOneOfCount !== undefined ||
      summary.localMcpOperationCount !== undefined ||
      summary.localMcpOperationTypes.length > 0 ||
      summary.localMcpOperationCategories.length > 0 ||
      Object.keys(summary.localMcpOperationCategoryCounts).length > 0 ||
      summary.localMcpOperationDrift.length > 0 ||
      summary.localMcpBrandTemplateCount !== undefined ||
      summary.localMcpBrandTemplateVariantCount !== undefined ||
      summary.localMcpBrandTemplateReadyCount !== undefined ||
      summary.localMcpMuApiEnvReady !== undefined ||
      summary.localMcpMuApiRealEvidenceReady !== undefined ||
      summary.localMcpReleaseStatus ||
      summary.localMcpBlockerIds.length > 0 ||
      summary.localMcpApprovalRequestHash ||
      summary.localMcpApprovalOpSummary ||
      summary.localMcpApprovalOperationTypes.length > 0 ||
      summary.localMcpApprovalWritesExecuteDirectly !== undefined ||
      summary.localMcpApprovalImportRequired !== undefined ||
      summary.localMcpApprovalRequiresUserApproval !== undefined ||
      summary.localMcpApprovalAuditOk !== undefined ||
      summary.requestHash ||
      summary.opSummary ||
      summary.operationTypes.length > 0
  );
}

function getStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(getString).filter(Boolean) : [];
}

function getStringArrayRecord(value: unknown): Record<string, string[]> {
  const record = getRecord(value);
  if (!record) return {};
  return Object.fromEntries(
    Object.entries(record)
      .map(([key, items]) => [key, getStringArray(items)])
      .filter(([key, items]) => getString(key).length > 0 && items.length > 0)
  );
}

function getNumberRecord(value: unknown): Record<string, number> {
  const record = getRecord(value);
  if (!record) return {};
  return Object.fromEntries(
    Object.entries(record)
      .filter(([key, count]) => getString(key).length > 0 && typeof count === "number" && Number.isFinite(count))
      .map(([key, count]) => [key, count as number])
  );
}

function getBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}
