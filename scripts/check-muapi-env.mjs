#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_BASE_URL = "https://api.muapi.ai";
const argv = process.argv.slice(2);
const root = process.cwd();
const jsonOutput = argv.includes("--json");
const requireReal = argv.includes("--require-real");
const requireChat = argv.includes("--require-chat") || process.env.MUAPI_REQUIRE_CHAT === "1";
const reportPath = getArgValue("--report") || process.env.MUAPI_ENV_REPORT || "";

loadEnvFiles();

const baseUrl = normalizeBaseUrl(process.env.MUAPI_BASE_URL || DEFAULT_BASE_URL);
const apiKey = (process.env.MUAPI_API_KEY || "").trim();
const model = (process.env.MUAPI_MODEL || "gpt-4o").trim();
const chatProbe = (process.env.MUAPI_CHAT_PROBE || "").trim();
const envLocalPath = path.join(root, ".env.local");
const envPath = path.join(root, ".env");
const envExamplePath = path.join(root, ".env.example");
const gitignorePath = path.join(root, ".gitignore");

const checks = [
  createCheck("env-template", ".env.example contains required MuAPI keys", checkEnvTemplate()),
  createCheck("secret-hygiene", ".env.local is ignored by git", checkGitignore()),
  createCheck("base-url", "MUAPI_BASE_URL is parseable", checkBaseUrl()),
  createCheck("api-key", "MUAPI_API_KEY is configured", checkApiKey()),
  createCheck("model", "MUAPI_MODEL is configured", Boolean(model), "MUAPI_MODEL is empty."),
  createCheck(
    "chat-probe",
    "MUAPI_CHAT_PROBE is configured when strict chat verification is required",
    !requireChat || Boolean(chatProbe),
    "MUAPI_CHAT_PROBE is required for --require-chat / MUAPI_REQUIRE_CHAT=1."
  ),
  createCheck(
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
  .map((check) => checkToEnvKey(check.id))
  .filter(Boolean);

const result = {
  ok: checks.every((check) => check.status === "passed"),
  checkedAt: new Date().toISOString(),
  requireReal,
  requireChat,
  envLocalExists: existsSync(envLocalPath),
  envExists: existsSync(envPath),
  envExampleExists: existsSync(envExamplePath),
  baseUrl,
  model,
  apiKeyConfigured: checkApiKey().ok === true,
  chatProbeConfigured: Boolean(chatProbe),
  missingEnvKeys,
  failedEnvKeys,
  redaction: {
    secretValuesReturned: false,
    redactedKeys: ["MUAPI_API_KEY", "MUAPI_CHAT_PROBE"],
  },
  checks,
  nextCommands: {
    copyTemplate: "copy .env.example .env.local",
    strictVerify: "npm run verify:muapi -- --json --require-chat --report releases\\muapi-real-verification-report.json",
    assertReal: "npm run verify:muapi:assert-real -- --json --report releases\\muapi-real-verification-report.json",
    release: "npm run verify:release -- --json --report releases\\agentic-readiness-report.json",
  },
};

if (jsonOutput) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(result.ok ? "MuAPI environment is ready." : "MuAPI environment is not ready.");
  for (const check of checks) {
    console.log(`${check.status.toUpperCase()} ${check.id}: ${check.label}${check.error ? ` - ${check.error}` : ""}`);
  }
}
if (reportPath) writeFileSync(path.resolve(root, reportPath), `${JSON.stringify(result, null, 2)}\n`);
process.exit(result.ok ? 0 : 1);

function checkEnvTemplate() {
  if (!existsSync(envExamplePath)) return { ok: false, error: ".env.example does not exist." };
  const content = readFileSync(envExamplePath, "utf8");
  const required = [
    "MUAPI_BASE_URL",
    "MUAPI_API_KEY",
    "MUAPI_MODEL",
    "MUAPI_CHAT_PROBE",
    "MUAPI_REQUIRE_CHAT",
    "MUAPI_VERIFY_REPORT",
    "MUAPI_ENV_REPORT",
  ];
  const missing = required.filter((key) => !new RegExp(`^${key}=`, "m").test(content));
  return {
    ok: missing.length === 0,
    detail: { required, missing },
    error: missing.length ? `Missing keys: ${missing.join(", ")}` : undefined,
  };
}

function checkGitignore() {
  if (!existsSync(gitignorePath)) return { ok: false, error: ".gitignore does not exist." };
  const gitignore = readFileSync(gitignorePath, "utf8");
  const ok = /^\.env\.local$/m.test(gitignore) || /^\*\.local$/m.test(gitignore);
  return {
    ok,
    error: ok ? undefined : ".gitignore should ignore .env.local or *.local.",
  };
}

function checkBaseUrl() {
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

function checkApiKey() {
  if (!apiKey) return { ok: false, error: "MUAPI_API_KEY is empty." };
  const lowered = apiKey.toLowerCase();
  const looksPlaceholder = ["mock", "test-key", "example", "your-api-key", "changeme"].some((item) => lowered.includes(item));
  return {
    ok: !looksPlaceholder,
    error: looksPlaceholder ? "MUAPI_API_KEY looks like a placeholder/mock value." : undefined,
  };
}

function checkToEnvKey(checkId) {
  if (checkId === "api-key") return "MUAPI_API_KEY";
  if (checkId === "chat-probe") return "MUAPI_CHAT_PROBE";
  if (checkId === "model") return "MUAPI_MODEL";
  if (checkId === "base-url" || checkId === "real-base-url") return "MUAPI_BASE_URL";
  return "";
}

function createCheck(id, label, value, fallbackError) {
  const normalized = typeof value === "object" && value !== null ? value : { ok: Boolean(value), error: fallbackError };
  return {
    id,
    label,
    status: normalized.ok ? "passed" : "failed",
    detail: normalized.detail,
    error: normalized.ok ? undefined : normalized.error || fallbackError,
  };
}

function loadEnvFiles() {
  for (const fileName of [".env.local", ".env"]) {
    const filePath = path.join(root, fileName);
    if (!existsSync(filePath)) continue;
    const content = readFileSync(filePath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const [key, ...rest] = trimmed.split("=");
      if (!key || process.env[key] !== undefined) continue;
      process.env[key] = rest.join("=").replace(/^['"]|['"]$/g, "");
    }
  }
}

function normalizeBaseUrl(value) {
  return value.trim().replace(/\/+$/, "");
}

function isLocalhostUrl(value) {
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return true;
  }
}

function getArgValue(name) {
  const exact = argv.find((item) => item.startsWith(`${name}=`));
  if (exact) return exact.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || "" : "";
}
