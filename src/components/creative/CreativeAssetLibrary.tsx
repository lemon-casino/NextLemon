import { useMemo, useState, type ReactNode } from "react";
import {
  Download,
  Edit3,
  Eraser,
  Eye,
  FileAudio,
  FileVideo,
  Filter,
  Images,
  Plus,
  Search,
  Tag,
  Trash2,
  Type,
  X,
} from "lucide-react";
import { useCreativeStore } from "@/stores/creativeStore";
import { toast } from "@/stores/toastStore";
import { formatFileSize, isTauriEnvironment } from "@/services/fileStorageService";
import {
  CREATIVE_ASSET_KIND_LABELS,
  CREATIVE_ASSET_SOURCE_LABELS,
  cleanupOrphanCreativeFiles,
  downloadCreativeAsset,
  getCreativeAssetPreviewUrl,
  getCreativeAssetSizeLabel,
  normalizeAssetTags,
} from "@/services/creativeAssetService";
import {
  CREATIVE_ASSET_DRAG_TYPE,
  type CreativeAsset,
  type CreativeAssetKind,
} from "@/types/creative";
import { useResilientMedia, type MediaKind } from "@/utils/mediaLoadStrategy";

type AssetKindFilter = CreativeAssetKind | "all";
type AssetSourceFilter = CreativeAsset["source"] | "all";

interface CreativeAssetLibraryProps {
  activeAssetId?: string | null;
  className?: string;
  compact?: boolean;
  emptyDescription?: string;
  onAddToCanvas?: (assetId: string) => void;
  showAddToCanvas?: boolean;
}

export function CreativeAssetLibrary({
  activeAssetId,
  className = "",
  compact = false,
  emptyDescription = "上传文件、创建文本，或从工作流节点保存素材。",
  onAddToCanvas,
  showAddToCanvas = Boolean(onAddToCanvas),
}: CreativeAssetLibraryProps) {
  const assets = useCreativeStore((state) => state.assets);
  const updateAsset = useCreativeStore((state) => state.updateAsset);
  const removeAssets = useCreativeStore((state) => state.removeAssets);
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<AssetKindFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<AssetSourceFilter>("all");
  const [tagFilter, setTagFilter] = useState<string>("all");
  const [previewAssetId, setPreviewAssetId] = useState<string | null>(null);
  const [cleanupRunning, setCleanupRunning] = useState(false);

  const tags = useMemo(
    () => Array.from(new Set(assets.flatMap((asset) => asset.tags))).sort((a, b) => a.localeCompare(b)),
    [assets]
  );

  const sourceCounts = useMemo(() => {
    const counts: Partial<Record<CreativeAsset["source"], number>> = {};
    for (const asset of assets) {
      counts[asset.source] = (counts[asset.source] || 0) + 1;
    }
    return counts;
  }, [assets]);

  const filteredAssets = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return assets.filter((asset) => {
      if (kindFilter !== "all" && asset.kind !== kindFilter) return false;
      if (sourceFilter !== "all" && asset.source !== sourceFilter) return false;
      if (tagFilter !== "all" && !asset.tags.includes(tagFilter)) return false;
      if (!normalized) return true;

      return [
        asset.title,
        asset.fileName,
        asset.text,
        asset.note,
        asset.mimeType,
        asset.tags.join(" "),
        CREATIVE_ASSET_SOURCE_LABELS[asset.source],
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalized));
    });
  }, [assets, kindFilter, query, sourceFilter, tagFilter]);

  const previewAsset = useMemo(
    () => assets.find((asset) => asset.id === previewAssetId) || null,
    [assets, previewAssetId]
  );

  const handleDelete = (asset: CreativeAsset) => {
    if (!window.confirm(`确认删除素材「${asset.title}」？画布上的引用也会被移除。`)) return;
    removeAssets([asset.id]);
    if (previewAssetId === asset.id) setPreviewAssetId(null);
    toast.success("素材已删除");
  };

  const handleCleanupOrphanFiles = async () => {
    setCleanupRunning(true);
    try {
      const result = await cleanupOrphanCreativeFiles();
      if (result.deletedCount > 0) {
        toast.success(
          `已清理 ${result.deletedCount} 个未引用文件，释放 ${formatFileSize(result.orphanBytes)}`
        );
      } else {
        toast.info("没有需要清理的未引用文件");
      }
    } catch (error) {
      toast.error(`清理失败: ${error instanceof Error ? error.message : "未知错误"}`);
    } finally {
      setCleanupRunning(false);
    }
  };

  const handleDownload = async (asset: CreativeAsset) => {
    try {
      const downloaded = await downloadCreativeAsset(asset);
      if (downloaded) toast.success("素材下载已开始");
    } catch (error) {
      toast.error(`下载失败: ${error instanceof Error ? error.message : "未知错误"}`);
    }
  };

  const handleSaveMetadata = (asset: CreativeAsset, input: AssetMetadataInput) => {
    updateAsset(asset.id, {
      title: input.title.trim() || asset.title,
      tags: normalizeAssetTags(input.tags),
      note: input.note.trim() || undefined,
    });
    toast.success("素材信息已更新");
  };

  return (
    <div className={`flex h-full min-h-0 flex-col ${className}`}>
      <div className="border-b border-base-300/60 p-3">
        <label className="input input-sm input-bordered flex items-center gap-2 bg-base-200/70">
          <Search className="h-4 w-4 text-base-content/40" />
          <input
            className="min-w-0 flex-1 bg-transparent"
            placeholder="搜索标题、标签、来源..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button type="button" onClick={() => setQuery("")}>
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </label>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="flex items-center gap-2 rounded-lg border border-base-300 bg-base-100 px-2">
            <Filter className="h-3.5 w-3.5 text-base-content/40" />
            <select
              className="select select-xs min-w-0 flex-1 bg-transparent px-0 focus:outline-none"
              value={kindFilter}
              onChange={(event) => setKindFilter(event.target.value as AssetKindFilter)}
            >
              <option value="all">全部类型</option>
              {Object.entries(CREATIVE_ASSET_KIND_LABELS).map(([kind, label]) => (
                <option key={kind} value={kind}>{label}</option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 rounded-lg border border-base-300 bg-base-100 px-2">
            <Images className="h-3.5 w-3.5 text-base-content/40" />
            <select
              className="select select-xs min-w-0 flex-1 bg-transparent px-0 focus:outline-none"
              value={sourceFilter}
              onChange={(event) => setSourceFilter(event.target.value as AssetSourceFilter)}
            >
              <option value="all">全部来源</option>
              {Object.entries(CREATIVE_ASSET_SOURCE_LABELS).map(([source, label]) => (
                <option key={source} value={source}>
                  {label}{sourceCounts[source as CreativeAsset["source"]] ? ` ${sourceCounts[source as CreativeAsset["source"]]}` : ""}
                </option>
              ))}
            </select>
          </label>
        </div>

        {tags.length > 0 && (
          <div className="mt-3 flex gap-1 overflow-x-auto pb-1">
            <button
              className={`btn btn-xs rounded-full ${tagFilter === "all" ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setTagFilter("all")}
            >
              全部标签
            </button>
            {tags.map((tag) => (
              <button
                key={tag}
                className={`btn btn-xs rounded-full ${tagFilter === tag ? "btn-primary" : "btn-ghost"}`}
                onClick={() => setTagFilter(tag)}
              >
                <Tag className="h-3 w-3" />
                {tag}
              </button>
            ))}
          </div>
        )}

        {!compact && (
          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[11px] text-base-content/50">
            <Metric label="全部" value={assets.length} />
            <Metric label="工作流" value={sourceCounts.workflow || 0} />
            <Metric label="上传" value={sourceCounts.upload || 0} />
          </div>
        )}
        {!compact && isTauriEnvironment() && (
          <button
            className="btn btn-ghost btn-xs mt-2 w-full gap-1 text-base-content/50"
            disabled={cleanupRunning}
            onClick={() => void handleCleanupOrphanFiles()}
            title="删除未被任何素材引用的本地文件（仅桌面端）"
          >
            <Eraser className="h-3 w-3" />
            {cleanupRunning ? "清理中..." : "清理未引用文件"}
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {filteredAssets.length === 0 ? (
          <div className="flex h-44 flex-col items-center justify-center rounded-lg border border-dashed border-base-300 px-4 text-center text-sm text-base-content/45">
            <Plus className="mb-2 h-5 w-5" />
            <div>{assets.length === 0 ? "暂无素材" : "没有匹配的素材"}</div>
            <div className="mt-1 text-xs">{emptyDescription}</div>
          </div>
        ) : (
          filteredAssets.map((asset) => (
            <CreativeAssetCard
              key={asset.id}
              active={activeAssetId === asset.id}
              asset={asset}
              showAddToCanvas={showAddToCanvas}
              onAddToCanvas={onAddToCanvas ? () => onAddToCanvas(asset.id) : undefined}
              onDelete={() => handleDelete(asset)}
              onDownload={() => void handleDownload(asset)}
              onPreview={() => setPreviewAssetId(asset.id)}
            />
          ))
        )}
      </div>

      {previewAsset && (
        <CreativeAssetPreviewModal
          asset={previewAsset}
          onClose={() => setPreviewAssetId(null)}
          onDelete={() => handleDelete(previewAsset)}
          onDownload={() => void handleDownload(previewAsset)}
          onSave={(input) => handleSaveMetadata(previewAsset, input)}
        />
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-base-200/70 px-2 py-1">
      <div className="font-semibold text-base-content/80">{value}</div>
      <div>{label}</div>
    </div>
  );
}

function CreativeAssetCard({
  active,
  asset,
  showAddToCanvas,
  onAddToCanvas,
  onDelete,
  onDownload,
  onPreview,
}: {
  active: boolean;
  asset: CreativeAsset;
  showAddToCanvas: boolean;
  onAddToCanvas?: () => void;
  onDelete: () => void;
  onDownload: () => void;
  onPreview: () => void;
}) {
  const previewUrl = getCreativeAssetPreviewUrl(asset);

  return (
    <div
      className={`group rounded-lg border p-2 transition-colors ${
        active ? "border-primary bg-primary/5" : "border-base-300 bg-base-100/70 hover:bg-base-200/70"
      }`}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(CREATIVE_ASSET_DRAG_TYPE, JSON.stringify({ assetId: asset.id }));
        event.dataTransfer.effectAllowed = "copy";
      }}
      onDoubleClick={onAddToCanvas}
    >
      <div className="flex gap-3">
        <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-md bg-base-200">
          <AssetThumbnail asset={asset} previewUrl={previewUrl} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{asset.title}</div>
              <div className="mt-1 line-clamp-2 text-xs text-base-content/50">
                {asset.kind === "text" ? asset.text || "文本素材" : asset.mimeType || CREATIVE_ASSET_KIND_LABELS[asset.kind]}
              </div>
            </div>
            <span className="badge badge-xs badge-outline flex-shrink-0">
              {CREATIVE_ASSET_SOURCE_LABELS[asset.source]}
            </span>
          </div>

          {asset.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {asset.tags.slice(0, 3).map((tag) => (
                <span key={tag} className="badge badge-xs bg-base-200 text-base-content/60">
                  {tag}
                </span>
              ))}
            </div>
          )}

          <div className="mt-2 flex items-center gap-1">
            {showAddToCanvas && (
              <button className="btn btn-primary btn-xs" onClick={onAddToCanvas}>
                放入
              </button>
            )}
            <IconButton title="预览" onClick={onPreview}>
              <Eye className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton title="下载" onClick={onDownload}>
              <Download className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton className="text-error hover:bg-error/10" title="删除" onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5" />
            </IconButton>
          </div>
        </div>
      </div>
    </div>
  );
}

function IconButton({
  children,
  className = "",
  title,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  title: string;
  onClick?: () => void;
}) {
  return (
    <button
      className={`btn btn-ghost btn-xs btn-circle opacity-80 group-hover:opacity-100 ${className}`}
      title={title}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
    >
      {children}
    </button>
  );
}

function AssetThumbnail({ asset, previewUrl }: { asset: CreativeAsset; previewUrl: string }) {
  const media = useResilientMedia(previewUrl, "image");
  if (asset.kind === "image" && previewUrl && !media.failed) {
    return (
      <img
        key={media.stage}
        src={media.src}
        crossOrigin={media.crossOrigin}
        alt={asset.title}
        className="h-full w-full object-cover"
        onError={media.onMediaError}
      />
    );
  }

  const Icon = asset.kind === "video" ? FileVideo : asset.kind === "audio" ? FileAudio : asset.kind === "text" ? Type : Images;
  return <Icon className="h-6 w-6 text-base-content/40" />;
}

interface AssetMetadataInput {
  title: string;
  tags: string;
  note: string;
}

function CreativeAssetPreviewModal({
  asset,
  onClose,
  onDelete,
  onDownload,
  onSave,
}: {
  asset: CreativeAsset;
  onClose: () => void;
  onDelete: () => void;
  onDownload: () => void;
  onSave: (input: AssetMetadataInput) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState<AssetMetadataInput>({
    title: asset.title,
    tags: asset.tags.join(", "),
    note: asset.note || "",
  });

  const previewUrl = getCreativeAssetPreviewUrl(asset);

  const save = () => {
    onSave(input);
    setEditing(false);
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex max-h-[86vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-base-300 bg-base-100 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-base-300 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate font-semibold">{asset.title}</div>
            <div className="text-xs text-base-content/50">
              {CREATIVE_ASSET_KIND_LABELS[asset.kind]} · {CREATIVE_ASSET_SOURCE_LABELS[asset.source]} · {getCreativeAssetSizeLabel(asset)}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button className="btn btn-ghost btn-sm btn-circle" title="下载" onClick={onDownload}>
              <Download className="h-4 w-4" />
            </button>
            <button className="btn btn-ghost btn-sm btn-circle" title="编辑信息" onClick={() => setEditing((value) => !value)}>
              <Edit3 className="h-4 w-4" />
            </button>
            <button className="btn btn-ghost btn-sm btn-circle text-error hover:bg-error/10" title="删除" onClick={onDelete}>
              <Trash2 className="h-4 w-4" />
            </button>
            <button className="btn btn-ghost btn-sm btn-circle" title="关闭" onClick={onClose}>
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_280px] overflow-hidden">
          <div className="min-h-[360px] overflow-auto bg-base-200/60 p-4">
            <AssetPreviewBody asset={asset} previewUrl={previewUrl} />
          </div>

          <div className="overflow-y-auto border-l border-base-300 p-4">
            {editing ? (
              <div className="space-y-3">
                <label className="form-control">
                  <span className="label-text text-xs">标题</span>
                  <input
                    className="input input-sm input-bordered"
                    value={input.title}
                    onChange={(event) => setInput((state) => ({ ...state, title: event.target.value }))}
                  />
                </label>
                <label className="form-control">
                  <span className="label-text text-xs">标签</span>
                  <input
                    className="input input-sm input-bordered"
                    placeholder="品牌, 海报, 参考图"
                    value={input.tags}
                    onChange={(event) => setInput((state) => ({ ...state, tags: event.target.value }))}
                  />
                </label>
                <label className="form-control">
                  <span className="label-text text-xs">备注</span>
                  <textarea
                    className="textarea textarea-bordered min-h-24 text-sm"
                    value={input.note}
                    onChange={(event) => setInput((state) => ({ ...state, note: event.target.value }))}
                  />
                </label>
                <div className="flex justify-end gap-2">
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
                    取消
                  </button>
                  <button className="btn btn-primary btn-sm" onClick={save}>
                    保存
                  </button>
                </div>
              </div>
            ) : (
              <AssetMetadata asset={asset} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function AssetPreviewBody({ asset, previewUrl }: { asset: CreativeAsset; previewUrl: string }) {
  const mediaKind: MediaKind =
    asset.kind === "video" ? "video" : asset.kind === "audio" ? "audio" : "image";
  const media = useResilientMedia(previewUrl, mediaKind);

  if (asset.kind === "text") {
    return (
      <pre className="min-h-full whitespace-pre-wrap break-words rounded-lg bg-base-100 p-4 text-sm leading-6 text-base-content">
        {asset.text || ""}
      </pre>
    );
  }

  if (asset.kind === "image" && previewUrl && !media.failed) {
    return (
      <img
        key={media.stage}
        src={media.src}
        crossOrigin={media.crossOrigin}
        alt={asset.title}
        className="mx-auto max-h-[64vh] max-w-full rounded-md object-contain"
        onError={media.onMediaError}
      />
    );
  }

  if (asset.kind === "video" && previewUrl && !media.failed) {
    return (
      <video
        key={media.stage}
        src={media.src}
        crossOrigin={media.crossOrigin}
        className="h-full max-h-[64vh] w-full rounded-md bg-black object-contain"
        controls
        onError={media.onMediaError}
        onCanPlay={media.onMediaReady}
      />
    );
  }

  if (asset.kind === "audio" && previewUrl && !media.failed) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <audio
          key={media.stage}
          src={media.src}
          crossOrigin={media.crossOrigin}
          controls
          className="w-full max-w-xl"
          onError={media.onMediaError}
          onCanPlay={media.onMediaReady}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-[320px] flex-col items-center justify-center gap-2 text-base-content/40">
      <Images className="h-8 w-8" />
      <span className="text-sm">{previewUrl && media.failed ? "素材加载失败" : "素材预览缺失"}</span>
    </div>
  );
}

function AssetMetadata({ asset }: { asset: CreativeAsset }) {
  return (
    <div className="space-y-4 text-sm">
      <InfoRow label="类型" value={CREATIVE_ASSET_KIND_LABELS[asset.kind]} />
      <InfoRow label="来源" value={CREATIVE_ASSET_SOURCE_LABELS[asset.source]} />
      <InfoRow label="文件名" value={asset.fileName || "未记录"} />
      <InfoRow label="MIME" value={asset.mimeType || "未记录"} />
      <InfoRow label="大小" value={getCreativeAssetSizeLabel(asset)} />
      <InfoRow label="更新时间" value={new Date(asset.updatedAt).toLocaleString()} />
      {asset.note && (
        <div>
          <div className="mb-1 text-xs text-base-content/45">备注</div>
          <div className="whitespace-pre-wrap rounded-md bg-base-200/70 p-2 text-base-content/70">{asset.note}</div>
        </div>
      )}
      <div>
        <div className="mb-1 text-xs text-base-content/45">标签</div>
        {asset.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {asset.tags.map((tag) => (
              <span key={tag} className="badge badge-sm bg-base-200 text-base-content/70">
                {tag}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-base-content/40">未设置</span>
        )}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-base-content/45">{label}</div>
      <div className="mt-0.5 break-words text-base-content/75">{value}</div>
    </div>
  );
}
