import { v4 as uuidv4 } from "uuid";
import {
  applyMuApiEventPollResult,
  createMuApiEventPollState,
  isMuApiEventPollStalled,
  type MuApiEventPollState,
} from "@/services/muApiEventStream";
import type {
  AgentEvent,
  AgentProvider,
  AgentProviderConfig,
  AgentSession,
  MuApiAsset,
  MuApiJob,
  MuApiRawEvent,
  MuApiSession,
} from "@/types/agent";
import type { CanvasAgentOp, CreativeAssetKind, DesignPlan, DesignPlanStep } from "@/types/creative";

const DEFAULT_MUAPI_BASE_URL = "https://api.muapi.ai";
const MUAPI_REPORT_REDACTION = {
  secretValuesReturned: false,
  redactedKeys: ["MUAPI_API_KEY", "MUAPI_CHAT_PROBE", "x-api-key"],
  note: "Request headers, API key values, and chat probe text are not written to verification reports.",
};
const REQUIRED_MUAPI_STEP_IDS = ["config", "account", "skills", "session", "chat", "events"] as const;
const REQUIRED_MUAPI_ENDPOINT_RULES = [
  { id: "account", pattern: /^GET \/api\/v1\/account\/balance$/ },
  { id: "skills", pattern: /^GET \/api\/v1\/creative-agent\/agent-skills$/ },
  { id: "session", pattern: /^POST \/api\/v1\/creative-agent\/sessions$/ },
  { id: "chat", pattern: /^POST \/api\/v1\/creative-agent\/sessions\/[^/]+\/chat$/ },
  { id: "events", pattern: /^GET \/api\/v1\/creative-agent\/jobs\/[^/]+\/events(?:\?.*)?$/ },
] as const;

export interface MuApiChatRequest {
  message: string;
  messages_snapshot?: unknown[];
  model?: string;
  [key: string]: unknown;
}

export interface MuApiRunSkillRequest {
  skill_name: string;
  inputs: Record<string, unknown>;
  messages_snapshot?: unknown[];
  model?: string;
}

export interface MuApiClientOptions {
  baseUrl?: string;
  apiKey?: string;
  onRequestComplete?: (entry: MuApiEndpointLogEntry) => void;
}

export interface MuApiEndpointLogEntry {
  method: string;
  path: string;
  status?: number;
  durationMs: number;
  error?: string;
}

export interface MuApiVerificationStep {
  id: "config" | "account" | "skills" | "session" | "chat" | "events";
  label: string;
  status: "passed" | "failed" | "skipped";
  durationMs: number;
  detail?: unknown;
  error?: string;
}

export interface MuApiStepEvidence {
  seen: boolean;
  passed: boolean;
  status?: MuApiVerificationStep["status"];
  error?: string;
}

export interface MuApiEndpointEvidence {
  seen: boolean;
  has2xx: boolean;
  count: number;
  statuses: number[];
}

export interface MuApiEvidenceChecklistItem {
  id: string;
  label: string;
  required: true;
  status: "passed" | "failed";
  evidence: Record<string, unknown>;
}

export interface MuApiVerificationResult {
  ok: boolean;
  checkedAt: number;
  baseUrl: string;
  model: string;
  realService: boolean;
  requireChat: boolean;
  chatProbeConfigured: boolean;
  redaction: typeof MUAPI_REPORT_REDACTION;
  remoteSessionId?: string;
  remoteJobId?: string;
  steps: MuApiVerificationStep[];
  endpointLog: MuApiEndpointLogEntry[];
  strictEvidenceReady: boolean;
  stepEvidence: Record<string, MuApiStepEvidence>;
  missingStepIds: string[];
  failedStepIds: string[];
  endpointEvidence: Record<string, MuApiEndpointEvidence>;
  missingEndpointIds: string[];
  failedEndpoint2xxIds: string[];
  evidenceChecklist: MuApiEvidenceChecklistItem[];
  blockingEvidenceIds: string[];
}

export class MuApiClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly onRequestComplete?: (entry: MuApiEndpointLogEntry) => void;

  constructor(options: MuApiClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.apiKey = options.apiKey?.trim();
    this.onRequestComplete = options.onRequestComplete;
  }

  isConfigured() {
    return Boolean(this.baseUrl && this.apiKey);
  }

  listSessions() {
    return this.request<MuApiSession[]>("/api/v1/creative-agent/sessions");
  }

  createSession(payload: Record<string, unknown> = {}) {
    return this.request<MuApiSession>("/api/v1/creative-agent/sessions", {
      method: "POST",
      body: payload,
    });
  }

  updateSession(sessionId: string, payload: Record<string, unknown>) {
    return this.request<MuApiSession>(`/api/v1/creative-agent/sessions/${encodeURIComponent(sessionId)}`, {
      method: "PATCH",
      body: payload,
    });
  }

  deleteSession(sessionId: string) {
    return this.request<Record<string, unknown>>(`/api/v1/creative-agent/sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
    });
  }

  getSessionMessages(sessionId: string) {
    return this.request<unknown[]>(`/api/v1/creative-agent/sessions/${encodeURIComponent(sessionId)}/messages`);
  }

  updateSessionMessages(sessionId: string, payload: Record<string, unknown>) {
    return this.request<Record<string, unknown>>(`/api/v1/creative-agent/sessions/${encodeURIComponent(sessionId)}/messages`, {
      method: "PATCH",
      body: payload,
    });
  }

  chat(sessionId: string, payload: MuApiChatRequest) {
    return this.request<Record<string, unknown>>(`/api/v1/creative-agent/sessions/${encodeURIComponent(sessionId)}/chat`, {
      method: "POST",
      body: payload,
    });
  }

  listSessionAssets(sessionId: string) {
    return this.request<MuApiAsset[]>(`/api/v1/creative-agent/sessions/${encodeURIComponent(sessionId)}/assets`);
  }

  registerSessionAsset(sessionId: string, payload: MuApiAsset) {
    return this.request<MuApiAsset>(`/api/v1/creative-agent/sessions/${encodeURIComponent(sessionId)}/assets`, {
      method: "POST",
      body: payload,
    });
  }

  listSessionJobs(sessionId: string) {
    return this.request<MuApiJob[]>(`/api/v1/creative-agent/sessions/${encodeURIComponent(sessionId)}/jobs`);
  }

  getJobStatus(jobId: string) {
    return this.request<MuApiJob>(`/api/v1/creative-agent/jobs/${encodeURIComponent(jobId)}/status`);
  }

  getJobEvents(jobId: string, since?: string) {
    const query = since ? `?since=${encodeURIComponent(since)}` : "";
    return this.request<unknown>(`/api/v1/creative-agent/jobs/${encodeURIComponent(jobId)}/events${query}`);
  }

  approveJob(jobId: string, payload: Record<string, unknown> = {}) {
    return this.request<Record<string, unknown>>(`/api/v1/creative-agent/jobs/${encodeURIComponent(jobId)}/approve`, {
      method: "POST",
      body: payload,
    });
  }

  rejectJob(jobId: string, payload: Record<string, unknown> = {}) {
    return this.request<Record<string, unknown>>(`/api/v1/creative-agent/jobs/${encodeURIComponent(jobId)}/reject`, {
      method: "POST",
      body: payload,
    });
  }

  cancelJob(jobId: string, payload: Record<string, unknown> = {}) {
    return this.request<Record<string, unknown>>(`/api/v1/creative-agent/jobs/${encodeURIComponent(jobId)}/cancel`, {
      method: "POST",
      body: payload,
    });
  }

  listAgentSkills() {
    return this.request<Array<Record<string, unknown>>>("/api/v1/creative-agent/agent-skills");
  }

  runSkill(sessionId: string, payload: MuApiRunSkillRequest) {
    return this.request<Record<string, unknown>>(`/api/v1/creative-agent/sessions/${encodeURIComponent(sessionId)}/run-skill`, {
      method: "POST",
      body: payload,
    });
  }

  getAccountBalance() {
    return this.request<Record<string, unknown>>("/api/v1/account/balance");
  }

  private async request<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
    if (!this.apiKey) {
      throw new Error("MuAPI 未配置 API Key");
    }

    const method = options.method || "GET";
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch (error) {
      this.onRequestComplete?.({
        method,
        path,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : "网络请求失败",
      });
      throw error;
    }

    this.onRequestComplete?.({
      method,
      path,
      status: response.status,
      durationMs: Date.now() - startedAt,
    });

    const text = await response.text();
    const data = text ? safeJsonParse(text) : {};
    if (!response.ok) {
      const detail = getString(getRecord(data).detail) || getString(getRecord(data).message) || response.statusText;
      throw new Error(`MuAPI ${response.status}: ${detail}`);
    }

    return unwrapMuApiData(data) as T;
  }
}

export function createMuApiClient(config: AgentProviderConfig) {
  return new MuApiClient({
    baseUrl: config.baseUrl || DEFAULT_MUAPI_BASE_URL,
    apiKey: config.apiKey,
  });
}

export async function verifyMuApiConnection(
  config: AgentProviderConfig,
  options: { chatProbe?: string; requireChat?: boolean } = {}
): Promise<MuApiVerificationResult> {
  const endpointLog: MuApiEndpointLogEntry[] = [];
  const client = new MuApiClient({
    baseUrl: config.baseUrl || DEFAULT_MUAPI_BASE_URL,
    apiKey: config.apiKey,
    onRequestComplete: (entry) => endpointLog.push(entry),
  });
  const checkedAt = Date.now();
  const steps: MuApiVerificationStep[] = [];
  const baseUrl = normalizeBaseUrl(config.baseUrl || DEFAULT_MUAPI_BASE_URL);
  const model = config.model || "gpt-4o";
  const chatProbe = options.chatProbe?.trim();
  const requireChat = Boolean(options.requireChat);
  let remoteSessionId: string | undefined;
  let remoteJobId: string | undefined;

  const runStep = async <T>(
    id: MuApiVerificationStep["id"],
    label: string,
    fn: () => Promise<T>
  ): Promise<T | null> => {
    const startedAt = Date.now();
    try {
      const detail = await fn();
      steps.push({ id, label, status: "passed", durationMs: Date.now() - startedAt, detail });
      return detail;
    } catch (error) {
      steps.push({
        id,
        label,
        status: "failed",
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : "未知错误",
      });
      return null;
    }
  };

  await runStep("config", "配置检查", async () => {
    if (!client.isConfigured()) throw new Error("MuAPI Base URL 或 API Key 未配置");
    return { baseUrl, model, requireChat, chatProbeConfigured: Boolean(chatProbe) };
  });

  if (!client.isConfigured()) {
    return withMuApiEvidence({
      ok: false,
      checkedAt,
      baseUrl,
      model,
      realService: false,
      requireChat,
      chatProbeConfigured: Boolean(chatProbe),
      redaction: MUAPI_REPORT_REDACTION,
      steps,
      endpointLog,
    });
  }

  await runStep("account", "账户余额", () => client.getAccountBalance());
  await runStep("skills", "Agent Skills", () => client.listAgentSkills());
  const session = await runStep("session", "创建远端会话", () =>
    client.createSession({ name: `NextLemon verification ${new Date(checkedAt).toISOString()}` })
  );
  if (session && typeof getRecord(session).id === "string") {
    remoteSessionId = getString(getRecord(session).id);
  }

  if (chatProbe) {
    if (!remoteSessionId) {
      steps.push({
        id: "chat",
        label: "Chat 探针",
        status: "failed",
        durationMs: 0,
        error: "Chat 探针需要远端 session id，但创建会话未返回 id。",
      });
    } else {
      const chat = await runStep("chat", "Chat 探针", () =>
        client.chat(remoteSessionId, {
          message: chatProbe,
          messages_snapshot: [],
          model,
        })
      );
      if (chat) {
        const nextJobId = getString(getRecord(chat).job_id) || getString(getRecord(chat).jobId) || getString(getRecord(getRecord(chat).job).id);
        if (nextJobId) remoteJobId = nextJobId;
        if (remoteJobId) {
          const jobId = remoteJobId;
          await runStep("events", "Job Events", () => client.getJobEvents(jobId));
        } else if (requireChat) {
          steps.push({
            id: "events",
            label: "Job Events",
            status: "failed",
            durationMs: 0,
            error: "严格验证要求 Chat 返回 job_id/jobId/job.id，以拉取 Job Events。",
          });
        }
      }
    }
  } else if (requireChat) {
    steps.push({
      id: "chat",
      label: "Chat 探针",
      status: "failed",
      durationMs: 0,
      error: "已启用严格验证，但未填写 Chat 探针消息。",
    });
  } else {
    steps.push({
      id: "chat",
      label: "Chat 探针",
      status: "skipped",
      durationMs: 0,
      detail: "未填写探针消息，跳过可能产生费用的 chat 调用。",
    });
  }

  return withMuApiEvidence({
    ok: steps.every((step) => step.status === "passed" || step.status === "skipped"),
    checkedAt,
    baseUrl,
    model,
    realService: endpointLog.length > 0,
    requireChat,
    chatProbeConfigured: Boolean(chatProbe),
    redaction: MUAPI_REPORT_REDACTION,
    remoteSessionId,
    remoteJobId,
    steps,
    endpointLog,
  });
}

function withMuApiEvidence(
  report: Omit<
    MuApiVerificationResult,
    | "strictEvidenceReady"
    | "stepEvidence"
    | "missingStepIds"
    | "failedStepIds"
    | "endpointEvidence"
    | "missingEndpointIds"
    | "failedEndpoint2xxIds"
    | "evidenceChecklist"
    | "blockingEvidenceIds"
  >
): MuApiVerificationResult {
  const stepEvidence = Object.fromEntries(
    REQUIRED_MUAPI_STEP_IDS.map((id) => {
      const step = report.steps.find((item) => item.id === id);
      return [
        id,
        {
          seen: Boolean(step),
          passed: step?.status === "passed",
          status: step?.status,
          error: step?.error,
        },
      ];
    })
  ) as Record<string, MuApiStepEvidence>;

  const endpointEvidence = Object.fromEntries(
    REQUIRED_MUAPI_ENDPOINT_RULES.map((rule) => {
      const matches = report.endpointLog.filter((entry) =>
        rule.pattern.test(`${entry.method || "GET"} ${entry.path || ""}`)
      );
      return [
        rule.id,
        {
          seen: matches.length > 0,
          has2xx: matches.some((entry) => isSuccessStatus(entry.status)),
          count: matches.length,
          statuses: [...new Set(matches.map((entry) => entry.status).filter(isNumber))],
        },
      ];
    })
  ) as Record<string, MuApiEndpointEvidence>;

  const evidenceChecklist: MuApiEvidenceChecklistItem[] = [
    muApiEvidenceItem("report-ok", "Verification report succeeded", report.ok === true, { value: report.ok }),
    muApiEvidenceItem("configured", "MuAPI API key was configured for verification", Boolean(report.steps.find((step) => step.id === "config" && step.status === "passed")), {
      value: Boolean(report.steps.find((step) => step.id === "config" && step.status === "passed")),
    }),
    muApiEvidenceItem("real-service", "Verification reached a MuAPI-compatible service", report.realService === true, {
      value: report.realService,
    }),
    muApiEvidenceItem("non-localhost-base-url", "Base URL is not localhost", !isLocalhostUrl(report.baseUrl), {
      baseUrl: report.baseUrl,
    }),
    muApiEvidenceItem("remote-session-id", "Remote session id is present", Boolean(report.remoteSessionId), {
      present: Boolean(report.remoteSessionId),
    }),
    muApiEvidenceItem("remote-job-id", "Remote job id is present for strict chat verification", Boolean(report.remoteJobId), {
      present: Boolean(report.remoteJobId),
    }),
    muApiEvidenceItem("redaction", "Report contains no secret values", report.redaction.secretValuesReturned === false, {
      secretValuesReturned: report.redaction.secretValuesReturned,
    }),
  ];

  for (const id of REQUIRED_MUAPI_STEP_IDS) {
    const evidence = stepEvidence[id] || { seen: false, passed: false };
    evidenceChecklist.push(
      muApiEvidenceItem(`step-${id}`, `Required step ${id} passed`, evidence.seen && evidence.passed, {
        seen: evidence.seen,
        status: evidence.status,
        error: evidence.error,
      })
    );
  }

  for (const rule of REQUIRED_MUAPI_ENDPOINT_RULES) {
    const evidence = endpointEvidence[rule.id] || { seen: false, has2xx: false, count: 0, statuses: [] };
    evidenceChecklist.push(
      muApiEvidenceItem(`endpoint-${rule.id}`, `Endpoint ${rule.id} has 2xx evidence`, evidence.seen && evidence.has2xx, {
        seen: evidence.seen,
        has2xx: evidence.has2xx,
        count: evidence.count,
        statuses: evidence.statuses,
      })
    );
  }

  return {
    ...report,
    strictEvidenceReady: evidenceChecklist.every((item) => item.status === "passed"),
    stepEvidence,
    missingStepIds: Object.entries(stepEvidence)
      .filter(([, evidence]) => !evidence.seen)
      .map(([id]) => id),
    failedStepIds: Object.entries(stepEvidence)
      .filter(([, evidence]) => evidence.seen && !evidence.passed)
      .map(([id]) => id),
    endpointEvidence,
    missingEndpointIds: Object.entries(endpointEvidence)
      .filter(([, evidence]) => !evidence.seen)
      .map(([id]) => id),
    failedEndpoint2xxIds: Object.entries(endpointEvidence)
      .filter(([, evidence]) => evidence.seen && !evidence.has2xx)
      .map(([id]) => id),
    evidenceChecklist,
    blockingEvidenceIds: evidenceChecklist.filter((item) => item.status !== "passed").map((item) => item.id),
  };
}

function muApiEvidenceItem(
  id: string,
  label: string,
  passed: boolean,
  evidence: Record<string, unknown>
): MuApiEvidenceChecklistItem {
  return {
    id,
    label,
    required: true,
    status: passed ? "passed" : "failed",
    evidence,
  };
}

function isSuccessStatus(status: unknown): status is number {
  return typeof status === "number" && status >= 200 && status < 300;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isLocalhostUrl(value: string) {
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(url.hostname);
  } catch {
    return true;
  }
}

export function createMuApiAgentProvider(config: AgentProviderConfig): AgentProvider {
  const client = createMuApiClient(config);

  return {
    kind: "muapi",
    label: "MuAPI Provider",
    startSession: async (title = "MuAPI Agent 会话") => {
      const remote = await client.createSession({ name: title });
      return createAgentSessionFromMuApi(remote, title);
    },
    sendMessage: async function* (session: AgentSession, content: string) {
      const remoteSessionId = getRemoteSessionId(session);
      if (!remoteSessionId) throw new Error("MuAPI 会话缺少 remoteSessionId");

      const chatResponse = await client.chat(remoteSessionId, {
        message: content,
        messages_snapshot: session.messages.map((message) => ({
          role: message.role,
          content: message.content,
          timestamp: new Date(message.createdAt).toISOString(),
        })),
        model: config.model || "gpt-4o",
      });

      const immediateEvents = mapMuApiEvents(extractEvents(chatResponse), session.id);
      for (const event of immediateEvents) yield event;

      const jobId = getString(chatResponse.job_id) || getString(chatResponse.jobId) || getString(getRecord(chatResponse.job).id);
      if (jobId) {
        const jobEvents = await client.getJobEvents(jobId);
        for (const event of mapMuApiEvents(extractEvents(jobEvents), session.id, jobId)) {
          yield event;
        }
      }
    },
    approve: async (session, ops) => {
      const jobId = getRemoteJobId(session);
      if (!jobId) throw new Error("MuAPI 会话缺少待审批 jobId");
      const response = await client.approveJob(jobId, { ops });
      return createToolResultEvent(session.id, "muapi.approve", true, response);
    },
    reject: async (session, reason) => {
      const jobId = getRemoteJobId(session);
      if (!jobId) throw new Error("MuAPI 会话缺少待审批 jobId");
      const response = await client.rejectJob(jobId, { reason });
      return createToolResultEvent(session.id, "muapi.reject", true, response);
    },
    cancel: async (session) => {
      const jobId = getRemoteJobId(session);
      if (!jobId) throw new Error("MuAPI 会话缺少待取消 jobId");
      const response = await client.cancelJob(jobId, {});
      return createToolResultEvent(session.id, "muapi.cancel", true, response);
    },
  };
}

export async function sendMuApiMessage(
  config: AgentProviderConfig,
  session: AgentSession,
  content: string
): Promise<{
  events: AgentEvent[];
  remoteSessionId: string;
  remoteJobId?: string;
  raw: Record<string, unknown>;
  pollState?: MuApiEventPollState;
}> {
  const client = createMuApiClient(config);
  const remoteSessionId = getRemoteSessionId(session) || (await client.createSession({ name: session.title })).id;
  const chatResponse = await client.chat(remoteSessionId, {
    message: content,
    messages_snapshot: session.messages.map((message) => ({
      role: message.role,
      content: message.content,
      timestamp: new Date(message.createdAt).toISOString(),
    })),
    model: config.model || "gpt-4o",
  });
  const remoteJobId = getString(chatResponse.job_id) || getString(chatResponse.jobId) || getString(getRecord(chatResponse.job).id);
  const events = mapMuApiEvents(extractEvents(chatResponse), session.id, remoteJobId);

  let pollState: MuApiEventPollState | undefined;
  if (remoteJobId) {
    const jobEventsRaw = await client.getJobEvents(remoteJobId);
    const payload = readJobEventsPayload(jobEventsRaw);
    events.push(...mapMuApiEvents(payload.events, session.id, remoteJobId));
    pollState = applyMuApiEventPollResult(createMuApiEventPollState(), payload).state;
  }

  return {
    events,
    remoteSessionId,
    remoteJobId,
    raw: chatResponse,
    pollState,
  };
}

export async function approveMuApiJob(config: AgentProviderConfig, jobId: string, payload: Record<string, unknown> = {}) {
  return createMuApiClient(config).approveJob(jobId, payload);
}

export async function rejectMuApiJob(config: AgentProviderConfig, jobId: string, reason?: string) {
  return createMuApiClient(config).rejectJob(jobId, { reason });
}

export async function cancelMuApiJob(config: AgentProviderConfig, jobId: string) {
  return createMuApiClient(config).cancelJob(jobId, {});
}

export function createAgentSessionFromMuApi(remote: MuApiSession, fallbackTitle = "MuAPI Agent 会话"): AgentSession {
  const timestamp = Date.now();
  const createdAt = parseRemoteTime(remote.created_at) || timestamp;
  const updatedAt = parseRemoteTime(remote.updated_at) || createdAt;
  return {
    id: uuidv4(),
    title: remote.name || remote.title || fallbackTitle,
    providerKind: "muapi",
    messages: [],
    status: "idle",
    createdAt,
    updatedAt,
    metadata: {
      remoteSessionId: remote.id,
      remote,
    },
  };
}

export function mapMuApiEvents(rawEvents: unknown, localSessionId: string, fallbackJobId?: string): AgentEvent[] {
  return extractEvents(rawEvents).map((raw) => mapMuApiEvent(raw, localSessionId, fallbackJobId));
}

export function mapMuApiEvent(raw: MuApiRawEvent, localSessionId: string, fallbackJobId?: string): AgentEvent {
  const eventType = normalizeEventType(getString(raw.type) || getString(raw.event) || getString(raw.name) || getString(raw.kind));
  const payload = getRecord(raw.data || raw.payload || raw);
  const createdAt = parseRemoteTime(raw.created_at || raw.createdAt || payload.created_at || payload.createdAt) || Date.now();
  const jobId = getString(raw.job_id) || getString(raw.jobId) || getString(payload.job_id) || getString(payload.jobId) || fallbackJobId;

  if (eventType === "plan_propose") {
    return {
      id: getString(raw.id) || uuidv4(),
      type: "plan_propose",
      sessionId: localSessionId,
      plan: normalizeDesignPlan(payload.plan || payload, localSessionId),
      createdAt,
    };
  }

  if (eventType === "tool_call") {
    const toolName = getString(payload.toolName) || getString(payload.tool_name) || getString(payload.name) || "muapi.tool";
    return {
      id: getString(raw.id) || uuidv4(),
      type: "tool_call",
      sessionId: localSessionId,
      toolName,
      args: getRecord(payload.args || payload.arguments || payload.input),
      write: getBoolean(payload.write) ?? true,
      createdAt,
    };
  }

  if (eventType === "tool_result") {
    const ok = getBoolean(payload.ok) ?? !["failed", "error", "rejected"].includes(getString(payload.status).toLowerCase());
    return {
      id: getString(raw.id) || uuidv4(),
      type: "tool_result",
      sessionId: localSessionId,
      toolName: getString(payload.toolName) || getString(payload.tool_name) || getString(payload.name) || "muapi.tool",
      ok,
      result: payload.result || payload.output || payload,
      error: getString(payload.error) || getString(payload.message),
      createdAt,
    };
  }

  if (eventType === "approval_required") {
    return {
      id: getString(raw.id) || uuidv4(),
      type: "approval_required",
      sessionId: localSessionId,
      title: getString(payload.title) || "MuAPI 请求确认",
      ops: normalizeCanvasAgentOps(payload.ops || payload.operations),
      createdAt,
    };
  }

  if (eventType === "error") {
    return {
      id: getString(raw.id) || uuidv4(),
      type: "error",
      sessionId: localSessionId,
      message: getString(payload.message) || getString(payload.error) || "MuAPI 事件错误",
      detail: payload,
      createdAt,
    };
  }

  const content =
    getString(payload.content) ||
    getString(payload.text) ||
    getString(payload.message) ||
    (jobId ? `MuAPI job ${jobId}: ${eventType || "event"}` : JSON.stringify(payload));

  return {
    id: getString(raw.id) || uuidv4(),
    type: "text",
    sessionId: localSessionId,
    content,
    createdAt,
  };
}

export function extractEvents(value: unknown): MuApiRawEvent[] {
  if (Array.isArray(value)) return value.map(getRecord).filter((item) => Object.keys(item).length > 0);
  const record = getRecord(value);
  const candidates = [record.events, record.data, record.items, record.results];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.map(getRecord).filter((item) => Object.keys(item).length > 0);
  }
  return Object.keys(record).length > 0 ? [record] : [];
}

function normalizeDesignPlan(value: unknown, localSessionId: string): DesignPlan {
  const record = getRecord(value);
  const stepsInput = Array.isArray(record.steps) ? record.steps : [];
  const steps: DesignPlanStep[] = stepsInput.map((step, index) => {
    const stepRecord = getRecord(step);
    return {
      id: getString(stepRecord.id) || `step-${index + 1}`,
      title: getString(stepRecord.title) || getString(stepRecord.name) || `步骤 ${index + 1}`,
      description: getString(stepRecord.description) || getString(stepRecord.detail) || undefined,
      tool: getString(stepRecord.tool) || getString(stepRecord.toolName) || "muapi",
      outputKind: normalizeOutputKind(stepRecord.outputKind || stepRecord.output_kind),
      dependsOn: getStringArray(stepRecord.dependsOn || stepRecord.depends_on),
      modelHint: getString(stepRecord.modelHint) || getString(stepRecord.model_hint) || undefined,
      status: normalizeStepStatus(getString(stepRecord.status)),
      estimatedCost: getString(stepRecord.estimatedCost) || getString(stepRecord.estimated_cost) || undefined,
      metadata: getRecord(stepRecord.metadata),
    };
  });

  const now = Date.now();
  return {
    id: getString(record.id) || `muapi-plan-${localSessionId}`,
    title: getString(record.title) || getString(record.name) || "MuAPI 设计计划",
    brief: getString(record.brief) || getString(record.prompt) || "",
    steps,
    status: normalizePlanStatus(getString(record.status)),
    createdAt: parseRemoteTime(record.created_at || record.createdAt) || now,
    updatedAt: parseRemoteTime(record.updated_at || record.updatedAt) || now,
    metadata: getRecord(record.metadata),
  };
}

function normalizeCanvasAgentOps(value: unknown): CanvasAgentOp[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is CanvasAgentOp => {
    const record = getRecord(item);
    return typeof record.type === "string";
  });
}

function createToolResultEvent(sessionId: string, toolName: string, ok: boolean, result?: unknown, error?: string): AgentEvent {
  return {
    id: uuidv4(),
    type: "tool_result",
    sessionId,
    toolName,
    ok,
    result,
    error,
    createdAt: Date.now(),
  };
}

function normalizeBaseUrl(baseUrl?: string) {
  return (baseUrl?.trim() || DEFAULT_MUAPI_BASE_URL).replace(/\/+$/, "");
}

function normalizeEventType(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[-.]/g, "_");
  if (normalized === "plan" || normalized === "plan_proposed") return "plan_propose";
  if (normalized === "tool" || normalized === "tool_call_delta") return "tool_call";
  if (normalized === "result" || normalized === "tool_result_delta") return "tool_result";
  if (normalized === "approval" || normalized === "approval_required") return "approval_required";
  return normalized;
}

function normalizeOutputKind(value: unknown): DesignPlanStep["outputKind"] {
  const text = getString(value);
  if (["text", "image", "video", "audio", "workflow"].includes(text)) {
    return text as CreativeAssetKind | "workflow";
  }
  return "workflow";
}

function normalizeStepStatus(value: string): DesignPlanStep["status"] {
  if (["pending", "approved", "running", "completed", "failed", "skipped"].includes(value)) {
    return value as DesignPlanStep["status"];
  }
  return "pending";
}

function normalizePlanStatus(value: string): DesignPlan["status"] {
  if (["draft", "awaiting_approval", "approved", "running", "completed", "failed", "cancelled"].includes(value)) {
    return value as DesignPlan["status"];
  }
  return "awaiting_approval";
}

function unwrapMuApiData(value: unknown) {
  const record = getRecord(value);
  if ("data" in record && Object.keys(record).length <= 3) return record.data;
  return value;
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return { detail: value };
  }
}

function parseRemoteTime(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function getRemoteSessionId(session: AgentSession) {
  return getString(getRecord(session.metadata).remoteSessionId);
}

function getRemoteJobId(session: AgentSession) {
  return getString(getRecord(session.metadata).remoteJobId);
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

function getBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (["true", "yes", "1"].includes(value.toLowerCase())) return true;
    if (["false", "no", "0"].includes(value.toLowerCase())) return false;
  }
  return null;
}

// 从 job events 响应中读取事件、游标与完成标志
function readJobEventsPayload(raw: unknown): {
  events: MuApiRawEvent[];
  cursor?: string | null;
  done: boolean;
} {
  const record = getRecord(raw);
  const cursorCandidates = [record.cursor, record.next_cursor, record.nextCursor];
  const cursor = cursorCandidates.find(
    (candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0
  );
  const done =
    record.done === true ||
    record.completed === true ||
    record.status === "completed" ||
    record.job_status === "completed";
  return { events: extractEvents(raw), cursor: cursor ?? null, done };
}

// 断点续传拉取：读取会话元数据中的游标状态，?since= 增量拉取，去重后返回新事件与下一个状态。
export async function pollMuApiJobEvents(
  config: AgentProviderConfig,
  session: AgentSession
): Promise<{
  newEvents: AgentEvent[];
  pollState: MuApiEventPollState;
  stalled: boolean;
}> {
  const remoteJobId = getRecord(session.metadata).remoteJobId;
  if (typeof remoteJobId !== "string" || !remoteJobId) {
    throw new Error("会话没有关联的远端 job");
  }

  const prevPoll = getRecord(session.metadata).eventPoll as MuApiEventPollState | undefined;
  const prev = prevPoll && typeof prevPoll.lastEventAt === "number"
    ? prevPoll
    : createMuApiEventPollState();

  const client = createMuApiClient(config);
  const raw = await client.getJobEvents(remoteJobId, prev.cursor ?? undefined);
  const payload = readJobEventsPayload(raw);
  const { state, newEvents } = applyMuApiEventPollResult(prev, payload);

  return {
    newEvents: mapMuApiEvents(newEvents, session.id, remoteJobId),
    pollState: state,
    stalled: isMuApiEventPollStalled(state),
  };
}
