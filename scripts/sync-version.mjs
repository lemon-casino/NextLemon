import { readFileSync, writeFileSync } from "fs";
import path from "path";

const rootDir = path.resolve(new URL("..", import.meta.url).pathname);

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeIfChanged(filePath, content) {
  const current = readFileSync(filePath, "utf8");
  if (current !== content) {
    writeFileSync(filePath, content);
    console.log(`updated ${path.relative(rootDir, filePath)}`);
  }
}

const packageJsonPath = path.join(rootDir, "package.json");
const { version } = readJson(packageJsonPath);

// keep tauri config in sync
const tauriConfigPath = path.join(rootDir, "src-tauri", "tauri.conf.json");
const tauriConfig = readJson(tauriConfigPath);
if (tauriConfig.version !== version) {
  tauriConfig.version = version;
  writeIfChanged(tauriConfigPath, `${JSON.stringify(tauriConfig, null, 2)}\n`);
}

// keep Cargo.toml version in sync
const cargoTomlPath = path.join(rootDir, "src-tauri", "Cargo.toml");
const cargoTomlContent = readFileSync(cargoTomlPath, "utf8");
const cargoTomlUpdated = cargoTomlContent.replace(
  /(\[package\][^\[]*?\nversion\s*=\s*")(.*?)(")/s,
  (_match, prefix, _old, suffix) => `${prefix}${version}${suffix}`
);
writeIfChanged(cargoTomlPath, cargoTomlUpdated);

// keep Cargo.lock version for the app crate in sync
const cargoLockPath = path.join(rootDir, "src-tauri", "Cargo.lock");
const cargoLockContent = readFileSync(cargoLockPath, "utf8");
const cargoLockUpdated = cargoLockContent.replace(
  /(\[\[package\]\]\s+name = "nextcreator"\s+version = ")(.*?)(")/s,
  (_match, prefix, _old, suffix) => `${prefix}${version}${suffix}`
);
writeIfChanged(cargoLockPath, cargoLockUpdated);

// update README badge
const readmePath = path.join(rootDir, "README.md");
const readmeContent = readFileSync(readmePath, "utf8");
const badgePattern = /version-[0-9A-Za-z_.-]+-blue\.svg/;
const badgeReplacement = `version-${version}-blue.svg`;
const readmeUpdated = badgePattern.test(readmeContent)
  ? readmeContent.replace(badgePattern, badgeReplacement)
  : readmeContent;
writeIfChanged(readmePath, readmeUpdated);

console.log(`Synced version to ${version}`);
