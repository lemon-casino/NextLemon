#!/usr/bin/env node
// NextLemon 本地实时桥 hub（第三条增量通道，与 window 桥 / stdio MCP 并存）。
//
// - 纯 Node 内置模块，零第三方依赖。
// - 只绑定 127.0.0.1；所有路由校验 x-bridge-token 头。
//   例外说明：浏览器 EventSource 无法携带自定义头，因此 GET /events 额外接受
//   `token` 查询参数（等价校验），其余 POST 路由只认请求头。
// - CORS 仅允许 localhost 源（非浏览器请求本就没有 Origin，token 仍然必查）。
//
// 路由：
//   GET  /events?role=page|agent   SSE 流（心跳 keep-alive、断线清理）
//   POST /snapshot?role=page       页面 → 转发 agent 通道
//   POST /tool-call?role=agent     外部 Agent → 转发 page 通道（带 requestId，hub 登记挂起）
//   POST /tool-result?role=page    页面按 requestId 回传（hub 匹配挂起的 tool-call）
//   POST /approval?role=*          事件透传到对端通道
//   GET  /health                   状态查看（同样需要 token）
//
// 启动：node ./scripts/nextlemon-agent-bridge.mjs [--port 8765] [--token <token>]
// 环境变量：NEXTLEMON_BRIDGE_PORT / NEXTLEMON_BRIDGE_TOKEN（CLI 参数优先）。
// 安全基线：未提供 --token 时生成随机 token，且仅在启动日志打印一次（可复制进面板配置）。
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";

export const DEFAULT_BRIDGE_PORT = 8765;
export const DEFAULT_BRIDGE_TOKEN = "nextlemon-local-agent-bridge";
export const BRIDGE_PROTOCOL_VERSION = "0.1.0";
export const BRIDGE_HOST = "127.0.0.1";
export const HEARTBEAT_INTERVAL_MS = 15_000;
export const TOOL_CALL_TIMEOUT_MS = 120_000;
export const MAX_BODY_BYTES = 5 * 1024 * 1024;
export const BRIDGE_ROLES = ["page", "agent"];
export const BRIDGE_POST_ROUTES = ["snapshot", "tool-call", "tool-result", "approval"];

// ---------- 纯函数（导出供 src/services/__tests__/agentRealtimeBridge.test.ts 复用） ----------

export function normalizeBridgePort(value, fallback = DEFAULT_BRIDGE_PORT) {
  const port = typeof value === "string" ? Number(value.trim()) : value;
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
    return fallback;
  }
  return port;
}

export function normalizeBridgeToken(value, fallback = DEFAULT_BRIDGE_TOKEN) {
  if (typeof value !== "string") return fallback;
  const token = value.trim();
  return token.length > 0 ? token : fallback;
}

export function parseBridgeCliArgs(argv = [], env = {}) {
  let port;
  let token;
  let help = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index]);
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    let next = null;
    let value;
    if (arg === "--port" || arg === "--token") {
      value = argv[index + 1];
      next = index + 1;
    } else if (arg.startsWith("--port=")) {
      value = arg.slice("--port=".length);
    } else if (arg.startsWith("--token=")) {
      value = arg.slice("--token=".length);
    } else {
      continue;
    }
    if (typeof value === "string" && value.trim() === "" && arg.includes("=")) continue;
    if (arg === "--port" || arg.startsWith("--port=")) {
      port = value;
    } else {
      token = value;
    }
    if (next !== null && typeof value === "string") index = next;
  }

  return {
    help,
    port: normalizeBridgePort(port ?? env.NEXTLEMON_BRIDGE_PORT),
    token: normalizeBridgeToken(token ?? env.NEXTLEMON_BRIDGE_TOKEN),
  };
}

export function resolveBridgeRole(url) {
  const role = (url.searchParams.get("role") || "").trim();
  return BRIDGE_ROLES.includes(role) ? role : null;
}

export function oppositeBridgeRole(role) {
  if (role === "page") return "agent";
  if (role === "agent") return "page";
  return null;
}

// token 校验：优先 x-bridge-token 头；仅当 allowQueryToken=true（服务器只对 GET /events 开启，
// 因为 EventSource 无法携带自定义头）才回退 `token` 查询参数，其余路由只认请求头，
// 避免 token 进入 URL 扩大访问日志/代理记录的泄露面。
export function extractBridgeToken(headers, url, allowQueryToken = false) {
  const headerToken = headers?.get ? headers.get("x-bridge-token") : headers?.["x-bridge-token"];
  if (typeof headerToken === "string" && headerToken.trim() !== "") return headerToken.trim();
  if (!allowQueryToken) return "";
  return url.searchParams.get("token") || "";
}

export function isBridgeRequestAuthorized(headers, url, token, allowQueryToken = false) {
  if (typeof token !== "string" || token.length === 0) return false;
  return extractBridgeToken(headers, url, allowQueryToken) === token;
}

// CORS：仅允许 localhost 源；返回应写入 Access-Control-Allow-Origin 的值（null 表示不写）。
export function resolveCorsOrigin(origin) {
  if (typeof origin !== "string" || origin === "") return null;
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1") {
      return origin;
    }
    return null;
  } catch {
    return null;
  }
}

export function routeBridgePost(pathname) {
  const normalized = (pathname || "").replace(/^\/+|\/+$/g, "");
  return BRIDGE_POST_ROUTES.includes(normalized) ? normalized : null;
}

// 转发方向约束：snapshot/tool-result 必须来自 page，tool-call 必须来自 agent，approval 双向透传。
export function resolveBridgeForwardTarget(route, sourceRole) {
  if (!route || !BRIDGE_ROLES.includes(sourceRole)) return null;
  if (route === "approval") return oppositeBridgeRole(sourceRole);
  const requiredSourceRole = route === "tool-call" ? "agent" : "page";
  if (sourceRole !== requiredSourceRole) return null;
  return oppositeBridgeRole(sourceRole);
}

export function formatSseEvent(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function createBridgeHubState() {
  return {
    startedAt: Date.now(),
    clients: { page: new Set(), agent: new Set() },
    pendingToolCalls: new Map(),
  };
}

export function registerBridgeToolCall(state, requestId, at = Date.now()) {
  if (typeof requestId !== "string" || requestId.trim() === "") {
    return { ok: false, error: "tool-call 缺少 requestId" };
  }
  const normalized = requestId.trim();
  if (state.pendingToolCalls.has(normalized)) {
    return { ok: false, error: `requestId 已挂起：${normalized}` };
  }
  state.pendingToolCalls.set(normalized, { requestedAt: at });
  return { ok: true, requestId: normalized };
}

export function matchBridgeToolResult(state, requestId, at = Date.now()) {
  if (typeof requestId !== "string" || requestId.trim() === "") {
    return { matched: false, reason: "invalid-request-id" };
  }
  const normalized = requestId.trim();
  const pending = state.pendingToolCalls.get(normalized);
  if (!pending) return { matched: false, reason: "unknown-request-id" };
  if (at - pending.requestedAt > TOOL_CALL_TIMEOUT_MS) {
    state.pendingToolCalls.delete(normalized);
    return { matched: false, reason: "expired-request-id" };
  }
  state.pendingToolCalls.delete(normalized);
  return { matched: true, requestId: normalized, elapsedMs: at - pending.requestedAt };
}

export function pruneExpiredToolCalls(state, at = Date.now()) {
  const removed = [];
  for (const [requestId, pending] of state.pendingToolCalls) {
    if (at - pending.requestedAt > TOOL_CALL_TIMEOUT_MS) {
      state.pendingToolCalls.delete(requestId);
      removed.push(requestId);
    }
  }
  return removed;
}

export function summarizeHubState(state, at = Date.now()) {
  return {
    protocol: BRIDGE_PROTOCOL_VERSION,
    uptimeMs: at - state.startedAt,
    pageClients: state.clients.page.size,
    agentClients: state.clients.agent.size,
    pendingToolCalls: state.pendingToolCalls.size,
  };
}

// ---------- 服务器装配 ----------

export function createBridgeServer(options = {}) {
  const { token, port } = options;
  const state = options.state || createBridgeHubState();
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;

  const server = createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      writeJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
    });
  });

  const heartbeat = setInterval(() => {
    broadcast(state, "keep-alive", { at: Date.now() });
    for (const requestId of pruneExpiredToolCalls(state)) {
      broadcast(state, "tool-call-expired", { requestId, at: Date.now() });
    }
  }, heartbeatIntervalMs);
  if (typeof heartbeat.unref === "function") heartbeat.unref();

  async function handleRequest(req, res) {
    const url = new URL(req.url || "/", `http://${BRIDGE_HOST}`);
    const corsOrigin = resolveCorsOrigin(req.headers.origin);

    if (corsOrigin) {
      res.setHeader("Access-Control-Allow-Origin", corsOrigin);
      res.setHeader("Vary", "Origin");
    }
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "GET, POST");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-bridge-token");
      res.setHeader("Access-Control-Max-Age", "600");
      res.writeHead(204);
      res.end();
      return;
    }

    // 仅 GET /events（EventSource 限制）允许 token 查询参数等价校验，其余路由只认请求头。
    const allowQueryToken = req.method === "GET" && url.pathname.replace(/\/+$/, "") === "/events";
    if (!isBridgeRequestAuthorized(req.headers, url, token, allowQueryToken)) {
      writeJson(res, 401, { ok: false, error: "无效的 x-bridge-token" });
      return;
    }

    if (req.method === "GET" && url.pathname === "/events") {
      const role = resolveBridgeRole(url);
      if (!role) {
        writeJson(res, 400, { ok: false, error: "role 必须是 page 或 agent" });
        return;
      }
      openEventStream(state, res, role);
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      writeJson(res, 200, { ok: true, ...summarizeHubState(state) });
      return;
    }

    if (req.method === "POST") {
      const route = routeBridgePost(url.pathname);
      if (!route) {
        writeJson(res, 404, { ok: false, error: `未知路由：${url.pathname}` });
        return;
      }
      const sourceRole = resolveBridgeRole(url);
      const targetRole = resolveBridgeForwardTarget(route, sourceRole);
      if (!targetRole) {
        writeJson(res, 403, {
          ok: false,
          error: `路由 ${route} 的 role 必须是 ${route === "tool-call" ? "agent" : "page"}`,
        });
        return;
      }
      let body;
      try {
        body = await readJsonBody(req);
      } catch (error) {
        const statusCode = error && error.statusCode ? error.statusCode : 400;
        writeJson(res, statusCode, { ok: false, error: error instanceof Error ? error.message : String(error) });
        return;
      }
      handleBridgePost(state, route, sourceRole, targetRole, body, res);
      return;
    }

    writeJson(res, 404, { ok: false, error: `未知路由：${req.method} ${url.pathname}` });
  }

  // 返回 null 表示已经写完响应；否则返回投递结果。
  function handleBridgePost(stateRef, route, sourceRole, targetRole, body, res) {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      writeJson(res, 400, { ok: false, error: "请求体必须是 JSON 对象" });
      return null;
    }

    if (route === "snapshot") {
      // role 展开放在最后：hub 校验后的来源角色不可被请求体覆盖。
      const delivered = broadcast(stateRef, "snapshot", { ...body, role: sourceRole }, targetRole);
      writeJson(res, 200, { ok: true, delivered, target: targetRole });
      return null;
    }

    if (route === "tool-call") {
      const registered = registerBridgeToolCall(stateRef, body.requestId);
      if (!registered.ok) {
        writeJson(res, 409, { ok: false, error: registered.error });
        return null;
      }
      const delivered = broadcast(stateRef, "tool-call", { ...body, role: sourceRole }, targetRole);
      writeJson(res, 200, { ok: true, requestId: registered.requestId, delivered, target: targetRole });
      return null;
    }

    if (route === "tool-result") {
      const matched = matchBridgeToolResult(stateRef, body.requestId);
      if (!matched.matched) {
        writeJson(res, matched.reason === "expired-request-id" ? 410 : 409, {
          ok: false,
          error: matched.reason,
          requestId: body.requestId ?? null,
        });
        return null;
      }
      const delivered = broadcast(stateRef, "tool-result", { ...body, role: sourceRole }, targetRole);
      writeJson(res, 200, { ok: true, requestId: matched.requestId, delivered, elapsedMs: matched.elapsedMs });
      return null;
    }

    // approval：事件透传（同样以 hub 校验后的来源角色为准）
    const delivered = broadcast(stateRef, "approval", { ...body, role: sourceRole }, targetRole);
    writeJson(res, 200, { ok: true, delivered, target: targetRole });
    return null;
  }

  function close() {
    clearInterval(heartbeat);
    for (const client of [...state.clients.page, ...state.clients.agent]) {
      try {
        client.res.end();
      } catch {
        // 忽略关闭时的写错误
      }
    }
    state.clients.page.clear();
    state.clients.agent.clear();
    return new Promise((resolve) => server.close(() => resolve(undefined)));
  }

  return { server, state, close, port };
}

function openEventStream(state, res, role) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const client = { res, role, connectedAt: Date.now() };
  state.clients[role].add(client);
  res.write(`retry: 3000\n\n`);
  res.write(formatSseEvent("ready", { role, ...summarizeHubState(state) }));

  const detach = () => {
    state.clients[role].delete(client);
  };
  res.on("close", detach);
  res.on("error", detach);
}

function broadcast(state, event, data, targetRole) {
  const payload = targetRole ? formatSseEvent(event, data) : `: ${event} keep-alive\n\n`;
  const roles = targetRole ? [targetRole] : BRIDGE_ROLES;
  let delivered = 0;
  for (const role of roles) {
    for (const client of state.clients[role]) {
      if (client.res.destroyed || client.res.writableEnded) {
        state.clients[role].delete(client);
        continue;
      }
      try {
        client.res.write(payload);
        delivered += 1;
      } catch {
        state.clients[role].delete(client);
      }
    }
  }
  return delivered;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        const error = new Error(`请求体超过 ${MAX_BODY_BYTES} 字节上限`);
        error.statusCode = 413;
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (raw === "") {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("请求体不是合法 JSON"));
      }
    });
    req.on("error", reject);
  });
}

function writeJson(res, statusCode, payload) {
  if (res.writableEnded || res.destroyed) return;
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

// ---------- 入口 ----------

// 是否显式提供了 token（CLI --token 或环境变量）。未提供时入口改为生成随机 token，
// 避免源码默认常量成为同机任意进程皆可用的"无鉴权边界"。
export function hasExplicitBridgeToken(argv = [], env = {}) {
  const fromArgs = (argv || []).some((arg) => String(arg) === "--token" || String(arg).startsWith("--token="));
  const envToken = env?.NEXTLEMON_BRIDGE_TOKEN;
  const fromEnv = typeof envToken === "string" && envToken.trim() !== "";
  return fromArgs || fromEnv;
}

export function startBridgeServerFromArgv(argv = [], env = {}) {
  const args = argv.slice(2);
  const { port, token: parsedToken, help } = parseBridgeCliArgs(args, env);
  if (help) {
    printHelp();
    return null;
  }
  const explicitToken = hasExplicitBridgeToken(args, env);
  const token = explicitToken ? parsedToken : randomBytes(24).toString("hex");
  const bridge = createBridgeServer({ token, port });
  bridge.server.on("error", (error) => {
    if (error && error.code === "EADDRINUSE") {
      console.error(`[nextlemon-agent-bridge] 端口 ${port} 已被占用（可能已有 hub 在运行）。可用 --port <port> 换端口后再试。`);
    } else {
      console.error(`[nextlemon-agent-bridge] 服务启动失败: ${error instanceof Error ? error.message : String(error)}`);
    }
    process.exit(1);
  });
  bridge.server.listen(port, BRIDGE_HOST, () => {
    console.log(`[nextlemon-agent-bridge] SSE hub listening at http://${BRIDGE_HOST}:${port}`);
    console.log(`[nextlemon-agent-bridge] token: ${token}${explicitToken ? "" : "（随机生成，仅此一次显示，请复制到面板配置）"}`);
    console.log(`[nextlemon-agent-bridge] 启动命令: node ./scripts/nextlemon-agent-bridge.mjs --port ${port} --token "${token}"`);
  });
  const shutdown = () => {
    void bridge.close().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  return bridge;
}

function printHelp() {
  console.log("用法: node ./scripts/nextlemon-agent-bridge.mjs [--port 8765] [--token <token>]");
  console.log("环境变量: NEXTLEMON_BRIDGE_PORT / NEXTLEMON_BRIDGE_TOKEN（CLI 参数优先）");
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  startBridgeServerFromArgv(process.argv, process.env);
}
