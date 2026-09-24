// Agent 双引擎本地会话适配器（Codex CLI / Claude Code CLI）与面板纯函数助手。
//
// 跨包契约（Rust 包提供；若最终缺失，运行时在调用处抛错并向上冒泡为 error 事件）：
// - invoke("spawn_agent_process", { program: string, args: string[], cwd: string }) → { processId: string }
// - invoke("kill_agent_process", { processId: string }) → void
// - Tauri 事件 "agent-engine-event"，payload { processId: string, data: string }（data 为一行引擎输出）
//
// 解析基于两家 CLI 的官方公开协议格式做最佳实现：
// - Codex：`codex exec --json` 的 stdout JSONL 事件（{"msg":{...}} 旧形态 / {"type":"item.completed","item":{...}} 新形态），
//   同时兼容 `codex app-server` 的 JSON-RPC 通知（{"method":"codex/event/...","params":{...}}）。
// - Claude Code：`claude -p <prompt> --output-format stream-json --verbose` 的 stream-json 行
//   （system/assistant/user/result 四类记录）。
// 解析失败或形态未知时优雅降级为 { kind: "raw" } 原始文本行。

import type {
  AgentProviderConfig,
  AgentSession,
  LocalAgentEngineMode,
} from "@/types/agent";

export type AgentEngineId = "codex" | "claude-code";

export interface AgentEngineMeta {
  id: AgentEngineId;
  label: string;
  defaultExecutable: string;
  description: string;
}

export const AGENT_ENGINES: AgentEngineMeta[] = [
  {
    id: "codex",
    label: "Codex CLI",
    defaultExecutable: "codex",
    description: "OpenAI Codex CLI：codex exec --json，stdout JSONL 事件流。",
  },
  {
    id: "claude-code",
    label: "Claude Code CLI",
    defaultExecutable: "claude",
    description: "Anthropic Claude Code：-p --output-format stream-json。",
  },
];

// 引擎解析出的语义事件；raw 为解析失败/未知形态的原始文本行降级。
export type AgentEngineParsedEvent =
  | { kind: "engine_session"; engineSessionId: string }
  | { kind: "text"; content: string }
  | { kind: "tool_call"; toolName: string; args: Record<string, unknown> }
  | { kind: "tool_result"; toolName: string; ok: boolean; result?: unknown; error?: string }
  | { kind: "error"; message: string }
  | { kind: "done" }
  | { kind: "raw"; content: string };

export interface AgentEngineLaunchOptions {
  prompt: string;
  cwd: string;
  executablePath?: string;
  engineSessionId?: string;
  model?: string;
}

export interface AgentEngineLaunch {
  engine: AgentEngineId;
  program: string;
  args: string[];
  cwd: string;
}

export interface AgentEngineTurnOptions extends AgentEngineLaunchOptions {
  engine: AgentEngineId;
  onEvent: (event: AgentEngineParsedEvent) => void;
}

export interface AgentEngineTurnHandle {
  processId: string;
  stop: () => Promise<void>;
}

export function parseAgentEngineLine(engine: AgentEngineId, line: string): AgentEngineParsedEvent[] {
  return engine === "codex" ? parseCodexEngineLine(line) : parseClaudeEngineLine(line);
}

// 构造引擎启动命令。提示词经 CLI 参数传入（契约中无 stdin 写入通道），
// 引擎会话 id 用于续聊：codex exec resume / claude --resume。
export function buildAgentEngineLaunch(engine: AgentEngineId, options: AgentEngineLaunchOptions): AgentEngineLaunch {
  const prompt = options.prompt.trim();
  if (!prompt) throw new Error("引擎提示词为空");
  const cwd = options.cwd.trim();
  if (!cwd) throw new Error("引擎工作目录未配置");
  const meta = AGENT_ENGINES.find((item) => item.id === engine) || AGENT_ENGINES[0];
  const program = options.executablePath?.trim() || meta.defaultExecutable;
  const engineSessionId = options.engineSessionId?.trim() || "";
  const model = options.model?.trim() || "";

  if (engine === "codex") {
    const args = ["exec", "--json", "--skip-git-repo-check"];
    if (model) args.push("--model", model);
    if (engineSessionId) args.push("resume", engineSessionId);
    args.push(prompt);
    return { engine, program, args, cwd };
  }

  const args = ["-p", prompt, "--output-format", "stream-json", "--verbose"];
  if (model) args.push("--model", model);
  if (engineSessionId) args.push("--resume", engineSessionId);
  return { engine, program, args, cwd };
}

// 线程绑定工作目录：会话 metadata.engineCwd（线程一旦绑定便随会话持久化）优先，
// 其次 Local Provider 配置的默认工作目录，最后回退到用户主目录（Tauri path API）。
export function resolveAgentEngineCwdSync(session: AgentSession, fallbackCwd = ""): string {
  const fromSession = getString(getRecord(session.metadata).engineCwd);
  if (fromSession) return fromSession;
  return fallbackCwd.trim();
}

export async function resolveAgentEngineCwd(session: AgentSession, fallbackCwd = ""): Promise<string> {
  const resolved = resolveAgentEngineCwdSync(session, fallbackCwd);
  if (resolved) return resolved;
  try {
    const { homeDir } = await import("@tauri-apps/api/path");
    return (await homeDir()).trim();
  } catch {
    return "";
  }
}

// 引擎回合的 Tauri IO 依赖（供单测注入桩替身）。
export interface AgentEngineIo {
  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
  listen: (
    event: string,
    handler: (event: { payload?: unknown }) => unknown
  ) => Promise<() => void>;
}

async function loadAgentEngineIo(): Promise<AgentEngineIo> {
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  return {
    invoke: invoke as unknown as AgentEngineIo["invoke"],
    listen: listen as unknown as AgentEngineIo["listen"],
  };
}

// 经跨包契约的 spawn/kill 与事件监听驱动一次引擎回合。
// onEvent 回调按行解析引擎输出；解析到终态事件（done）后自动停止监听并回收子进程。
// 关键顺序：先 await listen 注册监听，再 invoke spawn——Tauri 事件不补发，
// 引擎首行输出（codex thread.started / claude system init，恰是 engineSessionId 所在行）
// 可能在 spawn 的 invoke 返回前到达；processId 未知期间先按行缓冲，spawn 返回后过滤重放。
export async function startAgentEngineTurn(
  options: AgentEngineTurnOptions,
  io?: AgentEngineIo
): Promise<AgentEngineTurnHandle> {
  const launch = buildAgentEngineLaunch(options.engine, options);
  const { invoke, listen } = io ?? (await loadAgentEngineIo());

  let finished = false;
  let processId = "";
  let unlisten: () => void = () => undefined;
  // processId 未知期间到达的行；payload 里带 processId 的（他人进程的输出）在重放时被过滤
  const pendingLines: Array<{ processId: string; data: string }> = [];

  const drain = (line: string) => {
    for (const parsed of parseAgentEngineLine(options.engine, line)) {
      options.onEvent(parsed);
      if (parsed.kind === "done") finished = true;
    }
    if (finished) void stop();
  };

  const stop = async () => {
    finished = true;
    try {
      unlisten();
    } catch {
      // 重复 unlisten 无害
    }
    if (!processId) return;
    try {
      // 契约：kill_agent_process({ processId })；进程可能已自行退出，失败静默。
      await invoke("kill_agent_process", { processId });
    } catch {
      // 进程已退出时忽略
    }
  };

  // 契约：事件 "agent-engine-event"，payload { processId, data }，data 为一行引擎输出
  try {
    unlisten = await listen("agent-engine-event", (event) => {
      if (finished) return;
      const payload = getRecord(event.payload);
      const line = typeof payload.data === "string" ? payload.data : String(payload.data ?? "");
      if (!processId) {
        pendingLines.push({ processId: getString(payload.processId), data: line });
        return;
      }
      if (getString(payload.processId) && getString(payload.processId) !== processId) return;
      drain(line);
    });
  } catch (error) {
    // listen 失败发生在 spawn 之前：无需清理子进程，直接抛错
    throw error;
  }

  // 契约：spawn_agent_process({ program, args, cwd }) → { processId }
  try {
    const spawned = (await invoke("spawn_agent_process", {
      program: launch.program,
      args: launch.args,
      cwd: launch.cwd,
    })) as { processId?: unknown } | null;
    processId = getString(getRecord(spawned).processId);
  } catch (error) {
    // spawn 失败：注销监听后抛错（尚未有子进程可 kill）
    try {
      unlisten();
    } catch {
      // 忽略
    }
    throw error;
  }
  if (!processId) {
    try {
      unlisten();
    } catch {
      // 忽略
    }
    throw new Error("spawn_agent_process 未返回 processId");
  }

  // 重放监听注册与 spawn 返回之间到达的行：只取本进程（或未标注进程）的输出
  const buffered = pendingLines.splice(0, pendingLines.length);
  for (const item of buffered) {
    if (finished) break;
    if (item.processId && item.processId !== processId) continue;
    drain(item.data);
  }

  return { processId, stop };
}

// ---------------------------------------------------------------------------
// Codex stdout JSONL 行解析
// ---------------------------------------------------------------------------

export function parseCodexEngineLine(line: string): AgentEngineParsedEvent[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  const parsed = tryParseJsonLine(trimmed);
  if (!parsed) return [{ kind: "raw", content: trimmed }];
  const record = getRecord(parsed);

  // app-server JSON-RPC 通知：{"method":"codex/event/agent_message","params":{...}}
  const method = getString(record.method);
  const methodType = normalizeCodexEventType(method.includes("/") ? method.slice(method.lastIndexOf("/") + 1) : method);
  const paramsRecord = getRecord(record.params);
  // codex exec --json 旧形态：{"id":"0","msg":{"type":"agent_message",...}}
  const legacyMsg = getRecord(record.msg);
  // 新形态：{"type":"item.completed","item":{"item_type":"agent_message","text":"..."}}
  const phaseType = getString(record.type);
  const itemRecord = getRecord(record.item || legacyMsg.item || paramsRecord.item || paramsRecord);
  const itemType = normalizeCodexEventType(getString(itemRecord.item_type) || getString(itemRecord.type));
  const legacyType = normalizeCodexEventType(getString(legacyMsg.type));

  const sessionId =
    getString(record.thread_id) ||
    getString(record.session_id) ||
    getString(record.threadId) ||
    getString(legacyMsg.session_id) ||
    getString(itemRecord.thread_id) ||
    getString(paramsRecord.session_id) ||
    getString(paramsRecord.threadId);

  if (phaseType) {
    return parseCodexPhaseEvent(trimmed, phaseType.toLowerCase(), itemType, itemRecord, sessionId);
  }
  if (legacyType) {
    return parseCodexLegacyEvent(legacyType, legacyMsg, sessionId);
  }
  if (methodType) {
    return parseCodexLegacyEvent(methodType, getRecord(paramsRecord.msg || paramsRecord), sessionId);
  }
  // JSON-RPC 响应或未知形态：降级为原始文本行
  return [{ kind: "raw", content: trimmed }];
}

function parseCodexPhaseEvent(
  rawLine: string,
  // 原始 phase（小写），如 "thread.started" / "item.completed"；点号在此处有语义
  phase: string,
  itemType: string,
  item: Record<string, unknown>,
  sessionId: string
): AgentEngineParsedEvent[] {
  const normalizedPhase = normalizeCodexEventType(phase);
  if (phase === "thread.started" || normalizedPhase === "session_created" || normalizedPhase === "session_configured") {
    return sessionId ? [{ kind: "engine_session", engineSessionId: sessionId }] : [];
  }
  if (normalizedPhase === "turn_completed" || normalizedPhase === "thread_completed" || normalizedPhase === "task_complete") {
    return [{ kind: "done" }];
  }
  if (normalizedPhase === "error" || normalizedPhase === "stream_error" || normalizedPhase === "turn_failed") {
    return [{ kind: "error", message: getString(item.message) || "Codex 引擎错误" }];
  }
  if (!phase.startsWith("item.")) return [{ kind: "raw", content: rawLine }];
  const itemPhase = phase.slice("item.".length);

  switch (itemType) {
    case "agent_message":
    case "agent_reasoning": {
      const content = getString(item.text) || getString(item.message);
      return content ? [{ kind: "text", content }] : [];
    }
    case "command_execution": {
      if (itemPhase === "started") {
        return [{ kind: "tool_call", toolName: "shell", args: { command: item.command ?? [], cwd: getString(item.cwd) } }];
      }
      if (itemPhase === "completed") {
        const exitCode = getNumber(item.exit_code);
        return [
          {
            kind: "tool_result",
            toolName: "shell",
            ok: exitCode === null || exitCode === 0,
            result: item.aggregated_output ?? item.output,
            error: exitCode !== null && exitCode !== 0 ? `exit code ${exitCode}` : undefined,
          },
        ];
      }
      return [];
    }
    case "mcp_tool_call": {
      const toolName = getString(item.tool) || getString(item.server) || "mcp.tool";
      if (itemPhase === "started") {
        return [{ kind: "tool_call", toolName, args: getRecord(item.arguments) }];
      }
      if (itemPhase === "completed") {
        return [
          {
            kind: "tool_result",
            toolName,
            ok: item.status !== "failed",
            result: item.result ?? item.output,
          },
        ];
      }
      return [];
    }
    case "file_change": {
      if (itemPhase === "started") {
        return [{ kind: "tool_call", toolName: "apply_patch", args: { changes: item.changes ?? [] } }];
      }
      if (itemPhase === "completed") {
        return [{ kind: "tool_result", toolName: "apply_patch", ok: item.status !== "failed", result: item.changes ?? [] }];
      }
      return [];
    }
    case "web_search":
      return [{ kind: "tool_call", toolName: "web_search", args: { query: getString(item.query) } }];
    case "todo_list":
      return [];
    default:
      return itemPhase === "completed" ? [{ kind: "raw", content: rawLine }] : [];
  }
}

function parseCodexLegacyEvent(
  type: string,
  msg: Record<string, unknown>,
  sessionId: string
): AgentEngineParsedEvent[] {
  switch (type) {
    case "session_configured":
    case "session_created":
    case "thread_started":
      return sessionId ? [{ kind: "engine_session", engineSessionId: sessionId }] : [];
    case "task_started":
    case "turn_started":
      return [];
    case "agent_message": {
      const content = getString(msg.message) || getString(msg.text);
      return content ? [{ kind: "text", content }] : [];
    }
    case "agent_reasoning": {
      const content = getString(msg.text) || getString(msg.message);
      return content ? [{ kind: "text", content }] : [];
    }
    case "exec_command_begin":
      return [{ kind: "tool_call", toolName: "shell", args: { command: msg.command ?? [], cwd: getString(msg.cwd) } }];
    case "exec_command_end": {
      const exitCode = getNumber(msg.exit_code);
      return [
        {
          kind: "tool_result",
          toolName: "shell",
          ok: exitCode === null || exitCode === 0,
          result: msg.stdout ?? msg.aggregated_output,
          error: exitCode !== null && exitCode !== 0 ? `exit code ${exitCode}` : undefined,
        },
      ];
    }
    case "mcp_tool_call_begin": {
      const invocation = getRecord(msg.invocation);
      return [
        {
          kind: "tool_call",
          toolName: getString(invocation.tool) || getString(msg.tool) || "mcp.tool",
          args: getRecord(invocation.arguments),
        },
      ];
    }
    case "mcp_tool_call_end": {
      const invocation = getRecord(msg.invocation);
      return [
        {
          kind: "tool_result",
          toolName: getString(invocation.tool) || getString(msg.tool) || "mcp.tool",
          ok: msg.success !== false,
          result: msg.result,
        },
      ];
    }
    case "patch_apply_begin":
      return [{ kind: "tool_call", toolName: "apply_patch", args: { changes: msg.changes ?? msg.unified_diff ?? [] } }];
    case "patch_apply_end":
      return [
        {
          kind: "tool_result",
          toolName: "apply_patch",
          ok: msg.success === true,
          result: msg.stdout,
        },
      ];
    case "task_complete":
    case "turn_completed": {
      const events: AgentEngineParsedEvent[] = [];
      const lastMessage = getString(msg.last_agent_message);
      if (lastMessage) events.push({ kind: "text", content: lastMessage });
      events.push({ kind: "done" });
      return events;
    }
    case "error":
    case "stream_error":
      return [{ kind: "error", message: getString(msg.message) || "Codex 引擎错误" }];
    default:
      // 未知事件类型：优雅降级为原始文本行由上层处理（此处返回空避免噪声）。
      // 注意：完全非 JSON 的行已在 tryParseJsonLine 失败时降级为 raw。
      return [];
  }
}

function normalizeCodexEventType(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[.-]/g, "_");
  if (normalized === "sessionconfigured") return "session_configured";
  return normalized;
}

// ---------------------------------------------------------------------------
// Claude Code stream-json 行解析
// ---------------------------------------------------------------------------

export function parseClaudeEngineLine(line: string): AgentEngineParsedEvent[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  const parsed = tryParseJsonLine(trimmed);
  if (!parsed) return [{ kind: "raw", content: trimmed }];
  const record = getRecord(parsed);
  const type = getString(record.type);
  const sessionId = getString(record.session_id);

  // {"type":"system","subtype":"init","session_id":"..."}
  if (type === "system") {
    return sessionId ? [{ kind: "engine_session", engineSessionId: sessionId }] : [];
  }

  // {"type":"assistant","message":{"content":[...]}} / {"type":"user","message":{"content":[...]}}
  if (type === "assistant" || type === "user") {
    const events: AgentEngineParsedEvent[] = [];
    const blocks = getRecord(record.message).content;
    for (const rawBlock of Array.isArray(blocks) ? blocks : []) {
      const block = getRecord(rawBlock);
      const blockType = getString(block.type);
      if (blockType === "text" && getString(block.text)) {
        events.push({ kind: "text", content: getString(block.text) });
      } else if (blockType === "thinking" && getString(block.thinking)) {
        events.push({ kind: "text", content: getString(block.thinking) });
      } else if (blockType === "tool_use") {
        events.push({ kind: "tool_call", toolName: getString(block.name) || "claude.tool", args: getRecord(block.input) });
      } else if (blockType === "tool_result") {
        events.push({
          kind: "tool_result",
          toolName: getString(block.name) || "claude.tool",
          ok: block.is_error !== true,
          result: block.content,
        });
      }
    }
    return events;
  }

  // {"type":"result","subtype":"success|error_*","result":"..."}
  if (type === "result") {
    const events: AgentEngineParsedEvent[] = [];
    const subtype = getString(record.subtype);
    const resultText = getString(record.result);
    if (subtype === "success") {
      if (resultText) events.push({ kind: "text", content: resultText });
    } else {
      events.push({ kind: "error", message: resultText || `Claude Code 执行失败（${subtype || "unknown"}）` });
    }
    events.push({ kind: "done" });
    return events;
  }

  return [{ kind: "raw", content: trimmed }];
}

// ---------------------------------------------------------------------------
// Local Provider 引擎模式与可执行文件配置（存于 AgentProviderConfig.metadata）
// ---------------------------------------------------------------------------

export function getLocalEngineMode(config: AgentProviderConfig): LocalAgentEngineMode {
  const engine = getString(getRecord(config.metadata).engine);
  if (engine === "codex" || engine === "claude-code" || engine === "model-loop" || engine === "rules") {
    return engine;
  }
  // 向后兼容：未显式选择引擎时沿用 modelToolLoop 开关
  return getRecord(config.metadata).modelToolLoop === true ? "model-loop" : "rules";
}

export function getEngineExecutablePath(config: AgentProviderConfig, engine: AgentEngineId): string {
  const metadata = getRecord(config.metadata);
  return getString(metadata[engine === "codex" ? "codexPath" : "claudeCodePath"]);
}

export function getEngineSessionId(session: AgentSession): string {
  return getString(getRecord(session.metadata).engineSessionId);
}

// ---------------------------------------------------------------------------
// MuAPI Skills 专家工作流纯函数（配合 MuApiClient.listAgentSkills/runSkill 使用）
// ---------------------------------------------------------------------------

export interface AgentSkillSummary {
  name: string;
  title: string;
  description: string;
  requiredInputs: string[];
  allInputs: string[];
  enabled: boolean;
}

// 一句话 brief 可直接填充的输入名
export const SKILL_MESSAGE_INPUT_PATTERN = /^(prompt|message|text|query|brief|input|instruction|task|description|content|request)$/i;

export function normalizeAgentSkills(raw: unknown): AgentSkillSummary[] {
  const record = getRecord(raw);
  const list =
    (Array.isArray(raw) ? raw : undefined) ??
    (Array.isArray(record.skills) ? record.skills : undefined) ??
    (Array.isArray(record.data) ? record.data : undefined) ??
    (Array.isArray(record.items) ? record.items : undefined) ??
    [];

  const skills: AgentSkillSummary[] = [];
  for (const rawSkill of list) {
    const skill = getRecord(rawSkill);
    const name = getString(skill.name) || getString(skill.skill_name) || getString(skill.id);
    if (!name) continue;
    const inputs = parseSkillInputs(skill.inputs ?? skill.parameters ?? skill.input_schema ?? skill.arguments);
    skills.push({
      name,
      title: getString(skill.title) || getString(skill.label) || getString(skill.display_name) || name,
      description: getString(skill.description) || getString(skill.desc),
      requiredInputs: inputs.required,
      allInputs: inputs.all,
      enabled: skill.enabled !== false,
    });
  }
  return skills;
}

function parseSkillInputs(raw: unknown): { required: string[]; all: string[] } {
  if (Array.isArray(raw)) {
    const names: string[] = [];
    const required: string[] = [];
    for (const entry of raw) {
      if (typeof entry === "string") {
        const name = entry.trim();
        if (name) {
          names.push(name);
          required.push(name);
        }
        continue;
      }
      const record = getRecord(entry);
      const name = getString(record.name) || getString(record.key) || getString(record.id);
      if (!name) continue;
      names.push(name);
      if (record.required !== false && record.required !== "false") required.push(name);
    }
    return { required, all: names };
  }

  const record = getRecord(raw);
  if (Object.keys(record).length === 0) return { required: [], all: [] };
  // JSON Schema 形态：{ properties: {...}, required: [...] }
  const declaredRequired = new Set(getStringArray(record.required));
  const all = getStringArray(record.properties ? Object.keys(getRecord(record.properties)) : Object.keys(record));
  // 未显式声明 required 时全部按可选处理，避免把所有输入误报为「缺少必填输入」
  if (declaredRequired.size === 0) return { required: [], all };
  return { required: all.filter((name) => declaredRequired.has(name)), all };
}

export interface AgentSkillInputAssignment {
  skillName: string;
  messageInput?: string;
  inputs: Record<string, unknown>;
  unfilled: string[];
}

// 一句话发起：把用户输入映射到技能的必填输入。
// 命中 prompt/message 等消息型输入名的必填项获得完整用户输入；
// 其余必填项留空并列入 unfilled，由调用方提示用户。
export function mapSkillInputs(skill: AgentSkillSummary, userMessage: string): AgentSkillInputAssignment {
  const required = skill.requiredInputs.filter(Boolean);
  const candidates =
    required.length > 0
      ? required
      : skill.allInputs.filter((name) => SKILL_MESSAGE_INPUT_PATTERN.test(name)).slice(0, 1);
  const messageInput = candidates.find((name) => SKILL_MESSAGE_INPUT_PATTERN.test(name)) || candidates[0];
  const inputs: Record<string, unknown> = {};
  const unfilled: string[] = [];
  for (const name of candidates) {
    if (name === messageInput) {
      inputs[name] = userMessage;
    } else {
      inputs[name] = "";
      unfilled.push(name);
    }
  }
  return { skillName: skill.name, messageInput, inputs, unfilled };
}

// ---------------------------------------------------------------------------
// MuAPI 会话快照回写负载（配合 MuApiClient.updateSession PATCH 使用）
// ---------------------------------------------------------------------------

export function buildMuApiSessionSnapshotPayload(session: AgentSession): Record<string, unknown> {
  return {
    messages_snapshot: session.messages.map((message) => ({
      role: message.role,
      content: message.content,
      timestamp: new Date(message.createdAt).toISOString(),
    })),
  };
}

// ---------------------------------------------------------------------------
// 宽松取值助手
// ---------------------------------------------------------------------------

function tryParseJsonLine(line: string): unknown {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return undefined;
  }
}

function getRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

function getString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(getString).filter(Boolean);
}

function getNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
