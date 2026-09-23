import { v4 as uuidv4 } from "uuid";
import { runCanvasAgentTool, getWorkspaceSnapshot, type CanvasAgentToolName } from "@/services/canvasAgentRuntime";
import { LEMON_API_CONFIG } from "@/config/lemonApi";
import type { AgentProviderConfig } from "@/types/agent";
import { useAgentStore } from "@/stores/agentStore";

// 参考 infinite-canvas 的在线画布助手：真实 LLM function calling 循环。
// 第一轮强制 tool_choice="required"，后续轮改为 "auto"；
// 工具执行结果（包括校验失败原因）作为 role:"tool" 消息回填给模型自我修正。

export interface AgentModelConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export type AgentChatRole = "system" | "user" | "assistant" | "tool";

export interface AgentChatMessage {
  role: AgentChatRole;
  content: string;
  tool_call_id?: string;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
}

export interface AgentChatToolCall {
  id: string;
  // ask_user 不是画布受控工具，而是工具循环内的人机回路工具
  name: CanvasAgentToolName | "ask_user";
  arguments: string;
}

export interface AgentChatCompletionResult {
  content: string;
  toolCalls: AgentChatToolCall[];
}

export interface AgentAskUserPending {
  callId: string;
  question: string;
  options: string[];
  askedAt: number;
}

export interface AgentToolLoopTurnResult {
  ok: boolean;
  rounds: number;
  toolCallCount: number;
  awaitingApproval: boolean;
  awaitingUserInput?: boolean;
  pendingAskUser?: AgentAskUserPending;
  content?: string;
  error?: string;
}

interface AgentToolLoopState {
  messages: AgentChatMessage[];
  iterations: number;
}

const MAX_LOOP_ROUNDS = 4;

// 循环对话上下文仅存内存：应用重启后重新开始，不影响已持久化的会话记录。
const loopStates = new Map<string, AgentToolLoopState>();

export const AGENT_SYSTEM_PROMPT = [
  "你是 NextLemon 双模式创作工作区中的画布助手。",
  "你必须通过提供的工具来读取工作区状态或修改素材、创作画布与工作流，禁止编造执行结果。",
  "调用工具时只能引用 workspace.readSnapshot 返回的真实标识：素材优先使用其 label（如 asset_3），节点使用 nodeId；禁止编造 ID。",
  "在文本素材或提示词中引用素材时使用 @[asset_N] 语法，例如：请参考 @[asset_2] 的风格；节点快照中的 upstreamAssetLabels 列出了该节点可引用的上游素材。",
  "如果用户的需求不明确或缺少必要信息，调用 ask_user 工具向用户提问，可提供编号选项。",
  "参数必须符合每个工具的 JSON Schema；校验失败时请根据错误信息修正后重试。",
  "当用户想一次性搭好「提示词 → 图片生成」流程时，优先调用组合工具 generate_image_flow，而不是逐个拆成多个工具调用。",
  "写操作不会直接执行，会进入用户审批队列；请向用户说明你发起了哪些操作。",
  "全程使用中文与用户交流，回复保持简洁。",
].join("\n");

export function getAgentChatTools(): Array<{
  type: "function";
  function: {
    name: CanvasAgentToolName | "ask_user";
    description: string;
    parameters: Record<string, unknown>;
  };
}> {
  return [
    {
      type: "function",
      function: {
        name: "workspace.readSnapshot",
        description: "读取当前工作区快照：工作流画布列表、节点/边、创作素材库和创作画布实例。",
        parameters: { type: "object", properties: {}, additionalProperties: false },
      },
    },
    {
      type: "function",
      function: {
        name: "asset.create",
        description: "创建素材（文本/图片/视频/音频），可选放入创作画布。文本素材必须提供 text；媒体素材必须提供 dataUrl 或 storagePath。",
        parameters: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["text", "image", "video", "audio"], description: "素材类型" },
            title: { type: "string", description: "素材标题" },
            text: { type: "string", description: "文本素材内容" },
            tags: { type: "array", items: { type: "string" }, description: "标签" },
            note: { type: "string", description: "备注" },
            placeOnCanvas: { type: "boolean", description: "是否放入创作画布" },
            position: {
              type: "object",
              properties: { x: { type: "number" }, y: { type: "number" } },
              required: ["x", "y"],
              description: "画布坐标；省略时自动放在相邻素材右侧",
            },
          },
          required: ["kind"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "asset.update",
        description: "更新素材的标题、内容、标签或备注。assetId 可传快照中的 label（如 asset_3）。",
        parameters: {
          type: "object",
          properties: {
            assetId: { type: "string", description: "素材 ID 或规范标签（asset_N）" },
            patch: {
              type: "object",
              properties: {
                title: { type: "string" },
                text: { type: "string" },
                tags: { type: "array", items: { type: "string" } },
                note: { type: "string" },
              },
              additionalProperties: false,
            },
          },
          required: ["assetId", "patch"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "canvas.addAssetItem",
        description: "把素材库中的已有素材放入创作画布。assetId 可传快照中的 label（如 asset_3）。",
        parameters: {
          type: "object",
          properties: {
            assetId: { type: "string", description: "素材 ID 或规范标签（asset_N）" },
            position: {
              type: "object",
              properties: { x: { type: "number" }, y: { type: "number" } },
              required: ["x", "y"],
              description: "画布坐标；省略时自动放在相邻素材右侧",
            },
          },
          required: ["assetId"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "workflow.createNode",
        description: "在工作流画布创建节点。nodeType 必须是工作区支持的节点类型。",
        parameters: {
          type: "object",
          properties: {
            nodeType: { type: "string", description: "节点类型，例如 promptNode / imageGeneratorProNode / videoGeneratorNode" },
            position: {
              type: "object",
              properties: { x: { type: "number" }, y: { type: "number" } },
              required: ["x", "y"],
            },
            data: { type: "object", description: "节点数据，例如 { label, prompt }", additionalProperties: true },
          },
          required: ["nodeType", "position"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "workflow.connectNodes",
        description: "连接两个工作流节点。",
        parameters: {
          type: "object",
          properties: {
            source: { type: "string", description: "源节点 ID" },
            target: { type: "string", description: "目标节点 ID" },
            sourceHandle: { type: "string", description: "源句柄，例如 output-prompt" },
            targetHandle: { type: "string", description: "目标句柄，例如 input-prompt" },
          },
          required: ["source", "target"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "workflow.runNode",
        description: "运行一个工作流节点（高成本操作，仍需用户审批）。",
        parameters: {
          type: "object",
          properties: { nodeId: { type: "string", description: "节点 ID" } },
          required: ["nodeId"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "workflow.selectNodes",
        description: "选中工作流节点。",
        parameters: {
          type: "object",
          properties: {
            nodeIds: { type: "array", items: { type: "string" }, description: "节点 ID 列表" },
          },
          required: ["nodeIds"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "generate_image_flow",
        description:
          "组合工具：一次调用搭好完整图片生成流。内部编排受控操作：创建提示词素材→创建提示词节点与生成节点→连线→触发生成节点运行。所有写操作仍需用户审批。",
        parameters: {
          type: "object",
          properties: {
            prompt: { type: "string", description: "图片生成提示词" },
            title: { type: "string", description: "提示词素材/节点标题；省略时从 prompt 截取" },
            referenceAssetIds: {
              type: "array",
              items: { type: "string" },
              description: "可选参考素材，使用快照中的 label（如 asset_2），会以 @[asset_N] 提及注入提示词",
            },
            generatorNodeType: {
              type: "string",
              enum: ["imageGeneratorProNode", "imageGeneratorFastNode"],
              description: "生成节点类型，默认 imageGeneratorProNode",
            },
            position: {
              type: "object",
              properties: { x: { type: "number" }, y: { type: "number" } },
              required: ["x", "y"],
              description: "提示词节点画布坐标；生成节点自动放在其右侧",
            },
          },
          required: ["prompt"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "ask_user",
        description: "当用户需求不明确或缺少必要信息时，向用户提问并暂停执行；用户下一条消息就是回答。可提供编号选项。",
        parameters: {
          type: "object",
          properties: {
            question: { type: "string", description: "要向用户提出的问题" },
            options: {
              type: "array",
              items: { type: "string" },
              description: "可选的候选项，用户可以直接选择",
            },
          },
          required: ["question"],
          additionalProperties: false,
        },
      },
    },
  ];
}

// 未配置 API Key 时的中止提示：绝不回退到任何内置密钥。
export const AGENT_MISSING_API_KEY_MESSAGE =
  "未配置模型 API Key，本轮工具调用已中止。请在 Agent 面板的模型设置中填写 API Key 后重试。";

export function resolveAgentModelConfig(config: AgentProviderConfig): AgentModelConfig | null {
  const loopEnabled = config.metadata?.modelToolLoop === true;
  if (!loopEnabled) return null;

  const baseUrl = (config.baseUrl || LEMON_API_CONFIG.baseUrl).replace(/\/+$/, "");
  // 安全要求：用户未配置密钥时保留空值，由 runAgentToolLoop 中止本轮并提示，绝不使用内置密钥。
  const apiKey = (config.apiKey || "").trim();
  const model = config.model || "gpt-4o-mini";
  if (!baseUrl) return null;
  return { baseUrl, apiKey, model };
}

export function buildAgentSnapshotMessage(content: string): string {
  const snapshot = getWorkspaceSnapshot();
  return [
    content,
    "",
    "当前工作区快照（JSON）：",
    JSON.stringify(snapshot),
  ].join("\n");
}

export function parseAgentChatCompletion(data: unknown): AgentChatCompletionResult {
  const record = (data || {}) as Record<string, unknown>;
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const first = choices[0] as Record<string, unknown> | undefined;
  const message = (first?.message || {}) as Record<string, unknown>;
  const content = typeof message.content === "string" ? message.content : "";
  const rawCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];

  const toolCalls = rawCalls
    .map((item) => {
      const call = item as Record<string, unknown>;
      const id = typeof call.id === "string" ? call.id : uuidv4();
      const fn = (call.function || {}) as Record<string, unknown>;
      const name = typeof fn.name === "string" ? fn.name : "";
      const argsJson = typeof fn.arguments === "string" ? fn.arguments : "{}";
      if (!name) return null;
      return { id, name: name as CanvasAgentToolName | "ask_user", arguments: argsJson };
    })
    .filter((item): item is AgentChatToolCall => Boolean(item));

  return { content, toolCalls };
}

export async function callAgentChat(
  config: AgentModelConfig,
  messages: AgentChatMessage[],
  options: { toolChoice?: "required" | "auto"; fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<AgentChatCompletionResult> {
  const fetchImpl = options.fetchImpl || fetch;
  if (!config.apiKey.trim()) {
    throw new Error(AGENT_MISSING_API_KEY_MESSAGE);
  }
  const response = await fetchImpl(`${config.baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      tools: getAgentChatTools(),
      tool_choice: options.toolChoice || "auto",
      temperature: 0.4,
      stream: false,
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`模型请求失败 (${response.status}): ${errText.slice(0, 300)}`);
  }

  return parseAgentChatCompletion(await response.json());
}

type ToolExecutor = typeof runCanvasAgentTool;

export function hasActiveToolLoop(sessionId: string): boolean {
  return loopStates.has(sessionId);
}

export function clearToolLoop(sessionId: string): void {
  loopStates.delete(sessionId);
}

export async function runAgentToolLoop(
  sessionId: string,
  content: string,
  config: AgentModelConfig,
  options: { fetchImpl?: typeof fetch; executeTool?: ToolExecutor; maxRounds?: number } = {}
): Promise<AgentToolLoopTurnResult> {
  const executeTool = options.executeTool || runCanvasAgentTool;
  const maxRounds = options.maxRounds || MAX_LOOP_ROUNDS;

  // 安全闸门：没有可用密钥时中止本轮工具调用，不发任何模型请求。
  if (!config.apiKey.trim()) {
    useAgentStore.getState().addMessage(sessionId, "assistant", AGENT_MISSING_API_KEY_MESSAGE);
    return {
      ok: false,
      rounds: 0,
      toolCallCount: 0,
      awaitingApproval: false,
      error: AGENT_MISSING_API_KEY_MESSAGE,
    };
  }

  const state = loopStates.get(sessionId) || { messages: [], iterations: 0 };
  if (state.messages.length === 0) {
    state.messages.push({ role: "system", content: AGENT_SYSTEM_PROMPT });
  }

  if (content.trim()) {
    state.messages.push({
      role: "user",
      content: buildAgentSnapshotMessage(content),
    });
  }

  let toolCallCount = 0;
  let awaitingApproval = false;
  let lastError: string | undefined;

  try {
    for (let round = 0; round < maxRounds; round += 1) {
      state.iterations += 1;
      const hasToolFeedback = state.messages.some((message) => message.role === "tool");
      const completion = await callAgentChat(config, state.messages, {
        toolChoice: round === 0 && !hasToolFeedback ? "required" : "auto",
        fetchImpl: options.fetchImpl,
      });

      if (completion.content) {
        state.messages.push({ role: "assistant", content: completion.content });
        useAgentStore.getState().addMessage(sessionId, "assistant", completion.content);
      }

      if (completion.toolCalls.length === 0) {
        loopStates.set(sessionId, state);
        return {
          ok: !lastError,
          rounds: round + 1,
          toolCallCount,
          awaitingApproval,
          content: completion.content,
          error: lastError,
        };
      }

      state.messages.push({
        role: "assistant",
        content: completion.content || "",
        tool_calls: completion.toolCalls.map((call) => ({
          id: call.id,
          type: "function" as const,
          function: { name: call.name, arguments: call.arguments },
        })),
      });

      for (const call of completion.toolCalls) {
        toolCallCount += 1;

        if (call.name === "ask_user") {
          let askArgs: Record<string, unknown> = {};
          try {
            askArgs = JSON.parse(call.arguments || "{}") as Record<string, unknown>;
          } catch {
            // 参数解析失败也照常挂起，问题文本会退化为占位
          }
          const pending: AgentAskUserPending = {
            callId: call.id,
            question: typeof askArgs.question === "string" && askArgs.question.trim()
              ? askArgs.question.trim()
              : "请补充更多细节",
            options: Array.isArray(askArgs.options)
              ? askArgs.options.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
              : [],
            askedAt: Date.now(),
          };
          useAgentStore.getState().updateSessionMetadata(sessionId, { pendingAskUser: pending });
          loopStates.set(sessionId, state);
          return {
            ok: true,
            rounds: round + 1,
            toolCallCount,
            awaitingApproval,
            awaitingUserInput: true,
            pendingAskUser: pending,
          };
        }

        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.arguments || "{}") as Record<string, unknown>;
        } catch {
          // 参数解析失败按无效调用处理，交给模型修正
        }

        const outcome = await executeTool(sessionId, call.name, args);
        if (outcome.pendingApproval) awaitingApproval = true;
        if (!outcome.ok) lastError = outcome.error;

        state.messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({
            ok: outcome.ok,
            pendingApproval: outcome.pendingApproval === true,
            result: outcome.result,
            error: outcome.error,
          }),
        });
      }
    }

    loopStates.set(sessionId, state);
    return { ok: !lastError, rounds: maxRounds, toolCallCount, awaitingApproval, error: lastError };
  } catch (error) {
    loopStates.set(sessionId, state);
    const message = error instanceof Error ? error.message : "模型调用失败";
    return { ok: false, rounds: state.iterations, toolCallCount, awaitingApproval, error: message };
  }
}

export async function resumeAgentToolLoopAfterApproval(
  sessionId: string,
  config: AgentModelConfig,
  executionSummary: unknown,
  options: { fetchImpl?: typeof fetch; executeTool?: ToolExecutor } = {}
): Promise<AgentToolLoopTurnResult> {
  const state = loopStates.get(sessionId);
  if (!state) {
    return { ok: true, rounds: 0, toolCallCount: 0, awaitingApproval: false };
  }

  state.messages.push({
    role: "user",
    content: `用户已批准并执行了你发起的写操作，执行结果：${JSON.stringify(executionSummary)}。请继续完成任务或总结结果。`,
  });

  return runAgentToolLoop(sessionId, "", config, options);
}

export function getPendingAskUser(sessionId: string): AgentAskUserPending | null {
  const session = useAgentStore
    .getState()
    .sessions.find((item) => item.id === sessionId);
  const pending = session?.metadata?.pendingAskUser as AgentAskUserPending | undefined;
  return pending && typeof pending.callId === "string" ? pending : null;
}

// ask_user 人机回路：用户对挂起问题的回答作为 tool 结果回填，模型继续执行。
// 循环上下文丢失（应用重启）时退化为普通新消息。
export async function answerAgentAskUser(
  sessionId: string,
  answer: string,
  config: AgentModelConfig,
  options: { fetchImpl?: typeof fetch; executeTool?: ToolExecutor } = {}
): Promise<AgentToolLoopTurnResult> {
  const pending = getPendingAskUser(sessionId);
  const state = loopStates.get(sessionId);

  useAgentStore.getState().updateSessionMetadata(sessionId, { pendingAskUser: null });

  if (!pending || !state) {
    return { ok: true, rounds: 0, toolCallCount: 0, awaitingApproval: false };
  }

  state.messages.push({
    role: "tool",
    tool_call_id: pending.callId,
    content: JSON.stringify({ answer, answeredAt: Date.now() }),
  });

  return runAgentToolLoop(sessionId, "", config, options);
}
