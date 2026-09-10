#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import ts from "typescript";

const argv = process.argv.slice(2);
const root = process.cwd();
const reportPath = getArgValue("--report") || path.join("releases", "local-agent-bridge-verification-report.json");
const jsonOutput = argv.includes("--json");
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const bridgeSourcePath = path.join(root, "src", "services", "localAgentBridge.ts");
const agentOpsSourcePath = path.join(root, "src", "services", "agentOps.ts");
const brandTemplateReportPath = path.join(root, "releases", "brand-template-verification-report.json");
const requiredTools = [
  "nextlemon.readSnapshot",
  "nextlemon.listCanvasAgentOps",
  "nextlemon.listBrandTemplates",
  "nextlemon.createBrandSpec",
  "nextlemon.validateApprovalRequest",
  "nextlemon.requestApproval",
];

const checkedAt = new Date().toISOString();
const startedAt = Date.now();
mkdirSync(path.dirname(path.resolve(root, reportPath)), { recursive: true });

const testStep = runCommandStep("unit-test", "Local Agent Bridge focused unit tests", [
  npmCmd,
  ["test", "--", "--run", "src/services/__tests__/localAgentBridge.test.ts"],
]);
let brandReport = readJsonIfExists(brandTemplateReportPath);
const brandReportRefreshStep = isBrandTemplateReportReady(brandReport)
  ? null
  : runCommandStep("brand-template-report", "Refresh brand template verification report", [
      npmCmd,
      ["run", "verify:brand:templates", "--", "--json", "--report", path.join("releases", "brand-template-verification-report.json")],
    ]);
if (brandReportRefreshStep) {
  brandReport = readJsonIfExists(brandTemplateReportPath);
}
const bridgeSource = readFileSync(bridgeSourcePath, "utf8");
const toolsState = readBridgeToolCatalog(bridgeSourcePath);
const opState = readArrayDeclarationCount(agentOpsSourcePath, "CANVAS_AGENT_OP_SPECS");
const toolNames = toolsState.tools.map((tool) => tool.name);
const writeTools = toolsState.tools.filter((tool) => tool.write === true).map((tool) => tool.name);
const readOnlyBrandTools = toolsState.tools
  .filter((tool) => ["nextlemon.listBrandTemplates", "nextlemon.createBrandSpec"].includes(tool.name) && tool.write === false)
  .map((tool) => tool.name);

const toolCatalogOk =
  toolsState.ok &&
  requiredTools.every((tool) => toolNames.includes(tool)) &&
  toolNames.length === requiredTools.length &&
  writeTools.length === 1 &&
  writeTools[0] === "nextlemon.requestApproval";

const brandBridgeOk =
  sourceIncludes(bridgeSource, [
    "export function listLocalAgentBridgeBrandTemplates",
    "export function createLocalAgentBridgeBrandSpec",
    "createBrandSpecDocument",
    "createDesignTemplateCapabilityMatrix",
    "getTemplateVariants",
    "applyTemplateVariant",
    "supportsBrandSpecExport: true",
    "supportsVariantBrandSpec: true",
    "expectedTemplateCount: 5",
    "expectedVariantCount: 15",
    "expectedAppliedVariantCount: 15",
  ]) &&
  readOnlyBrandTools.length === 2 &&
  brandReport?.summary?.templateCount === 5 &&
  brandReport?.summary?.readyTemplateCount === 5 &&
  brandReport?.summary?.variantCount === 15;

const safetyOk =
  opState.ok &&
  opState.count === 15 &&
  sourceIncludes(bridgeSource, [
    "writesExecuteDirectly: false",
    "writeRequestsCanBeDisabled: true",
    "approvalRequired: true",
    "validateCanvasAgentOpsAgainstState",
    "agentStore.requestApproval",
  ]);

const steps = [
  testStep,
  ...(brandReportRefreshStep ? [brandReportRefreshStep] : []),
  {
    id: "tool-catalog",
    label: "In-app bridge exposes read tools, brand tools, and approval-only writes",
    status: toolCatalogOk ? "passed" : "failed",
    durationMs: 0,
    detail: {
      sourcePath: path.relative(root, bridgeSourcePath),
      sourceParsed: toolsState.ok,
      sourceError: toolsState.error || undefined,
      toolCount: toolsState.tools.length,
      toolNames,
      readOnlyBrandTools,
      writeTools,
      requiredTools,
    },
  },
  {
    id: "brand-bridge",
    label: "In-app bridge reuses brand template service for variants and brand specs",
    status: brandBridgeOk ? "passed" : "failed",
    durationMs: 0,
    detail: {
      brandTemplateReportPath: path.relative(root, brandTemplateReportPath),
      brandTemplateReportExists: Boolean(brandReport),
      brandTemplateCount: brandReport?.summary?.templateCount,
      brandTemplateReadyCount: brandReport?.summary?.readyTemplateCount,
      brandTemplateVariantCount: brandReport?.summary?.variantCount,
      readOnlyBrandTools,
      usesCreateBrandSpecDocument: bridgeSource.includes("createBrandSpecDocument"),
      usesTemplateVariants: bridgeSource.includes("getTemplateVariants") && bridgeSource.includes("applyTemplateVariant"),
    },
  },
  {
    id: "write-safety",
    label: "In-app bridge keeps CanvasAgentOp writes approval-only",
    status: safetyOk ? "passed" : "failed",
    durationMs: 0,
    detail: {
      operationCatalogPath: path.relative(root, agentOpsSourcePath),
      operationCatalogParsed: opState.ok,
      operationCount: opState.count,
      operationSourceError: opState.error || undefined,
      writeTools,
      writesExecuteDirectly: false,
      validatesRuntimeState: bridgeSource.includes("validateCanvasAgentOpsAgainstState"),
      queuesApproval: bridgeSource.includes("agentStore.requestApproval"),
    },
  },
];

const failed = steps.filter((step) => step.status === "failed");
const result = {
  ok: failed.length === 0,
  checkedAt,
  durationMs: Date.now() - startedAt,
  sourcePath: path.relative(root, bridgeSourcePath),
  testPath: "src/services/__tests__/localAgentBridge.test.ts",
  toolCount: toolsState.tools.length,
  operationCount: opState.count,
  brandTemplateCount: brandReport?.summary?.templateCount,
  brandTemplateReadyCount: brandReport?.summary?.readyTemplateCount,
  brandTemplateVariantCount: brandReport?.summary?.variantCount,
  brandSpecToolReady: readOnlyBrandTools.includes("nextlemon.createBrandSpec"),
  brandTemplateToolReady: readOnlyBrandTools.includes("nextlemon.listBrandTemplates"),
  failedStepIds: failed.map((step) => step.id),
  steps,
};

writeFileSync(path.resolve(root, reportPath), `${JSON.stringify(result, null, 2)}\n`);

if (jsonOutput) console.log(JSON.stringify(result, null, 2));
else {
  console.log(result.ok ? "Local Agent Bridge verification passed." : "Local Agent Bridge verification failed.");
  console.log(`Report: ${reportPath}`);
  for (const step of steps) console.log(`${step.status.toUpperCase()} ${step.id}: ${step.label}`);
}

process.exit(result.ok ? 0 : 1);

function runCommandStep(id, label, command) {
  const [cmd, args] = command;
  const startedAt = Date.now();
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

function readBridgeToolCatalog(filePath) {
  try {
    const sourceText = readFileSync(filePath, "utf8");
    const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const declaration = findVariableDeclaration(sourceFile, "LOCAL_AGENT_BRIDGE_TOOLS");
    const initializer = stripExpression(declaration?.initializer);
    if (!initializer || !ts.isArrayLiteralExpression(initializer)) {
      return { ok: false, tools: [], error: "LOCAL_AGENT_BRIDGE_TOOLS array not found." };
    }
    const tools = initializer.elements
      .filter(ts.isObjectLiteralExpression)
      .map((item) => ({
        name: getStringProperty(item, "name"),
        write: getBooleanProperty(item, "write"),
        description: getStringProperty(item, "description"),
      }))
      .filter((tool) => tool.name);
    return { ok: true, tools, error: "" };
  } catch (error) {
    return { ok: false, tools: [], error: error instanceof Error ? error.message : String(error) };
  }
}

function readArrayDeclarationCount(filePath, variableName) {
  try {
    const sourceText = readFileSync(filePath, "utf8");
    const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const declaration = findVariableDeclaration(sourceFile, variableName);
    const initializer = stripExpression(declaration?.initializer);
    if (!initializer || !ts.isArrayLiteralExpression(initializer)) {
      return { ok: false, count: 0, error: `${variableName} array not found.` };
    }
    return { ok: true, count: initializer.elements.length, error: "" };
  } catch (error) {
    return { ok: false, count: 0, error: error instanceof Error ? error.message : String(error) };
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

function stripExpression(expression) {
  if (!expression) return null;
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

function getStringProperty(objectNode, name) {
  const property = getPropertyAssignment(objectNode, name);
  const value = stripExpression(property?.initializer);
  return value && (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) ? value.text : "";
}

function getBooleanProperty(objectNode, name) {
  const property = getPropertyAssignment(objectNode, name);
  const value = stripExpression(property?.initializer);
  if (!value) return undefined;
  if (value.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (value.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
}

function getPropertyAssignment(objectNode, name) {
  return objectNode.properties.find(
    (property) =>
      ts.isPropertyAssignment(property) &&
      ((ts.isIdentifier(property.name) && property.name.text === name) ||
        (ts.isStringLiteral(property.name) && property.name.text === name))
  );
}

function sourceIncludes(sourceText, needles) {
  return needles.every((needle) => sourceText.includes(needle));
}

function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function isBrandTemplateReportReady(report) {
  return Boolean(
    report?.ok === true &&
      report?.summary?.templateCount === 5 &&
      report?.summary?.readyTemplateCount === 5 &&
      report?.summary?.variantCount === 15
  );
}

function tail(value, max = 1600) {
  const text = String(value || "").trim();
  return text.length > max ? text.slice(-max) : text;
}

function getArgValue(name) {
  const exact = argv.find((item) => item.startsWith(`${name}=`));
  if (exact) return exact.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || "" : "";
}
