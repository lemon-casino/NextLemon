import { useMemo } from "react";
import {
  Play,
  Pause,
  RotateCcw,
  CheckCircle,
  AlertCircle,
  Sparkles,
} from "lucide-react";
import type { PPTPageItem, PPTContentNodeData } from "./types";
import type { ConnectedImageInfo } from "./types";
import { PageItemRow } from "./PageItemRow";

interface PagesTabProps {
  pages: PPTPageItem[];
  generationStatus: PPTContentNodeData["generationStatus"];
  progress: PPTContentNodeData["progress"];
  hasTemplateImage: boolean;
  connectedImages?: ConnectedImageInfo[];
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

export function PagesTab({
  pages,
  generationStatus,
  progress,
  hasTemplateImage,
  connectedImages = [],
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
}: PagesTabProps) {
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

  // 如果没有页面（大纲未生成）
  if (pages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-base-content/50">
        <div className="w-16 h-16 rounded-full bg-base-200 flex items-center justify-center mb-4">
          <AlertCircle className="w-8 h-8" />
        </div>
        <p className="text-base font-medium mb-1">请先生成大纲</p>
        <p className="text-sm text-base-content/40">
          在「大纲」标签页生成大纲后，这里将显示页面列表
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col space-y-3">
      {/* 模板图提示 */}
      {!hasTemplateImage && (
        <div className="flex items-center gap-2 text-warning text-sm bg-warning/10 rounded-lg px-3 py-2 border border-warning/20">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>请先连接模板基底图（PPT 背景模板）</span>
        </div>
      )}

      {/* 生成控制区域 - 紧凑布局 */}
      <div className="flex items-center justify-between bg-base-200/30 rounded-xl px-4 py-2.5">
        <div className="flex items-center gap-3">
          {/* 进度信息 */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-base-content/70">
              进度：{progress.completed}/{progress.total} 页
            </span>
            <div className="w-32 h-1.5 bg-base-300 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  isCompleted ? "bg-success" : "bg-primary"
                }`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <span className={`text-sm font-medium ${isCompleted ? "text-success" : "text-primary"}`}>
              {progressPercent}%
            </span>
          </div>

          {/* 统计 */}
          <div className="flex items-center gap-2 text-xs text-base-content/50">
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-base-content/30" />
              待生成 {stats.pending}
            </span>
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-success" />
              完成 {stats.completed}
            </span>
            {stats.failed > 0 && (
              <span className="flex items-center gap-1 text-error">
                <span className="w-1.5 h-1.5 rounded-full bg-error" />
                失败 {stats.failed}
              </span>
            )}
          </div>
        </div>

        {/* 控制按钮 */}
        <div className="flex items-center gap-2">
          {/* 状态指示 */}
          {isRunning && (
            <span className="inline-flex items-center gap-1 text-primary text-sm">
              <span className="loading loading-spinner loading-xs" />
              生成中
            </span>
          )}
          {isPaused && (
            <span className="text-warning text-sm">已暂停</span>
          )}
          {isCompleted && (
            <span className="inline-flex items-center gap-1 text-success text-sm">
              <CheckCircle className="w-3.5 h-3.5" />
              已完成
            </span>
          )}
          {hasFailed && !isRunning && (
            <span className="text-error text-sm">{stats.failed} 个失败</span>
          )}

          {isIdle && (
            <button
              className="btn btn-primary btn-sm gap-1.5"
              onClick={onStartAll}
              disabled={!hasTemplateImage}
            >
              <Sparkles className="w-3.5 h-3.5" />
              开始生成
            </button>
          )}
          {isRunning && (
            <button
              className="btn btn-warning btn-sm gap-1"
              onClick={onPauseAll}
            >
              <Pause className="w-3.5 h-3.5" />
              暂停
            </button>
          )}
          {isPaused && (
            <button
              className="btn btn-primary btn-sm gap-1"
              onClick={onResumeAll}
            >
              <Play className="w-3.5 h-3.5" />
              继续
            </button>
          )}
          {hasFailed && !isRunning && (
            <button
              className="btn btn-error btn-sm gap-1"
              onClick={onRetryFailed}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              重试
            </button>
          )}
        </div>
      </div>

      {/* 页面列表 - 占据剩余空间 */}
      <div className="flex-1 overflow-y-auto space-y-2 min-h-0 pr-1">
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
            connectedImages={connectedImages}
            disabled={false}
          />
        ))}
      </div>
    </div>
  );
}
