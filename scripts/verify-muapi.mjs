#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const DEFAULT_BASE_URL = "https://api.muapi.ai";
const requiredStepIds = ["config", "account", "skills", "session", "chat", "events"];
const requiredEndpointRules = [
  { id: "account", pattern: /^GET \/api\/v1\/account\/balance$/ },
  { id: "skills", pattern: /^GET \/api\/v1\/creative-agent\/agent-skills$/ },
  { id: "session", pattern: /^POST \/api\/v1\/creative-agent\/sessions$/ },
  { id: "chat", pattern: /^POST \/api\/v1\/creative-agent\/sessions\/[^/]+\/chat$/ },
  { id: "events", pattern: /^GET \/api\/v1\/creative-agent\/jobs\/[^/]+\/events$/ },
];

const argv = process.argv.slice(2);
loadEnvFiles();
const args = new Set(argv);
const baseUrl = normalizeBaseUrl(process.env.MUAPI_BASE_URL || DEFAULT_BASE_URL);
const apiKey = (process.env.MUAPI_API_KEY || "").trim();
const model = (process.env.MUAPI_MODEL || "gpt-4o").trim();
const chatProbe = (process.env.MUAPI_CHAT_PROBE || "").trim();
const jsonOutput = args.has("--json");
const requireChat = args.has("--require-chat") || process.env.MUAPI_REQUIRE_CHAT === "1";
const reportPath = getArgValue("--report") || process.env.MUAPI_VERIFY_REPORT || "";

const steps = [];
const endpointLog = [];
let checkedAt = "";
let remoteSessionId = "";
let remoteJobId = "";

function log(message) {
  if (!jsonOutput) console.log(message);
}

function fail(message, code = 1) {
  const result = buildResult(false, { error: message });
  writeReport(result);
  if (jsonOutput) console.log(JSON.stringify(result, null, 2));
  else console.error(message);
  process.exit(code);
}

async function main() {
  checkedAt = new Date().toISOString();
  log(`MuAPI verification started: ${checkedAt}`);
  log(`Base URL: ${baseUrl}`);

  await runStep("config", "Configuration", async () => {
    if (!apiKey) {
      throw new Error("Missing MUAPI_API_KEY. Set MUAPI_API_KEY before running real MuAPI verification.");
    }
    return {
      baseUrl,
      model,
      requireChat,
      chatProbeConfigured: Boolean(chatProbe),
      reportPath: reportPath || null,
    };
  });

  await runStep("account", "Account balance", () => request("/api/v1/account/balance"));
  await runStep("skills", "Agent skills", () => request("/api/v1/creative-agent/agent-skills"));
  const session = await runStep("session", "Create session", () =>
    request("/api/v1/creative-agent/sessions", {
      method: "POST",
      body: {
        name: `NextLemon CLI verification ${checkedAt}`,
      },
    })
  );

  remoteSessionId = getString(session?.id);
  if (chatProbe) {
    if (!remoteSessionId) {
      fail("Chat probe requested but session response did not include id.");
    }
    const chat = await runStep("chat", "Chat probe", () =>
      request(`/api/v1/creative-agent/sessions/${encodeURIComponent(remoteSessionId)}/chat`, {
        method: "POST",
        body: {
          message: chatProbe,
          messages_snapshot: [],
          model,
        },
      })
    );
    remoteJobId = getString(chat?.job_id) || getString(chat?.jobId) || getString(chat?.job?.id);
    if (!remoteJobId && requireChat) {
      steps.push({
        id: "events",
        label: "Job events",
        status: "failed",
        durationMs: 0,
        error: "Strict chat verification requires chat response to include job_id, jobId, or job.id so job events can be fetched.",
      });
      fail("Strict chat verification requires chat response to include job_id, jobId, or job.id so job events can be fetched.");
    } else if (remoteJobId) {
      await runStep("events", "Job events", () =>
        request(`/api/v1/creative-agent/jobs/${encodeURIComponent(remoteJobId)}/events`)
      );
    }
  } else if (requireChat) {
    const step = {
      id: "chat",
      label: "Chat probe",
      status: "failed",
      durationMs: 0,
      error: "MUAPI_CHAT_PROBE is required when --require-chat or MUAPI_REQUIRE_CHAT=1 is set.",
    };
    steps.push(step);
    fail(step.error);
  } else {
    steps.push({
      id: "chat",
      label: "Chat probe",
      status: "skipped",
      durationMs: 0,
      detail: "MUAPI_CHAT_PROBE is empty; skipped potentially billable chat request.",
    });
    log("SKIP Chat probe: MUAPI_CHAT_PROBE is empty");
  }

  const result = buildResult(steps.every((step) => step.status === "passed" || step.status === "skipped"), {
    remoteSessionId,
    remoteJobId: remoteJobId || undefined,
  });

  if (jsonOutput) console.log(JSON.stringify(result, null, 2));
  else log("MuAPI verification completed.");
  writeReport(result);
}

async function runStep(id, label, fn) {
  const startedAt = Date.now();
  try {
    const detail = await fn();
    const step = {
      id,
      label,
      status: "passed",
      durationMs: Date.now() - startedAt,
      detail,
    };
    steps.push(step);
    log(`PASS ${label} (${step.durationMs}ms)`);
    return detail;
  } catch (error) {
    const step = {
      id,
      label,
      status: "failed",
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
    steps.push(step);
    if (jsonOutput) {
      const result = buildResult(false);
      writeReport(result);
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.error(`FAIL ${label}: ${step.error}`);
    }
    process.exit(1);
  }
}

async function request(path, options = {}) {
  const startedAt = Date.now();
  const method = options.method || "GET";
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  endpointLog.push({
    method,
    path,
    status: response.status,
    durationMs: Date.now() - startedAt,
  });
  const data = text ? safeJsonParse(text) : {};
  if (!response.ok) {
    const detail = data?.detail || data?.message || response.statusText;
    throw new Error(`MuAPI ${response.status}: ${detail}`);
  }
  return unwrapMuApiData(data);
}

function normalizeBaseUrl(value) {
  return value.trim().replace(/\/+$/, "");
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return { detail: value };
  }
}

function unwrapMuApiData(value) {
  if (value && typeof value === "object" && "data" in value && Object.keys(value).length <= 3) {
    return value.data;
  }
  return value;
}

function getString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function loadEnvFiles() {
  for (const fileName of [".env.local", ".env"]) {
    if (!existsSync(fileName)) continue;
    const content = readFileSync(fileName, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const [key, ...rest] = trimmed.split("=");
      if (!key || process.env[key] !== undefined) continue;
      process.env[key] = rest.join("=").replace(/^['"]|['"]$/g, "");
    }
  }
}

function getArgValue(name) {
  const exact = argv.find((item) => item.startsWith(`${name}=`));
  if (exact) return exact.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || "" : "";
}

function writeReport(result) {
  if (!reportPath) return;
  writeFileSync(reportPath, `${JSON.stringify(result, null, 2)}\n`);
}

function buildResult(ok, extra = {}) {
  const report = {
    ok,
    checkedAt: checkedAt || new Date().toISOString(),
    baseUrl,
    model,
    configured: Boolean(apiKey),
    realService: endpointLog.length > 0,
    requireChat,
    chatProbeConfigured: Boolean(chatProbe),
    redaction: {
      secretValuesReturned: false,
      redactedKeys: ["MUAPI_API_KEY", "MUAPI_CHAT_PROBE", "x-api-key"],
      note: "Request headers, API key values, and chat probe text are not written to verification reports.",
    },
    steps,
    endpointLog,
    ...(remoteSessionId ? { remoteSessionId } : {}),
    ...(remoteJobId ? { remoteJobId } : {}),
    ...extra,
  };
  const evidence = buildStrictEvidence(report);
  return {
    ...report,
    strictEvidenceReady: evidence.blockingEvidenceIds.length === 0,
    stepEvidence: evidence.stepEvidence,
    missingStepIds: evidence.missingStepIds,
    failedStepIds: evidence.failedStepIds,
    endpointEvidence: evidence.endpointEvidence,
    missingEndpointIds: evidence.missingEndpointIds,
    failedEndpoint2xxIds: evidence.failedEndpoint2xxIds,
    evidenceChecklist: evidence.evidenceChecklist,
    blockingEvidenceIds: evidence.blockingEvidenceIds,
  };
}

function buildStrictEvidence(report) {
  const stepEvidence = Object.fromEntries(
    requiredStepIds.map((id) => {
      const step = steps.find((item) => item && item.id === id);
      return [
        id,
        {
          seen: Boolean(step),
          passed: step?.status === "passed",
          status: step?.status,
        },
      ];
    })
  );
  const endpointEvidence = Object.fromEntries(
    requiredEndpointRules.map((rule) => {
      const matches = endpointLog.filter((entry) => rule.pattern.test(`${entry.method || "GET"} ${entry.path || ""}`));
      return [
        rule.id,
        {
          seen: matches.length > 0,
          has2xx: matches.some((entry) => isSuccessStatus(entry.status)),
          count: matches.length,
          statuses: [...new Set(matches.map((entry) => entry.status).filter((status) => status !== undefined))],
        },
      ];
    })
  );
  const evidenceChecklist = [
    evidenceItem("report-ok", "Verification report succeeded", report.ok === true, { value: report.ok }),
    evidenceItem("configured", "MuAPI API key was configured for verification", report.configured === true, { value: report.configured }),
    evidenceItem("real-service", "Verification reached a MuAPI-compatible service", report.realService === true, { value: report.realService }),
    evidenceItem("non-localhost-base-url", "Base URL is not localhost", !isLocalhostUrl(report.baseUrl), { baseUrl: report.baseUrl }),
    evidenceItem("remote-session-id", "Remote session id is present", Boolean(report.remoteSessionId), {
      present: Boolean(report.remoteSessionId),
    }),
    evidenceItem("remote-job-id", "Remote job id is present for strict chat verification", Boolean(report.remoteJobId), {
      present: Boolean(report.remoteJobId),
    }),
    evidenceItem("redaction", "Report contains no secret values", report.redaction?.secretValuesReturned === false, {
      secretValuesReturned: report.redaction?.secretValuesReturned,
    }),
  ];

  for (const id of requiredStepIds) {
    const evidence = stepEvidence[id] || { seen: false, passed: false, status: undefined };
    evidenceChecklist.push(
      evidenceItem(`step-${id}`, `Required step ${id} passed`, evidence.seen === true && evidence.passed === true, {
        seen: evidence.seen,
        status: evidence.status,
      })
    );
  }

  for (const rule of requiredEndpointRules) {
    const evidence = endpointEvidence[rule.id] || { seen: false, has2xx: false, count: 0, statuses: [] };
    evidenceChecklist.push(
      evidenceItem(`endpoint-${rule.id}`, `Endpoint ${rule.id} has 2xx evidence`, evidence.seen === true && evidence.has2xx === true, {
        seen: evidence.seen,
        has2xx: evidence.has2xx,
        count: evidence.count,
        statuses: evidence.statuses,
      })
    );
  }

  return {
    stepEvidence,
    missingStepIds: Object.entries(stepEvidence)
      .filter(([, evidence]) => evidence.seen !== true)
      .map(([id]) => id),
    failedStepIds: Object.entries(stepEvidence)
      .filter(([, evidence]) => evidence.seen === true && evidence.passed !== true)
      .map(([id]) => id),
    endpointEvidence,
    missingEndpointIds: Object.entries(endpointEvidence)
      .filter(([, evidence]) => evidence.seen !== true)
      .map(([id]) => id),
    failedEndpoint2xxIds: Object.entries(endpointEvidence)
      .filter(([, evidence]) => evidence.seen === true && evidence.has2xx !== true)
      .map(([id]) => id),
    evidenceChecklist,
    blockingEvidenceIds: evidenceChecklist.filter((item) => item.status !== "passed").map((item) => item.id),
  };
}

function evidenceItem(id, label, passed, evidence) {
  return {
    id,
    label,
    required: true,
    status: passed ? "passed" : "failed",
    evidence,
  };
}

function isLocalhostUrl(value) {
  if (!getString(value)) return true;
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return true;
  }
}

function isSuccessStatus(value) {
  return typeof value === "number" && value >= 200 && value < 300;
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
