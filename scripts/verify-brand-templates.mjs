#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const argv = process.argv.slice(2);
const root = process.cwd();
const sourcePath = path.resolve(root, getArgValue("--source") || "src/services/designTemplateService.ts");
const reportPath = getArgValue("--report") || path.join("releases", "brand-template-verification-report.json");
const jsonOutput = argv.includes("--json");

const requiredKinds = ["social-image", "poster", "brand-board", "ppt", "video-cover"];
const imageTemplateKinds = new Set(["social-image", "poster", "brand-board"]);
const checks = [];

let parseError = "";
let moduleError = "";
let templates = [];
let templateModule = null;
try {
  templateModule = await importDesignTemplateModule(sourcePath);
  templates = Array.isArray(templateModule.DESIGN_TEMPLATES) ? templateModule.DESIGN_TEMPLATES : [];
} catch (error) {
  moduleError = error instanceof Error ? error.message : String(error);
}

if (templates.length === 0) {
  try {
    templates = readTemplates(sourcePath);
  } catch (error) {
    parseError = error instanceof Error ? error.message : String(error);
  }
}
const templateResults = templates.map((template) => validateTemplate(template, templateModule));
const capabilityMatrix = createCapabilityMatrix(templates, templateModule);
const templateIds = templates.map((template) => template.id).filter(Boolean);
const readyTemplateIds = Array.isArray(capabilityMatrix.matrix?.templates)
  ? capabilityMatrix.matrix.templates.filter((template) => template?.ready === true).map((template) => template.id).filter(Boolean)
  : [];
const kindBreakdown = countBy(templates.map((template) => template.kind).filter(Boolean));
const variantIdsByTemplate = Object.fromEntries(templateResults.map((template) => [template.id, template.detail.variantIds || []]));
const workflowNodeTypesByTemplate = Object.fromEntries(templates.map((template) => [
  template.id,
  Array.isArray(template.recommendedWorkflowNodes)
    ? template.recommendedWorkflowNodes.map((node) => node?.nodeType).filter(Boolean)
    : [],
]));
const deliverableIdsByTemplate = Object.fromEntries(templates.map((template) => [
  template.id,
  Array.isArray(template.deliverables)
    ? template.deliverables.map((deliverable) => deliverable?.id).filter(Boolean)
    : [],
]));
const capabilityCheckIdsByTemplate = Object.fromEntries(
  Array.isArray(capabilityMatrix.matrix?.templates)
    ? capabilityMatrix.matrix.templates.map((template) => [
        template.id,
        Array.isArray(template.checks) ? template.checks.map((check) => check?.id).filter(Boolean) : [],
      ])
    : []
);

addCheck("source", "Template source file exists and is parseable", existsSync(sourcePath) && !parseError && templates.length > 0, {
  sourcePath: path.relative(root, sourcePath),
  templateCount: templates.length,
  error: parseError || undefined,
});
addCheck("module-load", "Template service module loads for variant verification", Boolean(templateModule) && !moduleError, {
  sourcePath: path.relative(root, sourcePath),
  error: moduleError || undefined,
});

const ids = templates.map((template) => template.id).filter(Boolean);
const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
addCheck("unique-ids", "Template ids are unique", duplicateIds.length === 0, { duplicateIds });

for (const kind of requiredKinds) {
  const matching = templates.filter((template) => template.kind === kind);
  addCheck(`kind-${kind}`, `Catalog includes ${kind}`, matching.length > 0, {
    ids: matching.map((template) => template.id),
  });
}

addCheck("templates-valid", "Every built-in template passes structural validation", templateResults.every((item) => item.ok), {
  failedTemplateIds: templateResults.filter((item) => !item.ok).map((item) => item.id),
});

addCheck("variants-valid", "Every built-in template exposes actionable variants", templateResults.every((item) => item.detail.variantOk), {
  failedTemplateIds: templateResults.filter((item) => !item.detail.variantOk).map((item) => item.id),
});

addCheck(
  "capability-matrix",
  "Template capability matrix is complete for agent selection",
  capabilityMatrix.ok,
  capabilityMatrix.detail
);

const result = {
  ok: checks.every((check) => check.status === "passed") && templateResults.every((item) => item.ok),
  checkedAt: new Date().toISOString(),
  requiredKinds,
  sourcePath: path.relative(root, sourcePath),
  summary: {
    templateCount: templates.length,
    templateIds,
    readyTemplateIds,
    kindBreakdown,
    kindCount: new Set(templates.map((template) => template.kind)).size,
    passedTemplates: templateResults.filter((item) => item.ok).length,
    failedTemplates: templateResults.filter((item) => !item.ok).length,
    variantCount: templateResults.reduce((sum, item) => sum + item.detail.variantCount, 0),
    variantIdsByTemplate,
    failedVariantTemplates: templateResults.filter((item) => !item.detail.variantOk).length,
    capabilityTemplateCount: capabilityMatrix.matrix?.templateCount || 0,
    readyTemplateCount: capabilityMatrix.matrix?.readyTemplateCount || 0,
    capabilityVariantCount: capabilityMatrix.matrix?.variantCount || 0,
    passedChecks: checks.filter((check) => check.status === "passed").length,
    failedChecks: checks.filter((check) => check.status === "failed").length,
    workflowNodeTypesByTemplate,
    deliverableIdsByTemplate,
    capabilityCheckIdsByTemplate,
  },
  checks,
  capabilityMatrix: capabilityMatrix.matrix,
  templates: templateResults,
};

mkdirSync(path.dirname(path.resolve(root, reportPath)), { recursive: true });
writeFileSync(path.resolve(root, reportPath), `${JSON.stringify(result, null, 2)}\n`);

if (jsonOutput) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(result.ok ? "Brand template verification passed." : "Brand template verification failed.");
  console.log(`Report: ${reportPath}`);
  for (const check of checks) console.log(`${check.status.toUpperCase()} ${check.id}: ${check.label}`);
  for (const template of templateResults) {
    console.log(`${template.ok ? "PASSED" : "FAILED"} template ${template.id || "(missing id)"}`);
  }
}

process.exit(result.ok ? 0 : 1);

function readTemplates(filePath) {
  if (!existsSync(filePath)) return [];
  const sourceText = readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declaration = findDesignTemplatesDeclaration(sourceFile);
  if (!declaration?.initializer) return [];

  const initializer = stripExpression(declaration.initializer);
  if (!ts.isArrayLiteralExpression(initializer)) return [];
  return valueFromExpression(initializer);
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

function findDesignTemplatesDeclaration(sourceFile) {
  let found = null;
  visit(sourceFile);
  return found;

  function visit(node) {
    if (found) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "DESIGN_TEMPLATES") {
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

function validateTemplate(template, templateModule) {
  const errors = [];
  const requiredTextFields = [
    "id",
    "kind",
    "planKind",
    "name",
    "description",
    "outputKind",
    "defaultBrief",
    "modelHint",
  ];

  for (const field of requiredTextFields) {
    if (!isNonEmptyString(template[field])) errors.push(`${field} must be a non-empty string`);
  }

  if (!requiredKinds.includes(template.kind)) errors.push(`kind must be one of ${requiredKinds.join(", ")}`);
  requireStringArray(template, "promptGuidance", errors);
  requireStringArray(template, "acceptanceCriteria", errors);
  requireStringArray(template, "tags", errors);
  validateDeliverables(template, errors);
  validateWorkflowNodes(template, errors);
  validateKindSpecificRules(template, errors);
  const variantDetail = validateTemplateVariants(template, templateModule, errors);

  return {
    id: template.id,
    kind: template.kind,
    ok: errors.length === 0,
    errors,
    detail: {
      outputKind: template.outputKind,
      planKind: template.planKind,
      aspectRatio: template.aspectRatio,
      videoSize: template.videoSize,
      pageCountRange: template.pageCountRange,
      deliverableCount: Array.isArray(template.deliverables) ? template.deliverables.length : 0,
      requiredDeliverableCount: Array.isArray(template.deliverables)
        ? template.deliverables.filter((item) => item?.required === true).length
        : 0,
      workflowNodeCount: Array.isArray(template.recommendedWorkflowNodes) ? template.recommendedWorkflowNodes.length : 0,
      requiredWorkflowNodeCount: Array.isArray(template.recommendedWorkflowNodes)
        ? template.recommendedWorkflowNodes.filter((item) => item?.required === true).length
        : 0,
      acceptanceCriteriaCount: Array.isArray(template.acceptanceCriteria) ? template.acceptanceCriteria.length : 0,
      tagCount: Array.isArray(template.tags) ? template.tags.length : 0,
      modelHint: template.modelHint,
      ...variantDetail,
    },
  };
}

function validateTemplateVariants(template, templateModule, errors) {
  const errorCountBefore = errors.length;
  if (
    !templateModule ||
    typeof templateModule.getTemplateVariants !== "function" ||
    typeof templateModule.applyTemplateVariant !== "function"
  ) {
    errors.push("template variants cannot be verified because the template service module did not load");
    return { variantOk: false, variantCount: 0, variantIds: [] };
  }

  const variants = templateModule.getTemplateVariants(template);
  if (!Array.isArray(variants) || variants.length < 3) {
    errors.push("getTemplateVariants must return at least 3 variants");
    return {
      variantOk: false,
      variantCount: Array.isArray(variants) ? variants.length : 0,
      variantIds: Array.isArray(variants) ? variants.map((variant) => variant?.id).filter(Boolean) : [],
    };
  }

  const variantIds = variants.map((variant) => variant?.id).filter(Boolean);
  const duplicateIds = variantIds.filter((id, index) => variantIds.indexOf(id) !== index);
  if (duplicateIds.length > 0) errors.push(`variant ids must be unique: ${duplicateIds.join(", ")}`);

  for (const [index, variant] of variants.entries()) {
    if (!isNonEmptyString(variant?.id)) errors.push(`variants[${index}].id must be a non-empty string`);
    if (!isNonEmptyString(variant?.name)) errors.push(`variants[${index}].name must be a non-empty string`);
    if (!isNonEmptyString(variant?.description)) errors.push(`variants[${index}].description must be a non-empty string`);
    if (!isNonEmptyString(variant?.briefSuffix)) errors.push(`variants[${index}].briefSuffix must be a non-empty string`);
    if (!Array.isArray(variant?.promptGuidance) || variant.promptGuidance.length === 0) {
      errors.push(`variants[${index}].promptGuidance must be a non-empty array`);
    }
    if (!Array.isArray(variant?.tags) || variant.tags.length === 0) {
      errors.push(`variants[${index}].tags must be a non-empty array`);
    }

    const applied = templateModule.applyTemplateVariant(template, variant);
    if (applied.id !== `${template.id}__${variant.id}`) {
      errors.push(`variants[${index}] applied id must be template id plus variant id`);
    }
    if (!String(applied.name || "").includes(variant.name)) {
      errors.push(`variants[${index}] applied name must include variant name`);
    }
    if (!String(applied.defaultBrief || "").includes(variant.briefSuffix)) {
      errors.push(`variants[${index}] applied brief must include variant suffix`);
    }
    for (const guidance of variant.promptGuidance || []) {
      if (!applied.promptGuidance?.includes(guidance)) {
        errors.push(`variants[${index}] applied prompt guidance is missing variant guidance`);
        break;
      }
    }
    for (const tag of variant.tags || []) {
      if (!applied.tags?.includes(tag)) {
        errors.push(`variants[${index}] applied tags are missing variant tag`);
        break;
      }
    }
    for (const criterion of variant.acceptanceCriteria || []) {
      if (!applied.acceptanceCriteria?.includes(criterion)) {
        errors.push(`variants[${index}] applied acceptance criteria are missing variant criterion`);
        break;
      }
    }
  }

  return {
    variantOk: errors.length === errorCountBefore && duplicateIds.length === 0 && variants.length >= 3,
    variantCount: variants.length,
    variantIds,
  };
}

function createCapabilityMatrix(templates, templateModule) {
  if (!templateModule || typeof templateModule.createDesignTemplateCapabilityMatrix !== "function") {
    return {
      ok: false,
      matrix: null,
      detail: { error: "createDesignTemplateCapabilityMatrix is not available." },
    };
  }

  try {
    const matrix = templateModule.createDesignTemplateCapabilityMatrix(templates);
    const matrixTemplates = Array.isArray(matrix?.templates) ? matrix.templates : [];
    const workflowNodeTypes = Array.isArray(matrix?.workflowNodeTypes) ? matrix.workflowNodeTypes : [];
    const deliverableKinds = Array.isArray(matrix?.deliverableKinds) ? matrix.deliverableKinds : [];
    const allTemplatesReady = matrixTemplates.length === templates.length && matrixTemplates.every((template) => template.ready === true);
    const allTemplateChecksPassed = matrixTemplates.every((template) =>
      Array.isArray(template.checks) && template.checks.every((check) => check.status === "passed")
    );
    const ok =
      matrix?.schemaVersion === 1 &&
      matrix?.templateCount === templates.length &&
      matrix?.readyTemplateCount === templates.length &&
      matrix?.variantCount === 15 &&
      Array.isArray(matrix?.missingKinds) &&
      matrix.missingKinds.length === 0 &&
      allTemplatesReady &&
      allTemplateChecksPassed &&
      ["promptNode", "imageGeneratorProNode", "pptContentNode", "pptAssemblerNode", "videoGeneratorNode"].every((nodeType) =>
        workflowNodeTypes.includes(nodeType)
      ) &&
      ["image", "workflow", "project"].every((kind) => deliverableKinds.includes(kind));

    return {
      ok,
      matrix,
      detail: {
        templateCount: matrix?.templateCount,
        readyTemplateCount: matrix?.readyTemplateCount,
        variantCount: matrix?.variantCount,
        missingKinds: matrix?.missingKinds,
        workflowNodeTypes,
        deliverableKinds,
        allTemplatesReady,
        allTemplateChecksPassed,
      },
    };
  } catch (error) {
    return {
      ok: false,
      matrix: null,
      detail: { error: error instanceof Error ? error.message : String(error) },
    };
  }
}

function validateDeliverables(template, errors) {
  if (!Array.isArray(template.deliverables) || template.deliverables.length === 0) {
    errors.push("deliverables must be a non-empty array");
    return;
  }
  if (!template.deliverables.some((item) => item?.required === true)) {
    errors.push("deliverables must include at least one required item");
  }
  for (const [index, item] of template.deliverables.entries()) {
    if (!isNonEmptyString(item?.id)) errors.push(`deliverables[${index}].id must be a non-empty string`);
    if (!isNonEmptyString(item?.title)) errors.push(`deliverables[${index}].title must be a non-empty string`);
    if (!isNonEmptyString(item?.kind)) errors.push(`deliverables[${index}].kind must be a non-empty string`);
    if (typeof item?.required !== "boolean") errors.push(`deliverables[${index}].required must be boolean`);
    if (!isNonEmptyString(item?.description)) errors.push(`deliverables[${index}].description must be a non-empty string`);
  }
}

function validateWorkflowNodes(template, errors) {
  if (!Array.isArray(template.recommendedWorkflowNodes) || template.recommendedWorkflowNodes.length === 0) {
    errors.push("recommendedWorkflowNodes must be a non-empty array");
    return;
  }
  if (!template.recommendedWorkflowNodes.some((item) => item?.required === true)) {
    errors.push("recommendedWorkflowNodes must include at least one required item");
  }
  for (const [index, item] of template.recommendedWorkflowNodes.entries()) {
    if (!isNonEmptyString(item?.nodeType)) errors.push(`recommendedWorkflowNodes[${index}].nodeType must be a non-empty string`);
    if (!isNonEmptyString(item?.label)) errors.push(`recommendedWorkflowNodes[${index}].label must be a non-empty string`);
    if (typeof item?.required !== "boolean") errors.push(`recommendedWorkflowNodes[${index}].required must be boolean`);
    if (!isNonEmptyString(item?.purpose)) errors.push(`recommendedWorkflowNodes[${index}].purpose must be a non-empty string`);
  }
}

function validateKindSpecificRules(template, errors) {
  const nodeTypes = Array.isArray(template.recommendedWorkflowNodes)
    ? template.recommendedWorkflowNodes.map((item) => item?.nodeType)
    : [];
  const deliverableKinds = Array.isArray(template.deliverables) ? template.deliverables.map((item) => item?.kind) : [];

  if (imageTemplateKinds.has(template.kind)) {
    if (!isNonEmptyString(template.aspectRatio)) errors.push(`${template.kind} must define aspectRatio`);
    if (template.outputKind !== "image") errors.push(`${template.kind} outputKind must be image`);
    if (!nodeTypes.includes("promptNode")) errors.push(`${template.kind} must recommend promptNode`);
    if (!nodeTypes.includes("imageGeneratorProNode")) errors.push(`${template.kind} must recommend imageGeneratorProNode`);
    if (!deliverableKinds.includes("image")) errors.push(`${template.kind} must include an image deliverable`);
  }

  if (template.kind === "ppt") {
    if (template.planKind !== "ppt") errors.push("ppt template planKind must be ppt");
    if (template.outputKind !== "workflow") errors.push("ppt template outputKind must be workflow");
    if (!isNonEmptyString(template.pageCountRange)) errors.push("ppt template must define pageCountRange");
    for (const nodeType of ["promptNode", "pptContentNode", "pptAssemblerNode"]) {
      if (!nodeTypes.includes(nodeType)) errors.push(`ppt template must recommend ${nodeType}`);
    }
    if (!deliverableKinds.includes("workflow")) errors.push("ppt template must include a workflow deliverable");
    if (!deliverableKinds.includes("project")) errors.push("ppt template must include a project deliverable");
  }

  if (template.kind === "video-cover") {
    if (template.planKind !== "video") errors.push("video-cover template planKind must be video");
    if (!isNonEmptyString(template.aspectRatio)) errors.push("video-cover template must define aspectRatio");
    if (!isNonEmptyString(template.videoSize)) errors.push("video-cover template must define videoSize");
    if (!nodeTypes.includes("promptNode")) errors.push("video-cover template must recommend promptNode");
    if (!nodeTypes.includes("videoGeneratorNode")) errors.push("video-cover template must recommend videoGeneratorNode");
    if (!deliverableKinds.includes("image")) errors.push("video-cover template must include an image cover deliverable");
  }
}

function requireStringArray(template, field, errors) {
  if (!Array.isArray(template[field]) || template[field].length === 0) {
    errors.push(`${field} must be a non-empty array`);
    return;
  }
  for (const [index, item] of template[field].entries()) {
    if (!isNonEmptyString(item)) errors.push(`${field}[${index}] must be a non-empty string`);
  }
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function addCheck(id, label, passed, detail = {}) {
  checks.push({
    id,
    label,
    status: passed ? "passed" : "failed",
    detail,
  });
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
