#!/usr/bin/env node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import ts from "typescript";

const argv = process.argv.slice(2);
const reportPath = getArgValue("--report") || "";
const jsonOutput = argv.includes("--json");
const root = process.cwd();
const agentOpSourcePath = path.join(root, "src", "services", "agentOps.ts");
const inboxDir = mkdtempSync(path.join(os.tmpdir(), "nextlemon-mcp-inbox-"));
const invalidMuApiReportPath = writeInvalidMuApiReport();
const currentSourceOps = readSourceOpCatalog(agentOpSourcePath);
const currentOperationTypes = currentSourceOps.ok
  ? currentSourceOps.specs.map((op) => op.type).filter(Boolean).sort()
  : [];
const currentOperationCategoryCounts = currentSourceOps.ok
  ? countBy(currentSourceOps.specs.map((op) => op.category).filter(Boolean))
  : {};
mkdirSync(inboxDir, { recursive: true });

const requests = [
  frame({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
  `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`,
  frame({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
  `${JSON.stringify({
    jsonrpc: "2.0",
    id: 11,
    method: "tools/call",
    params: { name: "nextlemon.get_manifest", arguments: {} },
  })}\n`,
  `${JSON.stringify({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "nextlemon.list_canvas_agent_ops", arguments: {} },
  })}\n`,
  `${JSON.stringify({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: {
      name: "nextlemon.list_brand_templates",
      arguments: {
        includePromptGuidance: false,
        includeVariants: true,
        includeAppliedVariants: true,
        includeCapabilityMatrix: true,
      },
    },
  })}\n`,
  `${JSON.stringify({
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: {
      name: "nextlemon.create_brand_spec",
      arguments: {
        brandKit: {
          id: "mcp-brand-kit",
          name: "MCP 验收品牌",
          colors: ["#111827", "#f59e0b"],
          fonts: { heading: "Inter", body: "Inter" },
          logoAssetId: "logo-asset",
          tone: "professional",
          referenceAssetIds: ["reference-asset"],
          createdAt: 1,
          updatedAt: 1,
        },
        assets: [
          { id: "logo-asset", title: "Logo", kind: "image" },
          { id: "reference-asset", title: "Reference", kind: "image" },
        ],
        templateId: "poster-vertical-campaign",
        variantId: "bold",
      },
    },
  })}\n`,
  `${JSON.stringify({
    jsonrpc: "2.0",
    id: 12,
    method: "tools/call",
    params: { name: "nextlemon.read_verification_reports", arguments: {} },
  })}\n`,
  `${JSON.stringify({
    jsonrpc: "2.0",
    id: 6,
    method: "tools/call",
    params: { name: "nextlemon.check_muapi_env", arguments: { requireReal: true, requireChat: true } },
  })}\n`,
  `${JSON.stringify({
    jsonrpc: "2.0",
    id: 7,
    method: "tools/call",
    params: { name: "nextlemon.assert_muapi_real_report", arguments: { reportPath: invalidMuApiReportPath } },
  })}\n`,
  `${JSON.stringify({
    jsonrpc: "2.0",
    id: 8,
    method: "tools/call",
    params: {
      name: "nextlemon.get_release_status",
      arguments: {
        currentLocalMcpReport: {
          ok: true,
          toolCount: 11,
          operationCount: 15,
          operationTypes: currentOperationTypes,
          brandTemplateCount: 5,
          brandTemplateVariantCount: 15,
          brandTemplateReadyCount: 5,
          approvalSchemaOneOfCount: 15,
          operationCategories: ["asset", "canvas", "library", "workflow"],
          operationCategoryCounts: currentOperationCategoryCounts,
          operationDrift: [],
          muApiEnvReady: false,
          muApiRealEvidenceReady: false,
          releaseStatus: "web-prerelease-ready",
          blockerIds: ["muapi-env", "muapi-real-evidence", "strict-release"],
          source: "verify-local-mcp-in-progress",
        },
      },
    },
  })}\n`,
  `${JSON.stringify({
    jsonrpc: "2.0",
    id: 9,
    method: "tools/call",
    params: {
      name: "nextlemon.validate_approval_request",
      arguments: { ops: [{ type: "workflow.selectNodes", nodeIds: [] }] },
    },
  })}\n`,
  frame({
    jsonrpc: "2.0",
    id: 10,
    method: "tools/call",
    params: {
      name: "nextlemon.create_approval_request",
      arguments: {
        title: "MCP 自检审批请求",
        ops: [
          {
            type: "asset.add",
            asset: {
              kind: "text",
              title: "MCP 自检",
              text: "由 verify-local-mcp.mjs 生成。",
              source: "agent",
              tags: ["mcp-self-test"],
            },
          },
        ],
      },
    },
  }),
];

const result = await runSelfTest();
writeReport(result);
if (jsonOutput) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(result.ok ? "Local MCP verification passed." : "Local MCP verification failed.");
  console.log(`Inbox: ${result.inboxDir}`);
  for (const step of result.steps) {
    console.log(`${step.status.toUpperCase()} ${step.id}: ${step.label}`);
  }
}
process.exit(result.ok ? 0 : 1);

async function runSelfTest() {
  const checkedAt = new Date().toISOString();
  const steps = [];
  const child = spawn(process.execPath, ["scripts/nextlemon-mcp-stdio.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      NEXTLEMON_AGENT_INBOX: inboxDir,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  for (const request of requests) child.stdin.write(request);
  child.stdin.end();

  const exitCode = await waitForChild(child);
  const responses = parseJsonLines(stdout);
  const byId = new Map(responses.filter((item) => item.id !== undefined).map((item) => [item.id, item]));

  step(steps, "process", "stdio process exited", exitCode === 0, { exitCode, stderr: stderr.trim() || undefined });

  const initialize = byId.get(1);
  step(steps, "initialize", "initialize response includes protocol version", Boolean(initialize?.result?.protocolVersion), initialize);

  const toolsList = byId.get(2);
  const tools = Array.isArray(toolsList?.result?.tools) ? toolsList.result.tools : [];
  const approvalToolSchemas = tools
    .filter((tool) => ["nextlemon.validate_approval_request", "nextlemon.create_approval_request"].includes(tool.name))
    .map((tool) => ({
      name: tool.name,
      oneOfCount: tool.inputSchema?.properties?.ops?.items?.oneOf?.length,
      minItems: tool.inputSchema?.properties?.ops?.minItems,
    }));
  const approvalToolSchemasOk =
    approvalToolSchemas.length === 2 &&
    approvalToolSchemas.every((schema) => schema.oneOfCount === 15 && schema.minItems === 1);
  const toolNames = tools.map((tool) => tool.name);
  step(steps, "tools", "tools/list exposes expected local MCP tools with granular approval schemas", tools.length >= 11 && toolNames.includes("nextlemon.create_brand_spec") && approvalToolSchemasOk, {
    toolNames,
    approvalToolSchemas,
  });

  const manifest = readToolJson(byId.get(11));
  const manifestBrandTemplates = manifest.brandTemplates || {};
  step(
    steps,
    "manifest",
    "manifest declares safe approval workflow, operation schemas, and brand template variant capabilities",
    manifest.safety?.writesExecuteDirectly === false &&
      manifest.safety?.approvalImportRequired === true &&
      manifest.operationCatalogSource?.parsedFromSource === true &&
      manifest.operationCatalogSource?.fallbackUsed === false &&
      manifestBrandTemplates.supportsVariants === true &&
      manifestBrandTemplates.supportsAppliedVariants === true &&
      manifestBrandTemplates.supportsCapabilityMatrix === true &&
      manifestBrandTemplates.supportsBrandSpecExport === true &&
      manifestBrandTemplates.supportsVariantBrandSpec === true &&
      manifestBrandTemplates.brandSpecTool === "nextlemon.create_brand_spec" &&
      manifestBrandTemplates.expectedTemplateCount === 5 &&
      manifestBrandTemplates.expectedVariantCount === 15 &&
      manifestBrandTemplates.expectedAppliedVariantCount === 15 &&
      manifestBrandTemplates.recommendedArguments?.includeVariants === true &&
      manifestBrandTemplates.recommendedArguments?.includeAppliedVariants === true &&
      manifestBrandTemplates.recommendedArguments?.includeCapabilityMatrix === true,
    {
      safety: manifest.safety,
      operationCatalogSource: manifest.operationCatalogSource,
      brandTemplates: manifestBrandTemplates,
    }
  );

  const ops = readToolJson(byId.get(3));
  const sourceOps = readSourceOpCatalog(agentOpSourcePath);
  const operationCatalog = Array.isArray(ops.operationCatalog) ? ops.operationCatalog : [];
  const operationSchemaOneOfCount = Array.isArray(ops.operationSchema?.oneOf) ? ops.operationSchema.oneOf.length : 0;
  const approvalRequestSchemaOneOfCount = Array.isArray(ops.approvalRequestSchema?.properties?.ops?.items?.oneOf)
    ? ops.approvalRequestSchema.properties.ops.items.oneOf.length
    : 0;
  const mcpOpTypes = operationCatalog.map((op) => op.type).filter(Boolean).sort();
  const sourceOpTypes = sourceOps.specs.map((op) => op.type).filter(Boolean).sort();
  const opDrift = diffValues(sourceOpTypes, mcpOpTypes);
  const opCategories = [...new Set(operationCatalog.map((op) => op.category).filter(Boolean))].sort();
  const opCategoryCounts = countBy(operationCatalog.map((op) => op.category).filter(Boolean));
  const completeSpecShape = operationCatalog.every(
    (op) =>
      typeof op.type === "string" &&
      typeof op.category === "string" &&
      typeof op.label === "string" &&
      typeof op.description === "string" &&
      Array.isArray(op.required) &&
      op.example &&
      typeof op.example === "object"
  );
  step(
    steps,
    "ops",
    "operation catalog matches app CanvasAgentOp specs without drift",
    sourceOps.ok === true &&
      ops.sourceParsed === true &&
      ops.fallbackUsed === false &&
      operationCatalog.length === sourceOps.specs.length &&
      operationCatalog.length === 15 &&
      operationSchemaOneOfCount === 15 &&
      approvalRequestSchemaOneOfCount === 15 &&
      opDrift.length === 0 &&
      completeSpecShape,
    {
      sourcePath: path.relative(root, agentOpSourcePath),
      sourceParsed: ops.sourceParsed,
      fallbackUsed: ops.fallbackUsed,
      sourceOpCount: sourceOps.specs.length,
      opCount: operationCatalog.length,
      operationTypes: mcpOpTypes,
      operationSchemaOneOfCount,
      approvalRequestSchemaOneOfCount,
      categories: opCategories,
      categoryCounts: opCategoryCounts,
      drift: opDrift,
      completeSpecShape,
      sourceError: sourceOps.error || ops.sourceError,
    }
  );

  const brandSpec = readToolJson(byId.get(5));
  const brandSpecCapability = brandSpec.templateCapability || {};
  const brandSpecCatalog = brandSpec.templateCatalog || {};
  const brandSpecWorkflowNodes = Array.isArray(brandSpecCapability.requiredWorkflowNodeTypes)
    ? brandSpecCapability.requiredWorkflowNodeTypes
    : [];
  const brandSpecCatalogNodes = Array.isArray(brandSpecCatalog.workflowNodeTypes) ? brandSpecCatalog.workflowNodeTypes : [];
  step(
    steps,
    "brand-spec-tool",
    "brand spec MCP tool returns complete variant-aware brand spec details",
    brandSpec.ok === true &&
      brandSpec.moduleLoaded === true &&
      brandSpec.variantId === "bold" &&
      brandSpec.templateId === "poster-vertical-campaign__bold" &&
      brandSpec.validation?.score === 100 &&
      brandSpecCapability.ready === true &&
      brandSpecCapability.variantCount === 3 &&
      brandSpecWorkflowNodes.includes("promptNode") &&
      brandSpecWorkflowNodes.includes("imageGeneratorProNode") &&
      brandSpecCatalog.templateCount === 5 &&
      brandSpecCatalog.readyTemplateCount === 5 &&
      brandSpecCatalog.variantCount === 15 &&
      brandSpecCatalogNodes.includes("pptContentNode") &&
      brandSpecCatalogNodes.includes("pptAssemblerNode") &&
      brandSpecCatalogNodes.includes("videoGeneratorNode") &&
      brandSpec.spec?.validation?.score === 100,
    {
      templateId: brandSpec.templateId,
      variantId: brandSpec.variantId,
      validationScore: brandSpec.validation?.score,
      templateCapabilityReady: brandSpecCapability.ready,
      templateCapabilityVariantCount: brandSpecCapability.variantCount,
      templateCapabilityRequiredWorkflowNodes: brandSpecWorkflowNodes,
      templateCatalogTemplateCount: brandSpecCatalog.templateCount,
      templateCatalogReadyTemplateCount: brandSpecCatalog.readyTemplateCount,
      templateCatalogVariantCount: brandSpecCatalog.variantCount,
      templateCatalogWorkflowNodeTypes: brandSpecCatalogNodes,
      promptGuidanceCount: brandSpec.promptGuidanceCount,
      usageNoteCount: brandSpec.usageNoteCount,
    }
  );

  const templates = readToolJson(byId.get(4));
  const templateKinds = Array.isArray(templates.templates) ? [...new Set(templates.templates.map((template) => template.kind))] : [];
  const pptTemplate = Array.isArray(templates.templates)
    ? templates.templates.find((template) => template.kind === "ppt")
    : null;
  const videoTemplate = Array.isArray(templates.templates)
    ? templates.templates.find((template) => template.kind === "video-cover")
    : null;
  const pptNodeTypes = Array.isArray(pptTemplate?.recommendedWorkflowNodes)
    ? pptTemplate.recommendedWorkflowNodes.map((node) => node.nodeType)
    : [];
  const pptVariantIds = Array.isArray(pptTemplate?.variants) ? pptTemplate.variants.map((variant) => variant.id) : [];
  const videoVariantIds = Array.isArray(videoTemplate?.variants) ? videoTemplate.variants.map((variant) => variant.id) : [];
  const commonVariantOk = Array.isArray(templates.templates)
    ? templates.templates
        .filter((template) => ["social-image", "poster", "brand-board"].includes(template.kind))
        .every((template) => {
          const ids = Array.isArray(template.variants) ? template.variants.map((variant) => variant.id) : [];
          return ["balanced", "bold", "systematic"].every((id) => ids.includes(id));
        })
    : false;
  const capabilityMatrix = templates.capabilityMatrix || {};
  const capabilityWorkflowNodes = Array.isArray(capabilityMatrix.workflowNodeTypes) ? capabilityMatrix.workflowNodeTypes : [];
  const capabilityDeliverableKinds = Array.isArray(capabilityMatrix.deliverableKinds) ? capabilityMatrix.deliverableKinds : [];
  const capabilityChecksOk =
    capabilityMatrix.schemaVersion === 1 &&
    capabilityMatrix.templateCount === 5 &&
    capabilityMatrix.readyTemplateCount === 5 &&
    capabilityMatrix.variantCount === 15 &&
    Array.isArray(capabilityMatrix.missingKinds) &&
    capabilityMatrix.missingKinds.length === 0 &&
    Array.isArray(capabilityMatrix.templates) &&
    capabilityMatrix.templates.length === 5 &&
    capabilityMatrix.templates.every(
      (template) =>
        template.ready === true &&
        Array.isArray(template.checks) &&
        template.checks.every((check) => check.status === "passed") &&
        Array.isArray(template.variantIds) &&
        template.variantIds.length === 3
    ) &&
    ["promptNode", "imageGeneratorProNode", "pptContentNode", "pptAssemblerNode", "videoGeneratorNode"].every((nodeType) =>
      capabilityWorkflowNodes.includes(nodeType)
    ) &&
    ["image", "workflow", "project"].every((kind) => capabilityDeliverableKinds.includes(kind));
  const everyTemplateHasAppliedVariants = Array.isArray(templates.templates)
    ? templates.templates.every(
        (template) =>
          template.variantCount === 3 &&
          Array.isArray(template.appliedVariants) &&
          template.appliedVariants.length === 3 &&
          template.appliedVariants.every((variant) => String(variant.id || "").startsWith(`${template.id}__`))
      )
    : false;
  step(
    steps,
    "brand-templates",
    "brand template catalog exposes required kinds, workflow nodes, and 15 variants through MCP",
    templates.ok === true &&
      templates.moduleLoaded === true &&
      templates.sourceMode === "module" &&
      templates.summary?.templateCount === 5 &&
      templateKinds.length === 5 &&
      templates.summary?.variantCount === 15 &&
      templates.summary?.appliedVariantCount === 15 &&
      templates.summary?.capabilityTemplateCount === 5 &&
      templates.summary?.readyTemplateCount === 5 &&
      templates.summary?.capabilityVariantCount === 15 &&
      capabilityChecksOk &&
      pptNodeTypes.includes("pptContentNode") &&
      pptNodeTypes.includes("pptAssemblerNode") &&
      pptVariantIds.includes("executive") &&
      videoVariantIds.includes("motion-hook") &&
      commonVariantOk &&
      everyTemplateHasAppliedVariants,
    {
      templateCount: templates.summary?.templateCount,
      filteredCount: templates.summary?.filteredCount,
      variantCount: templates.summary?.variantCount,
      appliedVariantCount: templates.summary?.appliedVariantCount,
      capabilityTemplateCount: templates.summary?.capabilityTemplateCount,
      readyTemplateCount: templates.summary?.readyTemplateCount,
      capabilityVariantCount: templates.summary?.capabilityVariantCount,
      capabilityWorkflowNodes,
      capabilityDeliverableKinds,
      capabilityChecksOk,
      moduleLoaded: templates.moduleLoaded,
      sourceMode: templates.sourceMode,
      kinds: templateKinds,
      pptNodeTypes,
      pptVariantIds,
      videoVariantIds,
      commonVariantOk,
      everyTemplateHasAppliedVariants,
    }
  );

  const reports = readToolJson(byId.get(12));
  const reportIds = Array.isArray(reports.reports) ? reports.reports.map((report) => report.id) : [];
  const reportsById = new Map(Array.isArray(reports.reports) ? reports.reports.map((report) => [report.id, report]) : []);
  const readinessSummary = reportsById.get("agentic-readiness")?.summary || {};
  const readinessBrandSpec = readinessSummary.brandSpec || {};
  const readinessBrandTemplates = readinessSummary.readinessBrandTemplates || {};
  const readinessLocalBridge = readinessSummary.readinessLocalBridge || {};
  const readinessLocalMcp = readinessSummary.readinessLocalMcp || {};
  const readinessBrandTemplateIds = Array.isArray(readinessBrandTemplates.templateIds) ? readinessBrandTemplates.templateIds : [];
  const readinessReadyTemplateIds = Array.isArray(readinessBrandTemplates.readyTemplateIds) ? readinessBrandTemplates.readyTemplateIds : [];
  const readinessVariantIdsByTemplate = readinessBrandTemplates.variantIdsByTemplate || {};
  const readinessWorkflowNodesByTemplate = readinessBrandTemplates.workflowNodeTypesByTemplate || {};
  const readinessDeliverableIdsByTemplate = readinessBrandTemplates.deliverableIdsByTemplate || {};
  const readinessKindBreakdown = readinessBrandTemplates.kindBreakdown || {};
  const readinessLocalMcpOperationTypes = Array.isArray(readinessLocalMcp.operationTypes) ? readinessLocalMcp.operationTypes : [];
  const readinessLocalMcpCategoryCounts = readinessLocalMcp.operationCategoryCounts || {};
  const brandTemplateSummary = reportsById.get("brand-templates")?.summary || {};
  const muApiEnvSummary = reportsById.get("muapi-env")?.summary || {};
  const localMcpSummary = reportsById.get("local-mcp")?.summary || {};
  const localBridgeReport = reportsById.get("local-agent-bridge");
  const localBridgeSummary = localBridgeReport?.summary || {};
  const localBridgeOk =
    !localBridgeReport?.exists ||
    (localBridgeSummary.ok === true &&
      localBridgeSummary.toolCount === 6 &&
      localBridgeSummary.operationCount === 15 &&
      localBridgeSummary.brandTemplateReadyCount === 5 &&
      localBridgeSummary.brandTemplateVariantCount === 15 &&
      localBridgeSummary.brandSpecToolReady === true &&
      localBridgeSummary.brandTemplateToolReady === true);
  const muApiMockSummary = reportsById.get("muapi-mock")?.summary || {};
  const muApiMissingKeySummary = reportsById.get("muapi-missing-key")?.summary || {};
  const mockEndpointEvidence = muApiMockSummary.endpointEvidence || {};
  const requiredMockEndpointsHave2xx = ["account", "skills", "session", "chat", "events"].every(
    (id) => mockEndpointEvidence[id]?.has2xx === true
  );
  const mockBlockingEvidenceIds = Array.isArray(muApiMockSummary.blockingEvidenceIds) ? muApiMockSummary.blockingEvidenceIds : [];
  const missingKeyBlockingEvidenceIds = Array.isArray(muApiMissingKeySummary.blockingEvidenceIds)
    ? muApiMissingKeySummary.blockingEvidenceIds
    : [];
  step(
    steps,
    "reports",
    "verification report summaries expose readiness, brand spec granularity, variants, MuAPI failed keys, endpoint evidence, strict evidence blockers, and redaction",
    reports.ok === true &&
      reportIds.includes("brand-templates") &&
      reportIds.includes("muapi-env") &&
      reportIds.includes("local-mcp") &&
      localBridgeOk &&
      reportIds.includes("muapi-mock") &&
      reportIds.includes("muapi-missing-key") &&
      readinessBrandSpec.ready === true &&
      readinessBrandSpec.score === 100 &&
      readinessBrandSpec.templateCapabilityReady === true &&
      readinessBrandSpec.templateCapabilityVariantCount === 3 &&
      Array.isArray(readinessBrandSpec.templateCapabilityRequiredWorkflowNodes) &&
      readinessBrandSpec.templateCapabilityRequiredWorkflowNodes.includes("promptNode") &&
      readinessBrandSpec.templateCapabilityRequiredWorkflowNodes.includes("imageGeneratorProNode") &&
      readinessBrandSpec.templateCatalogTemplateCount === 5 &&
      readinessBrandSpec.templateCatalogReadyTemplateCount === 5 &&
      readinessBrandSpec.templateCatalogVariantCount === 15 &&
      Array.isArray(readinessBrandSpec.templateCatalogWorkflowNodeTypes) &&
      readinessBrandSpec.templateCatalogWorkflowNodeTypes.includes("pptContentNode") &&
      readinessBrandSpec.templateCatalogWorkflowNodeTypes.includes("pptAssemblerNode") &&
      readinessBrandSpec.templateCatalogWorkflowNodeTypes.includes("videoGeneratorNode") &&
      readinessBrandTemplates.ready === true &&
      readinessBrandTemplates.templateCount === 5 &&
      readinessBrandTemplateIds.length === 5 &&
      readinessBrandTemplateIds.includes("ppt-business-deck") &&
      readinessReadyTemplateIds.length === 5 &&
      readinessKindBreakdown.ppt === 1 &&
      readinessKindBreakdown["video-cover"] === 1 &&
      Array.isArray(readinessVariantIdsByTemplate["ppt-business-deck"]) &&
      readinessVariantIdsByTemplate["ppt-business-deck"].includes("executive") &&
      Array.isArray(readinessVariantIdsByTemplate["video-cover-landscape"]) &&
      readinessVariantIdsByTemplate["video-cover-landscape"].includes("motion-hook") &&
      Array.isArray(readinessWorkflowNodesByTemplate["ppt-business-deck"]) &&
      readinessWorkflowNodesByTemplate["ppt-business-deck"].includes("pptAssemblerNode") &&
      Array.isArray(readinessDeliverableIdsByTemplate["ppt-business-deck"]) &&
      readinessDeliverableIdsByTemplate["ppt-business-deck"].includes("pptx-file") &&
      readinessBrandTemplates.variantCount === 15 &&
      readinessBrandTemplates.readyTemplateCount === 5 &&
      Array.isArray(readinessBrandTemplates.workflowNodeTypes) &&
      readinessBrandTemplates.workflowNodeTypes.includes("pptContentNode") &&
      readinessLocalBridge.ready === true &&
      readinessLocalBridge.toolCount === 6 &&
      readinessLocalBridge.operationCount === 15 &&
      Array.isArray(readinessLocalBridge.writeTools) &&
      readinessLocalBridge.writeTools.includes("nextlemon.requestApproval") &&
      readinessLocalMcp.ready === true &&
      readinessLocalMcp.toolCount === 11 &&
      readinessLocalMcp.operationCount === 15 &&
      readinessLocalMcpOperationTypes.length === 15 &&
      readinessLocalMcpOperationTypes.includes("workflow.connectNodes") &&
      readinessLocalMcpCategoryCounts.asset === 3 &&
      readinessLocalMcpCategoryCounts.canvas === 6 &&
      readinessLocalMcpCategoryCounts.workflow === 5 &&
      readinessLocalMcpCategoryCounts.library === 1 &&
      readinessLocalMcp.approvalSchemaOneOfCount === 15 &&
      Array.isArray(readinessLocalMcp.operationCategories) &&
      readinessLocalMcp.operationCategories.includes("workflow") &&
      readinessLocalMcp.approvalPolicy?.writesExecuteDirectly === false &&
      readinessLocalMcp.approvalPolicy?.approvalImportRequired === true &&
      readinessLocalMcp.approvalPolicy?.requiresUserApproval === true &&
      brandTemplateSummary.variantCount === 15 &&
      Array.isArray(brandTemplateSummary.templateIds) &&
      brandTemplateSummary.templateIds.includes("video-cover-landscape") &&
      brandTemplateSummary.kindBreakdown?.["brand-board"] === 1 &&
      Array.isArray(brandTemplateSummary.variantIdsByTemplate?.["ppt-business-deck"]) &&
      brandTemplateSummary.variantIdsByTemplate["ppt-business-deck"].includes("executive") &&
      localMcpSummary.brandTemplateVariantCount === 15 &&
      Array.isArray(localMcpSummary.operationTypes) &&
      localMcpSummary.operationTypes.length === 15 &&
      localMcpSummary.operationCategoryCounts?.asset === 3 &&
      Array.isArray(muApiEnvSummary.failedEnvKeys) &&
      muApiEnvSummary.failedEnvKeys.includes("MUAPI_API_KEY") &&
      muApiEnvSummary.failedEnvKeys.includes("MUAPI_CHAT_PROBE") &&
      muApiEnvSummary.apiKeyConfigured === false &&
      muApiEnvSummary.chatProbeConfigured === false &&
      muApiEnvSummary.redaction?.secretValuesReturned === false &&
      muApiMockSummary.endpointLogCount >= 5 &&
      muApiMockSummary.endpoint2xxCount >= 5 &&
      requiredMockEndpointsHave2xx &&
      muApiMockSummary.strictEvidenceReady === false &&
      muApiMockSummary.evidenceChecklistCount === 18 &&
      mockBlockingEvidenceIds.includes("non-localhost-base-url") &&
      muApiMissingKeySummary.endpointLogCount === 0 &&
      muApiMissingKeySummary.strictEvidenceReady === false &&
      muApiMissingKeySummary.evidenceChecklistCount === 18 &&
      missingKeyBlockingEvidenceIds.includes("configured") &&
      missingKeyBlockingEvidenceIds.includes("step-config") &&
      missingKeyBlockingEvidenceIds.includes("endpoint-account") &&
      muApiMissingKeySummary.redaction?.secretValuesReturned === false,
    {
      reportIds,
      availableCount: reports.availableCount,
      readinessBrandSpec,
      readinessBrandTemplates,
      readinessLocalBridge,
      readinessLocalMcp,
      brandTemplateVariantCount: brandTemplateSummary.variantCount,
      localMcpBrandTemplateVariantCount: localMcpSummary.brandTemplateVariantCount,
      localBridgeReportExists: Boolean(localBridgeReport?.exists),
      localBridgeSummary,
      failedEnvKeys: muApiEnvSummary.failedEnvKeys,
      apiKeyConfigured: muApiEnvSummary.apiKeyConfigured,
      chatProbeConfigured: muApiEnvSummary.chatProbeConfigured,
      envSecretValuesReturned: muApiEnvSummary.redaction?.secretValuesReturned,
      mockEndpointLogCount: muApiMockSummary.endpointLogCount,
      mockEndpoint2xxCount: muApiMockSummary.endpoint2xxCount,
      mockEndpointEvidence,
      mockStrictEvidenceReady: muApiMockSummary.strictEvidenceReady,
      mockEvidenceChecklistCount: muApiMockSummary.evidenceChecklistCount,
      mockBlockingEvidenceIds,
      missingKeyEndpointLogCount: muApiMissingKeySummary.endpointLogCount,
      missingKeyStrictEvidenceReady: muApiMissingKeySummary.strictEvidenceReady,
      missingKeyEvidenceChecklistCount: muApiMissingKeySummary.evidenceChecklistCount,
      missingKeyBlockingEvidenceIds,
      missingKeySecretValuesReturned: muApiMissingKeySummary.redaction?.secretValuesReturned,
    }
  );

  const muApiEnv = readToolJson(byId.get(6));
  const muApiCheckIds = Array.isArray(muApiEnv.checks) ? muApiEnv.checks.map((check) => check.id) : [];
  const missingEnvKeys = Array.isArray(muApiEnv.missingEnvKeys) ? muApiEnv.missingEnvKeys : [];
  const failedEnvKeys = Array.isArray(muApiEnv.failedEnvKeys) ? muApiEnv.failedEnvKeys : [];
  step(
    steps,
    "muapi-env",
    "MuAPI real-service prerequisites expose missing and failed keys without secrets",
    typeof muApiEnv.ok === "boolean" &&
      muApiEnv.redaction?.secretValuesReturned === false &&
      typeof muApiEnv.apiKeyConfigured === "boolean" &&
      typeof muApiEnv.chatProbeConfigured === "boolean" &&
      muApiCheckIds.includes("api-key") &&
      muApiCheckIds.includes("chat-probe") &&
      missingEnvKeys.includes("MUAPI_API_KEY") &&
      missingEnvKeys.includes("MUAPI_CHAT_PROBE") &&
      failedEnvKeys.includes("MUAPI_API_KEY") &&
      failedEnvKeys.includes("MUAPI_CHAT_PROBE") &&
      !Object.hasOwn(muApiEnv, "apiKey") &&
      !Object.hasOwn(muApiEnv, "chatProbe"),
    {
      ok: muApiEnv.ok,
      apiKeyConfigured: muApiEnv.apiKeyConfigured,
      chatProbeConfigured: muApiEnv.chatProbeConfigured,
      missingEnvKeys,
      failedEnvKeys,
      checkIds: muApiCheckIds,
      secretValuesReturned: muApiEnv.redaction?.secretValuesReturned,
    }
  );

  const realEvidence = readToolJson(byId.get(7));
  const realEvidenceChecklist = Array.isArray(realEvidence.evidenceChecklist) ? realEvidence.evidenceChecklist : [];
  step(
    steps,
    "muapi-real-evidence",
    "MuAPI real-service assertion rejects localhost/mock evidence with checklist details",
    realEvidence.ok === false &&
      Array.isArray(realEvidence.errors) &&
      realEvidence.errors.includes("report.realService must be true.") &&
      realEvidence.errors.includes("baseUrl points to localhost; this is not a real MuAPI service.") &&
      realEvidenceChecklist.length === 18 &&
      Array.isArray(realEvidence.blockingEvidenceIds) &&
      realEvidence.blockingEvidenceIds.includes("real-service") &&
      realEvidence.blockingEvidenceIds.includes("non-localhost-base-url") &&
      realEvidence.evidencePolicy?.mockReportsAccepted === false &&
      realEvidence.evidencePolicy?.requiresRedactedReport === true &&
      realEvidence.evidencePolicy?.requiresEndpoint2xxEvidence === true &&
      realEvidence.endpoint2xxCount === 5 &&
      realEvidence.endpointEvidence?.events?.has2xx === true &&
      realEvidence.stepEvidence?.chat?.passed === true &&
      Array.isArray(realEvidence.missingEndpointIds) &&
      realEvidence.missingEndpointIds.length === 0 &&
      Array.isArray(realEvidence.failedEndpoint2xxIds) &&
      realEvidence.failedEndpoint2xxIds.length === 0 &&
      realEvidence.redaction?.secretValuesReturned === false,
    {
      ok: realEvidence.ok,
      reportPath: realEvidence.reportPath,
      errors: realEvidence.errors,
      mockReportsAccepted: realEvidence.evidencePolicy?.mockReportsAccepted,
      requiresRedactedReport: realEvidence.evidencePolicy?.requiresRedactedReport,
      requiresEndpoint2xxEvidence: realEvidence.evidencePolicy?.requiresEndpoint2xxEvidence,
      endpoint2xxCount: realEvidence.endpoint2xxCount,
      endpointEvidence: realEvidence.endpointEvidence,
      stepEvidence: realEvidence.stepEvidence,
      evidenceChecklistCount: realEvidenceChecklist.length,
      blockingEvidenceIds: realEvidence.blockingEvidenceIds,
      missingEndpointIds: realEvidence.missingEndpointIds,
      failedEndpoint2xxIds: realEvidence.failedEndpoint2xxIds,
      secretValuesReturned: realEvidence.redaction?.secretValuesReturned,
    }
  );

  const releaseStatus = readToolJson(byId.get(8));
  step(
    steps,
    "release-status",
    "consolidated release status uses current MCP self-test summary and exposes strict MuAPI blockers",
    typeof releaseStatus.status === "string" &&
      releaseStatus.redaction?.secretValuesReturned === false &&
      releaseStatus.muApi?.realEvidenceReady === false &&
      Array.isArray(releaseStatus.muApi?.failedEnvKeys) &&
      releaseStatus.muApi.failedEnvKeys.includes("MUAPI_API_KEY") &&
      releaseStatus.muApi.failedEnvKeys.includes("MUAPI_CHAT_PROBE") &&
      releaseStatus.localMcp?.ok === true &&
      releaseStatus.localMcp?.approvalSchemaOneOfCount === 15 &&
      Array.isArray(releaseStatus.localMcp?.operationTypes) &&
      releaseStatus.localMcp.operationTypes.length === 15 &&
      Array.isArray(releaseStatus.localMcp?.operationCategories) &&
      releaseStatus.localMcp.operationCategories.includes("workflow") &&
      releaseStatus.localMcp?.operationCategoryCounts?.asset === 3 &&
      releaseStatus.localMcp?.operationCategoryCounts?.canvas === 6 &&
      releaseStatus.localMcp?.operationCategoryCounts?.workflow === 5 &&
      releaseStatus.localMcp?.operationCategoryCounts?.library === 1 &&
      releaseStatus.localMcp?.brandTemplateVariantCount === 15 &&
      releaseStatus.localMcp?.brandTemplateReadyCount === 5 &&
      Array.isArray(releaseStatus.localMcp?.blockerIds) &&
      releaseStatus.localMcp.blockerIds.includes("muapi-real-evidence") &&
      releaseStatus.localMcp?.reportOverrideApplied === true &&
      releaseStatus.localMcp?.source === "verify-local-mcp-in-progress" &&
      Array.isArray(releaseStatus.muApi?.realEvidenceBlockingIds) &&
      releaseStatus.muApi.realEvidenceBlockingIds.includes("report-readable") &&
      releaseStatus.muApi?.realEvidenceChecklistCount >= 1 &&
      Array.isArray(releaseStatus.blockers) &&
      releaseStatus.blockers.some((blocker) => blocker.id === "muapi-real-evidence") &&
      !releaseStatus.blockers.some((blocker) => blocker.id === "local-mcp"),
    {
      status: releaseStatus.status,
      localReleasable: releaseStatus.localPrerelease?.releasable,
      strictReleasable: releaseStatus.strictRelease?.releasable,
      muApiEnvReady: releaseStatus.muApi?.envReady,
      muApiRealEvidenceReady: releaseStatus.muApi?.realEvidenceReady,
      failedEnvKeys: releaseStatus.muApi?.failedEnvKeys,
      localMcpOk: releaseStatus.localMcp?.ok,
      approvalSchemaOneOfCount: releaseStatus.localMcp?.approvalSchemaOneOfCount,
      operationTypes: releaseStatus.localMcp?.operationTypes,
      operationCategories: releaseStatus.localMcp?.operationCategories,
      operationCategoryCounts: releaseStatus.localMcp?.operationCategoryCounts,
      brandTemplateVariantCount: releaseStatus.localMcp?.brandTemplateVariantCount,
      brandTemplateReadyCount: releaseStatus.localMcp?.brandTemplateReadyCount,
      localMcpBlockerIds: releaseStatus.localMcp?.blockerIds,
      realEvidenceBlockingIds: releaseStatus.muApi?.realEvidenceBlockingIds,
      realEvidenceChecklistCount: releaseStatus.muApi?.realEvidenceChecklistCount,
      reportOverrideApplied: releaseStatus.localMcp?.reportOverrideApplied,
      localMcpSource: releaseStatus.localMcp?.source,
      blockerIds: Array.isArray(releaseStatus.blockers) ? releaseStatus.blockers.map((blocker) => blocker.id) : [],
      secretValuesReturned: releaseStatus.redaction?.secretValuesReturned,
    }
  );

  const validation = readToolJson(byId.get(9));
  step(steps, "validate", "approval request validates without writing", validation.ok === true && validation.opCount === 1, validation);

  const approval = readToolJson(byId.get(10));
  const approvalFileExists = typeof approval.filePath === "string" && existsSync(approval.filePath);
  const approvalPackage = approvalFileExists ? safeJsonParse(readFileSync(approval.filePath, "utf8")) : null;
  const requestHashOk =
    typeof approval.requestHash === "string" &&
    /^[a-f0-9]{64}$/.test(approval.requestHash) &&
    approvalPackage?.requestHash === approval.requestHash;
  const approvalAuditOk =
    approvalPackage?.opCount === 1 &&
    approvalPackage?.opSummary === approval.opSummary &&
    Array.isArray(approvalPackage?.operationTypes) &&
    approvalPackage.operationTypes.includes("asset.add") &&
    approvalPackage?.approvalPolicy?.writesExecuteDirectly === false &&
    approvalPackage?.approvalPolicy?.approvalImportRequired === true &&
    approvalPackage?.approvalPolicy?.requiresUserApproval === true &&
    requestHashOk;
  step(steps, "approval", "approval request file is created with audit metadata for app import", approval.ok === true && approvalFileExists && approvalAuditOk, {
    filePath: approval.filePath,
    requestId: approval.requestId,
    requestHash: approval.requestHash,
    packageType: approvalPackage?.packageType,
    opCount: approvalPackage?.ops?.length,
    packageOpCount: approvalPackage?.opCount,
    opSummary: approvalPackage?.opSummary,
    operationTypes: approvalPackage?.operationTypes,
    approvalPolicy: approvalPackage?.approvalPolicy,
    requestHashOk,
    approvalAuditOk,
  });

  return {
    ok: steps.every((item) => item.status === "passed"),
    checkedAt,
    transportInputs: ["content-length", "newline-json"],
    inboxDir,
    toolCount: tools.length,
    operationCount: Array.isArray(ops.operationCatalog) ? ops.operationCatalog.length : 0,
    operationTypes: mcpOpTypes,
    operationCategoryCounts: opCategoryCounts,
    brandTemplateCount: templates.summary?.templateCount || 0,
    brandTemplateVariantCount: templates.summary?.variantCount || 0,
    brandTemplateReadyCount: templates.summary?.readyTemplateCount || 0,
    muApiEnvReady: muApiEnv.ok === true,
    muApiRealEvidenceReady: realEvidence.ok === true,
    releaseStatus: releaseStatus.status,
    approvalFilePath: approval.filePath,
    steps,
  };
}

function writeInvalidMuApiReport() {
  const filePath = path.join(mkdtempSync(path.join(os.tmpdir(), "nextlemon-invalid-muapi-report-")), "report.json");
  const report = {
    ok: true,
    configured: true,
    realService: false,
    checkedAt: new Date().toISOString(),
    baseUrl: "http://127.0.0.1:7788",
    remoteSessionId: "mock-session",
    remoteJobId: "mock-job",
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
      { method: "POST", path: "/api/v1/creative-agent/sessions", status: 200, durationMs: 1 },
      { method: "POST", path: "/api/v1/creative-agent/sessions/mock-session/chat", status: 200, durationMs: 1 },
      { method: "GET", path: "/api/v1/creative-agent/jobs/mock-job/events", status: 200, durationMs: 1 },
    ],
  };
  writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`);
  return filePath;
}

function waitForChild(child) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill();
      resolve(-1);
    }, 10_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code ?? 0);
    });
  });
}

function step(steps, id, label, ok, detail) {
  steps.push({
    id,
    label,
    status: ok ? "passed" : "failed",
    detail,
  });
}

function frame(message) {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
}

function parseJsonLines(value) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => safeJsonParse(line))
    .filter(Boolean);
}

function readToolJson(response) {
  const text = response?.result?.content?.[0]?.text;
  return typeof text === "string" ? safeJsonParse(text) || {} : {};
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function readSourceOpCatalog(filePath) {
  try {
    const sourceText = readFileSync(filePath, "utf8");
    const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const declaration = findVariableDeclaration(sourceFile, "CANVAS_AGENT_OP_SPECS");
    if (!declaration?.initializer) return { ok: false, specs: [], error: "CANVAS_AGENT_OP_SPECS declaration not found." };

    const initializer = stripExpression(declaration.initializer);
    if (!ts.isArrayLiteralExpression(initializer)) return { ok: false, specs: [], error: "CANVAS_AGENT_OP_SPECS is not an array literal." };

    return { ok: true, specs: valueFromExpression(initializer), error: "" };
  } catch (error) {
    return { ok: false, specs: [], error: error instanceof Error ? error.message : String(error) };
  }
}

function findVariableDeclaration(sourceFile, name) {
  let found = null;
  visit(sourceFile);
  return found;

  function visit(node) {
    if (found) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  }
}

function valueFromExpression(expression) {
  const node = stripExpression(expression);

  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isIdentifier(node) && node.text === "undefined") return undefined;
  if (ts.isArrayLiteralExpression(node)) return node.elements.map((item) => valueFromExpression(item));
  if (ts.isObjectLiteralExpression(node)) {
    const value = {};
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) {
        throw new Error(`Unsupported op catalog property kind: ${ts.SyntaxKind[property.kind]}`);
      }
      value[propertyName(property.name)] = valueFromExpression(property.initializer);
    }
    return value;
  }

  throw new Error(`Unsupported op catalog expression kind: ${ts.SyntaxKind[node.kind]}`);
}

function stripExpression(expression) {
  let node = expression;
  while (
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression?.(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isParenthesizedExpression(node)
  ) {
    node = node.expression;
  }
  return node;
}

function propertyName(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  throw new Error(`Unsupported op catalog property name kind: ${ts.SyntaxKind[name.kind]}`);
}

function diffValues(expected, actual) {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  return [
    ...expected.filter((item) => !actualSet.has(item)).map((item) => ({ type: item, side: "missing-from-mcp" })),
    ...actual.filter((item) => !expectedSet.has(item)).map((item) => ({ type: item, side: "extra-in-mcp" })),
  ];
}

function countBy(items) {
  return items.reduce((acc, item) => {
    acc[item] = (acc[item] || 0) + 1;
    return acc;
  }, {});
}

function getArgValue(name) {
  const exact = argv.find((item) => item.startsWith(`${name}=`));
  if (exact) return exact.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || "" : "";
}

function writeReport(value) {
  if (!reportPath) return;
  writeFileSync(reportPath, `${JSON.stringify(value, null, 2)}\n`);
}
