import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildAgentEngineLaunch,
  buildMuApiSessionSnapshotPayload,
  getEngineExecutablePath,
  getEngineSessionId,
  getLocalEngineMode,
  mapSkillInputs,
  normalizeAgentSkills,
  parseAgentEngineLine,
  parseClaudeEngineLine,
  parseCodexEngineLine,
  resolveAgentEngineCwdSync,
  startAgentEngineTurn,
  type AgentEngineIo,
  type AgentSkillSummary,
} from "@/services/agentEngines";
import { stripSessionOnlyProviderApiKeys, useAgentStore } from "@/stores/agentStore";
import type { AgentProviderConfig, AgentSession } from "@/types/agent";

function session(patch: Partial<AgentSession> = {}): AgentSession {
  return {
    id: "session-1",
    title: "测试会话",
    providerKind: "local",
    messages: [],
    status: "idle",
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  };
}

function config(metadata?: Record<string, unknown>): AgentProviderConfig {
  return { kind: "local", enabled: true, name: "Local Provider", metadata };
}

function skill(patch: Partial<AgentSkillSummary> = {}): AgentSkillSummary {
  return {
    name: "poster",
    title: "海报专家",
    description: "",
    requiredInputs: [],
    allInputs: [],
    enabled: true,
    ...patch,
  };
}

describe("parseCodexEngineLine（codex exec --json 旧形态）", () => {
  it("maps agent_message to text", () => {
    expect(parseCodexEngineLine('{"id":"0","msg":{"type":"agent_message","message":"你好"}}')).toEqual([
      { kind: "text", content: "你好" },
    ]);
  });

  it("extracts engine session id from session_configured", () => {
    expect(parseCodexEngineLine('{"msg":{"type":"session_configured","session_id":"sess-42"}}')).toEqual([
      { kind: "engine_session", engineSessionId: "sess-42" },
    ]);
  });

  it("maps exec_command_begin/end to tool_call/tool_result", () => {
    expect(parseCodexEngineLine('{"msg":{"type":"exec_command_begin","command":["ls","-la"],"cwd":"/tmp"}}')).toEqual([
      { kind: "tool_call", toolName: "shell", args: { command: ["ls", "-la"], cwd: "/tmp" } },
    ]);
    expect(parseCodexEngineLine('{"msg":{"type":"exec_command_end","exit_code":1,"stdout":"boom"}}')).toEqual([
      { kind: "tool_result", toolName: "shell", ok: false, result: "boom", error: "exit code 1" },
    ]);
  });

  it("maps task_complete to final text and done", () => {
    expect(parseCodexEngineLine('{"msg":{"type":"task_complete","last_agent_message":"完成了"}}')).toEqual([
      { kind: "text", content: "完成了" },
      { kind: "done" },
    ]);
  });

  it("maps error events", () => {
    expect(parseCodexEngineLine('{"msg":{"type":"error","message":"配额不足"}}')).toEqual([
      { kind: "error", message: "配额不足" },
    ]);
  });

  it("ignores noise events like task_started", () => {
    expect(parseCodexEngineLine('{"msg":{"type":"task_started"}}')).toEqual([]);
  });
});

describe("parseCodexEngineLine（新版 item/thread 事件形态）", () => {
  it("extracts thread id from thread.started", () => {
    expect(parseCodexEngineLine('{"type":"thread.started","thread_id":"thr-1"}')).toEqual([
      { kind: "engine_session", engineSessionId: "thr-1" },
    ]);
  });

  it("maps item.completed agent_message to text", () => {
    expect(
      parseCodexEngineLine('{"type":"item.completed","item":{"item_type":"agent_message","text":"段落"}}')
    ).toEqual([{ kind: "text", content: "段落" }]);
  });

  it("maps command_execution items to shell tool_call/tool_result", () => {
    expect(
      parseCodexEngineLine('{"type":"item.started","item":{"item_type":"command_execution","command":["npm","test"]}}')
    ).toEqual([{ kind: "tool_call", toolName: "shell", args: { command: ["npm", "test"], cwd: "" } }]);
    expect(
      parseCodexEngineLine(
        '{"type":"item.completed","item":{"item_type":"command_execution","command":["npm","test"],"exit_code":0,"aggregated_output":"ok"}}'
      )
    ).toEqual([{ kind: "tool_result", toolName: "shell", ok: true, result: "ok", error: undefined }]);
  });

  it("marks done on turn.completed", () => {
    expect(parseCodexEngineLine('{"type":"turn.completed","usage":{}}')).toEqual([{ kind: "done" }]);
  });

  it("degrades unknown completed items to raw line", () => {
    expect(parseCodexEngineLine('{"type":"item.completed","item":{"item_type":"unknown_thing"}}')).toEqual([
      { kind: "raw", content: '{"type":"item.completed","item":{"item_type":"unknown_thing"}}' },
    ]);
  });
});

describe("parseCodexEngineLine（app-server JSON-RPC 通知形态）", () => {
  it("maps codex/event/agent_message notifications", () => {
    expect(
      parseCodexEngineLine('{"method":"codex/event/agent_message","params":{"msg":{"message":"通知文本"}}}')
    ).toEqual([{ kind: "text", content: "通知文本" }]);
  });

  it("degrades non-JSON lines to raw text", () => {
    expect(parseCodexEngineLine("plain stdout noise")).toEqual([{ kind: "raw", content: "plain stdout noise" }]);
    expect(parseCodexEngineLine("")).toEqual([]);
  });

  it("routes through parseAgentEngineLine by engine id", () => {
    expect(parseAgentEngineLine("codex", '{"msg":{"type":"task_started"}}')).toEqual([]);
    expect(parseAgentEngineLine("claude-code", "not json")).toEqual([{ kind: "raw", content: "not json" }]);
  });
});

describe("parseClaudeEngineLine（--output-format stream-json）", () => {
  it("extracts session id from system init", () => {
    expect(
      parseClaudeEngineLine('{"type":"system","subtype":"init","session_id":"claude-9","cwd":"/tmp"}')
    ).toEqual([{ kind: "engine_session", engineSessionId: "claude-9" }]);
  });

  it("maps assistant text and tool_use blocks", () => {
    expect(
      parseClaudeEngineLine(
        '{"type":"assistant","message":{"content":[{"type":"text","text":"开始"},{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"ls"}}]},"session_id":"claude-9"}'
      )
    ).toEqual([
      { kind: "text", content: "开始" },
      { kind: "tool_call", toolName: "Bash", args: { command: "ls" } },
    ]);
  });

  it("maps user tool_result blocks with is_error", () => {
    expect(
      parseClaudeEngineLine(
        '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"输出","is_error":false}]}}'
      )
    ).toEqual([{ kind: "tool_result", toolName: "claude.tool", ok: true, result: "输出", error: undefined }]);
    expect(
      parseClaudeEngineLine(
        '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"失败","is_error":true}]}}'
      )[0]
    ).toMatchObject({ ok: false });
  });

  it("maps result success to final text and done", () => {
    expect(
      parseClaudeEngineLine('{"type":"result","subtype":"success","result":"全部完成","session_id":"claude-9"}')
    ).toEqual([
      { kind: "text", content: "全部完成" },
      { kind: "done" },
    ]);
  });

  it("maps error results", () => {
    const events = parseClaudeEngineLine('{"type":"result","subtype":"error_during_execution","result":"挂了"}');
    expect(events[0]).toEqual({ kind: "error", message: "挂了" });
    expect(events[1]).toEqual({ kind: "done" });
  });

  it("degrades unknown records to raw", () => {
    expect(parseClaudeEngineLine('{"type":"control_response"}')).toEqual([
      { kind: "raw", content: '{"type":"control_response"}' },
    ]);
  });
});

describe("buildAgentEngineLaunch", () => {
  it("launches codex exec with json output", () => {
    expect(
      buildAgentEngineLaunch("codex", { prompt: "画一张海报", cwd: "/workspace" })
    ).toEqual({
      engine: "codex",
      program: "codex",
      args: ["exec", "--json", "--skip-git-repo-check", "画一张海报"],
      cwd: "/workspace",
    });
  });

  it("resumes codex threads and passes model and executable overrides", () => {
    expect(
      buildAgentEngineLaunch("codex", {
        prompt: "继续",
        cwd: "/workspace",
        executablePath: "C:/tools/codex.exe",
        engineSessionId: "thr-1",
        model: "gpt-5",
      })
    ).toEqual({
      engine: "codex",
      program: "C:/tools/codex.exe",
      args: ["exec", "--json", "--skip-git-repo-check", "--model", "gpt-5", "resume", "thr-1", "继续"],
      cwd: "/workspace",
    });
  });

  it("launches claude code with stream-json output", () => {
    expect(
      buildAgentEngineLaunch("claude-code", { prompt: "画一张海报", cwd: "/workspace" })
    ).toEqual({
      engine: "claude-code",
      program: "claude",
      args: ["-p", "画一张海报", "--output-format", "stream-json", "--verbose"],
      cwd: "/workspace",
    });
  });

  it("resumes claude sessions via --resume", () => {
    expect(
      buildAgentEngineLaunch("claude-code", { prompt: "继续", cwd: "/workspace", engineSessionId: "claude-9" }).args
    ).toContain("--resume");
  });

  it("rejects empty prompt or cwd", () => {
    expect(() => buildAgentEngineLaunch("codex", { prompt: "  ", cwd: "/workspace" })).toThrow();
    expect(() => buildAgentEngineLaunch("codex", { prompt: "hi", cwd: " " })).toThrow();
  });
});

describe("startAgentEngineTurn（注入式 IO 单测）", () => {
  interface FakeIo {
    io: AgentEngineIo;
    order: string[];
    unlisten: ReturnType<typeof vi.fn>;
    handler: ((event: { payload?: unknown }) => void) | null;
  }

  function createFakeIo(): FakeIo {
    const order: string[] = [];
    const unlisten = vi.fn();
    let handler: ((event: { payload?: unknown }) => void) | null = null;
    const invoke = vi.fn(async (command: string, _args?: Record<string, unknown>) => {
      order.push(`invoke:${command}`);
      if (command === "spawn_agent_process") {
        // spawn 的 invoke 返回前引擎已输出首行：应被缓冲并在 processId 就绪后重放
        handler?.({ payload: { processId: "other-proc", data: "来自他人进程的行" } });
        handler?.({ payload: { data: '{"type":"thread.started","thread_id":"thr-9"}' } });
        return { processId: "proc-1" };
      }
      return {};
    });
    const listen = vi.fn(async (_event: string, received: (event: { payload?: unknown }) => void) => {
      order.push("listen");
      handler = received;
      return unlisten;
    });
    return { io: { invoke, listen }, order, unlisten, get handler() { return handler; } };
  }

  it("registers listen before spawn and replays lines buffered during spawn", async () => {
    const fake = createFakeIo();
    const onEvent = vi.fn();
    const handle = await startAgentEngineTurn({ engine: "codex", prompt: "hi", cwd: "/w", onEvent }, fake.io);

    // 关键顺序：先注册监听再 spawn，避免首行（engineSessionId 所在行）在注册前被丢弃
    expect(fake.order).toEqual(["listen", "invoke:spawn_agent_process"]);
    expect(handle.processId).toBe("proc-1");
    expect(onEvent).toHaveBeenCalledWith({ kind: "engine_session", engineSessionId: "thr-9" });
    // 他人进程的行在重放时被过滤
    expect(onEvent).not.toHaveBeenCalledWith({ kind: "raw", content: "来自他人进程的行" });

    // spawn 返回后的行按 processId 过滤；done 触发自动清理（kill + unlisten）
    fake.handler?.({ payload: { processId: "proc-1", data: '{"msg":{"type":"task_complete","last_agent_message":"完成"}}' } });
    fake.handler?.({ payload: { processId: "proc-1", data: "done 之后应被忽略" } });
    expect(onEvent).toHaveBeenCalledWith({ kind: "text", content: "完成" });
    expect(onEvent).toHaveBeenCalledWith({ kind: "done" });
    expect(onEvent).not.toHaveBeenCalledWith({ kind: "raw", content: "done 之后应被忽略" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fake.io.invoke).toHaveBeenCalledWith("kill_agent_process", { processId: "proc-1" });
    expect(fake.unlisten).toHaveBeenCalled();
  });

  it("propagates listen failure without spawning", async () => {
    const invoke = vi.fn(async (command: string) => {
      throw new Error(`不应被调用：${command}`);
    });
    const listen = vi.fn(async () => {
      throw new Error("listen failed");
    });
    await expect(
      startAgentEngineTurn({ engine: "claude-code", prompt: "hi", cwd: "/w", onEvent: vi.fn() }, { invoke, listen })
    ).rejects.toThrow("listen failed");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("unlistens when spawn fails", async () => {
    const unlisten = vi.fn();
    const invoke = vi.fn(async () => {
      throw new Error("spawn failed");
    });
    const listen = vi.fn(async () => unlisten);
    await expect(
      startAgentEngineTurn({ engine: "codex", prompt: "hi", cwd: "/w", onEvent: vi.fn() }, { invoke, listen })
    ).rejects.toThrow("spawn failed");
    expect(unlisten).toHaveBeenCalled();
  });
});

describe("本地引擎配置读取", () => {
  it("defaults to rules and honours legacy modelToolLoop", () => {
    expect(getLocalEngineMode(config())).toBe("rules");
    expect(getLocalEngineMode(config({ modelToolLoop: true }))).toBe("model-loop");
    expect(getLocalEngineMode(config({ engine: "codex" }))).toBe("codex");
  });

  it("reads per-engine executable paths and session engine ids", () => {
    const cfg = config({ codexPath: "C:/bin/codex.exe", claudeCodePath: "C:/bin/claude.cmd" });
    expect(getEngineExecutablePath(cfg, "codex")).toBe("C:/bin/codex.exe");
    expect(getEngineExecutablePath(cfg, "claude-code")).toBe("C:/bin/claude.cmd");
    expect(getEngineSessionId(session({ metadata: { engineSessionId: "thr-1" } }))).toBe("thr-1");
    expect(getEngineSessionId(session())).toBe("");
  });

  it("binds thread cwd to session metadata before fallback", () => {
    expect(resolveAgentEngineCwdSync(session({ metadata: { engineCwd: "/bound" } }), "/fallback")).toBe("/bound");
    expect(resolveAgentEngineCwdSync(session(), "/fallback")).toBe("/fallback");
    expect(resolveAgentEngineCwdSync(session())).toBe("");
  });
});

describe("normalizeAgentSkills", () => {
  it("normalizes skill records with array inputs", () => {
    const skills = normalizeAgentSkills([
      {
        name: "poster",
        title: "海报专家",
        description: "生成海报",
        inputs: [{ name: "brief", required: true }, { name: "brand", required: false }],
      },
      { skill_name: "video", label: "视频专家" },
      { title: "缺少名称，应被过滤" },
    ]);
    expect(skills).toHaveLength(2);
    expect(skills[0]).toMatchObject({
      name: "poster",
      title: "海报专家",
      requiredInputs: ["brief"],
      allInputs: ["brief", "brand"],
    });
    expect(skills[1]).toMatchObject({ name: "video", title: "视频专家", requiredInputs: [] });
  });

  it("unwraps nested skills arrays and reads json-schema inputs", () => {
    const skills = normalizeAgentSkills({
      skills: [
        {
          name: "logo",
          input_schema: { type: "object", properties: { prompt: { type: "string" }, style: { type: "string" } }, required: ["prompt"] },
        },
      ],
    });
    expect(skills).toHaveLength(1);
    expect(skills[0].requiredInputs).toEqual(["prompt"]);
    expect(skills[0].allInputs).toEqual(["prompt", "style"]);
  });

  it("treats all inputs as optional when the schema declares no required list", () => {
    const skills = normalizeAgentSkills({
      skills: [
        {
          name: "crop",
          input_schema: { type: "object", properties: { prompt: { type: "string" }, ratio: { type: "string" } } },
        },
      ],
    });
    expect(skills[0].requiredInputs).toEqual([]);
    expect(skills[0].allInputs).toEqual(["prompt", "ratio"]);
    // 消息型输入兜底命中，不误报「缺少必填输入」
    const assignment = mapSkillInputs(skills[0], "裁成方形");
    expect(assignment.inputs).toEqual({ prompt: "裁成方形" });
    expect(assignment.unfilled).toEqual([]);
  });
});

describe("mapSkillInputs", () => {
  it("fills message-like required input with the user message", () => {
    const assignment = mapSkillInputs(skill({ requiredInputs: ["brief"], allInputs: ["brief"] }), "做一张节日海报");
    expect(assignment.inputs).toEqual({ brief: "做一张节日海报" });
    expect(assignment.unfilled).toEqual([]);
    expect(assignment.messageInput).toBe("brief");
  });

  it("flags non-message required inputs as unfilled", () => {
    const assignment = mapSkillInputs(
      skill({ requiredInputs: ["brief", "brand_ref"], allInputs: ["brief", "brand_ref"] }),
      "做一张海报"
    );
    expect(assignment.inputs).toEqual({ brief: "做一张海报", brand_ref: "" });
    expect(assignment.unfilled).toEqual(["brand_ref"]);
  });

  it("falls back to message-like optional inputs when none required", () => {
    const assignment = mapSkillInputs(
      skill({ requiredInputs: [], allInputs: ["style", "prompt"] }),
      "做一张海报"
    );
    expect(assignment.inputs).toEqual({ prompt: "做一张海报" });
  });
});

describe("buildMuApiSessionSnapshotPayload", () => {
  it("serializes messages as role/content/timestamp snapshot", () => {
    const payload = buildMuApiSessionSnapshotPayload({
      ...session(),
      messages: [
        { id: "m1", role: "user", content: "你好", createdAt: Date.UTC(2026, 0, 2, 3, 4, 5) },
        { id: "m2", role: "assistant", content: "好的", createdAt: Date.UTC(2026, 0, 2, 3, 4, 6) },
      ],
    });
    expect(payload).toEqual({
      messages_snapshot: [
        { role: "user", content: "你好", timestamp: "2026-01-02T03:04:05.000Z" },
        { role: "assistant", content: "好的", timestamp: "2026-01-02T03:04:06.000Z" },
      ],
    });
  });
});

describe("agentStore.createSessionFromBrief（跨包契约导出）", () => {
  beforeEach(() => {
    useAgentStore.setState({ sessions: [], activeSessionId: null });
  });

  it("creates a local session with the brief as first user message and returns its id", () => {
    const sessionId = useAgentStore.getState().createSessionFromBrief("为新品设计一张海报");
    const created = useAgentStore.getState().sessions.find((item) => item.id === sessionId);
    expect(created?.providerKind).toBe("local");
    expect(created?.title).toBe("为新品设计一张海报");
    expect(created?.messages).toHaveLength(1);
    expect(created?.messages[0]).toMatchObject({ role: "user", content: "为新品设计一张海报" });
    expect(useAgentStore.getState().activeSessionId).toBe(sessionId);
  });

  it("truncates long briefs for the title but keeps the full message", () => {
    const brief = "一".repeat(40);
    const sessionId = useAgentStore.getState().createSessionFromBrief(brief);
    const created = useAgentStore.getState().sessions.find((item) => item.id === sessionId);
    expect(created?.title).toHaveLength(25);
    expect(created?.title.endsWith("…")).toBe(true);
    expect(created?.messages[0].content).toBe(brief);
  });

  it("falls back to a default title for blank briefs", () => {
    const sessionId = useAgentStore.getState().createSessionFromBrief("   ");
    const created = useAgentStore.getState().sessions.find((item) => item.id === sessionId);
    expect(created?.title).toBe("新建 Agent 会话");
    expect(created?.messages).toHaveLength(0);
  });
});

describe("stripSessionOnlyProviderApiKeys（仅本会话保存 API Key）", () => {
  it("strips apiKey only for providers marked sessionOnlyApiKey", () => {
    const local = config({ sessionOnlyApiKey: true });
    local.apiKey = "sk-local";
    const muapi: AgentProviderConfig = { kind: "muapi", enabled: true, name: "MuAPI Provider", apiKey: "sk-muapi" };
    const configs = { local, muapi };

    const stripped = stripSessionOnlyProviderApiKeys(configs);
    expect(stripped.local.apiKey).toBeUndefined();
    expect(stripped.muapi.apiKey).toBe("sk-muapi");
    // 内存中的原配置不受影响
    expect(configs.local.apiKey).toBe("sk-local");
  });
});
