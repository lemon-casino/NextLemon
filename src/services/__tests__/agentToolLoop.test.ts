import { beforeEach, describe, expect, it } from "vitest";
import {
  AGENT_SYSTEM_PROMPT,
  answerAgentAskUser,
  callAgentChat,
  clearToolLoop,
  getAgentChatTools,
  getPendingAskUser,
  hasActiveToolLoop,
  parseAgentChatCompletion,
  resolveAgentModelConfig,
  resumeAgentToolLoopAfterApproval,
  runAgentToolLoop,
  type AgentModelConfig,
} from "@/services/agentToolLoop";
import { useAgentStore } from "@/stores/agentStore";
import type { AgentProviderConfig } from "@/types/agent";

const config: AgentModelConfig = {
  baseUrl: "https://llm.example.com",
  apiKey: "test-key",
  model: "test-model",
};

function chatResponse(message: Record<string, unknown>) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message }] }),
    text: async () => "",
  } as unknown as Response;
}

function fetchMock(responses: Array<Record<string, unknown>>, calls: unknown[] = []) {
  const impl = (async (_url: unknown, init?: RequestInit) => {
    calls.push(init?.body ? JSON.parse(String(init.body)) : null);
    const next = responses.shift();
    if (!next) throw new Error("没有更多 mock 响应");
    return chatResponse((next as { message?: Record<string, unknown> }).message || {});
  }) as unknown as typeof fetch;
  return impl;
}

const noopExecutor = async () => ({ ok: true as const });

describe("agentToolLoop", () => {
  beforeEach(() => {
    clearToolLoop("session-loop");
  });

  it("exposes one JSON schema per controlled tool", () => {
    const tools = getAgentChatTools();
    expect(tools).toHaveLength(9);
    expect(tools.some((tool) => tool.function.name === "ask_user")).toBe(true);
    for (const tool of tools) {
      expect(tool.type).toBe("function");
      expect(tool.function.name).toBeTruthy();
      expect(tool.function.description).toContain("。");
      expect(tool.function.parameters.type).toBe("object");
    }
    const create = tools.find((tool) => tool.function.name === "asset.create");
    expect((create!.function.parameters as Record<string, unknown>).required).toEqual(["kind"]);
  });

  it("resolves model config only when the loop toggle is on", () => {
    expect(resolveAgentModelConfig({ ...config, metadata: {} } as AgentProviderConfig)).toBeNull();
    const resolved = resolveAgentModelConfig({
      kind: "local",
      enabled: true,
      name: "Local Provider",
      metadata: { modelToolLoop: true },
    } as AgentProviderConfig);
    expect(resolved).not.toBeNull();
    expect(resolved!.model).toBe("gpt-4o-mini");
  });

  it("parses tool calls and plain text from a chat completion", () => {
    const parsed = parseAgentChatCompletion({
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: "call-1",
                function: { name: "workspace.readSnapshot", arguments: "{}" },
              },
              { function: { name: "", arguments: "{}" } },
            ],
          },
        },
      ],
    });
    expect(parsed.content).toBe("");
    expect(parsed.toolCalls).toHaveLength(1);
    expect(parsed.toolCalls[0].name).toBe("workspace.readSnapshot");

    const textOnly = parseAgentChatCompletion({ choices: [{ message: { content: "你好" } }] });
    expect(textOnly.content).toBe("你好");
    expect(textOnly.toolCalls).toHaveLength(0);
  });

  it("runs required-then-auto rounds and feeds tool results back", async () => {
    const bodies: unknown[] = [];
    const fetchImpl = fetchMock(
      [
        {
          message: {
            content: "",
            tool_calls: [
              { id: "call-1", function: { name: "workspace.readSnapshot", arguments: "{}" } },
            ],
          },
        },
        { message: { content: "快照已读取，画布为空。" } },
      ],
      bodies
    );

    const executedTools: string[] = [];
    const result = await runAgentToolLoop("session-loop", "看看画布上有什么", config, {
      fetchImpl,
      executeTool: async (_sessionId, toolName) => {
        executedTools.push(toolName);
        return { ok: true, result: { items: [] } };
      },
    });

    expect(result.ok).toBe(true);
    expect(result.rounds).toBe(2);
    expect(result.toolCallCount).toBe(1);
    expect(result.content).toContain("快照已读取");
    expect(executedTools).toEqual(["workspace.readSnapshot"]);

    expect((bodies[0] as { tool_choice: string }).tool_choice).toBe("required");
    expect((bodies[1] as { tool_choice: string }).tool_choice).toBe("auto");

    const messages = (bodies[1] as { messages: Array<{ role: string; content: string; tool_call_id?: string }> }).messages;
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toBe(AGENT_SYSTEM_PROMPT);
    const toolMessage = messages.find((message) => message.role === "tool");
    expect(toolMessage?.tool_call_id).toBe("call-1");
    expect(toolMessage?.content).toContain('"ok":true');
    expect(hasActiveToolLoop("session-loop")).toBe(true);
  });

  it("records executor failures and reports them in the loop result", async () => {
    const result = await runAgentToolLoop("session-loop-err", "创建素材", config, {
      fetchImpl: fetchMock([
        {
          message: {
            tool_calls: [{ id: "call-9", function: { name: "asset.create", arguments: '{"kind":"image"}' } }],
          },
        },
        { message: { content: "收到，素材缺少数据。" } },
      ]),
      executeTool: async () => ({ ok: false, error: "媒体素材缺少 dataUrl 或 storagePath" }),
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("dataUrl");
  });

  it("flags awaitingApproval when the executor queues write ops", async () => {
    const result = await runAgentToolLoop("session-loop-approve", "建一个素材", config, {
      fetchImpl: fetchMock([
        {
          message: {
            tool_calls: [{ id: "call-2", function: { name: "asset.create", arguments: '{"kind":"text","text":"hi"}' } }],
          },
        },
        { message: { content: "已提交审批。" } },
      ]),
      executeTool: async () => ({ ok: true, pendingApproval: true, result: [] }),
    });

    expect(result.awaitingApproval).toBe(true);
    expect(result.ok).toBe(true);
  });

  it("surfaces HTTP failures as loop errors", async () => {
    const failing = (async () =>
      ({
        ok: false,
        status: 500,
        json: async () => ({}),
        text: async () => "boom",
      }) as unknown as Response) as unknown as typeof fetch;

    const result = await runAgentToolLoop("session-loop-http", "你好", config, {
      fetchImpl: failing,
      executeTool: noopExecutor,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("500");
  });

  it("resumes after approval, continuing the same conversation", async () => {
    const calls: unknown[] = [];
    const fetchImpl = fetchMock([{ message: { content: "写操作已执行完成，任务结束。" } }], calls);

    // 先制造一个进行中的循环
    await runAgentToolLoop("session-loop-resume", "帮我建素材", config, {
      fetchImpl: fetchMock([
        {
          message: {
            tool_calls: [{ id: "call-3", function: { name: "asset.create", arguments: '{"kind":"text","text":"x"}' } }],
          },
        },
      ]),
      executeTool: async () => ({ ok: true, pendingApproval: true, result: [] }),
    });
    expect(hasActiveToolLoop("session-loop-resume")).toBe(true);

    const resumed = await resumeAgentToolLoopAfterApproval(
      "session-loop-resume",
      config,
      { summary: "新增素材 1" },
      { fetchImpl }
    );

    expect(resumed.ok).toBe(true);
    expect(resumed.content).toContain("任务结束");
    const lastBody = calls[calls.length - 1] as {
      tool_choice: string;
      messages: Array<{ role: string; content: string }>;
    };
    const userMessages = lastBody.messages.filter((message) => message.role === "user");
    expect(userMessages[userMessages.length - 1].content).toContain("用户已批准");
    expect(lastBody.tool_choice).toBe("auto");
  });

  it("sends chat requests to the OpenAI-compatible endpoint with auth", async () => {
    const bodies: unknown[] = [];
    const fetchImpl = fetchMock([{ message: { content: "ok" } }], bodies);
    await callAgentChat(config, [{ role: "user", content: "hi" }], {
      toolChoice: "auto",
      fetchImpl,
    });
    const body = bodies[0] as { model: string; tool_choice: string; tools: unknown[] };
    expect(body.model).toBe("test-model");
    expect(body.tool_choice).toBe("auto");
    expect(Array.isArray(body.tools)).toBe(true);
  });
  it("pauses on ask_user and resumes with the user's answer as tool result", async () => {
    const sessionIdAsk = useAgentStore.getState().createSession("ask 测试", "local");
    clearToolLoop(sessionIdAsk);

    const calls: unknown[] = [];
    const fetchImpl = fetchMock(
      [
        {
          message: {
            tool_calls: [
              {
                id: "ask-1",
                function: {
                  name: "ask_user",
                  arguments: JSON.stringify({ question: "要几种尺寸？", options: ["1 种", "3 种"] }),
                },
              },
            ],
          },
        },
        { message: { content: "好的，按 3 种尺寸继续。" } },
      ],
      calls
    );

    const firstTurn = await runAgentToolLoop(sessionIdAsk, "帮我做封面", config, {
      fetchImpl,
      executeTool: async () => ({ ok: true }),
    });
    expect(firstTurn.ok).toBe(true);
    expect(firstTurn.awaitingUserInput).toBe(true);
    expect(firstTurn.pendingAskUser?.question).toBe("要几种尺寸？");
    expect(firstTurn.pendingAskUser?.options).toEqual(["1 种", "3 种"]);
    expect(getPendingAskUser(sessionIdAsk)?.callId).toBe("ask-1");

    const resumed = await answerAgentAskUser(sessionIdAsk, "3 种", config, { fetchImpl });
    expect(resumed.ok).toBe(true);
    expect(resumed.content).toContain("3 种尺寸");
    expect(getPendingAskUser(sessionIdAsk)).toBeNull();

    const lastBody = calls[calls.length - 1] as { messages: Array<{ role: string; content: string; tool_call_id?: string }> };
    const toolMessage = lastBody.messages.find((message) => message.role === "tool" && message.tool_call_id === "ask-1");
    expect(toolMessage?.content).toContain("3 种");
  });
});
