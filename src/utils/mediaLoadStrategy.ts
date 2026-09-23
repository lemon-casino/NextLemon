import { useEffect, useMemo, useSyncExternalStore } from "react";

// 媒体加载降级策略（创作画布 / 素材库共用）：
// 1) 首选带 crossOrigin=anonymous 加载，保证显示侧尽可能不污染画布（canvas.toDataURL 可用）；
// 2) 服务器不支持 CORS 时 onError 降级为不带 crossOrigin 重试：素材能显示，但该素材会污染画布，
//    浏览器环境下画布导出 toDataURL 会整体抛 SecurityError（导出链路由 creativeCanvasExport
//    负责，本模块只覆盖显示侧的加载与占位降级）；
// 3) 视频/音频增加超时兜底：onError 或超时都会推进阶段，避免远程素材长时间黑屏后直接裂图。
export type MediaKind = "image" | "video" | "audio";

// 加载阶段：cors（带 crossOrigin=anonymous）→ direct（去掉 CORS 重试）→ failed（交给 UI 显示占位）
export type MediaLoadStage = "cors" | "direct" | "failed";

// 视频/音频元数据加载超时：超过该时长未就绪即进入下一阶段
export const MEDIA_LOAD_TIMEOUT_MS = 8000;

// 阶段推进（纯函数）：cors → direct → failed（failed 为终态）
export function nextMediaLoadStage(stage: MediaLoadStage): MediaLoadStage {
  return stage === "cors" ? "direct" : "failed";
}

// 当前阶段应使用的 crossOrigin 属性值
export function mediaCrossOrigin(stage: MediaLoadStage): "anonymous" | undefined {
  return stage === "cors" ? "anonymous" : undefined;
}

export interface MediaLoadSnapshot {
  stage: MediaLoadStage;
  ready: boolean;
  failed: boolean;
  crossOrigin: "anonymous" | undefined;
}

type TimerHandle = ReturnType<typeof setTimeout>;

export interface MediaLoadStateMachineOptions {
  timeoutMs?: number;
  scheduleTimer?: (handler: () => void, ms: number) => TimerHandle;
  cancelTimer?: (handle: TimerHandle) => void;
}

// 框架无关的媒体加载降级状态机（useResilientMedia 的核心逻辑，可在无 DOM 的
// 单测环境直接驱动）：cors → direct → failed；视频/音频每阶段未就绪超时推进，
// 就绪（onCanPlay）取消超时；reset 换源后回到 cors。
export function createMediaLoadStateMachine(
  kind: MediaKind,
  options: MediaLoadStateMachineOptions = {}
) {
  const timeoutMs = options.timeoutMs ?? MEDIA_LOAD_TIMEOUT_MS;
  const scheduleTimer =
    options.scheduleTimer ?? ((handler, ms) => setTimeout(handler, ms));
  const cancelTimer = options.cancelTimer ?? ((handle) => clearTimeout(handle));

  let stage: MediaLoadStage = "cors";
  let ready = false;
  let timer: TimerHandle | null = null;
  let snapshot: MediaLoadSnapshot = {
    stage,
    ready,
    failed: false,
    crossOrigin: "anonymous",
  };
  const listeners = new Set<() => void>();

  const publish = () => {
    snapshot = {
      stage,
      ready,
      failed: stage === "failed",
      crossOrigin: mediaCrossOrigin(stage),
    };
    for (const listener of listeners) listener();
  };

  const clearTimer = () => {
    if (timer != null) {
      cancelTimer(timer);
      timer = null;
    }
  };

  // 图片的 error 事件可靠且及时，无需超时；音视频可能挂起不出错，需要兜底
  const armTimeout = () => {
    clearTimer();
    if (kind === "image" || stage === "failed" || ready) return;
    timer = scheduleTimer(() => {
      timer = null;
      ready = false;
      stage = nextMediaLoadStage(stage);
      // 超时推进到 direct 后同样要武装 direct 阶段的超时兜底
      armTimeout();
      publish();
    }, timeoutMs);
  };

  armTimeout();

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    // 元素 onError：当前阶段失败，推进到下一阶段（已到 failed 则忽略）
    notifyError() {
      const next = nextMediaLoadStage(stage);
      if (next === stage) return;
      ready = false;
      stage = next;
      armTimeout();
      publish();
    },
    // 元素 onCanPlay：当前阶段就绪，取消该阶段的超时兜底
    notifyReady() {
      if (ready) return;
      ready = true;
      clearTimer();
      publish();
    },
    // 换源后从第一阶段重来
    reset() {
      stage = "cors";
      ready = false;
      armTimeout();
      publish();
    },
    dispose() {
      clearTimer();
      listeners.clear();
    },
  };
}

export interface ResilientMediaState extends MediaLoadSnapshot {
  src: string;
  // 挂到元素 onError；阶段推进后建议配合 key={stage} 重建元素触发真正的重试
  onMediaError: () => void;
  // 挂到视频/音频的 onCanPlay（取消该阶段的超时兜底）
  onMediaReady: () => void;
}

export function useResilientMedia(src: string, kind: MediaKind): ResilientMediaState {
  // 素材类型不可变，kind 变化时重建状态机即可
  const machine = useMemo(() => createMediaLoadStateMachine(kind), [kind]);

  useEffect(() => {
    machine.reset();
    return () => machine.dispose();
  }, [machine, src]);

  const snapshot = useSyncExternalStore(
    machine.subscribe,
    machine.getSnapshot,
    machine.getSnapshot
  );

  return {
    src,
    stage: snapshot.stage,
    crossOrigin: snapshot.crossOrigin,
    ready: snapshot.ready,
    failed: snapshot.failed,
    onMediaError: machine.notifyError,
    onMediaReady: machine.notifyReady,
  };
}
