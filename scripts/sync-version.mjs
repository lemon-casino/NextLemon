import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const versionFile = path.join(rootDir, 'VERSION');

const version = readFileSync(versionFile, 'utf8').trim();

function updateJson(filePath, updateFn) {
  const absolutePath = path.join(rootDir, filePath);
  const raw = readFileSync(absolutePath, 'utf8');
  const data = JSON.parse(raw);
  const nextData = updateFn(data);
  const nextRaw = `${JSON.stringify(nextData, null, 2)}\n`;

  if (raw !== nextRaw) {
    writeFileSync(absolutePath, nextRaw, 'utf8');
    console.log(`Updated ${filePath}`);
  }
}

function updateTextFile(filePath, replaceFn) {
  const absolutePath = path.join(rootDir, filePath);
  const raw = readFileSync(absolutePath, 'utf8');
  const nextRaw = replaceFn(raw);

  if (raw !== nextRaw) {
    writeFileSync(absolutePath, nextRaw, 'utf8');
    console.log(`Updated ${filePath}`);
  }
}

updateJson('package.json', (pkg) => ({ ...pkg, version }));
updateJson('src-tauri/tauri.conf.json', (config) => ({ ...config, version }));

updateTextFile('src-tauri/Cargo.toml', (content) =>
  content.replace(/^version\s*=\s*"[^"]+"/m, `version = "${version}"`)
);

updateTextFile('.github/workflows/release.yml', (content) =>
  content.replace(
    /shared-key:\s*"v[^\"]+"/,
    'shared-key: "v${{ steps.app-version.outputs.app_version }}"'
  )
);

console.log(`Version synchronized to ${version}`);
