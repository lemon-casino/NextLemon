// MuAPI job 持续轮询与恢复控制流（从 AgentPanel 提取为可导出模块，便于对
// 终态收敛、定时器清理、重启恢复等控制流补充单测）。

import {
  fetchMuApiJobStatus,
  findActiveMuApiJob,
  listMuApiSessionJobs,
  pollMuApiJobEvents,
} from "@/services/muApiAgentAdapter";
import {
  createMuApiEventPollState,
  isMuApiJobStatusTerminal,
  isMuApiSessionJobSettled,
  shouldPollMuApiSessionJob,
  type MuApiEventPollState,
} from "@/services/muApiEventStream";
import { useAgentStore } from "@/stores/agentStore";
import { toast } from "@/stores/toastStore";
import type { AgentProviderConfig, AgentSession } from "@/types/agent";

export const MUAPI_ACTIVE_POLL_INTERVAL_MS = 2000;

export function getRemoteJobId(session: AgentSession) {
  const metadata = session.metadata || {};
  return typeof metadata.remoteJobId === "string" ? metadata.remoteJobId : "";
}

export function getRemoteSessionId(session: AgentSession) {
  const metadata = session.metadata || {};
  return typeof metadata.remoteSessionId === "string" ? metadata.remoteSessionId : "";
}

export function getEventPoll(session: AgentSession): MuApiEventPollState | undefined {
  const candidate = (session.metadata || {}).eventPoll;
  return candidate && typeof candidate === "object" ? (candidate as MuApiEventPollState) : undefined;
}

// 增量续拉远端事件；静默模式供轮询循环使用，避免 toast 刷屏（stalled 提示同样静默）。
export async function syncMuApiSessionEvents(
  sessionId: string,
  config: AgentProviderConfig,
  options: { silent?: boolean } = {}
) {
  const { sessions, appendEvent, updateSessionMetadata, setSessionStatus } = useAgentStore.getState();
  const session = sessions.find((item) => item.id === sessionId);
  if (!session) return null;
  const silent = options.silent === true;
  try {
    const result = await pollMuApiJobEvents(config, session);
    result.newEvents.forEach((event) => appendEvent(sessionId, event));
    updateSessionMetadata(sessionId, {
      eventPoll: result.pollState,
      ...(result.pollState.done ? { remoteJobStatus: "completed" } : {}),
    });
    if (result.pollState.done) {
      setSessionStatus(sessionId, "idle");
      // done 只会出现一次且轮询随之收敛，静默模式下也提示一次。
      toast.success("远端任务已完成");
    } else if (result.stalled) {
      setSessionStatus(sessionId, "failed");
      if (!silent) toast.error("远端任务超过 6 分钟没有新事件，已标记为停滞");
    } else if (!silent) {
      toast.success(`已同步 ${result.newEvents.length} 条新事件（游标：${result.pollState.cursor ?? "起点"}）`);
    }
    return result;
  } catch (error) {
    if (!silent) toast.error(error instanceof Error ? error.message : "同步远端事件失败");
    return null;
  }
}

// 持续轮询的单次 tick：增量续拉事件 + 查询 job 状态，到达终态（done/error/cancelled）时收敛。
export async function pollActiveMuApiJob(sessionId: string, config: AgentProviderConfig) {
  const { sessions } = useAgentStore.getState();
  const session = sessions.find((item) => item.id === sessionId);
  if (!session || !shouldPollMuApiSessionJob(session)) return;
  const jobId = getRemoteJobId(session);
  if (!jobId) return;

  await syncMuApiSessionEvents(sessionId, config, { silent: true });

  const job = await fetchMuApiJobStatus(config, jobId);
  if (!job) return; // 状态查询失败：保留事件轮询结果，等待下个周期重试
  const status = typeof job.status === "string" ? job.status.trim().toLowerCase() : "";
  if (!status || !isMuApiJobStatusTerminal(status)) return;

  const fresh = useAgentStore.getState().sessions.find((item) => item.id === sessionId);
  if (!fresh) return;
  const currentStatus = typeof fresh.metadata?.remoteJobStatus === "string"
    ? (fresh.metadata.remoteJobStatus as string).trim().toLowerCase()
    : "";
  if (isMuApiJobStatusTerminal(currentStatus)) return; // 事件流或先前查询已收敛，避免重复更新

  useAgentStore.getState().updateSessionMetadata(sessionId, { remoteJobStatus: status });
  const localStatus =
    status === "cancelled" || status === "canceled"
      ? "cancelled"
      : status === "error" || status === "failed"
        ? "failed"
        : "idle";
  useAgentStore.getState().setSessionStatus(sessionId, localStatus);
  if (localStatus === "failed") toast.error(`远端任务已结束：${status}`);
  else if (localStatus === "cancelled") toast.info("远端任务已取消");
  else toast.success("远端任务已完成");
}

// 刷新/重启恢复：向服务端查询该会话 pending/processing 的任务并对齐本地元数据，
// 不再只依赖本地持久化的 metadata.remoteJobId；查询失败时静默降级到本地元数据。
export async function recoverMuApiSessionJobs(sessionId: string, remoteSessionId: string, config: AgentProviderConfig) {
  try {
    const jobs = await listMuApiSessionJobs(config, remoteSessionId);
    const fresh = useAgentStore.getState().sessions.find((item) => item.id === sessionId);
    if (!fresh) return;

    const activeJob = findActiveMuApiJob(jobs);
    if (!activeJob || typeof activeJob.id !== "string" || !activeJob.id) {
      // 服务端已无未完成任务：把本地仍挂着的未完成 job 收敛，避免继续轮询
      if (getRemoteJobId(fresh) && !isMuApiSessionJobSettled(fresh)) {
        const poll = getEventPoll(fresh);
        useAgentStore.getState().updateSessionMetadata(sessionId, {
          remoteJobStatus: "done",
          eventPoll: { ...createMuApiEventPollState(), ...(poll || {}), done: true },
        });
        useAgentStore.getState().setSessionStatus(sessionId, "idle");
      }
      return;
    }

    const patch: Record<string, unknown> = {};
    const remoteStatus = typeof activeJob.status === "string" ? activeJob.status.trim().toLowerCase() : "";
    if (remoteStatus) patch.remoteJobStatus = remoteStatus;
    if (activeJob.id !== getRemoteJobId(fresh)) {
      patch.remoteJobId = activeJob.id;
      patch.eventPoll = createMuApiEventPollState(); // 对齐到新任务，从起点续听
    } else {
      // 同一任务：重启/刷新后本地 eventPoll.lastEventAt 可能已超过死空时限，
      // 刷新看门狗时钟（保留 cursor 继续增量续传），否则轮询循环会误判 stalled 永不启动。
      patch.eventPoll = { ...(getEventPoll(fresh) || createMuApiEventPollState()), lastEventAt: Date.now() };
    }
    if (Object.keys(patch).length > 0) {
      useAgentStore.getState().updateSessionMetadata(sessionId, patch);
    }
    if (!isMuApiSessionJobSettled({ metadata: { ...(fresh.metadata || {}), ...patch } })) {
      useAgentStore.getState().setSessionStatus(sessionId, "running");
    }
  } catch {
    // 服务端查询失败：保留本地 metadata；若本地挂有 remoteJobId，轮询循环仍会兜底续听
  }
}

export interface MuApiJobPollingHandle {
  stop: () => void;
}

// 启动约 2 秒周期的轮询循环：立即执行首轮，inFlight 防重入；
// 任务终态收敛（或调用 stop）时清理定时器。React 侧在 effect cleanup 中调用 stop。
export function startMuApiJobPolling(sessionId: string, config: AgentProviderConfig): MuApiJobPollingHandle {
  let stopped = false;
  let inFlight = false;

  const stop = () => {
    stopped = true;
    clearInterval(timer);
  };

  const tick = async () => {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      await pollActiveMuApiJob(sessionId, config);
    } finally {
      inFlight = false;
    }
    // 终态/停滞收敛后自停（React effect 依赖变化触发的 stop 是双保险）
    if (!stopped) {
      const session = useAgentStore.getState().sessions.find((item) => item.id === sessionId);
      if (!session || !shouldPollMuApiSessionJob(session)) stop();
    }
  };

  const timer = setInterval(() => void tick(), MUAPI_ACTIVE_POLL_INTERVAL_MS);
  void tick();

  return { stop };
}
