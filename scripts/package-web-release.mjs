#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { deflateRawSync } from "node:zlib";

const argv = process.argv.slice(2);
const root = process.cwd();
const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const outputPath = path.resolve(root, getArgValue("--output") || path.join("releases", `NextLemon-v${packageJson.version}-web.zip`));
const distDir = path.join(root, "dist");
const jsonOutput = argv.includes("--json");

const FIXED_DOS_TIME = 0;
const FIXED_DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
const CRC32_TABLE = createCrc32Table();

if (!existsSync(distDir)) {
  fail("dist directory does not exist. Run npm run build first.");
}

mkdirSync(path.dirname(outputPath), { recursive: true });

const tempOutputPath = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
writeDeterministicZip(distDir, tempOutputPath);
replaceOutputFile(tempOutputPath, outputPath);

const report = {
  ok: true,
  outputPath: path.relative(root, outputPath),
  size: statSync(outputPath).size,
  sha256: createHash("sha256").update(readFileSync(outputPath)).digest("hex"),
};

if (jsonOutput) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`Web release package created: ${report.outputPath}`);
  console.log(`SHA-256: ${report.sha256}`);
}

function writeDeterministicZip(sourceDir, targetPath) {
  const files = listFiles(sourceDir).sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const chunks = [];
  const centralDirectory = [];
  let offset = 0;

  for (const file of files) {
    const raw = readFileSync(file.absolutePath);
    const compressed = deflateRawSync(raw, { level: 9 });
    const name = Buffer.from(file.relativePath, "utf8");
    const crc = crc32(raw);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(FIXED_DOS_TIME, 10);
    localHeader.writeUInt16LE(FIXED_DOS_DATE, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(raw.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);

    chunks.push(localHeader, name, compressed);
    centralDirectory.push({
      name,
      crc,
      compressedSize: compressed.length,
      uncompressedSize: raw.length,
      offset,
    });
    offset += localHeader.length + name.length + compressed.length;
  }

  const centralStart = offset;
  for (const entry of centralDirectory) {
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(8, 10);
    header.writeUInt16LE(FIXED_DOS_TIME, 12);
    header.writeUInt16LE(FIXED_DOS_DATE, 14);
    header.writeUInt32LE(entry.crc, 16);
    header.writeUInt32LE(entry.compressedSize, 20);
    header.writeUInt32LE(entry.uncompressedSize, 24);
    header.writeUInt16LE(entry.name.length, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE(0, 38);
    header.writeUInt32LE(entry.offset, 42);
    chunks.push(header, entry.name);
    offset += header.length + entry.name.length;
  }

  const centralSize = offset - centralStart;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(centralDirectory.length, 8);
  end.writeUInt16LE(centralDirectory.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20);
  chunks.push(end);

  writeFileSync(targetPath, Buffer.concat(chunks));
}

function replaceOutputFile(tempPath, targetPath) {
  try {
    if (existsSync(targetPath)) removeWithRetry(targetPath);
    renameSync(tempPath, targetPath);
  } catch (error) {
    try {
      if (existsSync(tempPath)) rmSync(tempPath, { force: true });
    } catch {
      // Best effort cleanup; the original error is more useful.
    }
    throw error;
  }
}

function removeWithRetry(targetPath) {
  const attempts = 8;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      rmSync(targetPath, { force: true });
      return;
    } catch (error) {
      if (attempt === attempts || !isRetryableFileError(error)) throw error;
      sleep(150 * attempt);
    }
  }
}

function isRetryableFileError(error) {
  return Boolean(error && ["EBUSY", "EPERM", "EACCES"].includes(error.code));
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function listFiles(directory, base = directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(absolutePath, base));
    } else if (entry.isFile()) {
      files.push({
        absolutePath,
        relativePath: path.relative(base, absolutePath).replace(/\\/g, "/"),
      });
    }
  }
  return files;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createCrc32Table() {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

function getArgValue(name) {
  const exact = argv.find((item) => item.startsWith(`${name}=`));
  if (exact) return exact.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || "" : "";
}

function fail(message) {
  const result = { ok: false, error: message };
  if (jsonOutput) console.log(JSON.stringify(result, null, 2));
  else console.error(message);
  process.exit(1);
}
