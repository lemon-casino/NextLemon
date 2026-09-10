#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const argv = process.argv.slice(2);
const inputPath = getArgValue("--input");
const outputPath = getArgValue("--output") || "nextlemon-brand-spec.json";
const sourcePath = path.resolve(process.cwd(), getArgValue("--source") || "src/services/designTemplateService.ts");

if (!inputPath) {
  console.error("Usage: npm run brand:spec -- --input brand-input.json --output brand-spec.json");
  process.exit(2);
}

const input = JSON.parse(readFileSync(inputPath, "utf8"));
const brandKit = input.brandKit;
const assets = Array.isArray(input.assets) ? input.assets : [];
const template = input.template || null;

if (!brandKit || typeof brandKit !== "object") {
  console.error("Input must include brandKit.");
  process.exit(2);
}

const templateModule = await importDesignTemplateModule(sourcePath);
if (typeof templateModule.createBrandSpecDocument !== "function") {
  console.error("Template service must export createBrandSpecDocument.");
  process.exit(2);
}

const spec = templateModule.createBrandSpecDocument(brandKit, assets, template);
writeFileSync(outputPath, `${JSON.stringify(spec, null, 2)}\n`);
console.log(`Brand spec exported: ${outputPath}`);

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

function getArgValue(name) {
  const exact = argv.find((item) => item.startsWith(`${name}=`));
  if (exact) return exact.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || "" : "";
}
