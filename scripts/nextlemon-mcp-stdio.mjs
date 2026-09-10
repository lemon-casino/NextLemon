#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import ts from "typescript";
import { validateReport as validateMuApiRealReport } from "./assert-muapi-real-report.mjs";
import { buildReleaseStatus, isSelfTaintedByLocalMcpOnly } from "./nextlemon-release-status.mjs";

const ROOT = process.cwd();
const DEFAULT_INBOX_DIR = path.join(ROOT, "agent-inbox");
const inboxDir = process.env.NEXTLEMON_AGENT_INBOX || DEFAULT_INBOX_DIR;
const projectPackagePath = process.env.NEXTLEMON_PROJECT_PACKAGE || "";
const agentOpSourcePath = path.join(ROOT, "src", "services", "agentOps.ts");
const brandTemplateSourcePath = path.join(ROOT, "src", "services", "designTemplateService.ts");
const DEFAULT_MUAPI_BASE_URL = "https://api.muapi.ai";
const requiredBrandTemplateKinds = ["social-image", "poster", "brand-board", "ppt", "video-cover"];
const requiredMuApiEnvKeys = [
  "MUAPI_BASE_URL",
  "MUAPI_API_KEY",
  "MUAPI_MODEL",
  "MUAPI_CHAT_PROBE",
  "MUAPI_REQUIRE_CHAT",
  "MUAPI_VERIFY_REPORT",
  "MUAPI_ENV_REPORT",
];
const knownVerificationReports = [
  {
    id: "agentic-readiness",
    label: "Agentic readiness",
    path: path.join(ROOT, "releases", "agentic-readiness-report.json"),
  },
  {
    id: "agentic-readiness-strict",
    label: "Strict agentic readiness",
    path: path.join(ROOT, "releases", "agentic-readiness-strict-report.json"),
  },
  {
    id: "muapi-env",
    label: "MuAPI environment preflight",
    path: path.join(ROOT, "releases", "muapi-env-report.json"),
  },
  {
    id: "brand-templates",
    label: "Brand template catalog",
    path: path.join(ROOT, "releases", "brand-template-verification-report.json"),
  },
  {
    id: "muapi-real",
    label: "MuAPI real verification",
    path: path.join(ROOT, "releases", "muapi-real-verification-report.json"),
  },
  {
    id: "muapi-missing-key",
    label: "MuAPI missing key",
    path: path.join(ROOT, "releases", "muapi-missing-key-report.json"),
  },
  {
    id: "muapi-mock",
    label: "MuAPI mock contract",
    path: path.join(ROOT, "releases", "muapi-mock-verification-report.json"),
  },
  {
    id: "local-mcp",
    label: "Local MCP self-test",
    path: path.join(ROOT, "releases", "local-mcp-verification-report.json"),
  },
  {
    id: "local-agent-bridge",
    label: "In-app Local Agent Bridge self-test",
    path: path.join(ROOT, "releases", "local-agent-bridge-verification-report.json"),
  },
];

const fallbackOpSpecs = [
  {
    type: "asset.add",
    category: "asset",
    label: "新增素材",
    required: ["asset.kind"],
    example: {
      type: "asset.add",
      asset: { kind: "text", title: "外部 Agent 需求", text: "等待审批后写入。", source: "agent", tags: ["agent"] },
    },
  },
  {
    type: "asset.update",
    category: "asset",
    label: "更新素材",
    required: ["assetId", "patch"],
    example: { type: "asset.update", assetId: "asset-id", patch: { title: "更新后的标题" } },
  },
  {
    type: "asset.delete",
    category: "asset",
    label: "删除素材",
    required: ["assetIds"],
    example: { type: "asset.delete", assetIds: ["asset-id"] },
  },
  {
    type: "canvas.addItem",
    category: "canvas",
    label: "放入创作画布",
    required: ["assetId"],
    example: { type: "canvas.addItem", assetId: "asset-id", item: { position: { x: 240, y: 180 }, width: 320, height: 240 } },
  },
  {
    type: "canvas.updateItem",
    category: "canvas",
    label: "更新画布素材",
    required: ["itemId", "patch"],
    example: { type: "canvas.updateItem", itemId: "item-id", patch: { width: 420, height: 240 } },
  },
  {
    type: "canvas.deleteItem",
    category: "canvas",
    label: "移除画布素材",
    required: ["itemIds"],
    example: { type: "canvas.deleteItem", itemIds: ["item-id"] },
  },
  {
    type: "canvas.moveItem",
    category: "canvas",
    label: "移动画布素材",
    required: ["itemId", "position.x", "position.y"],
    example: { type: "canvas.moveItem", itemId: "item-id", position: { x: 320, y: 260 } },
  },
  {
    type: "canvas.selectItems",
    category: "canvas",
    label: "选择画布素材",
    required: ["itemIds"],
    example: { type: "canvas.selectItems", itemIds: ["item-id"] },
  },
  {
    type: "canvas.setViewport",
    category: "canvas",
    label: "调整创作视图",
    required: ["viewport.x", "viewport.y", "viewport.zoom"],
    example: { type: "canvas.setViewport", viewport: { x: 0, y: 0, zoom: 1 } },
  },
  {
    type: "workflow.addNode",
    category: "workflow",
    label: "新增工作流节点",
    required: ["nodeType", "position.x", "position.y"],
    example: { type: "workflow.addNode", nodeType: "promptNode", position: { x: 160, y: 160 }, data: { prompt: "生成一张品牌海报" } },
  },
  {
    type: "workflow.updateNode",
    category: "workflow",
    label: "更新工作流节点",
    required: ["nodeId", "data"],
    example: { type: "workflow.updateNode", nodeId: "node-id", data: { label: "更新后的节点" } },
  },
  {
    type: "workflow.connectNodes",
    category: "workflow",
    label: "连接工作流节点",
    required: ["source", "target"],
    example: { type: "workflow.connectNodes", source: "prompt-node-id", target: "image-node-id" },
  },
  {
    type: "workflow.runNode",
    category: "workflow",
    label: "运行工作流节点",
    required: ["nodeId"],
    example: { type: "workflow.runNode", nodeId: "node-id" },
  },
  {
    type: "workflow.selectNodes",
    category: "workflow",
    label: "选择工作流节点",
    required: ["nodeIds"],
    example: { type: "workflow.selectNodes", nodeIds: ["node-id"] },
  },
  {
    type: "library.saveWorkflowNode",
    category: "library",
    label: "保存节点为素材",
    required: ["nodeId"],
    example: { type: "library.saveWorkflowNode", nodeId: "node-id" },
  },
];
const opCatalogSource = readCanvasAgentOpCatalog(agentOpSourcePath);
const opSpecs = opCatalogSource.ok && opCatalogSource.specs.length > 0 ? opCatalogSource.specs : fallbackOpSpecs;
const opTypes = new Set(opSpecs.map((spec) => spec.type));
const operationSchema = buildCanvasAgentOpSchema(opSpecs);
const approvalRequestSchema = buildApprovalRequestSchema(opSpecs);

const tools = [
  {
    name: "nextlemon.get_manifest",
    description: "Return the NextLemon local Agent/MCP contract and safe file-based workflow.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "nextlemon.list_canvas_agent_ops",
    description: "List supported CanvasAgentOp write operations with required fields and examples.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "nextlemon.list_brand_templates",
    description: "List built-in brand/design templates with deliverables, workflow nodes, and acceptance criteria.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: requiredBrandTemplateKinds },
        id: { type: "string" },
        includePromptGuidance: { type: "boolean" },
        includeVariants: { type: "boolean" },
        includeAppliedVariants: { type: "boolean" },
        includeCapabilityMatrix: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "nextlemon.create_brand_spec",
    description: "Create a complete read-only brand spec document from a brand kit, assets, template, and optional template variant.",
    inputSchema: {
      type: "object",
      properties: {
        brandKit: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            colors: { type: "array", items: { type: "string" } },
            fonts: {
              type: "object",
              properties: {
                heading: { type: "string" },
                body: { type: "string" },
              },
              additionalProperties: false,
            },
            logoAssetId: { type: "string" },
            tone: { type: "string", enum: ["professional", "friendly", "bold", "minimal", "playful", "custom"] },
            customTone: { type: "string" },
            referenceAssetIds: { type: "array", items: { type: "string" } },
            createdAt: { type: "number" },
            updatedAt: { type: "number" },
          },
          required: ["name"],
          additionalProperties: true,
        },
        assets: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              title: { type: "string" },
              kind: { type: "string", enum: ["text", "image", "video", "audio"] },
            },
            required: ["id", "kind"],
            additionalProperties: true,
          },
        },
        templateId: { type: "string" },
        variantId: { type: "string" },
      },
      required: ["brandKit"],
      additionalProperties: false,
    },
  },
  {
    name: "nextlemon.read_project_package",
    description: "Read a NextLemon project package JSON from NEXTLEMON_PROJECT_PACKAGE or an explicit path.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "nextlemon.read_verification_reports",
    description: "Read summarized local readiness, brand template, MCP, and MuAPI verification reports from the releases folder.",
    inputSchema: {
      type: "object",
      properties: {
        includeRaw: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "nextlemon.check_muapi_env",
    description: "Check MuAPI real-service verification prerequisites without exposing secrets.",
    inputSchema: {
      type: "object",
      properties: {
        requireReal: { type: "boolean" },
        requireChat: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "nextlemon.assert_muapi_real_report",
    description: "Assert that a MuAPI verification report contains strict real-service evidence.",
    inputSchema: {
      type: "object",
      properties: {
        reportPath: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "nextlemon.get_release_status",
    description: "Return one consolidated release readiness status for local prerelease and strict MuAPI-gated release.",
    inputSchema: {
      type: "object",
      properties: {
        includeReports: { type: "boolean" },
        currentLocalMcpReport: {
          type: "object",
          description: "Optional in-progress local MCP self-test summary. Used only to avoid reading stale local MCP reports during self-verification.",
          properties: {
            ok: { type: "boolean" },
            toolCount: { type: "number" },
            operationCount: { type: "number" },
            operationTypes: { type: "array", items: { type: "string" } },
            operationCategoryCounts: {
              type: "object",
              additionalProperties: { type: "number" },
            },
            brandTemplateCount: { type: "number" },
            brandTemplateVariantCount: { type: "number" },
            brandTemplateReadyCount: { type: "number" },
            muApiEnvReady: { type: "boolean" },
            muApiRealEvidenceReady: { type: "boolean" },
            source: { type: "string" },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "nextlemon.validate_approval_request",
    description: "Validate a CanvasAgentOp approval request without writing an inbox file.",
    inputSchema: approvalRequestSchema,
  },
  {
    name: "nextlemon.create_approval_request",
    description: "Write a CanvasAgentOp approval request JSON file that can be imported into NextLemon.",
    inputSchema: approvalRequestSchema,
  },
];

let inputBuffer = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  inputBuffer = Buffer.concat([inputBuffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
  drainInputBuffer();
});

function drainInputBuffer() {
  while (inputBuffer.length > 0) {
    inputBuffer = stripLeadingLineBreaks(inputBuffer);
    if (inputBuffer.length === 0) return;

    if (startsWithContentLength(inputBuffer)) {
      const parsed = readContentLengthFrame(inputBuffer);
      if (!parsed) return;
      inputBuffer = parsed.remaining;
      handleLine(parsed.body);
      continue;
    }

    const lineEnd = inputBuffer.indexOf(0x0a);
    if (lineEnd === -1) return;
    const line = inputBuffer.slice(0, lineEnd).toString("utf8").trim();
    inputBuffer = inputBuffer.slice(lineEnd + 1);
    if (line) handleLine(line);
  }
}

function stripLeadingLineBreaks(value) {
  let index = 0;
  while (index < value.length && (value[index] === 0x0a || value[index] === 0x0d)) index += 1;
  return index === 0 ? value : value.slice(index);
}

function startsWithContentLength(value) {
  return value.slice(0, 15).toString("ascii").toLowerCase() === "content-length:";
}

function readContentLengthFrame(value) {
  const header = findHeaderEnd(value);
  if (!header) return null;
  const headerText = value.slice(0, header.index).toString("ascii");
  const match = /content-length:\s*(\d+)/i.exec(headerText);
  if (!match) {
    writeError(null, -32600, "Invalid framed message: missing Content-Length");
    inputBuffer = value.slice(header.index + header.length);
    return null;
  }

  const contentLength = Number(match[1]);
  if (!Number.isFinite(contentLength) || contentLength < 0) {
    writeError(null, -32600, "Invalid framed message: bad Content-Length");
    inputBuffer = value.slice(header.index + header.length);
    return null;
  }

  const bodyStart = header.index + header.length;
  const frameEnd = bodyStart + contentLength;
  if (value.length < frameEnd) return null;

  return {
    body: value.slice(bodyStart, frameEnd).toString("utf8"),
    remaining: value.slice(frameEnd),
  };
}

function findHeaderEnd(value) {
  const crlf = value.indexOf(Buffer.from("\r\n\r\n"));
  if (crlf !== -1) return { index: crlf, length: 4 };
  const lf = value.indexOf(Buffer.from("\n\n"));
  if (lf !== -1) return { index: lf, length: 2 };
  return null;
}

function handleLine(line) {
  let request;
  try {
    request = JSON.parse(line);
  } catch (error) {
    writeError(null, -32700, "Parse error", String(error));
    return;
  }

  Promise.resolve(handleRequest(request)).catch((error) => {
    writeError(request.id, -32603, error instanceof Error ? error.message : String(error));
  });
}

async function handleRequest(request) {
  if (request.method === "initialize") {
    writeResult(request.id, {
      protocolVersion: "2024-11-05",
      serverInfo: { name: "nextlemon-local-mcp", version: "0.1.0" },
      capabilities: { tools: {} },
    });
    return;
  }

  if (request.method === "tools/list") {
    writeResult(request.id, { tools });
    return;
  }

  if (request.method === "tools/call") {
    const name = request.params?.name;
    const args = getRecord(request.params?.arguments);
    const result = await callTool(name, args);
    writeResult(request.id, {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    });
    return;
  }

  if (request.method === "notifications/initialized") return;
  writeError(request.id, -32601, `Unknown method: ${request.method}`);
}

async function callTool(name, args) {
  if (name === "nextlemon.get_manifest") {
    return {
      name: "nextlemon-local-mcp",
      transport: "stdio",
      mode: "file-based-approval-inbox",
      inboxDir,
      projectPackagePath: projectPackagePath || null,
      tools,
      safety: {
        writesExecuteDirectly: false,
        approvalImportRequired: true,
      },
      operationCatalog: opSpecs,
      operationSchema,
      approvalRequestSchema,
      operationCatalogSource: {
        sourcePath: path.relative(ROOT, agentOpSourcePath),
        parsedFromSource: opCatalogSource.ok,
        fallbackUsed: !(opCatalogSource.ok && opCatalogSource.specs.length > 0),
        error: opCatalogSource.error || undefined,
      },
      brandTemplates: {
        requiredKinds: requiredBrandTemplateKinds,
        sourcePath: path.relative(ROOT, brandTemplateSourcePath),
        tool: "nextlemon.list_brand_templates",
        brandSpecTool: "nextlemon.create_brand_spec",
        supportsVariants: true,
        supportsAppliedVariants: true,
        supportsCapabilityMatrix: true,
        supportsBrandSpecExport: true,
        supportsVariantBrandSpec: true,
        expectedTemplateCount: 5,
        expectedVariantCount: 15,
        expectedAppliedVariantCount: 15,
        recommendedArguments: {
          includePromptGuidance: false,
          includeVariants: true,
          includeAppliedVariants: true,
          includeCapabilityMatrix: true,
        },
      },
      muApiPreflight: {
        tool: "nextlemon.check_muapi_env",
        secretValuesReturned: false,
        requiredEnvKeys: requiredMuApiEnvKeys,
      },
      muApiRealEvidence: {
        tool: "nextlemon.assert_muapi_real_report",
        defaultReportPath: path.join("releases", "muapi-real-verification-report.json"),
        requiresNonLocalhost: true,
        requiresEndpoint2xxEvidence: true,
        requiresRedactedReport: true,
      },
      releaseStatus: {
        tool: "nextlemon.get_release_status",
      },
      verificationReports: knownVerificationReports.map((report) => ({
        id: report.id,
        label: report.label,
        path: path.relative(ROOT, report.path),
      })),
    };
  }

  if (name === "nextlemon.list_brand_templates") {
    return listBrandTemplates(args);
  }

  if (name === "nextlemon.create_brand_spec") {
    return createBrandSpec(args);
  }

  if (name === "nextlemon.list_canvas_agent_ops") {
    return {
      operationCatalog: opSpecs,
      supportedTypes: [...opTypes],
      operationSchema,
      approvalRequestSchema,
      sourcePath: path.relative(ROOT, agentOpSourcePath),
      sourceParsed: opCatalogSource.ok,
      fallbackUsed: !(opCatalogSource.ok && opCatalogSource.specs.length > 0),
      sourceError: opCatalogSource.error || undefined,
    };
  }

  if (name === "nextlemon.read_project_package") {
    const filePath = args.path || projectPackagePath;
    if (!filePath) throw new Error("Missing project package path. Set NEXTLEMON_PROJECT_PACKAGE or pass path.");
    const projectPackage = JSON.parse(readFileSync(filePath, "utf8"));
    return {
      path: filePath,
      packageType: projectPackage.packageType,
      schemaVersion: projectPackage.schemaVersion,
      manifest: projectPackage.manifest,
      assetManifestCount: Array.isArray(projectPackage.assetManifest) ? projectPackage.assetManifest.length : 0,
    };
  }

  if (name === "nextlemon.read_verification_reports") {
    return readVerificationReports(Boolean(args.includeRaw));
  }

  if (name === "nextlemon.check_muapi_env") {
    return checkMuApiEnv(args);
  }

  if (name === "nextlemon.assert_muapi_real_report") {
    const reportPath = typeof args.reportPath === "string" && args.reportPath.trim()
      ? args.reportPath.trim()
      : path.join("releases", "muapi-real-verification-report.json");
    return {
      ...validateMuApiRealReport(reportPath),
      evidencePolicy: {
        mockReportsAccepted: false,
        localhostAccepted: false,
        requiredSteps: ["config", "account", "skills", "session", "chat", "events"],
        requiredEndpoint2xxEvidence: true,
        requiresEndpoint2xxEvidence: true,
        requiresNonLocalhost: true,
        requiresRemoteSessionId: true,
        requiresRemoteJobId: true,
        requiresRedactedReport: true,
      },
    };
  }

  if (name === "nextlemon.get_release_status") {
    return getReleaseStatus(args);
  }

  if (name === "nextlemon.create_approval_request") {
    const validation = validateApprovalRequest(args);
    if (!validation.ok) throw new Error(validation.errors.join("; "));
    const ops = args.ops;

    mkdirSync(inboxDir, { recursive: true });
    const request = {
      packageType: "nextlemon.agent-approval-request",
      schemaVersion: 1,
      id: randomUUID(),
      title: typeof args.title === "string" && args.title.trim() ? args.title.trim() : "外部 MCP 写操作",
      createdAt: Date.now(),
      source: "nextlemon-local-mcp",
      opCount: ops.length,
      opSummary: summarizeOps(ops),
      operationTypes: [...new Set(ops.map((op) => op.type).filter(Boolean))].sort(),
      approvalPolicy: {
        writesExecuteDirectly: false,
        approvalImportRequired: true,
        requiresUserApproval: true,
      },
      ops,
    };
    request.requestHash = hashApprovalRequest(request);
    const filePath = path.join(inboxDir, `${request.id}.json`);
    writeFileSync(filePath, `${JSON.stringify(request, null, 2)}\n`);
    return {
      ok: true,
      filePath,
      requestId: request.id,
      title: request.title,
      opCount: ops.length,
      opSummary: request.opSummary,
      operationTypes: request.operationTypes,
      requestHash: request.requestHash,
    };
  }

  if (name === "nextlemon.validate_approval_request") {
    return validateApprovalRequest(args);
  }

  throw new Error(`Unknown tool: ${name}`);
}

async function listBrandTemplates(args) {
  const includePromptGuidance = args.includePromptGuidance !== false;
  const includeAppliedVariants = args.includeAppliedVariants === true;
  const includeVariants = args.includeVariants === true || includeAppliedVariants;
  const includeCapabilityMatrix = args.includeCapabilityMatrix === true;
  let templates = [];
  let templateModule = null;
  let sourceMode = "ast";
  let error = "";
  try {
    const catalog = await readDesignTemplateCatalog();
    templates = catalog.templates;
    templateModule = catalog.templateModule;
    sourceMode = catalog.sourceMode;
    error = catalog.error;
  } catch (parseError) {
    error = parseError instanceof Error ? parseError.message : String(parseError);
  }

  const filtered = templates.filter((template) => {
    if (typeof args.kind === "string" && template.kind !== args.kind) return false;
    if (typeof args.id === "string" && template.id !== args.id) return false;
    return true;
  });
  const kinds = [...new Set(templates.map((template) => template.kind))].sort();
  const summarized = filtered.map((template) =>
    summarizeBrandTemplate(template, {
      includePromptGuidance,
      includeVariants,
      includeAppliedVariants,
      templateModule,
    })
  );
  const capabilityMatrix = includeCapabilityMatrix ? readTemplateCapabilityMatrix(templates, templateModule) : null;

  return {
    ok: !error && (!includeCapabilityMatrix || Boolean(capabilityMatrix?.matrix)),
    sourcePath: path.relative(ROOT, brandTemplateSourcePath),
    sourceMode,
    moduleLoaded: Boolean(templateModule),
    requiredKinds: requiredBrandTemplateKinds,
    summary: {
      templateCount: templates.length,
      filteredCount: filtered.length,
      kindCount: kinds.length,
      missingKinds: requiredBrandTemplateKinds.filter((kind) => !kinds.includes(kind)),
      variantCount: summarized.reduce((sum, template) => sum + (Number(template.variantCount) || 0), 0),
      appliedVariantCount: summarized.reduce(
        (sum, template) => sum + (Array.isArray(template.appliedVariants) ? template.appliedVariants.length : 0),
        0
      ),
      capabilityTemplateCount: capabilityMatrix?.matrix?.templateCount,
      readyTemplateCount: capabilityMatrix?.matrix?.readyTemplateCount,
      capabilityVariantCount: capabilityMatrix?.matrix?.variantCount,
    },
    filters: {
      kind: typeof args.kind === "string" ? args.kind : undefined,
      id: typeof args.id === "string" ? args.id : undefined,
      includePromptGuidance,
      includeVariants,
      includeAppliedVariants,
      includeCapabilityMatrix,
    },
    error: error || undefined,
    ...(capabilityMatrix
      ? {
          capabilityMatrix: capabilityMatrix.matrix,
          capabilityMatrixSource: capabilityMatrix.source,
          capabilityMatrixError: capabilityMatrix.error || undefined,
        }
      : {}),
    templates: summarized,
  };
}

async function createBrandSpec(args) {
  const brandKit = normalizeBrandKitInput(args.brandKit);
  const assets = normalizeBrandAssetsInput(args.assets);
  const templateId = typeof args.templateId === "string" ? args.templateId.trim() : "";
  const explicitVariantId = typeof args.variantId === "string" ? args.variantId.trim() : "";
  const catalog = await readDesignTemplateCatalog();
  if (!catalog.templateModule || typeof catalog.templateModule.createBrandSpecDocument !== "function") {
    throw new Error(`Template service module did not expose createBrandSpecDocument: ${catalog.error || "unknown error"}`);
  }

  const { template, variantId } = resolveTemplateForBrandSpec(
    catalog.templates,
    catalog.templateModule,
    templateId,
    explicitVariantId
  );
  const spec = catalog.templateModule.createBrandSpecDocument(brandKit, assets, template);

  return {
    ok: true,
    sourcePath: path.relative(ROOT, brandTemplateSourcePath),
    sourceMode: catalog.sourceMode,
    moduleLoaded: Boolean(catalog.templateModule),
    templateId: template?.id,
    baseTemplateId: templateId ? getBaseTemplateId(templateId) : undefined,
    variantId,
    validation: spec.validation,
    templateCapability: spec.templateCapability,
    templateCatalog: spec.templateCatalog,
    promptGuidanceCount: Array.isArray(spec.promptGuidance) ? spec.promptGuidance.length : 0,
    usageNoteCount: Array.isArray(spec.usageNotes) ? spec.usageNotes.length : 0,
    spec,
  };
}

function normalizeBrandKitInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("brandKit must be an object.");
  }
  const record = value;
  const now = Date.now();
  const tone = typeof record.tone === "string" && ["professional", "friendly", "bold", "minimal", "playful", "custom"].includes(record.tone)
    ? record.tone
    : "professional";
  const fonts = getRecord(record.fonts);
  return {
    id: typeof record.id === "string" && record.id.trim() ? record.id.trim() : `mcp-brand-${now}`,
    name: typeof record.name === "string" ? record.name.trim() : "",
    colors: Array.isArray(record.colors) ? record.colors.filter((color) => typeof color === "string").map((color) => color.trim()) : [],
    fonts: {
      heading: typeof fonts.heading === "string" ? fonts.heading.trim() : "",
      body: typeof fonts.body === "string" ? fonts.body.trim() : "",
    },
    logoAssetId: typeof record.logoAssetId === "string" && record.logoAssetId.trim() ? record.logoAssetId.trim() : undefined,
    tone,
    customTone: typeof record.customTone === "string" ? record.customTone.trim() : undefined,
    referenceAssetIds: Array.isArray(record.referenceAssetIds)
      ? record.referenceAssetIds.filter((id) => typeof id === "string" && id.trim()).map((id) => id.trim())
      : [],
    createdAt: Number.isFinite(record.createdAt) ? record.createdAt : now,
    updatedAt: Number.isFinite(record.updatedAt) ? record.updatedAt : now,
    metadata: getRecord(record.metadata),
  };
}

function normalizeBrandAssetsInput(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("assets must be an array when provided.");
  return value
    .map((item) => getRecord(item))
    .filter((item) => typeof item.id === "string" && item.id.trim())
    .map((item) => ({
      id: item.id.trim(),
      title: typeof item.title === "string" && item.title.trim() ? item.title.trim() : item.id.trim(),
      kind: ["text", "image", "video", "audio"].includes(item.kind) ? item.kind : "text",
      source: typeof item.source === "string" ? item.source : "agent",
      tags: Array.isArray(item.tags) ? item.tags.filter((tag) => typeof tag === "string") : [],
      createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
      updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : Date.now(),
    }));
}

function resolveTemplateForBrandSpec(templates, templateModule, templateId, variantId) {
  if (!templateId) return { template: undefined, variantId: undefined };
  const baseTemplateId = getBaseTemplateId(templateId);
  const inferredVariantId = variantId || getVariantIdFromTemplateId(templateId);
  const baseTemplate = templates.find((template) => template.id === baseTemplateId || template.id === templateId);
  if (!baseTemplate) throw new Error(`Unknown design template: ${templateId}`);
  if (!inferredVariantId) return { template: baseTemplate, variantId: undefined };
  if (typeof templateModule.getTemplateVariants !== "function" || typeof templateModule.applyTemplateVariant !== "function") {
    throw new Error("Template service module did not expose variant helpers.");
  }
  const variant = templateModule.getTemplateVariants(baseTemplate).find((item) => item.id === inferredVariantId);
  if (!variant) throw new Error(`Unknown template variant "${inferredVariantId}" for ${baseTemplate.id}.`);
  return {
    template: templateModule.applyTemplateVariant(baseTemplate, variant),
    variantId: inferredVariantId,
  };
}

function getBaseTemplateId(templateId) {
  return templateId.includes("__") ? templateId.split("__")[0] : templateId;
}

function getVariantIdFromTemplateId(templateId) {
  return templateId.includes("__") ? templateId.split("__").slice(1).join("__") : "";
}

function summarizeBrandTemplate(template, options) {
  const {
    includePromptGuidance,
    includeVariants = false,
    includeAppliedVariants = false,
    templateModule = null,
  } = options || {};
  const summary = {
    id: template.id,
    kind: template.kind,
    planKind: template.planKind,
    name: template.name,
    description: template.description,
    outputKind: template.outputKind,
    aspectRatio: template.aspectRatio,
    videoSize: template.videoSize,
    pageCountRange: template.pageCountRange,
    deliverables: Array.isArray(template.deliverables) ? template.deliverables : [],
    recommendedWorkflowNodes: Array.isArray(template.recommendedWorkflowNodes) ? template.recommendedWorkflowNodes : [],
    acceptanceCriteria: Array.isArray(template.acceptanceCriteria) ? template.acceptanceCriteria : [],
    tags: Array.isArray(template.tags) ? template.tags : [],
    modelHint: template.modelHint,
    ...(includePromptGuidance
      ? {
          defaultBrief: template.defaultBrief,
          promptGuidance: Array.isArray(template.promptGuidance) ? template.promptGuidance : [],
        }
      : {}),
  };

  if (!includeVariants) return summary;

  const variantState = readTemplateVariants(template, templateModule);
  summary.variantCount = variantState.variants.length;
  summary.variants = variantState.variants.map(summarizeTemplateVariant);
  summary.variantSource = variantState.source;
  if (variantState.error) summary.variantError = variantState.error;

  if (includeAppliedVariants) {
    summary.appliedVariants = variantState.variants
      .map((variant) => applyTemplateVariantSafely(template, variant, templateModule))
      .filter(Boolean)
      .map((applied) =>
        summarizeBrandTemplate(applied, {
          includePromptGuidance,
          includeVariants: false,
          includeAppliedVariants: false,
          templateModule: null,
        })
      );
  }

  return summary;
}

function summarizeTemplateVariant(variant) {
  return {
    id: variant.id,
    name: variant.name,
    description: variant.description,
    briefSuffix: variant.briefSuffix,
    promptGuidance: Array.isArray(variant.promptGuidance) ? variant.promptGuidance : [],
    acceptanceCriteria: Array.isArray(variant.acceptanceCriteria) ? variant.acceptanceCriteria : [],
    tags: Array.isArray(variant.tags) ? variant.tags : [],
  };
}

function readTemplateVariants(template, templateModule) {
  if (!templateModule || typeof templateModule.getTemplateVariants !== "function") {
    return { variants: [], source: "unavailable", error: "Template service module did not load." };
  }

  try {
    const variants = templateModule.getTemplateVariants(template);
    return {
      variants: Array.isArray(variants) ? variants : [],
      source: "designTemplateService.getTemplateVariants",
      error: Array.isArray(variants) ? "" : "getTemplateVariants did not return an array.",
    };
  } catch (error) {
    return {
      variants: [],
      source: "designTemplateService.getTemplateVariants",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function applyTemplateVariantSafely(template, variant, templateModule) {
  if (!templateModule || typeof templateModule.applyTemplateVariant !== "function") return null;
  try {
    return templateModule.applyTemplateVariant(template, variant);
  } catch {
    return null;
  }
}

function readTemplateCapabilityMatrix(templates, templateModule) {
  if (!templateModule || typeof templateModule.createDesignTemplateCapabilityMatrix !== "function") {
    return {
      matrix: null,
      source: "unavailable",
      error: "Template service module did not expose createDesignTemplateCapabilityMatrix.",
    };
  }

  try {
    return {
      matrix: templateModule.createDesignTemplateCapabilityMatrix(templates),
      source: "designTemplateService.createDesignTemplateCapabilityMatrix",
      error: "",
    };
  } catch (error) {
    return {
      matrix: null,
      source: "designTemplateService.createDesignTemplateCapabilityMatrix",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function checkMuApiEnv(args) {
  const env = readEnvValues();
  const requireReal = args.requireReal !== false;
  const requireChat = args.requireChat !== false;
  const baseUrl = normalizeBaseUrl(env.MUAPI_BASE_URL || DEFAULT_MUAPI_BASE_URL);
  const apiKey = (env.MUAPI_API_KEY || "").trim();
  const model = (env.MUAPI_MODEL || "gpt-4o").trim();
  const chatProbe = (env.MUAPI_CHAT_PROBE || "").trim();
  const envLocalPath = path.join(ROOT, ".env.local");
  const envPath = path.join(ROOT, ".env");
  const envExamplePath = path.join(ROOT, ".env.example");
  const gitignorePath = path.join(ROOT, ".gitignore");

  const checks = [
    createMuApiCheck("env-template", ".env.example contains required MuAPI keys", checkMuApiEnvTemplate(envExamplePath)),
    createMuApiCheck("secret-hygiene", ".env.local is ignored by git", checkMuApiGitignore(gitignorePath)),
    createMuApiCheck("base-url", "MUAPI_BASE_URL is parseable", checkMuApiBaseUrl(baseUrl)),
    createMuApiCheck("api-key", "MUAPI_API_KEY is configured", checkMuApiKey(apiKey)),
    createMuApiCheck("model", "MUAPI_MODEL is configured", Boolean(model), "MUAPI_MODEL is empty."),
    createMuApiCheck(
      "chat-probe",
      "MUAPI_CHAT_PROBE is configured when strict chat verification is required",
      !requireChat || Boolean(chatProbe),
      "MUAPI_CHAT_PROBE is required for strict chat verification."
    ),
    createMuApiCheck(
      "real-base-url",
      "Base URL is not localhost when real service verification is required",
      !requireReal || !isLocalhostUrl(baseUrl),
      "MUAPI_BASE_URL points to localhost; use a real MuAPI endpoint."
    ),
  ];
  const missingEnvKeys = checks
    .filter((check) => check.status === "failed")
    .map((check) => {
      if (check.id === "api-key") return "MUAPI_API_KEY";
      if (check.id === "chat-probe") return "MUAPI_CHAT_PROBE";
      if (check.id === "model") return "MUAPI_MODEL";
      return "";
    })
    .filter(Boolean);
  const failedEnvKeys = checks
    .filter((check) => check.status === "failed")
    .map((check) => checkToMuApiEnvKey(check.id))
    .filter(Boolean);

  return {
    ok: checks.every((check) => check.status === "passed"),
    checkedAt: new Date().toISOString(),
    requireReal,
    requireChat,
    envLocalExists: existsSync(envLocalPath),
    envExists: existsSync(envPath),
    envExampleExists: existsSync(envExamplePath),
    baseUrl,
    modelConfigured: Boolean(model),
    apiKeyConfigured: Boolean(apiKey) && !looksLikePlaceholder(apiKey),
    chatProbeConfigured: Boolean(chatProbe),
    missingEnvKeys,
    failedEnvKeys,
    checks,
    redaction: {
      secretValuesReturned: false,
      redactedKeys: ["MUAPI_API_KEY", "MUAPI_CHAT_PROBE"],
    },
    nextCommands: {
      copyTemplate: "copy .env.example .env.local",
      envPreflight: "npm run verify:muapi:env -- --json --require-real --require-chat --report releases\\muapi-env-report.json",
      strictVerify: "npm run verify:muapi -- --json --require-chat --report releases\\muapi-real-verification-report.json",
      assertReal: "npm run verify:muapi:assert-real -- --json --report releases\\muapi-real-verification-report.json",
      release: "npm run verify:release -- --json --report releases\\agentic-readiness-strict-report.json",
    },
  };
}

function checkToMuApiEnvKey(checkId) {
  if (checkId === "api-key") return "MUAPI_API_KEY";
  if (checkId === "chat-probe") return "MUAPI_CHAT_PROBE";
  if (checkId === "model") return "MUAPI_MODEL";
  if (checkId === "base-url" || checkId === "real-base-url") return "MUAPI_BASE_URL";
  return "";
}

function getReleaseStatus(args) {
  const includeReports = Boolean(args.includeReports);
  const localReportPath = path.join("releases", "agentic-readiness-report.json");
  const strictReportPath = path.join("releases", "agentic-readiness-strict-report.json");
  const localMcpReportPath = path.join("releases", "local-mcp-verification-report.json");
  const brandTemplateReportPath = path.join("releases", "brand-template-verification-report.json");
  const realReportPath = path.join("releases", "muapi-real-verification-report.json");

  const localReport = readJsonReport(localReportPath);
  const strictReport = readJsonReport(strictReportPath);
  const localMcpReport = withCurrentLocalMcpReport(readJsonReport(localMcpReportPath), args.currentLocalMcpReport);
  const brandTemplateReport = readJsonReport(brandTemplateReportPath);
  const muApiEnv = checkMuApiEnv({ requireReal: true, requireChat: true });
  const realEvidence = {
    ...validateMuApiRealReport(realReportPath),
    evidencePolicy: {
      mockReportsAccepted: false,
      localhostAccepted: false,
      requiredEndpoint2xxEvidence: true,
    },
  };
  return buildReleaseStatus({
    includeReports,
    paths: {
      localReportPath,
      strictReportPath,
      localMcpReportPath,
      brandTemplateReportPath,
      realReportPath,
    },
    localReport,
    strictReport,
    localMcpReport,
    brandTemplateReport,
    muApiEnv,
    realEvidence,
    reports: includeReports ? readVerificationReports(false) : undefined,
  });
}

function readJsonReport(reportPath) {
  const absolutePath = path.resolve(ROOT, reportPath);
  try {
    return {
      exists: true,
      data: safeJsonParse(readFileSync(absolutePath, "utf8")),
    };
  } catch {
    return {
      exists: false,
      data: null,
    };
  }
}

function withCurrentLocalMcpReport(report, currentLocalMcpReport) {
  if (!isRecord(currentLocalMcpReport)) return report;
  const safeOverride = pickLocalMcpReportFields(currentLocalMcpReport);
  if (Object.keys(safeOverride).length === 0) return report;
  const diskData = isRecord(report.data) ? report.data : {};
  return {
    exists: true,
    data: {
      ...diskData,
      ...safeOverride,
      reportOverrideApplied: true,
      reportOverrideReason: "current-local-mcp-self-test",
    },
  };
}

function pickLocalMcpReportFields(value) {
  const output = {};
  for (const key of ["ok", "muApiEnvReady", "muApiRealEvidenceReady"]) {
    if (typeof value[key] === "boolean") output[key] = value[key];
  }
  for (const key of [
    "toolCount",
    "operationCount",
    "brandTemplateCount",
    "brandTemplateVariantCount",
    "brandTemplateReadyCount",
    "approvalSchemaOneOfCount",
  ]) {
    if (Number.isFinite(value[key]) && value[key] >= 0) output[key] = value[key];
  }
  for (const key of ["operationTypes", "operationCategories", "operationDrift", "blockerIds"]) {
    if (Array.isArray(value[key])) output[key] = value[key].filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim());
  }
  if (isRecord(value.operationCategoryCounts)) {
    output.operationCategoryCounts = Object.fromEntries(
      Object.entries(value.operationCategoryCounts)
        .filter(([key, count]) => typeof key === "string" && key.trim() && Number.isFinite(count))
        .map(([key, count]) => [key, count])
    );
  }
  if (typeof value.releaseStatus === "string" && value.releaseStatus.trim()) {
    output.releaseStatus = value.releaseStatus.trim().slice(0, 120);
  }
  if (typeof value.source === "string" && value.source.trim()) {
    output.source = value.source.trim().slice(0, 120);
  }
  return output;
}

function readEnvValues() {
  const values = { ...process.env };
  for (const fileName of [".env.local", ".env"]) {
    const filePath = path.join(ROOT, fileName);
    if (!existsSync(filePath)) continue;
    const content = readFileSync(filePath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const [key, ...rest] = trimmed.split("=");
      if (!key || values[key] !== undefined) continue;
      values[key] = rest.join("=").replace(/^['"]|['"]$/g, "");
    }
  }
  return values;
}

function checkMuApiEnvTemplate(envExamplePath) {
  if (!existsSync(envExamplePath)) return { ok: false, error: ".env.example does not exist." };
  const content = readFileSync(envExamplePath, "utf8");
  const missing = requiredMuApiEnvKeys.filter((key) => !new RegExp(`^${key}=`, "m").test(content));
  return {
    ok: missing.length === 0,
    detail: { required: requiredMuApiEnvKeys, missing },
    error: missing.length ? `Missing keys: ${missing.join(", ")}` : undefined,
  };
}

function checkMuApiGitignore(gitignorePath) {
  if (!existsSync(gitignorePath)) return { ok: false, error: ".gitignore does not exist." };
  const gitignore = readFileSync(gitignorePath, "utf8");
  const ok = /^\.env\.local$/m.test(gitignore) || /^\*\.local$/m.test(gitignore);
  return {
    ok,
    error: ok ? undefined : ".gitignore should ignore .env.local or *.local.",
  };
}

function checkMuApiBaseUrl(baseUrl) {
  try {
    const url = new URL(baseUrl);
    const ok = url.protocol === "https:" || url.protocol === "http:";
    return {
      ok,
      detail: { protocol: url.protocol, hostname: url.hostname },
      error: ok ? undefined : "Base URL must use http or https.",
    };
  } catch {
    return { ok: false, error: "MUAPI_BASE_URL is not a valid URL." };
  }
}

function checkMuApiKey(apiKey) {
  if (!apiKey) return { ok: false, error: "MUAPI_API_KEY is empty." };
  return {
    ok: !looksLikePlaceholder(apiKey),
    error: looksLikePlaceholder(apiKey) ? "MUAPI_API_KEY looks like a placeholder/mock value." : undefined,
  };
}

function createMuApiCheck(id, label, value, fallbackError) {
  const normalized = typeof value === "object" && value !== null ? value : { ok: Boolean(value), error: fallbackError };
  return {
    id,
    label,
    status: normalized.ok ? "passed" : "failed",
    detail: normalized.detail,
    error: normalized.ok ? undefined : normalized.error || fallbackError,
  };
}

function normalizeBaseUrl(value) {
  return value.trim().replace(/\/+$/, "");
}

function looksLikePlaceholder(secret) {
  const lowered = secret.toLowerCase();
  return ["mock", "test-key", "example", "your-api-key", "changeme"].some((item) => lowered.includes(item));
}

function isLocalhostUrl(value) {
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return true;
  }
}

async function readDesignTemplateCatalog() {
  let moduleError = "";
  try {
    const templateModule = await importDesignTemplateModule(brandTemplateSourcePath);
    const templates = Array.isArray(templateModule.DESIGN_TEMPLATES) ? templateModule.DESIGN_TEMPLATES : [];
    if (templates.length > 0) {
      return {
        templates,
        templateModule,
        sourceMode: "module",
        error: "",
      };
    }
    moduleError = "DESIGN_TEMPLATES export is empty or missing.";
  } catch (error) {
    moduleError = error instanceof Error ? error.message : String(error);
  }

  const templates = readDesignTemplates();
  return {
    templates,
    templateModule: null,
    sourceMode: "ast",
    error: moduleError ? `Template service module could not load for variants: ${moduleError}` : "",
  };
}

async function importDesignTemplateModule(filePath) {
  const sourceText = readFileSync(filePath, "utf8");
  const output = ts.transpileModule(sourceText, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
    fileName: filePath,
  }).outputText;
  const url = `data:text/javascript;base64,${Buffer.from(output, "utf8").toString("base64")}`;
  return import(url);
}

function readDesignTemplates() {
  const sourceText = readFileSync(brandTemplateSourcePath, "utf8");
  const sourceFile = ts.createSourceFile(brandTemplateSourcePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declaration = findVariableDeclaration(sourceFile, "DESIGN_TEMPLATES");
  if (!declaration?.initializer) return [];

  const initializer = stripExpression(declaration.initializer);
  if (!ts.isArrayLiteralExpression(initializer)) return [];
  return valueFromExpression(initializer);
}

function readCanvasAgentOpCatalog(filePath) {
  try {
    const sourceText = readFileSync(filePath, "utf8");
    const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const declaration = findVariableDeclaration(sourceFile, "CANVAS_AGENT_OP_SPECS");
    if (!declaration?.initializer) {
      return { ok: false, specs: [], error: "CANVAS_AGENT_OP_SPECS declaration not found." };
    }
    const initializer = stripExpression(declaration.initializer);
    if (!ts.isArrayLiteralExpression(initializer)) {
      return { ok: false, specs: [], error: "CANVAS_AGENT_OP_SPECS is not an array literal." };
    }
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
        throw new Error(`Unsupported template property kind: ${ts.SyntaxKind[property.kind]}`);
      }
      value[propertyName(property.name)] = valueFromExpression(property.initializer);
    }
    return value;
  }

  throw new Error(`Unsupported template expression kind: ${ts.SyntaxKind[node.kind]}`);
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
  throw new Error(`Unsupported property name kind: ${ts.SyntaxKind[name.kind]}`);
}

function writeResult(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function writeError(id, code, message, data) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message, data } })}\n`);
}

function getRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function validateApprovalRequest(args) {
  const ops = Array.isArray(args.ops) ? args.ops : null;
  if (!ops) return { ok: false, opCount: 0, errors: ["ops must be an array."] };
  if (ops.length === 0) return { ok: false, opCount: 0, errors: ["Approval request requires non-empty ops."] };
  const errors = ops
    .map((op, index) => {
      const error = validateOp(op);
      return error ? `#${index + 1} ${error}` : null;
    })
    .filter(Boolean);
  return {
    ok: errors.length === 0,
    opCount: ops.length,
    summary: errors.length === 0 ? summarizeOps(ops) : undefined,
    errors,
  };
}

function readVerificationReports(includeRaw) {
  const reports = knownVerificationReports.map((report) => {
    const exists = fileExists(report.path);
    if (!exists) {
      return {
        id: report.id,
        label: report.label,
        path: path.relative(ROOT, report.path),
        exists: false,
      };
    }
    const rawText = readFileSync(report.path, "utf8");
    const data = safeJsonParse(rawText);
    const summary = summarizeVerificationReport(data);
    return {
      id: report.id,
      label: report.label,
      path: path.relative(ROOT, report.path),
      exists: true,
      summary,
      ...(includeRaw ? { raw: data } : {}),
    };
  });

  return {
    ok: true,
    checkedAt: new Date().toISOString(),
    reports,
    availableCount: reports.filter((report) => report.exists).length,
    blocked: reports
      .filter((report) => report.exists && report.summary?.blocked)
      .map((report) => ({ id: report.id, blocked: report.summary.blocked })),
    failed: reports
      .filter((report) => report.exists && report.summary?.failed)
      .map((report) => ({ id: report.id, failed: report.summary.failed })),
  };
}

function summarizeVerificationReport(data) {
  if (!data || typeof data !== "object") return { parseable: false };
  const steps = Array.isArray(data.steps) ? data.steps : [];
  const checks = Array.isArray(data.checks) ? data.checks : [];
  const endpointLog = getEndpointLog(data);
  const endpointEvidence = summarizeMuApiEndpointEvidence(endpointLog);
  const evidenceChecklist = getMuApiEvidenceChecklist(data);
  const blockingEvidenceIds = getMuApiBlockingEvidenceIds(data);
  const brandSpec = summarizeBrandSpecStep(steps.find((step) => step?.id === "brand-spec"));
  const readinessBrandTemplates = summarizeReadinessBrandTemplatesStep(steps.find((step) => step?.id === "brand-templates"));
  const readinessLocalBridge = summarizeReadinessLocalBridgeStep(steps.find((step) => step?.id === "local-bridge"));
  const localMcpStep = steps.find((step) => step?.id === "local-mcp");
  const readinessLocalMcp = summarizeReadinessLocalMcpStep(
    localMcpStep,
    isSelfTaintedByLocalMcpOnly(data)
  );
  return {
    parseable: true,
    ok: data.ok,
    releasable: data.releasable,
    realService: data.realService,
    configured: data.configured,
    requireChat: data.requireChat,
    baseUrl: data.baseUrl,
    apiKeyConfigured: data.apiKeyConfigured,
    chatProbeConfigured: data.chatProbeConfigured,
    missingEnvKeys: Array.isArray(data.missingEnvKeys) ? data.missingEnvKeys : [],
    failedEnvKeys: Array.isArray(data.failedEnvKeys) ? data.failedEnvKeys : [],
    remoteSessionId: data.remoteSessionId,
    remoteJobId: data.remoteJobId,
    toolCount: data.toolCount,
    operationCount: data.operationCount,
    operationTypes: getStringArray(data.operationTypes),
    operationCategoryCounts: getNumberRecord(data.operationCategoryCounts),
    brandTemplateCount: data.brandTemplateCount,
    brandTemplateVariantCount: data.brandTemplateVariantCount,
    brandTemplateReadyCount: data.brandTemplateReadyCount,
    brandSpecToolReady: data.brandSpecToolReady,
    brandTemplateToolReady: data.brandTemplateToolReady,
    muApiEnvReady: data.muApiEnvReady,
    muApiRealEvidenceReady: data.muApiRealEvidenceReady,
    requiredKinds: Array.isArray(data.requiredKinds) ? data.requiredKinds : [],
    templateIds: getStringArray(data.summary?.templateIds),
    readyTemplateIds: getStringArray(data.summary?.readyTemplateIds),
    kindBreakdown: getNumberRecord(data.summary?.kindBreakdown),
    variantCount: data.summary?.variantCount,
    variantIdsByTemplate: getStringArrayRecord(data.summary?.variantIdsByTemplate),
    failedVariantTemplates: data.summary?.failedVariantTemplates,
    capabilityTemplateCount: data.summary?.capabilityTemplateCount,
    readyTemplateCount: data.summary?.readyTemplateCount,
    capabilityVariantCount: data.summary?.capabilityVariantCount,
    capabilityMatrixReady: data.capabilityMatrix?.readyTemplateCount === data.capabilityMatrix?.templateCount,
    strictEvidenceReady: data.strictEvidenceReady ?? data.verifier?.report?.strictEvidenceReady ?? data.report?.strictEvidenceReady,
    evidenceChecklistCount: evidenceChecklist.length,
    blockingEvidenceIds,
    endpointLogCount: endpointLog.length,
    endpoint2xxCount: endpointLog.filter((entry) => isSuccessStatus(entry.status)).length,
    endpointEvidence,
    brandSpec,
    readinessBrandTemplates,
    readinessLocalBridge,
    readinessLocalMcp,
    realEvidencePolicy: {
      requiredSteps: ["config", "account", "skills", "session", "chat", "events"],
      requiresNonLocalhost: true,
      requiresEndpoint2xxEvidence: true,
      requiresRemoteSessionId: true,
      requiresRemoteJobId: true,
      requiresRedactedReport: true,
    },
    redaction: data.redaction
      ? {
          secretValuesReturned: data.redaction.secretValuesReturned === true,
          redactedKeys: Array.isArray(data.redaction.redactedKeys) ? data.redaction.redactedKeys : [],
        }
      : undefined,
    summary: data.summary,
    stepStatuses: steps.map((step) => ({ id: step.id, status: step.status, error: step.error })),
    checkStatuses: checks.map((check) => ({ id: check.id, status: check.status, error: check.error })),
    blocked: steps
      .filter((step) => step.status === "blocked")
      .map((step) => ({ id: step.id, reason: step.detail?.reason || step.error })),
    failed: [
      ...steps.filter((step) => step.status === "failed").map((step) => ({ id: step.id, reason: step.detail?.reason || step.error })),
      ...checks.filter((check) => check.status === "failed").map((check) => ({ id: check.id, reason: check.error })),
    ],
  };
}

function summarizeReadinessBrandTemplatesStep(step) {
  if (!step || typeof step !== "object") return undefined;
  const detail = getRecord(step.detail);
  const workflowNodeTypes = getStringArray(detail.brandTemplateWorkflowNodeTypes);
  const requiredKinds = getStringArray(detail.brandTemplateRequiredKinds);
  const missingKinds = getStringArray(detail.brandTemplateMissingKinds);
  const failedTemplateIds = getStringArray(detail.brandTemplateFailedTemplateIds);
  const ready =
    step.status === "passed" &&
    detail.brandTemplateReportOk === true &&
    detail.brandTemplateTemplateCount === 5 &&
    detail.brandTemplateKindCount === 5 &&
    detail.brandTemplatePassedTemplates === 5 &&
    detail.brandTemplateFailedTemplates === 0 &&
    detail.brandTemplateVariantCount === 15 &&
    detail.brandTemplateReadyTemplateCount === 5 &&
    detail.brandTemplateFailedChecks === 0 &&
    requiredKinds.length === 5 &&
    missingKinds.length === 0 &&
    failedTemplateIds.length === 0 &&
    ["promptNode", "imageGeneratorProNode", "pptContentNode", "pptAssemblerNode", "videoGeneratorNode"].every((nodeType) =>
      workflowNodeTypes.includes(nodeType)
    );
  return {
    ready,
    status: step.status,
    reportOk: detail.brandTemplateReportOk === true,
    requiredKinds,
    templateIds: getStringArray(detail.brandTemplateTemplateIds),
    readyTemplateIds: getStringArray(detail.brandTemplateReadyTemplateIds),
    kindBreakdown: getNumberRecord(detail.brandTemplateKindBreakdown),
    templateCount: numberOrUndefined(detail.brandTemplateTemplateCount),
    kindCount: numberOrUndefined(detail.brandTemplateKindCount),
    passedTemplates: numberOrUndefined(detail.brandTemplatePassedTemplates),
    failedTemplates: numberOrUndefined(detail.brandTemplateFailedTemplates),
    variantCount: numberOrUndefined(detail.brandTemplateVariantCount),
    variantIdsByTemplate: getStringArrayRecord(detail.brandTemplateVariantIdsByTemplate),
    failedVariantTemplates: numberOrUndefined(detail.brandTemplateFailedVariantTemplates),
    readyTemplateCount: numberOrUndefined(detail.brandTemplateReadyTemplateCount),
    capabilityVariantCount: numberOrUndefined(detail.brandTemplateCapabilityVariantCount),
    passedChecks: numberOrUndefined(detail.brandTemplatePassedChecks),
    failedChecks: numberOrUndefined(detail.brandTemplateFailedChecks),
    workflowNodeTypes,
    workflowNodeTypesByTemplate: getStringArrayRecord(detail.brandTemplateWorkflowNodeTypesByTemplate),
    deliverableKinds: getStringArray(detail.brandTemplateDeliverableKinds),
    deliverableIdsByTemplate: getStringArrayRecord(detail.brandTemplateDeliverableIdsByTemplate),
    outputKinds: getStringArray(detail.brandTemplateOutputKinds),
    capabilityCheckIdsByTemplate: getStringArrayRecord(detail.brandTemplateCapabilityCheckIdsByTemplate),
    missingKinds,
    failedTemplateIds,
    failedVariantTemplateIds: getStringArray(detail.brandTemplateFailedVariantTemplateIds),
  };
}

function summarizeReadinessLocalBridgeStep(step) {
  if (!step || typeof step !== "object") return undefined;
  const detail = getRecord(step.detail);
  return {
    ready:
      step.status === "passed" &&
      detail.localBridgeReportOk === true &&
      detail.localBridgeToolCount === 6 &&
      detail.localBridgeOperationCount === 15 &&
      detail.localBridgeBrandTemplateReadyCount === 5 &&
      detail.localBridgeBrandTemplateVariantCount === 15 &&
      detail.localBridgeBrandSpecToolReady === true &&
      detail.localBridgeBrandTemplateToolReady === true &&
      getStringArray(detail.localBridgeWriteTools).length === 1 &&
      getStringArray(detail.localBridgeWriteTools)[0] === "nextlemon.requestApproval",
    status: step.status,
    reportOk: detail.localBridgeReportOk === true,
    toolCount: numberOrUndefined(detail.localBridgeToolCount),
    operationCount: numberOrUndefined(detail.localBridgeOperationCount),
    brandTemplateCount: numberOrUndefined(detail.localBridgeBrandTemplateCount),
    brandTemplateReadyCount: numberOrUndefined(detail.localBridgeBrandTemplateReadyCount),
    brandTemplateVariantCount: numberOrUndefined(detail.localBridgeBrandTemplateVariantCount),
    brandSpecToolReady: detail.localBridgeBrandSpecToolReady === true,
    brandTemplateToolReady: detail.localBridgeBrandTemplateToolReady === true,
    failedStepIds: getStringArray(detail.localBridgeFailedStepIds),
    readOnlyBrandTools: getStringArray(detail.localBridgeReadOnlyBrandTools),
    writeTools: getStringArray(detail.localBridgeWriteTools),
  };
}

function summarizeReadinessLocalMcpStep(step, ignoreSelfTaint = false) {
  if (!step || typeof step !== "object") return undefined;
  const detail = getRecord(step.detail);
  const blockerIds = getStringArray(detail.localMcpBlockerIds);
  const operationDrift = getStringArray(detail.localMcpOperationDrift);
  return {
    ready:
      (step.status === "passed" || ignoreSelfTaint) &&
      (detail.localMcpReportOk === true || ignoreSelfTaint) &&
      detail.localMcpToolCount === 11 &&
      detail.localMcpOperationCount === 15 &&
      detail.localMcpApprovalSchemaOneOfCount === 15 &&
      detail.localMcpBrandTemplateReadyCount === 5 &&
      detail.localMcpBrandTemplateVariantCount === 15 &&
      detail.localMcpApprovalWritesExecuteDirectly === false &&
      detail.localMcpApprovalImportRequired === true &&
      detail.localMcpApprovalRequiresUserApproval === true &&
      detail.localMcpApprovalAuditOk === true &&
      operationDrift.length === 0 &&
      !blockerIds.includes("local-mcp"),
    status: step.status,
    reportOk: detail.localMcpReportOk === true || ignoreSelfTaint,
    transportInputs: getStringArray(detail.localMcpTransportInputs),
    toolCount: numberOrUndefined(detail.localMcpToolCount),
    toolNames: getStringArray(detail.localMcpToolNames),
    approvalToolNames: getStringArray(detail.localMcpApprovalToolNames),
    approvalSchemaOneOfCount: numberOrUndefined(detail.localMcpApprovalSchemaOneOfCount),
    operationCount: numberOrUndefined(detail.localMcpOperationCount),
    operationTypes: getStringArray(detail.localMcpOperationTypes),
    operationCategories: getStringArray(detail.localMcpOperationCategories),
    operationCategoryCounts: getNumberRecord(detail.localMcpOperationCategoryCounts),
    operationDrift,
    brandTemplateCount: numberOrUndefined(detail.localMcpBrandTemplateCount),
    brandTemplateVariantCount: numberOrUndefined(detail.localMcpBrandTemplateVariantCount),
    brandTemplateReadyCount: numberOrUndefined(detail.localMcpBrandTemplateReadyCount),
    muApiEnvReady: detail.localMcpMuApiEnvReady === true,
    muApiRealEvidenceReady: detail.localMcpMuApiRealEvidenceReady === true,
    releaseStatus: typeof detail.localMcpReleaseStatus === "string" ? detail.localMcpReleaseStatus : undefined,
    blockerIds,
    approvalRequestHash: typeof detail.localMcpApprovalRequestHash === "string" ? detail.localMcpApprovalRequestHash : undefined,
    approvalOpSummary: typeof detail.localMcpApprovalOpSummary === "string" ? detail.localMcpApprovalOpSummary : undefined,
    approvalOperationTypes: getStringArray(detail.localMcpApprovalOperationTypes),
    approvalPolicy: {
      writesExecuteDirectly: detail.localMcpApprovalWritesExecuteDirectly === true,
      approvalImportRequired: detail.localMcpApprovalImportRequired === true,
      requiresUserApproval: detail.localMcpApprovalRequiresUserApproval === true,
    },
    approvalAuditOk: detail.localMcpApprovalAuditOk === true,
  };
}

function summarizeBrandSpecStep(step) {
  if (!step || typeof step !== "object") return undefined;
  const detail = getRecord(step.detail);
  const requiredWorkflowNodes = Array.isArray(detail.templateCapabilityRequiredWorkflowNodes)
    ? detail.templateCapabilityRequiredWorkflowNodes.filter((value) => typeof value === "string" && value.trim())
    : [];
  const requiredDeliverables = Array.isArray(detail.templateCapabilityRequiredDeliverables)
    ? detail.templateCapabilityRequiredDeliverables.filter((value) => typeof value === "string" && value.trim())
    : [];
  const catalogWorkflowNodeTypes = Array.isArray(detail.templateCatalogWorkflowNodeTypes)
    ? detail.templateCatalogWorkflowNodeTypes.filter((value) => typeof value === "string" && value.trim())
    : [];
  const ready =
    step.status === "passed" &&
    detail.score === 100 &&
    detail.templateCapabilityReady === true &&
    detail.templateCapabilityVariantCount === 3 &&
    detail.templateCatalogTemplateCount === 5 &&
    detail.templateCatalogReadyTemplateCount === 5 &&
    detail.templateCatalogVariantCount === 15 &&
    requiredWorkflowNodes.includes("promptNode") &&
    requiredWorkflowNodes.includes("imageGeneratorProNode") &&
    catalogWorkflowNodeTypes.includes("pptContentNode") &&
    catalogWorkflowNodeTypes.includes("pptAssemblerNode") &&
    catalogWorkflowNodeTypes.includes("videoGeneratorNode") &&
    detail.templateCapabilityChecksPassed === detail.templateCapabilityCheckCount &&
    detail.templateCatalogChecksPassed === detail.templateCatalogCheckCount;

  return {
    ready,
    status: step.status,
    score: Number.isFinite(detail.score) ? detail.score : undefined,
    deliverableCount: Number.isFinite(detail.deliverableCount) ? detail.deliverableCount : undefined,
    acceptanceCriteriaCount: Number.isFinite(detail.acceptanceCriteriaCount) ? detail.acceptanceCriteriaCount : undefined,
    templateCapabilityReady: detail.templateCapabilityReady === true,
    templateCapabilityVariantCount: Number.isFinite(detail.templateCapabilityVariantCount)
      ? detail.templateCapabilityVariantCount
      : undefined,
    templateCapabilityRequiredWorkflowNodes: requiredWorkflowNodes,
    templateCapabilityRequiredDeliverables: requiredDeliverables,
    templateCapabilityCheckCount: Number.isFinite(detail.templateCapabilityCheckCount) ? detail.templateCapabilityCheckCount : undefined,
    templateCapabilityChecksPassed: Number.isFinite(detail.templateCapabilityChecksPassed) ? detail.templateCapabilityChecksPassed : undefined,
    templateCatalogTemplateCount: Number.isFinite(detail.templateCatalogTemplateCount) ? detail.templateCatalogTemplateCount : undefined,
    templateCatalogReadyTemplateCount: Number.isFinite(detail.templateCatalogReadyTemplateCount)
      ? detail.templateCatalogReadyTemplateCount
      : undefined,
    templateCatalogVariantCount: Number.isFinite(detail.templateCatalogVariantCount) ? detail.templateCatalogVariantCount : undefined,
    templateCatalogWorkflowNodeTypes: catalogWorkflowNodeTypes,
    templateCatalogCheckCount: Number.isFinite(detail.templateCatalogCheckCount) ? detail.templateCatalogCheckCount : undefined,
    templateCatalogChecksPassed: Number.isFinite(detail.templateCatalogChecksPassed) ? detail.templateCatalogChecksPassed : undefined,
  };
}

function getStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()) : [];
}

function getStringArrayRecord(value) {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, items]) => [key, getStringArray(items)])
      .filter(([key, items]) => typeof key === "string" && key.trim() && items.length > 0)
  );
}

function getNumberRecord(value) {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, count]) => typeof key === "string" && key.trim() && Number.isFinite(count))
      .map(([key, count]) => [key, count])
  );
}

function numberOrUndefined(value) {
  return Number.isFinite(value) ? value : undefined;
}

function getMuApiEvidenceChecklist(data) {
  if (Array.isArray(data.evidenceChecklist)) return data.evidenceChecklist;
  if (Array.isArray(data.verifier?.report?.evidenceChecklist)) return data.verifier.report.evidenceChecklist;
  if (Array.isArray(data.report?.evidenceChecklist)) return data.report.evidenceChecklist;
  return [];
}

function getMuApiBlockingEvidenceIds(data) {
  if (Array.isArray(data.blockingEvidenceIds)) return data.blockingEvidenceIds;
  if (Array.isArray(data.verifier?.report?.blockingEvidenceIds)) return data.verifier.report.blockingEvidenceIds;
  if (Array.isArray(data.report?.blockingEvidenceIds)) return data.report.blockingEvidenceIds;
  return [];
}

function getEndpointLog(data) {
  if (Array.isArray(data.endpointLog)) return data.endpointLog;
  if (Array.isArray(data.verifier?.report?.endpointLog)) return data.verifier.report.endpointLog;
  if (Array.isArray(data.report?.endpointLog)) return data.report.endpointLog;
  return [];
}

function summarizeMuApiEndpointEvidence(endpointLog) {
  const rules = [
    ["account", /^GET \/api\/v1\/account\/balance$/],
    ["skills", /^GET \/api\/v1\/creative-agent\/agent-skills$/],
    ["session", /^POST \/api\/v1\/creative-agent\/sessions$/],
    ["chat", /^POST \/api\/v1\/creative-agent\/sessions\/[^/]+\/chat$/],
    ["events", /^GET \/api\/v1\/creative-agent\/jobs\/[^/]+\/events$/],
  ];
  return Object.fromEntries(
    rules.map(([id, pattern]) => {
      const matches = endpointLog.filter((entry) => pattern.test(`${entry.method || "GET"} ${entry.path || ""}`));
      return [
        id,
        {
          seen: matches.length > 0,
          has2xx: matches.some((entry) => isSuccessStatus(entry.status)),
          count: matches.length,
          statuses: [...new Set(matches.map((entry) => entry.status).filter((status) => status !== undefined))],
        },
      ];
    })
  );
}

function isSuccessStatus(value) {
  return typeof value === "number" && value >= 200 && value < 300;
}

function validateOp(op) {
  if (!op || typeof op !== "object" || Array.isArray(op)) return "operation must be an object.";
  if (!opTypes.has(op.type)) return `unsupported operation type: ${String(op.type || "")}`;
  switch (op.type) {
    case "asset.add":
      return op.asset && ["text", "image", "video", "audio"].includes(op.asset.kind) ? "" : "asset.add requires asset.kind.";
    case "asset.update":
      return op.assetId && isRecord(op.patch) ? "" : "asset.update requires assetId and patch.";
    case "asset.delete":
      return nonEmptyArray(op.assetIds) ? "" : "asset.delete requires non-empty assetIds.";
    case "canvas.addItem":
      return op.assetId ? "" : "canvas.addItem requires assetId.";
    case "canvas.updateItem":
      return op.itemId && isRecord(op.patch) ? "" : "canvas.updateItem requires itemId and patch.";
    case "canvas.deleteItem":
      return nonEmptyArray(op.itemIds) ? "" : "canvas.deleteItem requires non-empty itemIds.";
    case "canvas.moveItem":
      return op.itemId && isFinitePosition(op.position) ? "" : "canvas.moveItem requires itemId and finite position.";
    case "canvas.selectItems":
      return Array.isArray(op.itemIds) ? "" : "canvas.selectItems requires itemIds array.";
    case "canvas.setViewport":
      return isFinitePosition(op.viewport) && Number.isFinite(op.viewport.zoom) && op.viewport.zoom > 0
        ? ""
        : "canvas.setViewport requires finite viewport x/y/zoom.";
    case "workflow.addNode":
      return op.nodeType && isFinitePosition(op.position) ? "" : "workflow.addNode requires nodeType and finite position.";
    case "workflow.updateNode":
      return op.nodeId && isRecord(op.data) ? "" : "workflow.updateNode requires nodeId and data.";
    case "workflow.connectNodes":
      return op.source && op.target ? "" : "workflow.connectNodes requires source and target.";
    case "workflow.runNode":
    case "library.saveWorkflowNode":
      return op.nodeId ? "" : `${op.type} requires nodeId.`;
    case "workflow.selectNodes":
      return Array.isArray(op.nodeIds) ? "" : "workflow.selectNodes requires nodeIds array.";
    default:
      return "unsupported operation.";
  }
}

function summarizeOps(ops) {
  const counts = ops.reduce((acc, op) => {
    acc[op.type] = (acc[op.type] || 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts)
    .map(([type, count]) => `${type} ${count}`)
    .join(", ");
}

function hashApprovalRequest(request) {
  const payload = {
    packageType: request.packageType,
    schemaVersion: request.schemaVersion,
    id: request.id,
    title: request.title,
    createdAt: request.createdAt,
    source: request.source,
    opCount: request.opCount,
    opSummary: request.opSummary,
    operationTypes: request.operationTypes,
    approvalPolicy: request.approvalPolicy,
    ops: request.ops,
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function fileExists(filePath) {
  try {
    readFileSync(filePath, "utf8");
    return true;
  } catch {
    return false;
  }
}

function nonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function isFinitePosition(value) {
  return isRecord(value) && Number.isFinite(value.x) && Number.isFinite(value.y);
}

function buildApprovalRequestSchema(specs) {
  return {
    type: "object",
    required: ["ops"],
    properties: {
      title: {
        type: "string",
        description: "Human-readable approval title shown inside NextLemon.",
      },
      ops: {
        type: "array",
        minItems: 1,
        description: "CanvasAgentOp operations. Writes are validated and queued for approval, never executed directly.",
        items: buildCanvasAgentOpSchema(specs),
      },
    },
    additionalProperties: false,
  };
}

function buildCanvasAgentOpSchema(specs) {
  return {
    oneOf: specs.map((spec) => buildSchemaForOpSpec(spec)),
  };
}

function buildSchemaForOpSpec(spec) {
  const schema = {
    type: "object",
    description: spec.description || spec.label,
    required: ["type"],
    properties: {
      type: {
        const: spec.type,
        description: spec.label,
      },
    },
    additionalProperties: true,
    examples: [spec.example],
  };
  for (const requiredPath of Array.isArray(spec.required) ? spec.required : []) {
    addRequiredPath(schema, requiredPath, spec.type);
  }
  return schema;
}

function addRequiredPath(schema, requiredPath, opType) {
  const parts = String(requiredPath).split(".");
  let current = schema;
  for (const [index, part] of parts.entries()) {
    current.required = Array.isArray(current.required) ? [...new Set([...current.required, part])] : [part];
    current.properties = isRecord(current.properties) ? current.properties : {};
    const isLeaf = index === parts.length - 1;
    if (!current.properties[part]) {
      current.properties[part] = isLeaf
        ? schemaForField(part, requiredPath, opType)
        : { type: "object", required: [], properties: {}, additionalProperties: true };
    }
    if (!isLeaf) current = current.properties[part];
  }
}

function schemaForField(field, requiredPath, opType) {
  if (field === "kind" && requiredPath === "asset.kind") return { type: "string", enum: ["text", "image", "video", "audio"] };
  if (field === "zoom") return { type: "number", exclusiveMinimum: 0 };
  if (field === "x" || field === "y") return { type: "number" };
  if (field.endsWith("Ids")) {
    const canBeEmpty = opType === "canvas.selectItems" || opType === "workflow.selectNodes";
    return { type: "array", minItems: canBeEmpty ? 0 : 1, items: { type: "string" } };
  }
  if (["asset", "patch", "item", "data", "viewport", "position"].includes(field)) {
    return { type: "object", additionalProperties: true };
  }
  return { type: "string", minLength: 1 };
}
