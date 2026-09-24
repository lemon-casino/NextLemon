import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  Bot,
  Check,
  Circle,
  Clock3,
  Download,
  History,
  KeyRound,
  Link2,
  MessageCircleQuestion,
  Pencil,
  Pin,
  Play,
  RefreshCw,
  Send,
  Settings2,
  Sparkles,
  Trash2,
  Undo2,
  Wrench,
  X,
} from "lucide-react";
import { LocalAgentBridgePanel } from "@/components/agent/LocalAgentBridgePanel";
import { DesignPlanDagView } from "@/components/agent/DesignPlanDagView";
import {
  approveAndExecuteAgentOps,
  CANVAS_AGENT_TOOLS,
  rollbackLastAgentExecution,
  runCanvasAgentInput,
  runCanvasAgentTool,
  type CanvasAgentToolName,
} from "@/services/canvasAgentRuntime";
import { agentOpLabel, summarizeAgentOps } from "@/services/agentOps";
import {
  buildMuApiSessionSnapshotPayload,
  getEngineExecutablePath,
  getEngineSessionId,
  getLocalEngineMode,
  mapSkillInputs,
  normalizeAgentSkills,
  resolveAgentEngineCwd,
  startAgentEngineTurn,
  type AgentEngineId,
  type AgentEngineParsedEvent,
  type AgentEngineTurnHandle,
  type AgentSkillSummary,
} from "@/services/agentEngines";
import {
  answerAgentAskUser,
  getPendingAskUser,
  hasActiveToolLoop,
  resolveAgentModelConfig,
  resumeAgentToolLoopAfterApproval,
  runAgentToolLoop,
} from "@/services/agentToolLoop";
import {
  isMuApiSessionJobSettled,
  resolveAgentApprovalResolutions,
  shouldPollMuApiSessionJob,
  type AgentApprovalEventResolution,
} from "@/services/muApiEventStream";
import {
  getRemoteJobId,
  getRemoteSessionId,
  recoverMuApiSessionJobs,
  startMuApiJobPolling,
  syncMuApiSessionEvents,
} from "@/services/muApiJobRecovery";
import { assetLabelMap } from "@/services/creativeAssetService";
import {
  createDesignPlanFromBrief,
  designPlanToCanvasAgentOps,
  updateDesignPlan,
  updateDesignPlanStep,
  validateDesignPlanTopology,
} from "@/services/designPlanPlanner";
import {
  approveMuApiJob,
  cancelMuApiJob,
  createMuApiClient,
  createMuApiAgentProvider,
  mapMuApiEvents,
  rejectMuApiJob,
  sendMuApiMessage,
  verifyMuApiConnection,
  type MuApiVerificationResult,
} from "@/services/muApiAgentAdapter";
import { useAgentStore } from "@/stores/agentStore";
import { useBrandKitStore } from "@/stores/brandKitStore";
import { useCreativeStore } from "@/stores/creativeStore";
import { toast } from "@/stores/toastStore";
import type {
  AgentApprovalAuditMetadata,
  AgentEvent,
  AgentProviderConfig,
  AgentProviderKind,
  AgentSession,
  LocalAgentEngineMode,
} from "@/types/agent";
import type { CanvasAgentOp, DesignPlan, DesignPlanStep } from "@/types/creative";

export function AgentPanel() {
  const providerConfigs = useAgentStore((state) => state.providerConfigs);
  const sessions = useAgentStore((state) => state.sessions);
  const activeSessionId = useAgentStore((state) => state.activeSessionId);
  const createSession = useAgentStore((state) => state.createSession);
  const upsertSession = useAgentStore((state) => state.upsertSession);
  const appendEvent = useAgentStore((state) => state.appendEvent);
  const updateSessionMetadata = useAgentStore((state) => state.updateSessionMetadata);
  const setSessionStatus = useAgentStore((state) => state.setSessionStatus);
  const setActiveSession = useAgentStore((state) => state.setActiveSession);
  const addMessage = useAgentStore((state) => state.addMessage);
  const requestApproval = useAgentStore((state) => state.requestApproval);
  const rejectPendingOps = useAgentStore((state) => state.rejectPendingOps);
  const cancelSession = useAgentStore((state) => state.cancelSession);
  const clearSession = useAgentStore((state) => state.clearSession);
  const setProviderConfig = useAgentStore((state) => state.setProviderConfig);
  const renameSession = useAgentStore((state) => state.renameSession);
  const rollbackHistory = useAgentStore((state) => state.rollbackHistory);
  const _hasHydrated = useAgentStore((state) => state._hasHydrated);
  const brandKits = useBrandKitStore((state) => state.brandKits);
  const creativeAssets = useCreativeStore((state) => state.assets);
  const activeBrandKitId = useBrandKitStore((state) => state.activeBrandKitId);
  const [selectedProviderKind, setSelectedProviderKind] = useState<AgentProviderKind>("local");
  const [input, setInput] = useState("");
  const [muApiVerifying, setMuApiVerifying] = useState(false);
  const [muApiChatProbe, setMuApiChatProbe] = useState("");
  const [muApiRequireChat, setMuApiRequireChat] = useState(false);
  const [muApiVerificationResult, setMuApiVerificationResult] = useState<MuApiVerificationResult | null>(null);
  const [toolName, setToolName] = useState<CanvasAgentToolName>("workspace.readSnapshot");
  const selectedTool = CANVAS_AGENT_TOOLS.find((tool) => tool.name === toolName) || CANVAS_AGENT_TOOLS[0];
  const [toolArgs, setToolArgs] = useState(() => JSON.stringify(selectedTool.exampleArgs, null, 2));
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  // Skills 专家工作流：muapi 技能列表 + 钉选中的技能名
  const [agentSkills, setAgentSkills] = useState<AgentSkillSummary[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [pinnedSkillName, setPinnedSkillName] = useState<string | null>(null);
  // 引擎回合进行中的句柄（按会话 id），取消会话时用于 kill 子进程
  const engineTurnHandlesRef = useRef<Map<string, AgentEngineTurnHandle>>(new Map());
  // 快照回写去重：同一会话的同一终态只尝试一次
  const snapshotSyncAttemptedRef = useRef<Set<string>>(new Set());
  // 卸载清理：面板被侧栏切换卸载时停止所有进行中的引擎子进程（kill + 注销监听），
  // 避免孤儿进程与事件监听器滞留；对应会话状态收敛为 failed，不再永久卡在 running。
  useEffect(() => {
    const handles = engineTurnHandlesRef.current;
    return () => {
      handles.forEach((handle, sessionId) => {
        void handle.stop();
        appendEvent(sessionId, {
          id: crypto.randomUUID(),
          type: "error",
          sessionId,
          message: "面板已关闭，进行中的引擎回合已中止",
          createdAt: Date.now(),
        });
        useAgentStore.getState().setSessionStatus(sessionId, "failed");
      });
      handles.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) || null,
    [activeSessionId, sessions]
  );
  const activeBrandKit = useMemo(
    () => brandKits.find((brandKit) => brandKit.id === activeBrandKitId) || null,
    [activeBrandKitId, brandKits]
  );
  const activePlan = activeSession ? getSessionDesignPlan(activeSession) : null;

  const selectedProviderConfig = providerConfigs[selectedProviderKind];
  // 本地 Provider 当前引擎模式（本地规则 / 真实模型工具循环 / Codex / Claude Code）
  const localEngineMode = getLocalEngineMode(providerConfigs.local);
  // 钉选中的技能（Skills 专家工作流）
  const pinnedSkill = useMemo(
    () => (pinnedSkillName ? agentSkills.find((skill) => skill.name === pinnedSkillName) || null : null),
    [agentSkills, pinnedSkillName]
  );

  const createSelectedProviderSession = async () => {
    if (selectedProviderKind === "muapi") {
      if (!isMuApiConfigured(providerConfigs.muapi)) {
        toast.error("请先配置 MuAPI Base URL 和 API Key");
        return null;
      }
      try {
        const provider = createMuApiAgentProvider(providerConfigs.muapi);
        const session = await provider.startSession("MuAPI 创作助手会话");
        upsertSession(session);
        toast.success("MuAPI 会话已创建");
        return session;
      } catch (error) {
        toast.error(`MuAPI 会话创建失败: ${error instanceof Error ? error.message : "未知错误"}`);
        return null;
      }
    }

    const sessionId = createSession("创作助手会话", "local");
    return useAgentStore.getState().sessions.find((session) => session.id === sessionId) || null;
  };

  const ensureSession = async () => {
    if (activeSession && activeSession.providerKind === selectedProviderKind) return activeSession;
    return createSelectedProviderSession();
  };

  useEffect(() => {
    setToolArgs(JSON.stringify(selectedTool.exampleArgs, null, 2));
  }, [selectedTool]);

  const handleSubmit = async () => {
    const content = input.trim();
    if (!content) return;
    const session = await ensureSession();
    if (!session) return;

    addMessage(session.id, "user", content);
    const pendingAsk =
      session.providerKind === "local" ? getPendingAskUser(session.id) : null;
    if (session.providerKind === "muapi") {
      // 钉选了技能时按 Skills 专家工作流走 runSkill 端点，而不是普通 chat
      const skill = pinnedSkill && pinnedSkill.enabled ? pinnedSkill : null;
      if (skill) {
        await sendMuApiSkillRun(session, skill, content);
      } else {
        await sendMuApiContent(session, content);
      }
    } else if (localEngineMode === "codex" || localEngineMode === "claude-code") {
      await runEngineTurn(session, content, localEngineMode);
    } else if (pendingAsk) {
      const modelConfig = resolveAgentModelConfig(providerConfigs.local);
      if (!modelConfig) {
        toast.error("模型工具调用未启用，无法继续回答");
        return;
      }
      const result = await answerAgentAskUser(session.id, content, modelConfig);
      if (!result.ok) toast.error(result.error || "模型继续执行失败");
    } else if (isToolCallInput(content)) {
      const result = await runCanvasAgentInput(session.id, content);
      if (!result.ok) toast.error(result.error || "工具调用失败");
    } else {
      const modelConfig = resolveAgentModelConfig(providerConfigs.local);
      if (modelConfig) {
        const result = await runAgentToolLoop(session.id, content, modelConfig);
        if (result.ok) {
          if (result.awaitingApproval) toast.info("模型发起的写操作已进入审批队列");
          if (result.awaitingUserInput) toast.info("模型在等待你的回答");
        } else {
          toast.error(result.error || "模型工具调用失败");
        }
      } else {
        createLocalDesignPlan(session.id, content);
      }
    }
    setInput("");
  };

  const handleRunTool = async () => {
    const session = await ensureSession();
    if (!session) return;
    try {
      const parsedArgs = JSON.parse(toolArgs || "{}") as unknown;
      if (!parsedArgs || typeof parsedArgs !== "object" || Array.isArray(parsedArgs)) {
        toast.error("工具参数必须是 JSON 对象");
        return;
      }
      const result = await runCanvasAgentTool(session.id, toolName, parsedArgs as Record<string, unknown>);
      if (!result.ok) {
        toast.error(result.error || "工具调用失败");
      } else if (result.pendingApproval) {
        toast.info("写操作已进入审批队列");
      } else {
        toast.success("工具调用完成");
      }
    } catch (error) {
      toast.error(`JSON 解析失败: ${error instanceof Error ? error.message : "未知错误"}`);
    }
  };

  const handleApprove = async () => {
    if (!activeSession) return;
    if (activeSession.providerKind === "muapi" && !activeSession.pendingOps?.length) {
      await approveRemoteJob(activeSession);
      return;
    }
    const ops = activeSession.pendingOps || [];
    const result = await approveAndExecuteAgentOps(activeSession.id);
    if (result.ok) {
      if (activePlan?.status === "awaiting_approval") {
        updateActivePlan(activeSession.id, updateDesignPlan(activePlan, { status: "completed" }));
      }
      toast.success(ops.length > 0 ? `已执行 ${summarizeAgentOps(ops)}` : "没有待执行操作");

      const modelConfig = resolveAgentModelConfig(providerConfigs.local);
      if (modelConfig && hasActiveToolLoop(activeSession.id)) {
        const resume = await resumeAgentToolLoopAfterApproval(activeSession.id, modelConfig, {
          summary: summarizeAgentOps(ops),
          execution: result.result,
        });
        if (!resume.ok) toast.error(resume.error || "模型继续执行失败");
      }
    } else {
      toast.error(result.error || "执行失败");
    }
  };

  const handleReject = () => {
    if (!activeSession) return;
    if (activeSession.providerKind === "muapi" && !activeSession.pendingOps?.length) {
      void rejectRemoteJob(activeSession);
      return;
    }
    rejectPendingOps(activeSession.id);
    toast.info("已拒绝本次 Agent 写操作");
  };

  const handleCancel = () => {
    if (!activeSession) return;
    if (activeSession.providerKind === "muapi") {
      void cancelRemoteJob(activeSession);
      return;
    }
    // 双引擎回合进行中：先 kill 引擎子进程再取消本地会话
    const engineHandle = engineTurnHandlesRef.current.get(activeSession.id);
    if (engineHandle) {
      engineTurnHandlesRef.current.delete(activeSession.id);
      void engineHandle.stop();
    }
    cancelSession(activeSession.id);
    toast.info("Agent 会话已取消");
  };

  const startRenameSession = (sessionId: string, currentTitle: string) => {
    setRenamingSessionId(sessionId);
    setRenameDraft(currentTitle);
  };

  const commitRenameSession = (sessionId: string) => {
    if (renamingSessionId !== sessionId) return;
    renameSession(sessionId, renameDraft);
    setRenamingSessionId(null);
  };

  const syncRemoteSessionEvents = async (session: AgentSession, silent = false) => {
    return syncMuApiSessionEvents(session.id, providerConfigs.muapi, { silent });
  };

  const muApiConfigured = isMuApiConfigured(providerConfigs.muapi);
  // 标量化配置值：供 Skills 拉取 effect 作为依赖，避免 providerConfigs 引用抖动触发请求风暴
  const muApiBaseUrl = providerConfigs.muapi.baseUrl || "";
  const muApiKey = providerConfigs.muapi.apiKey || "";
  const activeSessionIsMuApi = activeSession?.providerKind === "muapi";
  const activeSessionJobPending = Boolean(
    activeSession && activeSessionIsMuApi && shouldPollMuApiSessionJob(activeSession)
  );

  // MuAPI 任务持续轮询：激活的 muapi 会话挂着未完成远端 job 时，约 2 秒周期轮询
  // 增量事件与 job 状态直到终态（done/error/cancelled）；切换会话或卸载时清理定时器。
  useEffect(() => {
    const sessionId = activeSession?.id;
    if (!sessionId || !activeSessionIsMuApi || !muApiConfigured || !activeSessionJobPending) return;

    const polling = startMuApiJobPolling(sessionId, providerConfigs.muapi);
    return () => polling.stop();
    // providerConfigs.muapi 来自 zustand selector，配置变更产生新引用时重启循环以使用新配置；
    // activeSessionJobPending 收敛为 false（终态/停滞）时触发清理并停止轮询。
  }, [activeSession?.id, activeSessionIsMuApi, activeSessionJobPending, muApiConfigured, providerConfigs.muapi]);

  // 刷新/重启恢复：应用加载或切回 muapi 会话时，向服务端查询该会话
  // pending/processing 的任务并恢复续听，不再只依赖本地持久化的 metadata.remoteJobId。
  const recoveredSessionIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const sessionId = activeSession?.id;
    if (!sessionId || !activeSessionIsMuApi || !_hasHydrated || !muApiConfigured) return;
    const remoteSessionId = activeSession ? getRemoteSessionId(activeSession) : "";
    if (!remoteSessionId) return;
    if (recoveredSessionIdsRef.current.has(sessionId)) return;
    recoveredSessionIdsRef.current.add(sessionId);
    void recoverMuApiSessionJobs(sessionId, remoteSessionId, providerConfigs.muapi);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSession?.id, activeSessionIsMuApi, _hasHydrated, muApiConfigured]);

  // Skills 专家工作流：muapi 已配置且当前面向 muapi 时拉取技能列表，供输入区上方钉选。
  // 依赖收敛为 baseUrl/apiKey 标量：配置表单每个按键都会产生新 providerConfigs 引用，
  // 若依赖整个对象会引发 listAgentSkills 请求风暴。
  useEffect(() => {
    if (!muApiConfigured || (selectedProviderKind !== "muapi" && !activeSessionIsMuApi)) return;
    let cancelled = false;
    setSkillsLoading(true);
    const client = createMuApiClient({
      kind: "muapi",
      enabled: true,
      name: "MuAPI Provider",
      baseUrl: muApiBaseUrl || undefined,
      apiKey: muApiKey || undefined,
    });
    client
      .listAgentSkills()
      .then((raw) => {
        if (!cancelled) setAgentSkills(normalizeAgentSkills(raw));
      })
      .catch(() => {
        // 技能拉取失败静默降级：不展示 chips，也不打断普通 chat 流程
        if (!cancelled) setAgentSkills([]);
      })
      .finally(() => {
        if (!cancelled) setSkillsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionIsMuApi, muApiBaseUrl, muApiKey, muApiConfigured, selectedProviderKind]);

  // 会话快照回写服务端：muapi 会话任务到达终态后调用 updateSession（PATCH）回写消息快照；
  // 失败静默记入事件流，不打断 UI，也不重复重试。
  useEffect(() => {
    const session = activeSession;
    if (!session || !activeSessionIsMuApi || !muApiConfigured) return;
    if (!isMuApiSessionJobSettled(session)) return;
    const remoteSessionId = getRemoteSessionId(session);
    if (!remoteSessionId) return;
    if (session.metadata?.snapshotSyncedAt) return;
    if (snapshotSyncAttemptedRef.current.has(session.id)) return;
    snapshotSyncAttemptedRef.current.add(session.id);
    void syncSessionSnapshotToServer(session.id, remoteSessionId);
    // providerConfigs.muapi 变化产生新引用时重新评估回写条件
  }, [activeSession, activeSessionIsMuApi, muApiConfigured, providerConfigs.muapi]);

  // 双引擎回合：经 spawn_agent_process 启动 CLI 子进程，按行解析引擎输出映射为 Agent 事件。
  const runEngineTurn = async (session: AgentSession, prompt: string, engine: AgentEngineId) => {
    const config = providerConfigs.local;
    const fallbackCwd = typeof config.metadata?.engineCwd === "string" ? config.metadata.engineCwd : "";
    // 同一会话已有回合进行中：拒绝重复提交，避免覆盖旧 handle 导致旧子进程无法从 UI 停止
    if (engineTurnHandlesRef.current.has(session.id)) {
      toast.warning("当前会话已有引擎回合进行中，请等待完成或先取消");
      return;
    }
    try {
      const cwd = await resolveAgentEngineCwd(session, fallbackCwd);
      if (!cwd) {
        toast.error("无法确定引擎工作目录，请先在 Local Provider 设置中填写");
        return;
      }
      setSessionStatus(session.id, "running");
      const handle = await startAgentEngineTurn({
        engine,
        prompt,
        cwd,
        executablePath: getEngineExecutablePath(config, engine),
        engineSessionId: getEngineSessionId(session),
        model: config.model,
        onEvent: (parsed) => applyEngineParsedEvent(session.id, parsed),
      });
      engineTurnHandlesRef.current.set(session.id, handle);
      // 线程绑定工作目录与引擎会话 id（供恢复列出并续聊）
      updateSessionMetadata(session.id, { engine, engineCwd: cwd, engineProcessId: handle.processId });
      toast.info(`${engine === "codex" ? "Codex" : "Claude Code"} 引擎已启动`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      appendEvent(session.id, {
        id: crypto.randomUUID(),
        type: "error",
        sessionId: session.id,
        message: `引擎启动失败: ${message}`,
        createdAt: Date.now(),
      });
      setSessionStatus(session.id, "failed");
      toast.error(`引擎启动失败: ${message}`);
    }
  };

  const applyEngineParsedEvent = (sessionId: string, parsed: AgentEngineParsedEvent) => {
    switch (parsed.kind) {
      case "engine_session":
        updateSessionMetadata(sessionId, { engineSessionId: parsed.engineSessionId });
        return;
      case "text":
        appendEvent(sessionId, {
          id: crypto.randomUUID(),
          type: "text",
          sessionId,
          content: parsed.content,
          createdAt: Date.now(),
        });
        return;
      case "tool_call":
        appendEvent(sessionId, {
          id: crypto.randomUUID(),
          type: "tool_call",
          sessionId,
          toolName: parsed.toolName,
          args: parsed.args,
          write: true,
          createdAt: Date.now(),
        });
        return;
      case "tool_result":
        appendEvent(sessionId, {
          id: crypto.randomUUID(),
          type: "tool_result",
          sessionId,
          toolName: parsed.toolName,
          ok: parsed.ok,
          result: parsed.result,
          error: parsed.error,
          createdAt: Date.now(),
        });
        return;
      case "error":
        appendEvent(sessionId, {
          id: crypto.randomUUID(),
          type: "error",
          sessionId,
          message: parsed.message,
          createdAt: Date.now(),
        });
        setSessionStatus(sessionId, "failed");
        return;
      case "raw":
        appendEvent(sessionId, {
          id: crypto.randomUUID(),
          type: "text",
          sessionId,
          content: parsed.content,
          createdAt: Date.now(),
        });
        return;
      case "done":
        setSessionStatus(sessionId, "completed");
        engineTurnHandlesRef.current.get(sessionId)?.stop().then(() => {
          engineTurnHandlesRef.current.delete(sessionId);
        });
        return;
    }
  };

  // Skills 专家工作流：钉选技能后一句话发起，自动映射必填输入并切换 runSkill 端点。
  const sendMuApiSkillRun = async (session: AgentSession, skill: AgentSkillSummary, content: string) => {
    if (!isMuApiConfigured(providerConfigs.muapi)) {
      toast.error("MuAPI 未配置，已保留本地会话消息");
      return;
    }

    setSessionStatus(session.id, "running");
    try {
      const client = createMuApiClient(providerConfigs.muapi);
      const freshSession = useAgentStore.getState().sessions.find((item) => item.id === session.id) || session;
      const remoteSessionId =
        getRemoteSessionId(freshSession) || (await client.createSession({ name: freshSession.title })).id;
      const assignment = mapSkillInputs(skill, content);
      if (assignment.unfilled.length > 0) {
        toast.warning(`技能「${skill.title}」缺少必填输入：${assignment.unfilled.join("、")}，已留空提交`);
      }
      const response = await client.runSkill(remoteSessionId, {
        skill_name: skill.name,
        inputs: assignment.inputs,
        messages_snapshot: freshSession.messages.map((message) => ({
          role: message.role,
          content: message.content,
          timestamp: new Date(message.createdAt).toISOString(),
        })),
        model: providerConfigs.muapi.model || "gpt-4o",
      });
      const remoteJobId = extractRemoteJobId(response);
      const events = mapMuApiEvents(response, session.id, remoteJobId);
      updateSessionMetadata(session.id, {
        remoteSessionId,
        ...(remoteJobId ? { remoteJobId } : {}),
        lastMuApiResponse: response,
      });
      events.forEach((event) => appendEvent(session.id, event));
      setSessionStatus(
        session.id,
        events.some((event) => event.type === "approval_required") ? "awaiting_approval" : "idle"
      );
      toast.success(`技能「${skill.title}」已提交`);
    } catch (error) {
      appendEvent(session.id, {
        id: crypto.randomUUID(),
        type: "error",
        sessionId: session.id,
        message: error instanceof Error ? error.message : "MuAPI runSkill 请求失败",
        createdAt: Date.now(),
      });
      setSessionStatus(session.id, "failed");
      toast.error(`技能执行失败: ${error instanceof Error ? error.message : "未知错误"}`);
    }
  };

  const syncSessionSnapshotToServer = async (sessionId: string, remoteSessionId: string) => {
    const session = useAgentStore.getState().sessions.find((item) => item.id === sessionId);
    if (!session) return;
    try {
      await createMuApiClient(providerConfigs.muapi).updateSession(
        remoteSessionId,
        buildMuApiSessionSnapshotPayload(session)
      );
      updateSessionMetadata(sessionId, { snapshotSyncedAt: Date.now(), snapshotSyncError: null });
    } catch (error) {
      // 失败静默记入事件流，不打断 UI
      const message = error instanceof Error ? error.message : "未知错误";
      updateSessionMetadata(sessionId, { snapshotSyncError: message });
      appendEvent(sessionId, {
        id: crypto.randomUUID(),
        type: "tool_result",
        sessionId,
        toolName: "muapi.snapshotSync",
        ok: false,
        error: message,
        createdAt: Date.now(),
      });
    }
  };

  const sendMuApiContent = async (session: AgentSession, content: string) => {
    if (!isMuApiConfigured(providerConfigs.muapi)) {
      toast.error("MuAPI 未配置，已保留本地会话消息");
      return;
    }

    setSessionStatus(session.id, "running");
    try {
      const freshSession = useAgentStore.getState().sessions.find((item) => item.id === session.id) || session;
      const result = await sendMuApiMessage(providerConfigs.muapi, freshSession, content);
      updateSessionMetadata(session.id, {
        remoteSessionId: result.remoteSessionId,
        remoteJobId: result.remoteJobId,
        lastMuApiResponse: result.raw,
        ...(result.pollState ? { eventPoll: result.pollState } : {}),
      });
      result.events.forEach((event) => appendEvent(session.id, event));
      setSessionStatus(
        session.id,
        result.events.some((event) => event.type === "approval_required") ? "awaiting_approval" : "idle"
      );
      toast.success("MuAPI 事件已同步");
    } catch (error) {
      appendEvent(session.id, {
        id: crypto.randomUUID(),
        type: "error",
        sessionId: session.id,
        message: error instanceof Error ? error.message : "MuAPI 请求失败",
        createdAt: Date.now(),
      });
      setSessionStatus(session.id, "failed");
      toast.error(`MuAPI 请求失败: ${error instanceof Error ? error.message : "未知错误"}`);
    }
  };

  const handleVerifyMuApi = async () => {
    setMuApiVerifying(true);
    try {
      const result = await verifyMuApiConnection(providerConfigs.muapi, {
        chatProbe: muApiChatProbe,
        requireChat: muApiRequireChat,
      });
      setMuApiVerificationResult(result);
      const sessionId =
        activeSession?.providerKind === "muapi"
          ? activeSession.id
          : createSession("MuAPI 真实服务验证", "muapi");
      updateSessionMetadata(sessionId, {
        muApiVerification: result,
        remoteSessionId: result.remoteSessionId,
        remoteJobId: result.remoteJobId,
      });
      appendEvent(sessionId, {
        id: crypto.randomUUID(),
        type: "tool_result",
        sessionId,
        toolName: "muapi.verify",
        ok: result.ok,
        result,
        error: result.ok ? undefined : result.steps.find((step) => step.status === "failed")?.error,
        createdAt: Date.now(),
      });
      setSessionStatus(sessionId, result.ok ? "idle" : "failed");
      toast[result.ok ? "success" : "error"](result.ok ? "MuAPI 真实服务验证通过" : "MuAPI 真实服务验证失败");
    } catch (error) {
      toast.error(`MuAPI 验证失败: ${error instanceof Error ? error.message : "未知错误"}`);
    } finally {
      setMuApiVerifying(false);
    }
  };

  const createLocalDesignPlan = (sessionId: string, brief: string) => {
    const plan = createDesignPlanFromBrief(brief, {
      brandKit: activeBrandKit,
      assetLabels: assetLabelMap(creativeAssets),
    });
    updateActivePlan(sessionId, plan);
    appendEvent(sessionId, {
      id: crypto.randomUUID(),
      type: "plan_propose",
      sessionId,
      plan,
      createdAt: Date.now(),
    });
    setSessionStatus(sessionId, "idle");
    toast.success("设计计划已生成");
  };

  const updateActivePlan = (sessionId: string, plan: DesignPlan) => {
    updateSessionMetadata(sessionId, { activePlan: plan });
  };

  const submitPlanForApproval = (plan: DesignPlan) => {
    if (!activeSession) return;
    const errors = validateDesignPlanTopology(plan);
    if (errors.length > 0) {
      toast.error(errors.join("；"));
      return;
    }

    try {
      const ops = designPlanToCanvasAgentOps(plan);
      const nextPlan = updateDesignPlan(plan, { status: "awaiting_approval" });
      updateActivePlan(activeSession.id, nextPlan);
      const approval = requestApproval(activeSession.id, "执行设计计划", ops);
      if (!approval.ok) {
        toast.error(approval.errors.join("；"));
      } else {
        toast.info("设计计划已进入审批队列");
      }
    } catch (error) {
      toast.error(`计划转换失败: ${error instanceof Error ? error.message : "未知错误"}`);
    }
  };

  const approveRemoteJob = async (session: AgentSession) => {
    const jobId = getRemoteJobId(session);
    if (!jobId) {
      toast.warning("当前 MuAPI 会话没有待审批 jobId");
      return;
    }
    try {
      const result = await approveMuApiJob(providerConfigs.muapi, jobId);
      appendEvent(session.id, {
        id: crypto.randomUUID(),
        type: "tool_result",
        sessionId: session.id,
        toolName: "muapi.approve",
        ok: true,
        result,
        createdAt: Date.now(),
      });
      setSessionStatus(session.id, "idle");
      toast.success("MuAPI Job 已批准");
    } catch (error) {
      toast.error(`MuAPI 批准失败: ${error instanceof Error ? error.message : "未知错误"}`);
    }
  };

  const rejectRemoteJob = async (session: AgentSession) => {
    const jobId = getRemoteJobId(session);
    if (!jobId) {
      toast.warning("当前 MuAPI 会话没有待拒绝 jobId");
      return;
    }
    try {
      const result = await rejectMuApiJob(providerConfigs.muapi, jobId, "用户在 NextLemon 中拒绝");
      appendEvent(session.id, {
        id: crypto.randomUUID(),
        type: "tool_result",
        sessionId: session.id,
        toolName: "muapi.reject",
        ok: true,
        result,
        createdAt: Date.now(),
      });
      setSessionStatus(session.id, "idle");
      toast.info("MuAPI Job 已拒绝");
    } catch (error) {
      toast.error(`MuAPI 拒绝失败: ${error instanceof Error ? error.message : "未知错误"}`);
    }
  };

  const cancelRemoteJob = async (session: AgentSession) => {
    const jobId = getRemoteJobId(session);
    if (!jobId) {
      cancelSession(session.id);
      toast.info("MuAPI 会话已本地取消");
      return;
    }
    try {
      const result = await cancelMuApiJob(providerConfigs.muapi, jobId);
      appendEvent(session.id, {
        id: crypto.randomUUID(),
        type: "tool_result",
        sessionId: session.id,
        toolName: "muapi.cancel",
        ok: true,
        result,
        createdAt: Date.now(),
      });
      cancelSession(session.id);
      toast.info("MuAPI Job 已取消");
    } catch (error) {
      toast.error(`MuAPI 取消失败: ${error instanceof Error ? error.message : "未知错误"}`);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-base-300/60 p-3">
        <div className="grid grid-cols-2 gap-2">
          {(["local", "muapi"] as AgentProviderKind[]).map((kind) => (
            <button
              key={kind}
              className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                selectedProviderKind === kind
                  ? "border-primary/30 bg-primary/5"
                  : "border-base-300 bg-base-100 text-base-content/55"
              }`}
              onClick={() => {
                setSelectedProviderKind(kind);
                if (!providerConfigs[kind].enabled) setProviderConfig(kind, { enabled: true });
              }}
            >
              <div className="flex items-center gap-2 text-xs font-semibold">
                <Circle className={`h-2.5 w-2.5 ${providerConfigs[kind].enabled ? "fill-success text-success" : "text-base-content/30"}`} />
                {providerConfigs[kind].name}
              </div>
              <div className="mt-1 text-[11px] text-base-content/45">
                {kind === "local" ? "默认" : "可选"}
              </div>
            </button>
          ))}
        </div>

        {selectedProviderKind === "muapi" && (
          <MuApiConfigForm
            config={selectedProviderConfig}
            onChange={(patch) => setProviderConfig("muapi", patch)}
            chatProbe={muApiChatProbe}
            onChangeChatProbe={setMuApiChatProbe}
            requireChat={muApiRequireChat}
            onChangeRequireChat={setMuApiRequireChat}
            verificationResult={muApiVerificationResult}
            verifying={muApiVerifying}
            onVerify={() => void handleVerifyMuApi()}
          />
        )}
        {selectedProviderKind === "local" && (
          <LocalEngineForm
            config={selectedProviderConfig}
            onChange={(patch) => setProviderConfig("local", patch)}
          />
        )}

        <div className="mt-3 flex items-center gap-2">
          <button className="btn btn-primary btn-sm flex-1 gap-2" onClick={() => void createSelectedProviderSession()}>
            <Bot className="h-4 w-4" />
            {selectedProviderKind === "muapi" ? "MuAPI 会话" : "新会话"}
          </button>
          {activeSession && (
            <button className="btn btn-ghost btn-sm btn-circle" title="删除会话" onClick={() => clearSession(activeSession.id)}>
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {sessions.length > 0 && (
        <div className="flex gap-2 overflow-x-auto border-b border-base-300/60 p-3">
          {sessions.map((session) => {
            if (renamingSessionId === session.id) {
              return (
                <input
                  key={session.id}
                  className="input input-bordered input-xs w-36 rounded-full"
                  autoFocus
                  value={renameDraft}
                  aria-label="会话名称"
                  onChange={(event) => setRenameDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") commitRenameSession(session.id);
                    if (event.key === "Escape") setRenamingSessionId(null);
                  }}
                  onBlur={() => commitRenameSession(session.id)}
                />
              );
            }
            return (
              <button
                key={session.id}
                className={`btn btn-xs rounded-full ${activeSessionId === session.id ? "btn-primary" : "btn-ghost"}`}
                title={`${session.title}（双击重命名）`}
                onClick={() => setActiveSession(session.id)}
                onDoubleClick={() => startRenameSession(session.id, session.title)}
              >
                <span className="max-w-40 truncate">{session.title}</span>
                {activeSessionId === session.id && (
                  <Pencil
                    className="h-3 w-3 opacity-60"
                    onClick={(event) => {
                      event.stopPropagation();
                      startRenameSession(session.id, session.title);
                    }}
                  />
                )}
              </button>
            );
          })}
        </div>
      )}

      <LocalAgentBridgePanel />

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {!activeSession ? (
          <div className="flex h-44 flex-col items-center justify-center rounded-lg border border-dashed border-base-300 text-center text-sm text-base-content/45">
            <Bot className="mb-2 h-5 w-5" />
            创建一个 Agent 会话
          </div>
        ) : (
          <div className="space-y-3">
            <SessionStatus session={activeSession} />
            {activePlan && (
              <DesignPlanCard
                plan={activePlan}
                onChange={(plan) => updateActivePlan(activeSession.id, plan)}
                onSubmit={() => submitPlanForApproval(activePlan)}
              />
            )}
            {activeSession.providerKind === "muapi" && getRemoteJobId(activeSession) && (
              <RemoteJobCard
                jobId={getRemoteJobId(activeSession)}
                jobStatus={getRemoteJobStatus(activeSession)}
                settled={isMuApiSessionJobSettled(activeSession)}
                onApprove={handleApprove}
                onReject={handleReject}
                onCancel={handleCancel}
                onSync={() => void syncRemoteSessionEvents(activeSession)}
              />
            )}
            {activeSession.providerKind === "local" &&
              (() => {
                const pendingAsk = getPendingAskUser(activeSession.id);
                return pendingAsk ? (
                  <AskUserCard
                    question={pendingAsk.question}
                    options={pendingAsk.options}
                    onAnswer={(answer) => {
                      const modelConfig = resolveAgentModelConfig(providerConfigs.local);
                      if (!modelConfig) {
                        toast.error("模型工具调用未启用，无法继续回答");
                        return;
                      }
                      addMessage(activeSession.id, "user", answer);
                      void answerAgentAskUser(activeSession.id, answer, modelConfig).then((result) => {
                        if (!result.ok) toast.error(result.error || "模型继续执行失败");
                      });
                    }}
                  />
                ) : null;
              })()}
            {activeSession.pendingOps && activeSession.pendingOps.length > 0 && (
              <ApprovalCard
                ops={activeSession.pendingOps}
                audit={getLatestApprovalAudit(activeSession)}
                onApprove={handleApprove}
                onReject={handleReject}
                onCancel={handleCancel}
              />
            )}
            {rollbackHistory.length > 0 && rollbackHistory[rollbackHistory.length - 1] && (
              <RollbackCard
                summary={rollbackHistory[rollbackHistory.length - 1].opSummary}
                executedAt={rollbackHistory[rollbackHistory.length - 1].createdAt}
                historyCount={rollbackHistory.length}
                onRollback={() => {
                  if (!activeSession) return;
                  const result = rollbackLastAgentExecution(activeSession.id);
                  if (result.ok) {
                    toast.success("已回滚最近一次 Agent 执行");
                  } else {
                    toast.error(result.error || "回滚失败");
                  }
                }}
              />
            )}
            <SessionTimeline session={activeSession} />
          </div>
        )}
      </div>

      <div className="border-t border-base-300/60 p-3">
        <div className="mb-3 rounded-lg border border-base-300 bg-base-100 p-2">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-base-content/55">
            <Wrench className="h-3.5 w-3.5" />
            工具
          </div>
          <div className="flex gap-2">
            <select
              className="select select-bordered select-xs min-w-0 flex-1"
              value={toolName}
              onChange={(event) => setToolName(event.target.value as CanvasAgentToolName)}
            >
              {CANVAS_AGENT_TOOLS.map((tool) => (
                <option key={tool.name} value={tool.name}>
                  {tool.label}
                </option>
              ))}
            </select>
            <button className="btn btn-secondary btn-xs" onClick={() => void handleRunTool()}>
              运行
            </button>
          </div>
          <textarea
            className="textarea textarea-bordered mt-2 h-24 min-h-24 w-full resize-none font-mono text-[11px]"
            value={toolArgs}
            onChange={(event) => setToolArgs(event.target.value)}
          />
        </div>
        {muApiConfigured && (agentSkills.length > 0 || skillsLoading) && (
          <div className="mb-2 flex flex-wrap items-center gap-1">
            <span className="flex items-center gap-1 text-[11px] font-semibold text-base-content/45">
              <Sparkles className="h-3.5 w-3.5" />
              Skills
            </span>
            {skillsLoading && <span className="text-[11px] text-base-content/40">加载中…</span>}
            {agentSkills.map((skill) => {
              const pinned = pinnedSkillName === skill.name;
              return (
                <button
                  key={skill.name}
                  className={`btn btn-xs gap-1 rounded-full ${pinned ? "btn-secondary" : "btn-ghost border border-base-300"}`}
                  title={skill.description || skill.name}
                  onClick={() => setPinnedSkillName(pinned ? null : skill.name)}
                >
                  <Pin className={`h-3 w-3 ${pinned ? "fill-current" : "opacity-40"}`} />
                  <span className="max-w-32 truncate">{skill.title}</span>
                </button>
              );
            })}
          </div>
        )}
        <div className="flex gap-2">
          <textarea
            className="textarea textarea-bordered min-h-16 flex-1 resize-none text-sm"
            placeholder={
              pinnedSkill
                ? `一句话发起技能「${pinnedSkill.title}」，必填输入将自动映射…`
                : "输入 brief 生成设计计划，或输入工具 JSON..."
            }
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void handleSubmit();
              }
            }}
          />
          <button className="btn btn-primary self-stretch" title="发送" onClick={() => void handleSubmit()}>
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// Local Provider 引擎配置：本地规则 / 真实模型工具循环 / Codex CLI / Claude Code CLI。
function LocalEngineForm({
  config,
  onChange,
}: {
  config: AgentProviderConfig;
  onChange: (patch: Partial<AgentProviderConfig>) => void;
}) {
  const engineMode = getLocalEngineMode(config);
  const modes: Array<{ value: LocalAgentEngineMode; label: string }> = [
    { value: "rules", label: "本地规则" },
    { value: "model-loop", label: "真实模型工具循环" },
    { value: "codex", label: "Codex CLI" },
    { value: "claude-code", label: "Claude Code CLI" },
  ];
  const engineHints: Record<LocalAgentEngineMode, string> = {
    rules: "本地规则路由：自然语言 brief 生成设计计划，工具走手工 JSON 调用，不依赖外部模型。",
    "model-loop":
      "自然语言通过 LLM function calling 循环驱动受控工具（OpenAI 兼容协议，默认走 Lemon API）；写操作仍需审批，校验失败原因会回传给模型自我修正。",
    codex: "经本地 Codex CLI（codex exec --json）驱动真实模型工具循环，引擎输出按行解析为事件；会话线程绑定工作目录。",
    "claude-code":
      "经本地 Claude Code CLI（--output-format stream-json）驱动真实模型工具循环，引擎输出按行解析为事件；会话线程绑定工作目录。",
  };
  const engineId: AgentEngineId | null = engineMode === "codex" ? "codex" : engineMode === "claude-code" ? "claude-code" : null;

  const changeEngine = (mode: LocalAgentEngineMode) => {
    // 同步写入 modelToolLoop，保持旧数据向后兼容
    onChange({
      metadata: { ...config.metadata, engine: mode, modelToolLoop: mode === "model-loop" },
    });
  };

  return (
    <div className="mt-3 rounded-lg border border-base-300 bg-base-100 p-3">
      <div className="mb-2 text-xs font-semibold">引擎</div>
      <div className="grid grid-cols-2 gap-1">
        {modes.map((mode) => (
          <button
            key={mode.value}
            className={`rounded-md border px-2 py-1.5 text-left text-[11px] font-medium transition-colors ${
              engineMode === mode.value
                ? "border-primary/30 bg-primary/5 text-primary"
                : "border-base-300 text-base-content/55"
            }`}
            onClick={() => changeEngine(mode.value)}
          >
            {mode.label}
          </button>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-base-content/45">{engineHints[engineMode]}</p>

      {engineMode === "model-loop" && (
        <div className="mt-2 space-y-2">
          <input
            className="input input-bordered input-xs w-full"
            placeholder="模型名（默认 gpt-4o-mini）"
            value={config.model || ""}
            onChange={(event) => onChange({ model: event.target.value })}
          />
          <input
            className="input input-bordered input-xs w-full"
            placeholder="Base URL（默认 Lemon API）"
            value={config.baseUrl || ""}
            onChange={(event) => onChange({ baseUrl: event.target.value })}
          />
          <input
            className="input input-bordered input-xs w-full"
            type="password"
            placeholder="API Key（默认 Lemon API）"
            value={config.apiKey || ""}
            onChange={(event) => onChange({ apiKey: event.target.value })}
          />
          <SessionOnlyKeyToggle config={config} onChange={onChange} />
        </div>
      )}

      {engineId && (
        <div className="mt-2 space-y-2">
          <input
            className="input input-bordered input-xs w-full"
            placeholder={
              engineId === "codex"
                ? "Codex 可执行文件路径（默认 PATH 上的 codex）"
                : "Claude Code 可执行文件路径（默认 PATH 上的 claude）"
            }
            value={getEngineExecutablePath(config, engineId)}
            onChange={(event) =>
              onChange({
                metadata: {
                  ...config.metadata,
                  [engineId === "codex" ? "codexPath" : "claudeCodePath"]: event.target.value,
                },
              })
            }
          />
          <p className="text-[11px] text-base-content/40">
            Windows 提示：npm 全局安装的启动 shim 是 .cmd，建议填写完整可执行文件路径（如 …\codex.cmd）。
          </p>
          <input
            className="input input-bordered input-xs w-full"
            placeholder="引擎工作目录（默认用户主目录；会话首次运行后绑定）"
            value={typeof config.metadata?.engineCwd === "string" ? config.metadata.engineCwd : ""}
            onChange={(event) =>
              onChange({ metadata: { ...config.metadata, engineCwd: event.target.value } })
            }
          />
          <input
            className="input input-bordered input-xs w-full"
            placeholder="模型名（可选，经 --model 透传）"
            value={config.model || ""}
            onChange={(event) => onChange({ model: event.target.value })}
          />
        </div>
      )}
    </div>
  );
}

// 「仅本会话保存」：勾选后 apiKey 不进 agentStore partialize 持久化（内存保留，刷新即清）。
function SessionOnlyKeyToggle({
  config,
  onChange,
}: {
  config: AgentProviderConfig;
  onChange: (patch: Partial<AgentProviderConfig>) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-2 rounded-md border border-base-300 px-2 py-1.5 text-[11px]">
      <span>
        仅本会话保存 API Key
        <span className="ml-1 text-base-content/40">不写入本地存储，刷新即清</span>
      </span>
      <input
        type="checkbox"
        className="toggle toggle-xs"
        checked={config.metadata?.sessionOnlyApiKey === true}
        onChange={(event) =>
          onChange({
            metadata: { ...config.metadata, sessionOnlyApiKey: event.target.checked },
          })
        }
      />
    </label>
  );
}

function SessionStatus({ session }: { session: AgentSession }) {
  const statusLabel: Record<AgentSession["status"], string> = {
    idle: "空闲",
    running: "运行中",
    awaiting_approval: "待审批",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
  };

  return (
    <div className="rounded-lg border border-base-300 bg-base-100 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{session.title}</div>
          <div className="mt-1 text-xs text-base-content/45">
            {session.providerKind} · {new Date(session.updatedAt).toLocaleString()}
          </div>
        </div>
        <span className="badge badge-sm badge-outline">{statusLabel[session.status]}</span>
      </div>
    </div>
  );
}

function DesignPlanCard({
  plan,
  onChange,
  onSubmit,
}: {
  plan: DesignPlan;
  onChange: (plan: DesignPlan) => void;
  onSubmit: () => void;
}) {
  const errors = validateDesignPlanTopology(plan);

  return (
    <div className="rounded-lg border border-primary/25 bg-primary/5 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <input
            className="input input-bordered input-sm w-full bg-base-100 text-sm font-semibold"
            value={plan.title}
            onChange={(event) => onChange(updateDesignPlan(plan, { title: event.target.value }))}
          />
          <textarea
            className="textarea textarea-bordered mt-2 min-h-20 w-full resize-none bg-base-100 text-xs"
            value={plan.brief}
            onChange={(event) => onChange(updateDesignPlan(plan, { brief: event.target.value }))}
          />
        </div>
        <span className="badge badge-sm badge-primary badge-outline flex-shrink-0">{plan.status}</span>
      </div>

      {errors.length > 0 && (
        <div className="mt-2 rounded-md bg-error/10 p-2 text-xs text-error">
          {errors.join("；")}
        </div>
      )}

      <DesignPlanDagView plan={plan} />

      <div className="mt-3 space-y-2">
        {plan.steps.map((step, index) => (
          <DesignPlanStepRow
            key={step.id}
            index={index}
            step={step}
            onChange={(patch) => onChange(updateDesignPlanStep(plan, step.id, patch))}
          />
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="text-[11px] text-base-content/45">
          {plan.steps.length} 个步骤 · {plan.steps.filter((step) => step.dependsOn.length > 0).length} 个依赖
        </div>
        <button className="btn btn-primary btn-xs" disabled={errors.length > 0} onClick={onSubmit}>
          提交审批
        </button>
      </div>
    </div>
  );
}

function DesignPlanStepRow({
  index,
  step,
  onChange,
}: {
  index: number;
  step: DesignPlanStep;
  onChange: (patch: Partial<DesignPlanStep>) => void;
}) {
  return (
    <div className="rounded-lg border border-base-300 bg-base-100 p-2">
      <div className="flex items-start gap-2">
        <div className="mt-1 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
          {index + 1}
        </div>
        <div className="min-w-0 flex-1">
          <input
            className="input input-bordered input-xs w-full font-medium"
            value={step.title}
            onChange={(event) => onChange({ title: event.target.value })}
          />
          <textarea
            className="textarea textarea-bordered mt-1 min-h-14 w-full resize-none text-xs"
            value={step.description || ""}
            onChange={(event) => onChange({ description: event.target.value })}
          />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <select
              className="select select-bordered select-xs"
              value={step.status}
              onChange={(event) => onChange({ status: event.target.value as DesignPlanStep["status"] })}
            >
              {(["pending", "approved", "running", "completed", "failed", "skipped"] as DesignPlanStep["status"][]).map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
            <input
              className="input input-bordered input-xs"
              value={step.modelHint || ""}
              placeholder="模型建议"
              onChange={(event) => onChange({ modelHint: event.target.value })}
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-1 text-[10px] text-base-content/50">
            <span className="badge badge-xs badge-outline">{step.outputKind}</span>
            <span className="badge badge-xs badge-outline">{step.tool}</span>
            {step.estimatedCost && (
              <span className="badge badge-xs badge-warning">成本 {step.estimatedCost}</span>
            )}
            {step.dependsOn.map((dep) => (
              <span key={dep} className="badge badge-xs bg-base-200">依赖 {dep}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function MuApiConfigForm({
  config,
  onChange,
  chatProbe,
  onChangeChatProbe,
  requireChat,
  onChangeRequireChat,
  verificationResult,
  verifying,
  onVerify,
}: {
  config: AgentProviderConfig;
  onChange: (patch: Partial<AgentProviderConfig>) => void;
  chatProbe: string;
  onChangeChatProbe: (value: string) => void;
  requireChat: boolean;
  onChangeRequireChat: (value: boolean) => void;
  verificationResult: MuApiVerificationResult | null;
  verifying: boolean;
  onVerify: () => void;
}) {
  return (
    <div className="mt-3 space-y-2 rounded-lg border border-base-300 bg-base-100 p-2">
      <label className="flex items-center gap-2">
        <Link2 className="h-3.5 w-3.5 text-base-content/40" />
        <input
          className="input input-bordered input-xs min-w-0 flex-1"
          placeholder="https://api.muapi.ai"
          value={config.baseUrl || ""}
          onChange={(event) => onChange({ baseUrl: event.target.value })}
        />
      </label>
      <label className="flex items-center gap-2">
        <KeyRound className="h-3.5 w-3.5 text-base-content/40" />
        <input
          className="input input-bordered input-xs min-w-0 flex-1"
          placeholder="MuAPI API Key"
          type="password"
          value={config.apiKey || ""}
          onChange={(event) => onChange({ apiKey: event.target.value })}
        />
      </label>
      <SessionOnlyKeyToggle config={config} onChange={onChange} />
      <input
        className="input input-bordered input-xs w-full"
        placeholder="模型，例如 gpt-4o"
        value={config.model || ""}
        onChange={(event) => onChange({ model: event.target.value })}
      />
      <textarea
        className="textarea textarea-bordered min-h-14 w-full resize-none text-xs"
        placeholder="可选 Chat 探针消息；留空则只验证余额、技能和会话创建"
        value={chatProbe}
        onChange={(event) => onChangeChatProbe(event.target.value)}
      />
      <label className="flex items-center justify-between gap-2 rounded-md border border-base-300 px-2 py-1.5 text-[11px]">
        <span>
          严格 chat 验收
          <span className="ml-1 text-base-content/40">需要探针和 job events 证据</span>
        </span>
        <input
          className="toggle toggle-info toggle-xs"
          type="checkbox"
          checked={requireChat}
          onChange={(event) => onChangeRequireChat(event.target.checked)}
        />
      </label>
      <button className="btn btn-info btn-xs w-full" disabled={verifying} onClick={onVerify}>
        {verifying ? "验证中..." : "验证真实 MuAPI 服务"}
      </button>
      {verificationResult && (
        <div className="max-h-40 space-y-1 overflow-y-auto rounded-md bg-base-200/70 p-2">
          <div className="flex items-center justify-between gap-2 text-[11px] font-semibold">
            <span>{verificationResult.baseUrl}</span>
            <span className={`badge badge-xs ${verificationResult.ok ? "badge-success" : "badge-error"}`}>
              {verificationResult.ok ? "通过" : "失败"}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-1 text-center text-[10px] text-base-content/50">
            <div className="rounded bg-base-100 px-1 py-1">
              <div className="font-semibold text-base-content/70">{verificationResult.realService ? "yes" : "no"}</div>
              <div>real</div>
            </div>
            <div className="rounded bg-base-100 px-1 py-1">
              <div className="font-semibold text-base-content/70">{verificationResult.endpointLog.length}</div>
              <div>calls</div>
            </div>
            <div className="rounded bg-base-100 px-1 py-1">
              <div className="font-semibold text-base-content/70">{verificationResult.requireChat ? "strict" : "basic"}</div>
              <div>mode</div>
            </div>
          </div>
          <div className="rounded bg-base-100 px-2 py-1 text-[10px]">
            <div className="flex items-center justify-between gap-2">
              <span className="text-base-content/50">strict evidence</span>
              <span className={`badge badge-xs ${verificationResult.strictEvidenceReady ? "badge-success" : "badge-warning"}`}>
                {verificationResult.strictEvidenceReady ? "ready" : "blocked"}
              </span>
            </div>
            {verificationResult.blockingEvidenceIds.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {verificationResult.blockingEvidenceIds.slice(0, 8).map((id) => (
                  <span key={id} className="badge badge-xs badge-outline">{id}</span>
                ))}
                {verificationResult.blockingEvidenceIds.length > 8 && (
                  <span className="badge badge-xs badge-outline">+{verificationResult.blockingEvidenceIds.length - 8}</span>
                )}
              </div>
            )}
          </div>
          {(verificationResult.remoteSessionId || verificationResult.remoteJobId) && (
            <div className="space-y-0.5 rounded bg-base-100 px-2 py-1 text-[10px] text-base-content/50">
              {verificationResult.remoteSessionId && <div className="truncate">session: {verificationResult.remoteSessionId}</div>}
              {verificationResult.remoteJobId && <div className="truncate">job: {verificationResult.remoteJobId}</div>}
            </div>
          )}
          <div className="grid grid-cols-2 gap-1 text-[10px] text-base-content/45">
            {Object.entries(verificationResult.endpointEvidence).map(([id, evidence]) => (
              <div key={id} className="rounded bg-base-100 px-2 py-1">
                <div className="flex items-center justify-between gap-1">
                  <span>{id}</span>
                  <span className={evidence.has2xx ? "text-success" : evidence.seen ? "text-warning" : "text-base-content/35"}>
                    {evidence.has2xx ? "2xx" : evidence.seen ? "seen" : "missing"}
                  </span>
                </div>
                <div>{evidence.count} call · {evidence.statuses.join(",") || "-"}</div>
              </div>
            ))}
          </div>
          {verificationResult.steps.map((step) => (
            <div key={step.id} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="truncate">{step.label}</span>
              <span className={step.status === "passed" ? "text-success" : step.status === "failed" ? "text-error" : "text-base-content/45"}>
                {step.status} · {step.durationMs}ms
              </span>
            </div>
          ))}
          {verificationResult.evidenceChecklist.some((item) => item.status !== "passed") && (
            <details className="rounded bg-base-100 px-2 py-1 text-[10px] text-base-content/50">
              <summary className="cursor-pointer font-semibold">未通过证据项</summary>
              <div className="mt-1 space-y-0.5">
                {verificationResult.evidenceChecklist
                  .filter((item) => item.status !== "passed")
                  .slice(0, 10)
                  .map((item) => (
                    <div key={item.id} className="truncate">{item.id}: {item.label}</div>
                  ))}
              </div>
            </details>
          )}
          {verificationResult.endpointLog.slice(0, 6).map((entry, index) => (
            <div key={`${entry.method}-${entry.path}-${index}`} className="flex items-center justify-between gap-2 text-[10px] text-base-content/45">
              <span className="truncate">{entry.method} {entry.path}</span>
              <span>{entry.status || "ERR"} · {entry.durationMs}ms</span>
            </div>
          ))}
          <button
            className="btn btn-ghost btn-xs mt-1 w-full gap-1"
            onClick={() => downloadJson("nextlemon-muapi-verification-report.json", verificationResult)}
          >
            <Download className="h-3.5 w-3.5" />
            导出验证报告
          </button>
        </div>
      )}
    </div>
  );
}

function RemoteJobCard({
  jobId,
  jobStatus,
  settled,
  onApprove,
  onReject,
  onCancel,
  onSync,
}: {
  jobId: string;
  jobStatus: string;
  settled: boolean;
  onApprove: () => void | Promise<void>;
  onReject: () => void;
  onCancel: () => void;
  onSync: () => void | Promise<void>;
}) {
  return (
    <div className="rounded-lg border border-info/30 bg-info/5 p-3">
      <div className="flex items-start gap-2">
        <Clock3 className="mt-0.5 h-4 w-4 text-info" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">MuAPI Job</span>
            <span className={`badge badge-xs ${settled ? "badge-ghost" : "badge-info badge-outline"}`}>
              {jobStatus || (settled ? "done" : "running")}
            </span>
          </div>
          <div className="mt-1 truncate text-xs text-base-content/55">{jobId}</div>
        </div>
      </div>
      {settled ? (
        // 任务终态后收敛操作卡片：只保留手工同步入口，不再展示批准/拒绝/取消。
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="text-[11px] text-base-content/45">任务已结束，操作已收敛</span>
          <button className="btn btn-ghost btn-xs gap-1" onClick={() => void onSync()} title="从上次游标增量拉取事件">
            <RefreshCw className="h-3.5 w-3.5" />
            同步
          </button>
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-4 gap-2">
          <button className="btn btn-primary btn-xs gap-1" onClick={() => void onApprove()}>
            <Check className="h-3.5 w-3.5" />
            批准
          </button>
          <button className="btn btn-ghost btn-xs gap-1" onClick={onReject}>
            <X className="h-3.5 w-3.5" />
            拒绝
          </button>
          <button className="btn btn-ghost btn-xs gap-1" onClick={onCancel}>
            <Play className="h-3.5 w-3.5 rotate-45" />
            取消
          </button>
          <button className="btn btn-ghost btn-xs gap-1" onClick={() => void onSync()} title="从上次游标增量拉取事件">
            <RefreshCw className="h-3.5 w-3.5" />
            同步
          </button>
        </div>
      )}
    </div>
  );
}

function ApprovalCard({
  ops,
  audit,
  onApprove,
  onReject,
  onCancel,
}: {
  ops: CanvasAgentOp[];
  audit?: AgentApprovalAuditMetadata;
  onApprove: () => void | Promise<void>;
  onReject: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-lg border border-warning/40 bg-warning/5 p-3">
      <div className="flex items-start gap-2">
        <Clock3 className="mt-0.5 h-4 w-4 text-warning" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">等待确认</div>
          <div className="mt-1 text-xs text-base-content/55">{summarizeAgentOps(ops)}</div>
        </div>
      </div>
      {audit && (
        <div className="mt-3 space-y-1 rounded-md border border-warning/20 bg-base-100/80 p-2 text-[11px]">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-base-content/60">审计</span>
            <span className="badge badge-xs badge-warning">approval</span>
          </div>
          <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-base-content/50">
            {audit.requestId && <div className="truncate">id: {audit.requestId}</div>}
            <div>ops: {audit.opCount ?? ops.length}</div>
            {audit.source && <div className="truncate">source: {audit.source}</div>}
            {audit.requestHash && <div className="truncate">hash: {shortHash(audit.requestHash)}</div>}
          </div>
          {audit.operationTypes && audit.operationTypes.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {audit.operationTypes.map((type) => (
                <span key={type} className="badge badge-xs badge-outline">{type}</span>
              ))}
            </div>
          )}
          {audit.approvalPolicy && (
            <div className="text-base-content/45">
              writesDirect: {String(audit.approvalPolicy.writesExecuteDirectly)} · importRequired: {String(audit.approvalPolicy.approvalImportRequired)}
            </div>
          )}
        </div>
      )}
      <div className="mt-3 max-h-48 space-y-2 overflow-y-auto">
        {ops.map((op, index) => (
          <details key={`${op.type}-${index}`} className="rounded-md bg-base-100/80 p-2">
            <summary className="cursor-pointer text-xs font-medium">
              {index + 1}. {agentOpLabel(op.type)}
            </summary>
            <pre className="mt-2 max-h-40 overflow-auto rounded bg-base-200 p-2 text-[11px]">
              {JSON.stringify(op, null, 2)}
            </pre>
          </details>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <button className="btn btn-primary btn-xs gap-1" onClick={() => void onApprove()}>
          <Check className="h-3.5 w-3.5" />
          批准
        </button>
        <button className="btn btn-ghost btn-xs gap-1" onClick={onReject}>
          <X className="h-3.5 w-3.5" />
          拒绝
        </button>
        <button className="btn btn-ghost btn-xs gap-1" onClick={onCancel}>
          <Play className="h-3.5 w-3.5 rotate-45" />
          取消
        </button>
      </div>
    </div>
  );
}

function AskUserCard({
  question,
  options,
  onAnswer,
}: {
  question: string;
  options: string[];
  onAnswer: (answer: string) => void;
}) {
  return (
    <div className="rounded-lg border border-accent/40 bg-accent/5 p-3">
      <div className="flex items-center gap-1 text-xs font-semibold">
        <MessageCircleQuestion className="h-3.5 w-3.5" />
        模型在等待你的回答
      </div>
      <div className="mt-2 whitespace-pre-wrap text-sm">{question}</div>
      {options.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {options.map((option, index) => (
            <button
              key={`${index}-${option}`}
              className="btn btn-outline btn-xs"
              onClick={() => onAnswer(option)}
            >
              {index + 1}. {option}
            </button>
          ))}
        </div>
      )}
      {options.length > 0 && (
        <div className="mt-2 text-[11px] text-base-content/40">
          也可以直接在输入框输入自定义回答，发送即作为回答。
        </div>
      )}
    </div>
  );
}

function RollbackCard({
  summary,
  executedAt,
  historyCount,
  onRollback,
}: {
  summary: string;
  executedAt: number;
  historyCount: number;
  onRollback: () => void;
}) {
  return (
    <div className="rounded-lg border border-warning/40 bg-warning/5 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1 text-xs font-semibold">
            <History className="h-3.5 w-3.5" />
            上一次 Agent 执行可回滚
          </div>
          <div className="mt-1 truncate text-xs text-base-content/60">{summary}</div>
          <div className="mt-1 text-[11px] text-base-content/40">
            执行于 {new Date(executedAt).toLocaleString()} · 内存保留最近 3 步（当前 {historyCount} 步），应用重启后失效
          </div>
        </div>
        <button className="btn btn-warning btn-xs gap-1 flex-shrink-0" onClick={onRollback}>
          <Undo2 className="h-3.5 w-3.5" />
          回滚
        </button>
      </div>
    </div>
  );
}

function SessionTimeline({ session }: { session: AgentSession }) {
  const events = session.messages.flatMap((message) => message.events || []);
  // 审批事件生命周期：job 终态或后续批准/拒绝事件到达后收敛历史 approval_required 卡。
  const approvalResolutions = resolveAgentApprovalResolutions(events, isMuApiSessionJobSettled(session));

  return (
    <div className="space-y-2">
      {session.messages.map((message) => (
        <div
          key={message.id}
          className={`rounded-lg border p-3 ${
            message.role === "user" ? "border-primary/20 bg-primary/5" : "border-base-300 bg-base-100"
          }`}
        >
          <div className="mb-1 text-[11px] font-semibold uppercase text-base-content/40">{message.role}</div>
          {message.content && (
            <div className="text-sm">
              <AgentMarkdownText content={message.content} />
            </div>
          )}
        </div>
      ))}

      {events.length > 0 && (
        <div className="rounded-lg border border-base-300 bg-base-100 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-base-content/50">
            <Settings2 className="h-3.5 w-3.5" />
            事件
          </div>
          <div className="space-y-2">
            {events.map((event) => (
              <AgentEventRow key={event.id} event={event} resolution={approvalResolutions[event.id]} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Agent 聊天文本用 Markdown 渲染；skipHtml 禁用原始 HTML 注入，URL 亦经 react-markdown 默认净化。
function AgentMarkdownText({ content }: { content: string }) {
  return (
    <div className="text-xs leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown
        skipHtml
        components={{
          p: ({ children }) => <p className="my-1 first:mt-0 last:mb-0">{children}</p>,
          a: ({ children, href }) => (
            <a className="link link-primary" href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
          ul: ({ children }) => <ul className="my-1 list-inside list-disc space-y-0.5">{children}</ul>,
          ol: ({ children }) => <ol className="my-1 list-inside list-decimal space-y-0.5">{children}</ol>,
          h1: ({ children }) => <h1 className="mb-1 mt-2 text-sm font-bold first:mt-0">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-1 mt-2 text-sm font-bold first:mt-0">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-1 mt-2 text-xs font-bold first:mt-0">{children}</h3>,
          blockquote: ({ children }) => (
            <blockquote className="my-1 border-l-2 border-base-300 pl-2 text-base-content/60">{children}</blockquote>
          ),
          pre: ({ children }) => (
            <pre className="my-1 overflow-x-auto rounded bg-base-100/80 p-2 font-mono text-[11px]">{children}</pre>
          ),
          code: ({ children, className }) =>
            className ? (
              <code className="font-mono text-[11px]">{children}</code>
            ) : (
              <code className="rounded bg-base-100/80 px-1 font-mono text-[11px]">{children}</code>
            ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

const APPROVAL_OUTCOME_LABELS: Record<string, string> = {
  approved: "已批准",
  rejected: "已拒绝",
  cancelled: "已取消",
  completed: "已完成",
};

function AgentEventRow({ event, resolution }: { event: AgentEvent; resolution?: AgentApprovalEventResolution }) {
  if (event.type === "text") {
    return (
      <div className="rounded-md bg-base-200/70 p-2 text-xs">
        <AgentMarkdownText content={event.content} />
      </div>
    );
  }

  if (event.type === "approval_required") {
    if (resolution?.resolved) {
      return (
        <div className="rounded-md bg-base-200/60 p-2 text-xs text-base-content/50">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate">
              {event.title} · {summarizeAgentOps(event.ops)}
            </span>
            <span className="badge badge-xs badge-ghost flex-shrink-0">
              {APPROVAL_OUTCOME_LABELS[resolution.outcome || "completed"] || "已结束"}
            </span>
          </div>
        </div>
      );
    }
    return (
      <div className="rounded-md bg-warning/10 p-2 text-xs">
        {event.title} · {summarizeAgentOps(event.ops)}
      </div>
    );
  }

  if (event.type === "tool_result") {
    return (
      <details className={`rounded-md p-2 text-xs ${event.ok ? "bg-success/10" : "bg-error/10"}`}>
        <summary className="cursor-pointer">
          {event.toolName} · {event.ok ? "成功" : event.error || "失败"}
        </summary>
        {event.result !== undefined && (
          <pre className="mt-2 max-h-56 overflow-auto rounded bg-base-100/80 p-2 text-[11px]">
            {JSON.stringify(event.result, null, 2)}
          </pre>
        )}
      </details>
    );
  }

  if (event.type === "tool_call") {
    return (
      <div className="rounded-md bg-info/10 p-2 text-xs">
        {event.toolName} · {event.write ? "写操作" : "读操作"}
      </div>
    );
  }

  if (event.type === "plan_propose") {
    return <div className="rounded-md bg-primary/10 p-2 text-xs">计划：{event.plan.title}</div>;
  }

  return <div className="rounded-md bg-error/10 p-2 text-xs">{event.message}</div>;
}

function downloadJson(fileName: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName.replace(/[\\/:*?"<>|]+/g, "-");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function isMuApiConfigured(config: AgentProviderConfig) {
  return Boolean((config.baseUrl || "https://api.muapi.ai").trim() && config.apiKey?.trim());
}

// 从 runSkill / chat 响应中宽松提取远端 job id（job_id / jobId / job.id）
function extractRemoteJobId(value: unknown): string {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const job = record.job && typeof record.job === "object" && !Array.isArray(record.job)
    ? (record.job as Record<string, unknown>)
    : {};
  for (const candidate of [record.job_id, record.jobId, job.id]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return "";
}

function getRemoteJobStatus(session: AgentSession) {
  const metadata = session.metadata || {};
  return typeof metadata.remoteJobStatus === "string" ? metadata.remoteJobStatus : "";
}

function getSessionDesignPlan(session: AgentSession): DesignPlan | null {
  const candidate = session.metadata?.activePlan;
  if (!candidate || typeof candidate !== "object") return null;
  const plan = candidate as DesignPlan;
  return Array.isArray(plan.steps) && typeof plan.id === "string" ? plan : null;
}

function getLatestApprovalAudit(session: AgentSession): AgentApprovalAuditMetadata | undefined {
  for (let messageIndex = session.messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const events = session.messages[messageIndex].events || [];
    for (let eventIndex = events.length - 1; eventIndex >= 0; eventIndex -= 1) {
      const event = events[eventIndex];
      if (event.type === "approval_required") return event.audit;
    }
  }
  return undefined;
}

function shortHash(value: string) {
  return value.length > 16 ? `${value.slice(0, 8)}...${value.slice(-8)}` : value;
}

function isToolCallInput(content: string) {
  const trimmed = content.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}
