import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const tag = process.argv[2];

if (!tag) {
  console.error("Usage: node scripts/set-version-from-tag.mjs <tag>");
  process.exit(1);
}

const match = tag.match(/(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/);

if (!match) {
  console.error("Tag does not contain a valid semver version (e.g. v0.0.1)");
  process.exit(1);
}

const version = match[1];
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const packageJsonPath = path.join(rootDir, "package.json");

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

if (packageJson.version !== version) {
  packageJson.version = version;
  writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
  console.log(`Updated package.json version to ${version}`);
} else {
  console.log(`package.json already at version ${version}`);
}
