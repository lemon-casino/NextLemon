import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const packageJsonPath = path.join(rootDir, "package.json");

const tag = (process.argv[2] ?? "").trim();
const match = /^v?(\d+\.\d+\.\d+)$/.exec(tag);

if (!match?.[1]) {
  console.error(`Invalid version tag: "${tag}". Expected format: vX.Y.Z`);
  process.exit(1);
}

const version = match[1];
const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));

if (pkg.version !== version) {
  pkg.version = version;
  writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`Updated version in package.json to ${version}`);
} else {
  console.log(`package.json already at version ${version}`);
}
