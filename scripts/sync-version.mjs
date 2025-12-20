import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const packageJsonPath = path.join(rootDir, "package.json");

const { version } = JSON.parse(readFileSync(packageJsonPath, "utf8"));

function updateJsonVersion(filePath) {
  const fullPath = path.join(rootDir, filePath);
  const json = JSON.parse(readFileSync(fullPath, "utf8"));

  if (json.version !== version) {
    json.version = version;
    writeFileSync(fullPath, `${JSON.stringify(json, null, 2)}\n`);
    console.log(`Updated version in ${filePath}`);
  }
}

function updateTauriConfig() {
  updateJsonVersion("src-tauri/tauri.conf.json");
}

function updateCargoToml() {
  const cargoPath = path.join(rootDir, "src-tauri/Cargo.toml");
  const content = readFileSync(cargoPath, "utf8");
  const pattern = /(^\[package\][^]*?^version\s*=\s*")([^"]+)("\s*$)/m;
  const updated = content.replace(pattern, `$1${version}$3`);

  if (updated !== content) {
    writeFileSync(cargoPath, updated);
    console.log("Updated version in src-tauri/Cargo.toml");
  }
}

function updateReadmeBadge() {
  const readmePath = path.join(rootDir, "README.md");
  const content = readFileSync(readmePath, "utf8");
  const badgePattern = /(version-)([0-9]+\.[0-9]+\.[0-9]+)(-blue\.svg)/;
  const updated = content.replace(badgePattern, `$1${version}$3`);

  if (updated !== content) {
    writeFileSync(readmePath, updated);
    console.log("Updated version badge in README.md");
  }
}

updateTauriConfig();
updateCargoToml();
updateReadmeBadge();
