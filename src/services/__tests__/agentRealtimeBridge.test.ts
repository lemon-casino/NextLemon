import { describe, expect, it } from "vitest";
import {
  buildBridgeStartCommand,
  buildRealtimeEventsUrl,
  buildToolResultPayload,
  computeReconnectDelayMs,
  isBridgeTokenSafe,
  maskBridgeToken,
  parseBridgeEventPayload,
  parseToolCallPayload,
  REALTIME_BRIDGE_DEFAULT_PORT,
  REALTIME_BRIDGE_DEFAULT_TOKEN,
  resolveRealtimeBridgeConfig,
  summarizeRealtimeSnapshot,
} from "@/services/agentRealtimeBridge";

// tsconfig 未开启 allowJs，TS 无法静态解析 scripts/*.mjs；因此用非字面量动态 import 在运行时加载
// hub 模块（同一文件也被 releaseStatus.test.js 以静态 import 方式复用），并用本地接口描述其纯函数契约。
const hubSpecifier = "../../../scripts/nextlemon-agent-bridge.mjs";

interface BridgeHubState {
  startedAt: number;
  clients: { page: Set<unknown>; agent: Set<unknown> };
  pendingToolCalls: Map<string, { requestedAt: number }>;
}

interface BridgeHubModule {
  BRIDGE_PROTOCOL_VERSION: string;
  DEFAULT_BRIDGE_PORT: number;
  DEFAULT_BRIDGE_TOKEN: string;
  TOOL_CALL_TIMEOUT_MS: number;
  createBridgeHubState: () => BridgeHubState;
  formatSseEvent: (event: string, data: unknown) => string;
  hasExplicitBridgeToken: (argv: string[], env: Record<string, string | undefined>) => boolean;
  matchBridgeToolResult: (
    state: BridgeHubState,
    requestId: unknown,
    at?: number
  ) => { matched: boolean; reason?: string; requestId?: string; elapsedMs?: number };
  normalizeBridgePort: (value: unknown, fallback?: number) => number;
  parseBridgeCliArgs: (
    argv: string[],
    env: Record<string, string | undefined>
  ) => { help: boolean; port: number; token: string };
  pruneExpiredToolCalls: (state: BridgeHubState, at?: number) => string[];
  registerBridgeToolCall: (
    state: BridgeHubState,
    requestId: unknown,
    at?: number
  ) => { ok: boolean; requestId?: string; error?: string };
  resolveBridgeForwardTarget: (route: string | null, sourceRole: string | null) => string | null;
  resolveBridgeRole: (url: URL) => string | null;
  resolveCorsOrigin: (origin: unknown) => string | null;
  routeBridgePost: (pathname: string) => string | null;
  isBridgeRequestAuthorized: (
    headers: Record<string, unknown> | { get: (name: string) => string | null },
    url: URL,
    token: string,
    allowQueryToken?: boolean
  ) => boolean;
}

const hub = (await import(hubSpecifier)) as BridgeHubModule;
const {
  BRIDGE_PROTOCOL_VERSION,
  DEFAULT_BRIDGE_PORT,
  DEFAULT_BRIDGE_TOKEN,
  TOOL_CALL_TIMEOUT_MS,
  createBridgeHubState,
  formatSseEvent,
  hasExplicitBridgeToken,
  isBridgeRequestAuthorized,
  matchBridgeToolResult,
  normalizeBridgePort,
  parseBridgeCliArgs,
  pruneExpiredToolCalls,
  registerBridgeToolCall,
  resolveBridgeForwardTarget,
  resolveBridgeRole,
  resolveCorsOrigin,
  routeBridgePost,
} = hub;

function url(pathWithQuery: string) {
  return new URL(pathWithQuery, "http://127.0.0.1:8765");
}

const headersLike = (values: Record<string, string>) => ({
  get: (name: string) => values[name.toLowerCase()] ?? null,
});

describe("nextlemon-agent-bridge hub 配置与鉴权", () => {
  it("解析 CLI 参数：默认值、独立参数、等号参数、环境变量回退与优先级", () => {
    expect(parseBridgeCliArgs([], {})).toEqual({ help: false, port: DEFAULT_BRIDGE_PORT, token: DEFAULT_BRIDGE_TOKEN });
    expect(parseBridgeCliArgs(["--port", "9000", "--token", "abc"], {})).toEqual({ help: false, port: 9000, token: "abc" });
    expect(parseBridgeCliArgs(["--port=9100", "--token=tok-1"], {})).toEqual({ help: false, port: 9100, token: "tok-1" });
    expect(parseBridgeCliArgs([], { NEXTLEMON_BRIDGE_PORT: "9200", NEXTLEMON_BRIDGE_TOKEN: "env-tok" })).toEqual({
      help: false,
      port: 9200,
      token: "env-tok",
    });
    expect(parseBridgeCliArgs(["--port", "9300"], { NEXTLEMON_BRIDGE_PORT: "9400" }).port).toBe(9300);
    expect(parseBridgeCliArgs(["--help"], {}).help).toBe(true);
  });

  it("端口归一化拒绝非法输入", () => {
    expect(normalizeBridgePort("abc")).toBe(DEFAULT_BRIDGE_PORT);
    expect(normalizeBridgePort(0)).toBe(DEFAULT_BRIDGE_PORT);
    expect(normalizeBridgePort(70000)).toBe(DEFAULT_BRIDGE_PORT);
    expect(normalizeBridgePort("5432")).toBe(5432);
    expect(normalizeBridgePort(1)).toBe(1);
    expect(normalizeBridgePort(65535)).toBe(65535);
  });

  it("校验 x-bridge-token 头；query token 仅在显式允许（GET /events）时等价接受", () => {
    // 请求头在任何路由都有效
    expect(isBridgeRequestAuthorized(headersLike({ "x-bridge-token": "secret-1" }), url("/events?role=page"), "secret-1")).toBe(true);
    expect(isBridgeRequestAuthorized(headersLike({ "x-bridge-token": "secret-1" }), url("/snapshot?role=page"), "secret-1")).toBe(true);
    // query token 仅在 allowQueryToken=true 时有效；纯函数不判路径，
    // 服务器侧只对 GET /events 传入该标记（POST /snapshot?token=... 的 401 由冒烟验证）
    expect(isBridgeRequestAuthorized(headersLike({}), url("/events?role=page&token=secret-1"), "secret-1", true)).toBe(true);
    // 默认拒绝 query token：未开启标记的任何路由都必须失败
    expect(isBridgeRequestAuthorized(headersLike({}), url("/events?role=page&token=secret-1"), "secret-1")).toBe(false);
    expect(isBridgeRequestAuthorized(headersLike({}), url("/snapshot?role=page&token=secret-1"), "secret-1")).toBe(false);
    expect(isBridgeRequestAuthorized(headersLike({ "x-bridge-token": "nope" }), url("/events"), "secret-1")).toBe(false);
    expect(isBridgeRequestAuthorized(headersLike({}), url("/events?token=nope"), "secret-1", true)).toBe(false);
    expect(isBridgeRequestAuthorized(headersLike({}), url("/events"), "secret-1")).toBe(false);
  });

  it("识别是否显式提供 token（CLI --token 或环境变量），决定入口是否生成随机 token", () => {
    expect(hasExplicitBridgeToken(["--port", "9000"], {})).toBe(false);
    expect(hasExplicitBridgeToken(["--token", "abc"], {})).toBe(true);
    expect(hasExplicitBridgeToken(["--token=abc"], {})).toBe(true);
    expect(hasExplicitBridgeToken([], { NEXTLEMON_BRIDGE_TOKEN: "env-tok" })).toBe(true);
    expect(hasExplicitBridgeToken([], { NEXTLEMON_BRIDGE_TOKEN: "   " })).toBe(false);
    expect(hasExplicitBridgeToken([], {})).toBe(false);
  });

  it("CORS 只放行 localhost 源", () => {
    expect(resolveCorsOrigin("http://localhost:1420")).toBe("http://localhost:1420");
    expect(resolveCorsOrigin("http://127.0.0.1:1420")).toBe("http://127.0.0.1:1420");
    expect(resolveCorsOrigin("http://evil.example")).toBeNull();
    expect(resolveCorsOrigin("")).toBeNull();
    expect(resolveCorsOrigin("not-a-url")).toBeNull();
  });

  it("识别 SSE 角色并按角色约束 POST 转发方向", () => {
    expect(resolveBridgeRole(url("/events?role=page"))).toBe("page");
    expect(resolveBridgeRole(url("/events?role=agent"))).toBe("agent");
    expect(resolveBridgeRole(url("/events?role=intruder"))).toBeNull();

    expect(routeBridgePost("/snapshot")).toBe("snapshot");
    expect(routeBridgePost("/tool-call/")).toBe("tool-call");
    expect(routeBridgePost("/nope")).toBeNull();

    expect(resolveBridgeForwardTarget("snapshot", "page")).toBe("agent");
    expect(resolveBridgeForwardTarget("snapshot", "agent")).toBeNull();
    expect(resolveBridgeForwardTarget("tool-call", "agent")).toBe("page");
    expect(resolveBridgeForwardTarget("tool-call", "page")).toBeNull();
    expect(resolveBridgeForwardTarget("tool-result", "page")).toBe("agent");
    expect(resolveBridgeForwardTarget("approval", "page")).toBe("agent");
    expect(resolveBridgeForwardTarget("approval", "agent")).toBe("page");
    expect(resolveBridgeForwardTarget("approval", null)).toBeNull();
  });
});

describe("nextlemon-agent-bridge hub tool-call/result 配对", () => {
  it("登记挂起的 tool-call 并拒绝重复 requestId", () => {
    const state = createBridgeHubState();
    expect(registerBridgeToolCall(state, "req-1", 1000)).toEqual({ ok: true, requestId: "req-1" });
    expect(registerBridgeToolCall(state, "req-1", 1001).ok).toBe(false);
    expect(registerBridgeToolCall(state, "  ", 1002).ok).toBe(false);
    expect(state.pendingToolCalls.get("req-1")).toEqual({ requestedAt: 1000 });
  });

  it("按 requestId 匹配回传并移除挂起记录", () => {
    const state = createBridgeHubState();
    registerBridgeToolCall(state, "req-1", 1000);
    expect(matchBridgeToolResult(state, "req-1", 2000)).toEqual({ matched: true, requestId: "req-1", elapsedMs: 1000 });
    expect(state.pendingToolCalls.has("req-1")).toBe(false);
    expect(matchBridgeToolResult(state, "req-1", 3000)).toEqual({ matched: false, reason: "unknown-request-id" });
    expect(matchBridgeToolResult(state, "other", 3000).matched).toBe(false);
  });

  it("超时的挂起 tool-call 不再匹配并被清理", () => {
    const state = createBridgeHubState();
    registerBridgeToolCall(state, "req-1", 1000);
    registerBridgeToolCall(state, "req-2", 2000);
    expect(matchBridgeToolResult(state, "req-1", 1000 + TOOL_CALL_TIMEOUT_MS + 1)).toEqual({
      matched: false,
      reason: "expired-request-id",
    });
    expect(pruneExpiredToolCalls(state, 2000 + TOOL_CALL_TIMEOUT_MS + 1)).toEqual(["req-2"]);
    expect(state.pendingToolCalls.size).toBe(0);
  });
});

describe("nextlemon-agent-bridge hub SSE 帧", () => {
  it("格式化 event/data 帧并保留协议版本", () => {
    expect(formatSseEvent("tool-call", { requestId: "req-1" })).toBe(
      `event: tool-call\ndata: {"requestId":"req-1"}\n\n`
    );
    expect(BRIDGE_PROTOCOL_VERSION).toBe("0.1.0");
  });
});

describe("agentRealtimeBridge 页面侧消息解析", () => {
  it("解析 tool-call 事件并校验必填字段", () => {
    expect(parseToolCallPayload(JSON.stringify({ requestId: "req-1", tool: "nextlemon.readSnapshot" }))).toEqual({
      requestId: "req-1",
      tool: "nextlemon.readSnapshot",
      args: {},
      role: undefined,
    });
    expect(
      parseToolCallPayload(
        JSON.stringify({ requestId: " req-2 ", tool: " nextlemon.requestApproval ", args: { ops: [] }, role: "agent" })
      )
    ).toEqual({
      requestId: "req-2",
      tool: "nextlemon.requestApproval",
      args: { ops: [] },
      role: "agent",
    });
    expect(parseToolCallPayload(JSON.stringify({ tool: "nextlemon.readSnapshot" }))).toBeNull();
    expect(parseToolCallPayload(JSON.stringify({ requestId: "req-1" }))).toBeNull();
    expect(parseToolCallPayload("not-json")).toBeNull();
    expect(parseToolCallPayload("")).toBeNull();
    expect(parseToolCallPayload(JSON.stringify([1, 2]))).toBeNull();
    expect(parseToolCallPayload(JSON.stringify({ requestId: "req-1", tool: "t", args: "bad" }))?.args).toEqual({});
  });

  it("解析普通桥事件负载", () => {
    expect(parseBridgeEventPayload<Record<string, unknown>>(JSON.stringify({ ok: true }))).toEqual({ ok: true });
    expect(parseBridgeEventPayload("")).toBeNull();
    expect(parseBridgeEventPayload("123")).toBeNull();
  });

  it("构造 tool-result 负载：成功带结果，失败带错误信息", () => {
    expect(buildToolResultPayload("req-1", { ok: true, result: { ok: true } })).toEqual({
      requestId: "req-1",
      ok: true,
      result: { ok: true },
    });
    expect(buildToolResultPayload("req-2", { ok: false })).toEqual({
      requestId: "req-2",
      ok: false,
      error: "实时桥工具执行失败",
    });
    expect(buildToolResultPayload("req-3", { ok: false, error: "本地 Agent 桥未启用" })).toEqual({
      requestId: "req-3",
      ok: false,
      error: "本地 Agent 桥未启用",
    });
  });
});

describe("agentRealtimeBridge 重连与配置", () => {
  it("指数退避重连间隔，封顶 30s", () => {
    expect(computeReconnectDelayMs(0)).toBe(1000);
    expect(computeReconnectDelayMs(1)).toBe(2000);
    expect(computeReconnectDelayMs(2)).toBe(4000);
    expect(computeReconnectDelayMs(4)).toBe(16000);
    expect(computeReconnectDelayMs(5)).toBe(30000);
    expect(computeReconnectDelayMs(50)).toBe(30000);
    expect(computeReconnectDelayMs(Number.NaN)).toBe(1000);
  });

  it("掩码显示 token", () => {
    expect(maskBridgeToken("nextlemon-local-agent-bridge")).toBe("next…idge");
    expect(maskBridgeToken("short")).toBe("••••");
    expect(maskBridgeToken("")).toBe("未配置");
  });

  it("token 净化：拒绝空白与引号，避免 shell 分词与 URL 截断", () => {
    expect(isBridgeTokenSafe("plain-token_1")).toBe(true);
    expect(isBridgeTokenSafe("a1b2c3d4e5f6")).toBe(true);
    expect(isBridgeTokenSafe("has space")).toBe(false);
    expect(isBridgeTokenSafe('double"quote')).toBe(false);
    expect(isBridgeTokenSafe("single'quote")).toBe(false);
    expect(isBridgeTokenSafe("back`tick")).toBe(false);
    expect(isBridgeTokenSafe("")).toBe(false);
    expect(isBridgeTokenSafe("   ")).toBe(false);
  });

  it("从存储解析实时桥配置并与默认值合并", () => {
    const defaults = resolveRealtimeBridgeConfig(() => null);
    expect(defaults).toEqual({ port: REALTIME_BRIDGE_DEFAULT_PORT, token: REALTIME_BRIDGE_DEFAULT_TOKEN, autoConnect: true });

    expect(resolveRealtimeBridgeConfig(() => "not-json")).toEqual(defaults);

    const stored = resolveRealtimeBridgeConfig(() =>
      JSON.stringify({ port: 9000, token: "custom-token", autoConnect: false })
    );
    expect(stored).toEqual({ port: 9000, token: "custom-token", autoConnect: false });

    const partial = resolveRealtimeBridgeConfig(() => JSON.stringify({ port: 70000, token: "  " }));
    expect(partial).toEqual({ port: REALTIME_BRIDGE_DEFAULT_PORT, token: REALTIME_BRIDGE_DEFAULT_TOKEN, autoConnect: true });
  });

  it("含空白或引号的 token 回退默认 token（配置归一化）", () => {
    const unsafeSpace = resolveRealtimeBridgeConfig(() => JSON.stringify({ port: 9000, token: "secret token" }));
    expect(unsafeSpace.token).toBe(REALTIME_BRIDGE_DEFAULT_TOKEN);
    expect(unsafeSpace.port).toBe(9000);

    const unsafeQuote = resolveRealtimeBridgeConfig(() => JSON.stringify({ token: 'say"hi' }));
    expect(unsafeQuote.token).toBe(REALTIME_BRIDGE_DEFAULT_TOKEN);
  });

  it("生成 SSE 连接地址与 hub 启动命令（token 恒加双引号并转义内部引号）", () => {
    const config = { port: 9000, token: "secret token", autoConnect: true };
    expect(buildRealtimeEventsUrl(config)).toBe("http://127.0.0.1:9000/events?role=page&token=secret%20token");
    expect(buildBridgeStartCommand(config)).toBe(
      'node ./scripts/nextlemon-agent-bridge.mjs --port 9000 --token "secret token"'
    );
    expect(buildBridgeStartCommand({ port: 8765, token: "abc", autoConnect: true })).toBe(
      'node ./scripts/nextlemon-agent-bridge.mjs --port 8765 --token "abc"'
    );
    expect(buildBridgeStartCommand({ port: 8765, token: 'a"b', autoConnect: true })).toBe(
      'node ./scripts/nextlemon-agent-bridge.mjs --port 8765 --token "a\\"b"'
    );
  });
});

describe("agentRealtimeBridge 快照摘要", () => {
  it("统计工作流/素材/画布与会话规模，容错非对象输入", () => {
    expect(
      summarizeRealtimeSnapshot(
        {
          workflow: { nodes: [{ id: "n1" }, { id: "n2" }] },
          creative: { assets: [{ id: "a1" }], items: [{ id: "c1" }, { id: "c2" }, { id: "c3" }] },
        },
        4,
        7
      )
    ).toEqual({ workflowNodes: 2, creativeAssets: 1, canvasItems: 3, agentSessions: 4, activeSessionMessages: 7 });
    expect(summarizeRealtimeSnapshot(null, 0, 0)).toEqual({
      workflowNodes: 0,
      creativeAssets: 0,
      canvasItems: 0,
      agentSessions: 0,
      activeSessionMessages: 0,
    });
  });
});
