#!/usr/bin/env node
import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const argv = process.argv.slice(2);
const root = process.cwd();
const reportPath = getArgValue("--report") || path.join("releases", "muapi-mock-verification-report.json");
const verifierReportPath = getArgValue("--verifier-report") || path.join("releases", "muapi-mock-verifier-report.json");
const jsonOutput = argv.includes("--json");
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const FETCH_BLOCKED_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77,
  79, 87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123,
  135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526,
  530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993,
  995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566,
  6665, 6666, 6667, 6668, 6669, 6697, 10080,
]);

const seen = [];
const server = createServer(async (request, response) => {
  const body = await readBody(request);
  const url = new URL(request.url || "/", "http://127.0.0.1");
  seen.push({ method: request.method || "GET", path: url.pathname, body: safeJsonParse(body) });

  if (request.headers["x-api-key"] !== "mock-muapi-key") {
    sendJson(response, 401, { detail: "missing mock api key" });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/v1/account/balance") {
    sendJson(response, 200, { data: { balance: 100, currency: "mock-credit" } });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/v1/creative-agent/agent-skills") {
    sendJson(response, 200, { data: [{ name: "plan_propose" }, { name: "canvas_tool" }] });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/v1/creative-agent/sessions") {
    sendJson(response, 200, {
      data: {
        id: "mock-session",
        name: "Mock MuAPI verification",
        created_at: new Date().toISOString(),
      },
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/v1/creative-agent/sessions/mock-session/chat") {
    sendJson(response, 200, {
      data: {
        job_id: "mock-job",
        events: [
          { type: "plan_propose", data: { title: "Mock plan", brief: "mock", steps: [] } },
          { type: "approval_required", data: { title: "Mock approval", ops: [{ type: "workflow.selectNodes", nodeIds: [] }] } },
        ],
      },
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/v1/creative-agent/jobs/mock-job/events") {
    sendJson(response, 200, {
      data: [
        { type: "tool_call", data: { name: "workflow.selectNodes", args: { nodeIds: [] }, write: true } },
        { type: "tool_result", data: { ok: true, result: { selected: [] } } },
      ],
    });
    return;
  }

  sendJson(response, 404, { detail: `missing mock route: ${request.method} ${url.pathname}` });
});

const result = await main();
writeFileSync(path.resolve(root, reportPath), `${JSON.stringify(result, null, 2)}\n`);
if (jsonOutput) console.log(JSON.stringify(result, null, 2));
else {
  console.log(result.ok ? "MuAPI mock contract verification passed." : "MuAPI mock contract verification failed.");
  console.log(`Report: ${reportPath}`);
}
process.exit(result.ok ? 0 : 1);

async function main() {
  const baseUrl = await listen(server);
  const startedAt = Date.now();
  try {
    const child = await runVerifier(baseUrl);

    const verifierReport = safeJsonParse(readFileSync(path.resolve(root, verifierReportPath), "utf8"));
    const requiredPaths = [
      "/api/v1/account/balance",
      "/api/v1/creative-agent/agent-skills",
      "/api/v1/creative-agent/sessions",
      "/api/v1/creative-agent/sessions/mock-session/chat",
      "/api/v1/creative-agent/jobs/mock-job/events",
    ];
    const seenPaths = new Set(seen.map((item) => item.path));
    const missingPaths = requiredPaths.filter((item) => !seenPaths.has(item));
    const ok =
      child.exitCode === 0 &&
      verifierReport?.ok === true &&
      verifierReport?.configured === true &&
      verifierReport?.realService === true &&
      verifierReport?.remoteSessionId === "mock-session" &&
      verifierReport?.remoteJobId === "mock-job" &&
      missingPaths.length === 0;

    return {
      ok,
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      mock: true,
      baseUrl,
      verifierReportPath,
      requiredPaths,
      missingPaths,
      seen,
      verifier: {
        exitCode: child.exitCode,
        stdoutTail: tail(child.stdout),
        stderrTail: tail(child.stderr),
        report: verifierReport,
      },
      note: "This validates NextLemon's MuAPI adapter contract against a local mock. It is not a real MuAPI service verification.",
    };
  } finally {
    await close(server);
  }
}

function runVerifier(baseUrl) {
  return new Promise((resolve) => {
    const child = spawn(npmCmd, [
      "run",
      "verify:muapi",
      "--",
      "--json",
      "--require-chat",
      "--report",
      verifierReportPath,
    ], {
      cwd: root,
      shell: process.platform === "win32",
      env: {
        ...process.env,
        MUAPI_BASE_URL: baseUrl,
        MUAPI_API_KEY: "mock-muapi-key",
        MUAPI_MODEL: "mock-model",
        MUAPI_CHAT_PROBE: "mock contract probe",
        MUAPI_REQUIRE_CHAT: "1",
        MUAPI_VERIFY_REPORT: verifierReportPath,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
    }, 15_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr });
    });
  });
}

function listen(target) {
  return new Promise((resolve, reject) => {
    const tryListen = (attempt = 0) => {
      target.listen(0, "127.0.0.1", () => {
        const address = target.address();
        if (FETCH_BLOCKED_PORTS.has(address.port)) {
          target.close(() => {
            if (attempt > 20) reject(new Error("Unable to find a fetch-safe local port."));
            else tryListen(attempt + 1);
          });
          return;
        }
        resolve(`http://127.0.0.1:${address.port}`);
      });
    };
    target.on("error", reject);
    tryListen();
  });
}

function close(target) {
  return new Promise((resolve) => target.close(resolve));
}

function readBody(request) {
  return new Promise((resolve) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolve(body));
  });
}

function sendJson(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function tail(value, max = 1600) {
  const text = String(value || "").trim();
  return text.length > max ? text.slice(-max) : text;
}

function getArgValue(name) {
  const exact = argv.find((item) => item.startsWith(`${name}=`));
  if (exact) return exact.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || "" : "";
}
