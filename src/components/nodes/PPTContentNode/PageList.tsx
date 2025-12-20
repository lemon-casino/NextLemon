import { useMemo } from "react";
import { Play, Pause, RotateCcw, CheckCircle, AlertCircle } from "lucide-react";
import type { PPTPageItem } from "./types";
import { PageItemRow } from "./PageItemRow";

interface PageListProps {
  pages: PPTPageItem[];
  generationStatus: "idle" | "running" | "paused" | "completed" | "error";
  progress: { completed: number; total: number };
  onStartAll: () => void;
  onPauseAll: () => void;
  onResumeAll: () => void;
  onRetryFailed: () => void;
  onRetryPage: (id: string) => void;
  onSkipPage: (id: string) => void;
  onRunPage: (id: string) => void;
  onStopPage: (id: string) => void;
  onUploadImage: (id: string, imageData: string) => void;
  onShowScript?: (item: PPTPageItem) => void;
}

export function PageList({
  pages,
  generationStatus,
  progress,
  onStartAll,
  onPauseAll,
  onResumeAll,
  onRetryFailed,
  onRetryPage,
  onSkipPage,
  onRunPage,
  onStopPage,
  onUploadImage,
  onShowScript,
}: PageListProps) {
  // 计算统计信息
  const stats = useMemo(() => {
    const pending = pages.filter(p => p.status === "pending").length;
    const running = pages.filter(p => p.status === "running").length;
    const completed = pages.filter(p => p.status === "completed").length;
    const failed = pages.filter(p => p.status === "failed").length;
    const skipped = pages.filter(p => p.status === "skipped").length;
    return { pending, running, completed, failed, skipped };
  }, [pages]);

  // 进度百分比
  const progressPercent = progress.total > 0
    ? Math.round((progress.completed / progress.total) * 100)
    : 0;

  // 是否有失败的页面
  const hasFailed = stats.failed > 0;

  // 是否正在运行
  const isRunning = generationStatus === "running";
  const isPaused = generationStatus === "paused";
  const isCompleted = generationStatus === "completed";
  const isIdle = generationStatus === "idle";

  return (
    <div className="flex flex-col">
      {/* 顶部控制栏 */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {/* 状态指示 */}
          {isRunning && (
            <span className="badge badge-primary badge-sm gap-1">
              <span className="loading loading-spinner loading-xs" />
              生成中
            </span>
          )}
          {isPaused && (
            <span className="badge badge-warning badge-sm">已暂停</span>
          )}
          {isCompleted && (
            <span className="badge badge-success badge-sm gap-1">
              <CheckCircle className="w-3 h-3" />
              已完成
            </span>
          )}
          {hasFailed && !isRunning && (
            <span className="badge badge-error badge-sm gap-1">
              <AlertCircle className="w-3 h-3" />
              {stats.failed} 失败
            </span>
          )}
        </div>

        {/* 控制按钮 */}
        <div className="flex items-center gap-1">
          {isIdle && (
            <button
              className="btn btn-primary btn-xs gap-1"
              onClick={onStartAll}
            >
              <Play className="w-3 h-3" />
              开始生成
            </button>
          )}
          {isRunning && (
            <button
              className="btn btn-warning btn-xs gap-1"
              onClick={onPauseAll}
            >
              <Pause className="w-3 h-3" />
              暂停
            </button>
          )}
          {isPaused && (
            <button
              className="btn btn-primary btn-xs gap-1"
              onClick={onResumeAll}
            >
              <Play className="w-3 h-3" />
              继续
            </button>
          )}
          {hasFailed && !isRunning && (
            <button
              className="btn btn-error btn-xs gap-1"
              onClick={onRetryFailed}
            >
              <RotateCcw className="w-3 h-3" />
              重试失败
            </button>
          )}
        </div>
      </div>

      {/* 进度条 */}
      <div className="mb-3">
        <div className="flex items-center justify-between text-xs text-base-content/60 mb-1">
          <span>进度：{progress.completed}/{progress.total}</span>
          <span>{progressPercent}%</span>
        </div>
        <progress
          className={`progress w-full ${isCompleted ? "progress-success" : "progress-primary"}`}
          value={progress.completed}
          max={progress.total}
        />
      </div>

      {/* 统计摘要 */}
      <div className="flex items-center gap-2 text-xs text-base-content/60 mb-2">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-base-content/30" />
          待生成 {stats.pending}
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-primary" />
          生成中 {stats.running}
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-success" />
          完成 {stats.completed}
        </span>
        {stats.failed > 0 && (
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-error" />
            失败 {stats.failed}
          </span>
        )}
        {stats.skipped > 0 && (
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-warning" />
            跳过 {stats.skipped}
          </span>
        )}
      </div>

      {/* 页面列表 */}
      <div className="space-y-2">
        {pages.map((page) => (
          <PageItemRow
            key={page.id}
            item={page}
            onRetry={onRetryPage}
            onSkip={onSkipPage}
            onRun={onRunPage}
            onStop={onStopPage}
            onUploadImage={onUploadImage}
            onShowScript={onShowScript}
            disabled={isRunning}
          />
        ))}
      </div>
    </div>
  );
}
