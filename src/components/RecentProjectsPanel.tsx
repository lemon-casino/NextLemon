import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { History, Images, MessageSquare, X } from "lucide-react";
import { useAgentStore } from "@/stores/agentStore";
import { useCreativeStore } from "@/stores/creativeStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { getCreativeAssetPreviewUrl } from "@/services/creativeAssetService";
import type { AgentSession } from "@/types/agent";
import type { CreativeAsset } from "@/types/creative";

// ---------------------------------------------------------------------------
// 纯函数（组件与单测共用）：最近项目聚合、会话-资产关联、马赛克封面格与相对时间
// ---------------------------------------------------------------------------

/** 马赛克封面固定为 2×2 共 4 格；url 为 null 时渲染占位渐变。 */
export interface RecentProjectCoverTile {
  url: string | null;
}

export interface RecentProjectItem {
  sessionId: string;
  title: string;
  updatedAt: number;
  /** 该会话关联的素材总数（含图片以外的类型）。 */
  assetCount: number;
  /** 固定 4 格的封面（不足用 null 占位）。 */
  coverTiles: RecentProjectCoverTile[];
}

/** 兜底关联的会话活跃窗口余量：素材创建时间允许超出会话首末消息时间各 60s。 */
export const SESSION_ASSET_WINDOW_MS = 60_000;

/** 从宽松的 metadata 中读取字符串数组（跨包写入方不同，容错处理）。 */
function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

/** 从宽松的 metadata 中读取字符串。 */
function readString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

/**
 * 收集与会话关联的素材（只读启发式，按优先级）：
 * 1. session.metadata.assetIds 显式关联（跨包契约方向：Agent 面板包可写入该字段）；
 * 2. asset.metadata.sessionId 反向关联；
 * 3. 兜底：agent 来源素材且创建时间落在会话活跃窗口内（当前 store 未写入显式关联时的可显示集）。
 * 返回按创建时间倒序、按 id 去重后的素材列表。
 */
export function collectSessionAssets(
  session: Pick<AgentSession, "id" | "createdAt" | "updatedAt" | "metadata">,
  assets: CreativeAsset[]
): CreativeAsset[] {
  const explicitIds = readStringArray(
    (session.metadata as Record<string, unknown> | undefined)?.assetIds
  );
  const explicitIdSet = new Set(explicitIds);

  const matched = new Map<string, CreativeAsset>();
  for (const asset of assets) {
    if (explicitIdSet.has(asset.id)) {
      matched.set(asset.id, asset);
      continue;
    }

    const meta = asset.metadata as Record<string, unknown> | undefined;
    if (readString(meta?.sessionId) === session.id) {
      matched.set(asset.id, asset);
      continue;
    }

    if (
      asset.source === "agent" &&
      asset.createdAt >= session.createdAt - SESSION_ASSET_WINDOW_MS &&
      asset.createdAt <= session.updatedAt + SESSION_ASSET_WINDOW_MS
    ) {
      matched.set(asset.id, asset);
    }
  }

  return Array.from(matched.values()).sort((a, b) => b.createdAt - a.createdAt);
}

/** 把封面 URL 列表补齐为固定 4 格（不足用 null 占位，超出截断）。 */
export function buildCoverTiles(urls: string[]): RecentProjectCoverTile[] {
  return Array.from({ length: 4 }, (_, index) => ({
    url: urls[index] ?? null,
  }));
}

/**
 * 聚合最近项目：按会话更新时间倒序取前 limit 个，
 * 封面从关联素材中挑最新的图片类素材（有预览 URL）作为 2×2 马赛克。
 */
export function collectRecentProjects(
  sessions: AgentSession[],
  assets: CreativeAsset[],
  options: { limit?: number } = {}
): RecentProjectItem[] {
  const limit = options.limit ?? 9;

  return [...sessions]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit)
    .map((session) => {
      const sessionAssets = collectSessionAssets(session, assets);
      const coverUrls = sessionAssets
        .filter(
          (asset) =>
            asset.kind === "image" && getCreativeAssetPreviewUrl(asset) !== ""
        )
        .slice(0, 4)
        .map((asset) => getCreativeAssetPreviewUrl(asset));

      return {
        sessionId: session.id,
        title: session.title,
        updatedAt: session.updatedAt,
        assetCount: sessionAssets.length,
        coverTiles: buildCoverTiles(coverUrls),
      };
    });
}

/** 相对时间文案：刚刚 / N 分钟前 / N 小时前 / N 天前 / 本地日期。 */
export function formatRelativeTime(timestamp: number, now: number): string {
  const elapsed = Math.max(0, now - timestamp);
  const minute = 60_000;
  const hour = 3_600_000;
  const day = 86_400_000;

  if (elapsed < minute) return "刚刚";
  if (elapsed < hour) return `${Math.floor(elapsed / minute)} 分钟前`;
  if (elapsed < day) return `${Math.floor(elapsed / hour)} 小时前`;
  if (elapsed < 7 * day) return `${Math.floor(elapsed / day)} 天前`;
  return new Date(timestamp).toLocaleDateString();
}

// ---------------------------------------------------------------------------
// 浮层面板
// ---------------------------------------------------------------------------

const PLACEHOLDER_GRADIENTS = [
  "bg-gradient-to-br from-primary/30 via-primary/10 to-primary/5",
  "bg-gradient-to-br from-secondary/30 via-secondary/10 to-secondary/5",
  "bg-gradient-to-br from-accent/30 via-accent/10 to-accent/5",
  "bg-gradient-to-br from-base-content/15 via-base-content/8 to-base-content/5",
] as const;

interface RecentProjectsPanelProps {
  open: boolean;
  onClose: () => void;
}

export function RecentProjectsPanel({ open, onClose }: RecentProjectsPanelProps) {
  const sessions = useAgentStore((state) => state.sessions);
  const setActiveSession = useAgentStore((state) => state.setActiveSession);
  const assets = useCreativeStore((state) => state.assets);
  const workspaceMode = useWorkspaceStore((state) => state.mode);
  const setMode = useWorkspaceStore((state) => state.setMode);
  const [failedTileKeys, setFailedTileKeys] = useState<Set<string>>(new Set());

  const projects = useMemo(
    () => collectRecentProjects(sessions, assets),
    [sessions, assets]
  );

  if (!open) return null;

  // AgentPanel 挂载于创作画布侧栏（CreativeWorkspace），因此打开项目时
  // 需同时切到 creative 模式，让激活会话真正可见。
  const handleOpenProject = (item: RecentProjectItem) => {
    setActiveSession(item.sessionId);
    if (workspaceMode !== "creative") setMode("creative");
    onClose();
  };

  const handleTileError = (key: string) => {
    setFailedTileKeys((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* 遮罩 */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      <div
        className="relative w-full max-w-2xl max-h-[80vh] flex flex-col bg-base-100/90 backdrop-blur-md border border-base-200/60 rounded-2xl shadow-2xl overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-base-content/5">
          <div className="flex items-center gap-2">
            <History className="w-5 h-5 text-primary" />
            <h3 className="font-semibold text-lg tracking-tight">最近项目</h3>
            {projects.length > 0 && (
              <span className="badge badge-sm badge-ghost">{projects.length}</span>
            )}
          </div>
          <button
            className="btn btn-ghost btn-xs btn-circle"
            title="关闭"
            onClick={onClose}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 项目卡片网格 */}
        <div className="flex-1 overflow-y-auto p-5 custom-scrollbar">
          {projects.length === 0 ? (
            <div className="py-14 flex flex-col items-center text-base-content/50">
              <div className="w-16 h-16 rounded-2xl bg-base-content/5 flex items-center justify-center mb-3">
                <History className="w-8 h-8 opacity-40" />
              </div>
              <p className="text-sm">暂无最近项目</p>
              <p className="text-xs text-base-content/40 mt-1">
                在创作画布中开启 Agent 会话后，将在此处快速回访
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {projects.map((item) => (
                <button
                  key={item.sessionId}
                  className="group text-left rounded-xl border border-base-200/60 bg-base-100/60 hover:bg-base-100 hover:border-primary/30 hover:shadow-lg transition-all duration-200 overflow-hidden cursor-pointer"
                  onClick={() => handleOpenProject(item)}
                >
                  {/* 2×2 马赛克封面 */}
                  <div className="grid grid-cols-2 gap-0.5 aspect-[2/1] bg-base-200/40">
                    {item.coverTiles.map((tile, tileIndex) => {
                      const tileKey = `${item.sessionId}:${tileIndex}`;
                      const showImage = tile.url !== null && !failedTileKeys.has(tileKey);
                      return (
                        <div
                          key={tileKey}
                          className={`relative overflow-hidden ${PLACEHOLDER_GRADIENTS[tileIndex % PLACEHOLDER_GRADIENTS.length]}`}
                        >
                          {showImage ? (
                            <img
                              src={tile.url ?? undefined}
                              alt=""
                              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                              loading="lazy"
                              onError={() => handleTileError(tileKey)}
                            />
                          ) : (
                            <div className="absolute inset-0 flex items-center justify-center">
                              <Images className="w-4 h-4 text-base-content/25" />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* 标题与元信息 */}
                  <div className="px-3.5 py-3">
                    <div className="flex items-center gap-1.5">
                      <MessageSquare className="w-3.5 h-3.5 flex-shrink-0 text-base-content/40" />
                      <span className="text-sm font-medium truncate text-base-content/85 group-hover:text-primary transition-colors">
                        {item.title}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-base-content/45">
                      <span>{formatRelativeTime(item.updatedAt, Date.now())}</span>
                      <span className="w-0.5 h-0.5 rounded-full bg-base-content/30" />
                      <span>{item.assetCount} 项素材</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
