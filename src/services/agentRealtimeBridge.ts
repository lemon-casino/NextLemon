import { getWorkspaceSnapshot } from "@/services/canvasAgentRuntime";
import {
  createLocalAgentBridgeBrandSpec,
  listLocalAgentBridgeBrandTemplates,
  listLocalAgentBridgeCanvasAgentOps,
  readLocalAgentBridgeSnapshot,
  requestLocalAgentBridgeApproval,
  validateLocalAgentBridgeApprovalRequest,
} from "@/services/localAgentBridge";
import { useAgentStore } from "@/stores/agentStore";
import { useLocalAgentBridgeStore } from "@/stores/localAgentBridgeStore";
import type {
  LocalAgentBridgeApprovalRequest,
  LocalAgentBridgeBrandSpecRequest,
  LocalAgentBridgeBrandTemplateListRequest,
} from "@/types/localAgentBridge";

// 实时桥（第三条增量通道）：页面通过 SSE 连接 scripts/nextlemon-agent-bridge.mjs hub。
// 现有 window 桥（window.nextlemonAgentBridge）与 stdio MCP 保持不变；
// 本模块只做转发与受控执行：写操作一律走 requestLocalAgentBridgeApproval 审批队列，绝不直接执行。

export const REALTIME_BRIDGE_PROTOCOL_VERSION = "0.1.0";
export const REALTIME_BRIDGE_DEFAULT_PORT = 8765;
// 与 scripts/nextlemon-agent-bridge.mjs 的 DEFAULT_BRIDGE_TOKEN 保持一致的零配置开发默认值。
// 注意：hub 未显式提供 --token 时会生成随机 token（仅启动时打印一次），
// 此时需把打印出的 token 填入面板配置；本常量只在 hub 显式使用相同 token 时生效。
export const REALTIME_BRIDGE_DEFAULT_TOKEN = "nextlemon-local-agent-bridge";
// 配置取舍说明：实时桥配置独立于 localAgentBridgeStore（后者无端口/token 字段），
// 存浏览器 localStorage 而非 tauriStorage——它是轻量、可被面板编辑的本地开发配置，
// 不属于工作区/项目数据；如后续需要随应用配置包导出，可并入 getLocalAgentBridgeConfigBundle。
export const REALTIME_BRIDGE_CONFIG_STORAGE_KEY = "nextlemon-agent-realtime-bridge";
export const REALTIME_BRIDGE_SNAPSHOT_INTERVAL_MS = 30_000;
export const REALTIME_BRIDGE_RECONNECT_BASE_MS = 1_000;
export const REALTIME_BRIDGE_RECONNECT_MAX_MS = 30_000;

export type RealtimeBridgeConnectionStatus =
  | "disabled"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

export interface RealtimeBridgeConfig {
  port: number;
  token: string;
  autoConnect: boolean;
}

export interface RealtimeBridgeStatusState {
  status: RealtimeBridgeConnectionStatus;
  attempt: number;
  config: RealtimeBridgeConfig;
  configVersion: number;
  connectedAt?: number;
  lastEventAt?: number;
  lastToolCallAt?: number;
  lastSnapshotAt?: number;
  lastError?: string;
}

export interface RealtimeBridgeToolCallPayload {
  requestId: string;
  tool: string;
  args?: Record<string, unknown>;
  role?: string;
}

export interface RealtimeBridgeToolResultPayload {
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

interface SnapshotSummary {
  workflowNodes: number;
  creativeAssets: number;
  canvasItems: number;
  agentSessions: number;
  activeSessionMessages: number;
}

// ---------- 纯函数（可单测） ----------

export function parseBridgeEventPayload<T = unknown>(raw: unknown): T | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as T) : null;
  } catch {
    return null;
  }
}

export function parseToolCallPayload(raw: unknown): RealtimeBridgeToolCallPayload | null {
  const parsed = parseBridgeEventPayload<RealtimeBridgeToolCallPayload>(raw);
  if (!parsed) return null;
  if (typeof parsed.requestId !== "string" || parsed.requestId.trim() === "") return null;
  if (typeof parsed.tool !== "string" || parsed.tool.trim() === "") return null;
  return {
    requestId: parsed.requestId.trim(),
    tool: parsed.tool.trim(),
    args: parsed.args && typeof parsed.args === "object" && !Array.isArray(parsed.args) ? parsed.args : {},
    role: typeof parsed.role === "string" ? parsed.role : undefined,
  };
}

export function buildToolResultPayload(
  requestId: string,
  outcome: { ok: boolean; result?: unknown; error?: string }
): RealtimeBridgeToolResultPayload {
  return {
    requestId,
    ok: outcome.ok,
    ...(outcome.ok ? { result: outcome.result } : { error: outcome.error || "实时桥工具执行失败" }),
  };
}

export function computeReconnectDelayMs(attempt: number, baseMs = REALTIME_BRIDGE_RECONNECT_BASE_MS, maxMs = REALTIME_BRIDGE_RECONNECT_MAX_MS) {
  const safeAttempt = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;
  return Math.min(maxMs, baseMs * 2 ** Math.min(safeAttempt, 16));
}

export function maskBridgeToken(token: string) {
  if (typeof token !== "string" || token.length === 0) return "未配置";
  if (token.length < 12) return "••••";
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

// token 安全检查：拒绝空白与引号（含反引号），保证启动命令加引号后可被 shell 正确分词，
// 也避免 token 进入 URL 查询参数（EventSource）时被截断。
export function isBridgeTokenSafe(token: string) {
  return typeof token === "string" && token.trim() !== "" && !/\s/.test(token) && !/["'`]/.test(token);
}

function normalizeRealtimeBridgeConfigValue(value: Partial<RealtimeBridgeConfig>): RealtimeBridgeConfig {
  return {
    port: typeof value.port === "number" && Number.isInteger(value.port) && value.port >= 1 && value.port <= 65535
      ? value.port
      : REALTIME_BRIDGE_DEFAULT_PORT,
    token: typeof value.token === "string" && isBridgeTokenSafe(value.token.trim()) ? value.token.trim() : REALTIME_BRIDGE_DEFAULT_TOKEN,
    autoConnect: typeof value.autoConnect === "boolean" ? value.autoConnect : true,
  };
}

export function resolveRealtimeBridgeConfig(
  read: (key: string) => string | null = readRealtimeBridgeConfigFromStorage
): RealtimeBridgeConfig {
  const raw = read(REALTIME_BRIDGE_CONFIG_STORAGE_KEY);
  if (typeof raw !== "string" || raw.trim() === "") {
    return normalizeRealtimeBridgeConfigValue({});
  }
  const parsed = parseBridgeEventPayload<Partial<RealtimeBridgeConfig>>(raw);
  if (!parsed) return normalizeRealtimeBridgeConfigValue({});
  return normalizeRealtimeBridgeConfigValue(parsed);
}

export function buildRealtimeEventsUrl(config: RealtimeBridgeConfig) {
  // EventSource 无法携带自定义头，token 以查询参数传给 hub（hub 侧仅对 GET /events 等价校验）。
  return `http://127.0.0.1:${config.port}/events?role=page&token=${encodeURIComponent(config.token)}`;
}

export function buildBridgeStartCommand(config: RealtimeBridgeConfig) {
  // token 一律加双引号并转义内部引号，避免含空格/引号的 token 被 shell 分词截断。
  return `node ./scripts/nextlemon-agent-bridge.mjs --port ${config.port} --token "${escapeShellToken(config.token)}"`;
}

function escapeShellToken(token: string) {
  return token.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function summarizeRealtimeSnapshot(snapshot: unknown, agentSessions: number, activeSessionMessages: number): SnapshotSummary {
  const record = (snapshot && typeof snapshot === "object" ? snapshot : {}) as Record<string, unknown>;
  const workflow = isRecord(record.workflow) ? record.workflow : {};
  const creative = isRecord(record.creative) ? record.creative : {};
  return {
    workflowNodes: Array.isArray(workflow.nodes) ? workflow.nodes.length : 0,
    creativeAssets: Array.isArray(creative.assets) ? creative.assets.length : 0,
    canvasItems: Array.isArray(creative.items) ? creative.items.length : 0,
    agentSessions,
    activeSessionMessages,
  };
}

// ---------- 受控执行路径 ----------

type RealtimeBridgeToolOutcome = { ok: boolean; result?: unknown; error?: string };

export async function executeBridgeToolCall(payload: RealtimeBridgeToolCallPayload): Promise<RealtimeBridgeToolResultPayload> {
  const bridgeStore = useLocalAgentBridgeStore.getState();
  if (!bridgeStore.enabled) {
    return buildToolResultPayload(payload.requestId, { ok: false, error: "本地 Agent 桥未启用" });
  }

  let outcome: RealtimeBridgeToolOutcome;
  try {
    outcome = await dispatchBridgeTool(payload.tool, payload.args || {});
  } catch (error) {
    outcome = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  if (!outcome.ok) bridgeStore.recordError(outcome.error);
  return buildToolResultPayload(payload.requestId, outcome);
}

// 与 window.nextlemonAgentBridge 完全同源的实现（installLocalAgentBridge 暴露的就是这些函数），
// 因此操作校验与审批队列行为与现有两条通道一致；写操作只会进入审批队列。
async function dispatchBridgeTool(tool: string, args: Record<string, unknown>): Promise<RealtimeBridgeToolOutcome> {
  switch (tool) {
    case "nextlemon.readSnapshot": {
      const snapshot = await readLocalAgentBridgeSnapshot();
      return { ok: true, result: snapshot };
    }
    case "nextlemon.listCanvasAgentOps":
      return { ok: true, result: { operationCatalog: listLocalAgentBridgeCanvasAgentOps() } };
    case "nextlemon.listBrandTemplates":
      return { ok: true, result: listLocalAgentBridgeBrandTemplates(args as unknown as LocalAgentBridgeBrandTemplateListRequest) };
    case "nextlemon.createBrandSpec":
      return { ok: true, result: createLocalAgentBridgeBrandSpec(args as unknown as LocalAgentBridgeBrandSpecRequest) };
    case "nextlemon.validateApprovalRequest":
      return { ok: true, result: validateLocalAgentBridgeApprovalRequest(args as unknown as LocalAgentBridgeApprovalRequest) };
    case "nextlemon.requestApproval": {
      // 写操作：仅提交审批队列，等待用户在应用内批准，不直接执行。
      const result = await requestLocalAgentBridgeApproval(args as unknown as LocalAgentBridgeApprovalRequest);
      return result.ok
        ? { ok: true, result }
        : { ok: false, error: result.errors?.join("；") || "审批请求被拒绝", result };
    }
    default:
      return { ok: false, error: `未知的实时桥工具：${tool}` };
  }
}

// ---------- 连接管理（useSyncExternalStore 状态源） ----------

let statusState: RealtimeBridgeStatusState = {
  status: "disabled",
  attempt: 0,
  config: resolveRealtimeBridgeConfig(),
  configVersion: 0,
};

const statusListeners = new Set<() => void>();
let activeStop: (() => void) | null = null;

function setStatus(patch: Partial<RealtimeBridgeStatusState>) {
  statusState = { ...statusState, ...patch };
  for (const listener of statusListeners) listener();
}

export function subscribeRealtimeBridgeStatus(listener: () => void) {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

export function getRealtimeBridgeStatusSnapshot(): RealtimeBridgeStatusState {
  return statusState;
}

export function readRealtimeBridgeConfigFromStorage(key: string): string | null {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function saveRealtimeBridgeConfig(patch: Partial<RealtimeBridgeConfig>) {
  const current = resolveRealtimeBridgeConfig();
  // 保存时同样走归一化（端口范围/ token 净化），非法输入回退默认值而不是持久化坏配置。
  const next = normalizeRealtimeBridgeConfigValue({ ...current, ...patch });
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      window.localStorage.setItem(REALTIME_BRIDGE_CONFIG_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // 忽略持久化失败（隐私模式等）
    }
  }
  setStatus({ config: next, configVersion: statusState.configVersion + 1 });
  return next;
}

/** 挂载实时桥；返回清理函数。幂等：重复调用会先停掉旧连接。 */
export function startRealtimeBridge(): () => void {
  stopRealtimeBridge();

  if (typeof EventSource === "undefined") {
    setStatus({ status: "error", lastError: "当前环境不支持 EventSource" });
    return () => undefined;
  }

  const config = resolveRealtimeBridgeConfig();
  setStatus({
    config,
    status: config.autoConnect ? "connecting" : "disabled",
    attempt: 0,
    lastError: undefined,
  });
  if (!config.autoConnect) return () => undefined;

  let disposed = false;
  let eventSource: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let snapshotTimer: ReturnType<typeof setInterval> | null = null;
  let attempt = 0;

  const connect = () => {
    if (disposed) return;
    setStatus({ status: attempt === 0 ? "connecting" : "reconnecting", attempt });
    eventSource = new EventSource(buildRealtimeEventsUrl(config));
    // 注意：snapshot 定时器在 connect() 之外创建（见下方），重连只重建 EventSource，
    // 避免每次重连叠加一个新的 interval 导致 /snapshot 重复发布与句柄泄漏。

    eventSource.onopen = () => {
      attempt = 0;
      setStatus({ status: "connected", attempt, connectedAt: Date.now(), lastError: undefined });
    };

    eventSource.addEventListener("tool-call", (event) => {
      setStatus({ lastEventAt: Date.now() });
      void handleToolCallEvent((event as MessageEvent<string>).data);
    });

    eventSource.addEventListener("approval", (_event) => {
      // 外部 Agent 的审批透传事件只记录时间戳；实际写入仍必须走页面受控审批队列。
      setStatus({ lastEventAt: Date.now() });
    });

    eventSource.addEventListener("snapshot", (_event) => {
      setStatus({ lastEventAt: Date.now() });
    });

    eventSource.onerror = () => {
      if (disposed) return;
      eventSource?.close();
      eventSource = null;
      attempt += 1;
      setStatus({
        status: "reconnecting",
        attempt,
        lastError: `连接断开，${Math.round(computeReconnectDelayMs(attempt) / 1000)}s 后重试`,
      });
      reconnectTimer = setTimeout(connect, computeReconnectDelayMs(attempt));
    };
  };

  connect();

  // 定时器只创建一次（不随重连叠加），由 internalStop 统一清理。
  snapshotTimer = setInterval(() => {
    void publishRealtimeSnapshot();
  }, REALTIME_BRIDGE_SNAPSHOT_INTERVAL_MS);

  const internalStop = () => {
    disposed = true;
    eventSource?.close();
    eventSource = null;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (snapshotTimer) clearInterval(snapshotTimer);
    setStatus({ status: "disabled", attempt: 0 });
  };
  activeStop = internalStop;
  // 返回值统一走 stopRealtimeBridge：面板重连等场景重建连接后，
  // 运行时 effect 卸载时停掉的仍然是"当前活跃"的连接，避免停错对象造成连接泄漏。
  return () => stopRealtimeBridge();
}

export function stopRealtimeBridge() {
  if (activeStop) {
    const stop = activeStop;
    activeStop = null;
    stop();
  }
}

/** 面板"重连/应用配置"入口：按当前配置重建连接。 */
export function restartRealtimeBridge() {
  startRealtimeBridge();
}

async function handleToolCallEvent(raw: string) {
  const payload = parseToolCallPayload(raw);
  if (!payload) return;
  const result = await executeBridgeToolCall(payload);
  setStatus({ lastToolCallAt: Date.now() });
  await postBridgeJson("/tool-result", { role: "page", ...result });
  if (payload.tool === "nextlemon.requestApproval" && result.ok) {
    // 审批事件透传给 agent 通道，让外部 Agent 感知写请求已进入审批队列。
    await postBridgeJson("/approval", {
      role: "page",
      event: "approval_requested",
      requestId: payload.requestId,
      result: result.result,
    });
  }
}

export async function publishRealtimeSnapshot() {
  const snapshot = getWorkspaceSnapshot();
  const agentStore = useAgentStore.getState();
  const summary = summarizeRealtimeSnapshot(
    snapshot,
    agentStore.sessions.length,
    agentStore.sessions.find((session) => session.id === agentStore.activeSessionId)?.messages.length || 0
  );
  // 评审约束：/snapshot 广播默认只携带计数摘要，不含完整工作区快照，
  // 降低默认 token 形态下的数据暴露面；完整快照由外部 Agent 通过 nextlemon.readSnapshot 工具按需读取。
  const response = await postBridgeJson("/snapshot", {
    role: "page",
    version: REALTIME_BRIDGE_PROTOCOL_VERSION,
    createdAt: Date.now(),
    summary,
  });
  if (response.ok) setStatus({ lastSnapshotAt: Date.now() });
  return response;
}

export async function postBridgeJson(
  pathname: string,
  body: unknown
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> | null }> {
  const config = resolveRealtimeBridgeConfig();
  try {
    const response = await fetch(`http://127.0.0.1:${config.port}${pathname}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-bridge-token": config.token },
      body: JSON.stringify(body),
    });
    const data = parseBridgeEventPayload<Record<string, unknown>>(await response.text());
    return { ok: response.ok, status: response.status, data };
  } catch (error) {
    setStatus({ lastError: error instanceof Error ? error.message : String(error) });
    return { ok: false, status: 0, data: null };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
