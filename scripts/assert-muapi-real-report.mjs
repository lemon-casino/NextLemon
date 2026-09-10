#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const argv = process.argv.slice(2);
const reportPath = getArgValue("--report") || "releases/muapi-real-verification-report.json";
const jsonOutput = argv.includes("--json");

const requiredStepIds = ["config", "account", "skills", "session", "chat", "events"];
const requiredEndpointRules = [
  { id: "account", pattern: /^GET \/api\/v1\/account\/balance$/ },
  { id: "skills", pattern: /^GET \/api\/v1\/creative-agent\/agent-skills$/ },
  { id: "session", pattern: /^POST \/api\/v1\/creative-agent\/sessions$/ },
  { id: "chat", pattern: /^POST \/api\/v1\/creative-agent\/sessions\/[^/]+\/chat$/ },
  { id: "events", pattern: /^GET \/api\/v1\/creative-agent\/jobs\/[^/]+\/events$/ },
];
const forbiddenSecretKeyNames = new Set([
  "apikey",
  "api_key",
  "muapi_api_key",
  "x-api-key",
  "authorization",
  "bearer",
  "chatprobe",
  "chat_probe",
  "muapi_chat_probe",
]);

if (isCliEntry()) {
  const result = validateReport(reportPath);
  if (jsonOutput) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(result.ok ? "MuAPI real verification report is valid." : "MuAPI real verification report is invalid.");
    for (const error of result.errors) console.log(`- ${error}`);
  }
  process.exit(result.ok ? 0 : 1);
}

export function validateReport(reportPathInput) {
  const absolutePath = path.resolve(process.cwd(), reportPathInput);
  let report;
  try {
    report = safeJsonParse(readFileSync(absolutePath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to read report.";
    const evidenceChecklist = [evidenceItem("report-readable", "Verification report file is readable", false, { error: message })];
    return {
      ok: false,
      reportPath: reportPathInput,
      evidenceChecklist,
      blockingEvidenceIds: evidenceChecklist.map((item) => item.id),
      errors: [message],
    };
  }
  const errors = [];

  if (!report || typeof report !== "object" || Array.isArray(report)) {
    const evidenceChecklist = [
      evidenceItem("report-json-object", "Verification report is a JSON object", false, {
        actualType: Array.isArray(report) ? "array" : typeof report,
      }),
    ];
    return {
      ok: false,
      reportPath: reportPathInput,
      evidenceChecklist,
      blockingEvidenceIds: evidenceChecklist.map((item) => item.id),
      errors: ["Report must be a JSON object."],
    };
  }

  if (report.ok !== true) errors.push("report.ok must be true.");
  if (report.configured !== true) errors.push("report.configured must be true.");
  if (report.realService !== true) errors.push("report.realService must be true.");
  if (!isNonEmptyString(report.remoteSessionId)) errors.push("remoteSessionId is required.");
  if (!isNonEmptyString(report.remoteJobId)) errors.push("remoteJobId is required for strict chat verification.");
  if (isLocalhostUrl(report.baseUrl)) errors.push("baseUrl points to localhost; this is not a real MuAPI service.");

  const steps = Array.isArray(report.steps) ? report.steps : [];
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
  for (const id of requiredStepIds) {
    const step = steps.find((item) => item && item.id === id);
    if (!step) {
      errors.push(`Missing required step: ${id}.`);
    } else if (step.status !== "passed") {
      errors.push(`Step ${id} must be passed.`);
    }
  }

  const endpointLog = Array.isArray(report.endpointLog) ? report.endpointLog : [];
  if (endpointLog.length === 0) errors.push("endpointLog must contain real HTTP calls.");
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
  for (const rule of requiredEndpointRules) {
    const matches = endpointLog.filter((entry) => rule.pattern.test(`${entry.method || "GET"} ${entry.path || ""}`));
    if (matches.length === 0) {
      errors.push(`Missing endpoint evidence matching ${rule.pattern}.`);
    } else if (!matches.some((entry) => isSuccessStatus(entry.status))) {
      errors.push(`Endpoint evidence matching ${rule.pattern} must include a 2xx status.`);
    }
  }

  const redaction = inspectReportRedaction(report);
  if (redaction.secretFieldPaths.length > 0) {
    errors.push(`Report contains sensitive field(s): ${redaction.secretFieldPaths.join(", ")}.`);
  }
  if (redaction.literalSecretMatches.length > 0) {
    errors.push(`Report contains unredacted secret value(s): ${redaction.literalSecretMatches.join(", ")}.`);
  }
  const evidenceChecklist = buildEvidenceChecklist(report, {
    stepEvidence,
    endpointEvidence,
    redaction,
  });

  return {
    ok: errors.length === 0,
    reportPath: reportPathInput,
    checkedAt: report.checkedAt,
    baseUrl: report.baseUrl,
    remoteSessionId: report.remoteSessionId,
    remoteJobId: report.remoteJobId,
    endpointCount: endpointLog.length,
    endpoint2xxCount: endpointLog.filter((entry) => isSuccessStatus(entry.status)).length,
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
    evidencePolicy: {
      requiredSteps: requiredStepIds,
      requiredEndpoints: requiredEndpointRules.map((rule) => rule.id),
      requiresNonLocalhost: true,
      requiresEndpoint2xxEvidence: true,
      requiresRemoteSessionId: true,
      requiresRemoteJobId: true,
      requiresRedactedReport: true,
    },
    redaction: {
      secretValuesReturned: redaction.secretFieldPaths.length === 0 && redaction.literalSecretMatches.length === 0 ? false : true,
      secretFieldPaths: redaction.secretFieldPaths,
      literalSecretMatches: redaction.literalSecretMatches,
      scannedEnvKeys: redaction.scannedEnvKeys,
    },
    evidenceChecklist,
    blockingEvidenceIds: evidenceChecklist.filter((item) => item.status !== "passed").map((item) => item.id),
    errors,
  };
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isLocalhostUrl(value) {
  if (!isNonEmptyString(value)) return true;
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

function inspectReportRedaction(report) {
  const secretFieldPaths = [];
  collectSensitiveFields(report, "$", secretFieldPaths);

  const reportText = JSON.stringify(report);
  const envSecrets = [
    ["MUAPI_API_KEY", process.env.MUAPI_API_KEY || ""],
    ["MUAPI_CHAT_PROBE", process.env.MUAPI_CHAT_PROBE || ""],
  ].filter(([, value]) => shouldScanSecretValue(value));
  const literalSecretMatches = envSecrets
    .filter(([, value]) => reportText.includes(value))
    .map(([key]) => key);

  return {
    secretFieldPaths,
    literalSecretMatches,
    scannedEnvKeys: envSecrets.map(([key]) => key),
  };
}

function collectSensitiveFields(value, path, secretFieldPaths) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectSensitiveFields(item, `${path}[${index}]`, secretFieldPaths));
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (forbiddenSecretKeyNames.has(normalizeSecretKeyName(key))) secretFieldPaths.push(childPath);
    collectSensitiveFields(child, childPath, secretFieldPaths);
  }
}

function normalizeSecretKeyName(value) {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
}

function shouldScanSecretValue(value) {
  const secret = typeof value === "string" ? value.trim() : "";
  if (secret.length < 12) return false;
  const lowered = secret.toLowerCase();
  return !["mock", "test-key", "example", "your-api-key", "changeme"].some((item) => lowered.includes(item));
}

function buildEvidenceChecklist(report, { stepEvidence, endpointEvidence, redaction }) {
  const checklist = [
    evidenceItem("report-ok", "Verification report succeeded", report.ok === true, {
      value: report.ok,
    }),
    evidenceItem("configured", "MuAPI API key was configured for verification", report.configured === true, {
      value: report.configured,
    }),
    evidenceItem("real-service", "Verification reached a real MuAPI service", report.realService === true, {
      value: report.realService,
    }),
    evidenceItem("non-localhost-base-url", "Base URL is not localhost", !isLocalhostUrl(report.baseUrl), {
      baseUrl: report.baseUrl,
    }),
    evidenceItem("remote-session-id", "Remote session id is present", isNonEmptyString(report.remoteSessionId), {
      present: isNonEmptyString(report.remoteSessionId),
    }),
    evidenceItem("remote-job-id", "Remote job id is present for strict chat verification", isNonEmptyString(report.remoteJobId), {
      present: isNonEmptyString(report.remoteJobId),
    }),
    evidenceItem(
      "redaction",
      "Report contains no secret field names or configured secret values",
      redaction.secretFieldPaths.length === 0 && redaction.literalSecretMatches.length === 0,
      {
        secretFieldPathCount: redaction.secretFieldPaths.length,
        literalSecretMatchCount: redaction.literalSecretMatches.length,
      }
    ),
  ];

  for (const id of requiredStepIds) {
    const evidence = stepEvidence[id] || { seen: false, passed: false, status: undefined };
    checklist.push(
      evidenceItem(`step-${id}`, `Required step ${id} passed`, evidence.seen === true && evidence.passed === true, {
        seen: evidence.seen,
        status: evidence.status,
      })
    );
  }

  for (const rule of requiredEndpointRules) {
    const evidence = endpointEvidence[rule.id] || { seen: false, has2xx: false, count: 0, statuses: [] };
    checklist.push(
      evidenceItem(`endpoint-${rule.id}`, `Endpoint ${rule.id} has 2xx evidence`, evidence.seen === true && evidence.has2xx === true, {
        seen: evidence.seen,
        has2xx: evidence.has2xx,
        count: evidence.count,
        statuses: evidence.statuses,
      })
    );
  }

  return checklist;
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

function isCliEntry() {
  return Boolean(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href);
}

function getArgValue(name) {
  const exact = argv.find((item) => item.startsWith(`${name}=`));
  if (exact) return exact.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || "" : "";
}
