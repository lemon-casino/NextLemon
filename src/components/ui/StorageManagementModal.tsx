import { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  X,
  HardDrive,
  Image,
  Trash2,
  RefreshCw,
  FolderOpen,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { useStorageManagementStore } from "@/stores/storageManagementStore";
import { useCanvasStore } from "@/stores/canvasStore";
import { formatFileSize, getImageUrl, type ImageInfoWithMetadata } from "@/services/fileStorageService";
import { LoadingIndicator } from "@/components/ui/LoadingIndicator";
import { ImageDetailModal } from "@/components/ui/ImageDetailModal";

export function StorageManagementModal() {
  const {
    isOpen,
    isLoading,
    isTauri,
    fileStats,
    storagePath,
    expandedFileCanvases,
    canvasImages,
    error,
    closeModal,
    refreshStats,
    handleClearCache,
    handleClearAllImages,
    handleClearCanvasImages,
    handleDeleteImage,
    toggleFileCanvasExpanded,
    loadCanvasImages,
  } = useStorageManagementStore();

  const { canvases } = useCanvasStore();

  // 动画状态
  const [isVisible, setIsVisible] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  // 删除确认状态
  const [deleteConfirm, setDeleteConfirm] = useState<{
    type: "image" | "canvas" | "allImages";
    path?: string;
    filename?: string;
    canvasId?: string;
    canvasName?: string;
  } | null>(null);

  // 图片详情预览状态
  const [selectedImage, setSelectedImage] = useState<ImageInfoWithMetadata | null>(null);

  // 搜索状态
  const [searchQuery, setSearchQuery] = useState("");

  // 进入动画
  useEffect(() => {
    if (isOpen) {
      setIsClosing(false);
      requestAnimationFrame(() => setIsVisible(true));
    }
  }, [isOpen]);

  // 关闭时先播放退出动画
  const handleClose = useCallback(() => {
    setIsClosing(true);
    setIsVisible(false);
    setTimeout(() => {
      closeModal();
      setIsClosing(false);
    }, 200);
  }, [closeModal]);

  // ESC 键关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        handleClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleClose]);

  // 当用户输入搜索关键词时，自动加载所有画布的图片数据
  useEffect(() => {
    if (!searchQuery.trim() || !fileStats || !isTauri) return;

    // 加载所有未加载的画布图片
    const loadAllCanvasImages = async () => {
      const canvasIds = fileStats.images_by_canvas.map(c => c.canvas_id);
      const unloadedCanvasIds = canvasIds.filter(id => !canvasImages.has(id));

      // 并行加载所有未加载的画布图片
      await Promise.all(
        unloadedCanvasIds.map(canvasId => loadCanvasImages(canvasId))
      );
    };

    loadAllCanvasImages();
  }, [searchQuery, fileStats, isTauri, canvasImages, loadCanvasImages]);

  if (!isOpen) return null;

  // 获取画布名称
  const getCanvasName = (canvasId: string): string => {
    const canvas = canvases.find((c) => c.id === canvasId);
    return canvas?.name || `Canvas ${canvasId.slice(0, 8)}...`;
  };

  // 执行确认的删除操作
  const executeDelete = async () => {
    if (!deleteConfirm) return;

    const { type, path, canvasId } = deleteConfirm;
    setDeleteConfirm(null);

    switch (type) {
      case "image":
        if (path) await handleDeleteImage(path);
        break;
      case "canvas":
        if (canvasId) await handleClearCanvasImages(canvasId);
        break;
      case "allImages":
        await handleClearAllImages();
        break;
    }
  };

  // 确认清理所有图片
  const confirmClearAllImages = () => {
    setDeleteConfirm({ type: "allImages" });
  };

  // 确认清理画布图片
  const confirmClearCanvasImages = (canvasId: string, canvasName: string) => {
    setDeleteConfirm({ type: "canvas", canvasId, canvasName });
  };

  // 确认删除单个图片
  const confirmDeleteImage = (e: React.MouseEvent, path: string, filename: string) => {
    e.stopPropagation();
    setDeleteConfirm({ type: "image", path, filename });
  };

  // 获取确认对话框的提示信息
  const getDeleteConfirmMessage = () => {
    if (!deleteConfirm) return "";
    switch (deleteConfirm.type) {
      case "image":
        return `Are you sure you want to delete image "${deleteConfirm.filename}"? This action cannot be undone.`;
      case "canvas":
        return `Are you sure you want to delete all images in canvas "${deleteConfirm.canvasName}"? This action cannot be undone.`;
      case "allImages":
        return "Are you sure you want to delete all stored images? This action cannot be undone and image references in canvases will be broken.";
    }
  };

  // 渲染文件存储内容（桌面端）
  const renderFileStorage = () => {
    if (!fileStats) {
      return (
        <div className="flex items-center justify-center py-12 text-white/30">
          <p>Unable to get file storage information</p>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {/* 搜索框 */}
        <div className="relative">
          <input
            type="text"
            placeholder="Search prompts..."
            className="input input-sm w-full bg-black/20 border-white/10 text-white placeholder:text-white/20 focus:border-primary/50 focus:outline-none pr-8 transition-colors"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-full hover:bg-white/10 text-white/40 hover:text-white transition-colors"
              onClick={() => setSearchQuery("")}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* 总览卡片 */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white/5 rounded-xl p-3 border border-white/5">
            <div className="flex items-center gap-2 text-white/50 mb-1">
              <Image className="w-3.5 h-3.5" />
              <span className="text-[10px] uppercase tracking-wider">Images</span>
            </div>
            <p className="text-xl font-bold font-outfit text-white">{fileStats.image_count}</p>
          </div>
          <div className="bg-white/5 rounded-xl p-3 border border-white/5">
            <div className="flex items-center gap-2 text-white/50 mb-1">
              <HardDrive className="w-3.5 h-3.5" />
              <span className="text-[10px] uppercase tracking-wider">Size</span>
            </div>
            <p className="text-xl font-bold font-outfit text-white">{formatFileSize(fileStats.total_size)}</p>
          </div>
          <div className="bg-white/5 rounded-xl p-3 border border-white/5">
            <div className="flex items-center gap-2 text-white/50 mb-1">
              <FolderOpen className="w-3.5 h-3.5" />
              <span className="text-[10px] uppercase tracking-wider">Cache</span>
            </div>
            <p className="text-xl font-bold font-outfit text-white">{formatFileSize(fileStats.cache_size)}</p>
          </div>
        </div>

        {/* 存储路径 */}
        {storagePath && (
          <div className="bg-white/5 rounded-lg p-3 border border-white/5">
            <p className="text-xs text-white/40 mb-1 uppercase tracking-wider">Location</p>
            <p className="text-sm font-mono break-all text-white/80">{storagePath}</p>
          </div>
        )}

        {/* 按画布分组的存储 */}
        {fileStats.images_by_canvas.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">By Canvas</h3>
            <div className="space-y-2">
              {fileStats.images_by_canvas.map((canvasStats) => {
                const canvasName = getCanvasName(canvasStats.canvas_id);
                const isExpanded = expandedFileCanvases.includes(canvasStats.canvas_id);
                const allImages = canvasImages.get(canvasStats.canvas_id) || [];

                // 根据搜索关键词过滤图片
                const filteredImages = !searchQuery.trim()
                  ? allImages
                  : allImages.filter((image) => {
                    const query = searchQuery.toLowerCase();
                    // 搜索提示词
                    const promptMatch = image.metadata?.prompt?.toLowerCase().includes(query);
                    // 搜索文件名
                    const filenameMatch = image.filename.toLowerCase().includes(query);
                    return promptMatch || filenameMatch;
                  });

                // 如果有搜索关键词且没有匹配结果，不显示这个画布分组
                if (searchQuery.trim() && filteredImages.length === 0) {
                  return null;
                }

                return (
                  <div
                    key={canvasStats.canvas_id}
                    className="border border-white/10 rounded-lg overflow-hidden transition-colors"
                  >
                    {/* 画布头部 */}
                    <div
                      className="flex items-center justify-between bg-white/5 p-3 cursor-pointer hover:bg-white/10 transition-colors"
                      onClick={() => toggleFileCanvasExpanded(canvasStats.canvas_id)}
                    >
                      <div className="flex items-center gap-2">
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4 text-white/50" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-white/50" />
                        )}
                        <div>
                          <p className="font-medium text-sm text-white/90">{canvasName}</p>
                          <p className="text-xs text-white/50">
                            {searchQuery.trim()
                              ? `${filteredImages.length} / ${canvasStats.image_count} images`
                              : `${canvasStats.image_count} images`
                            } · {formatFileSize(canvasStats.total_size)}
                          </p>
                        </div>
                      </div>
                      <button
                        className="glass-btn btn-sm btn-square text-error/70 hover:text-error hover:bg-error/10"
                        onClick={(e) => {
                          e.stopPropagation();
                          confirmClearCanvasImages(canvasStats.canvas_id, canvasName);
                        }}
                        disabled={isLoading}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    {/* 展开的图片列表 */}
                    {isExpanded && (
                      <div className="p-3 space-y-2 bg-black/20">
                        {allImages.length === 0 ? (
                          <div className="text-center py-4 text-white/30 text-sm">
                            <LoadingIndicator size="md" variant="dots" className="text-primary mx-auto mb-2" />
                            Loading...
                          </div>
                        ) : filteredImages.length === 0 ? (
                          <div className="text-center py-4 text-white/30 text-sm">
                            <Image className="w-8 h-8 mx-auto mb-2 opacity-30" />
                            <p>No matching images</p>
                          </div>
                        ) : (
                          filteredImages.map((image) => (
                            <div
                              key={image.id}
                              className="flex items-center gap-3 p-2 bg-white/5 rounded-lg cursor-pointer hover:bg-white/10 transition-colors border border-transparent hover:border-white/5"
                              onClick={() => setSelectedImage(image)}
                            >
                              {/* 图片预览 */}
                              <div className="w-12 h-12 rounded overflow-hidden flex-shrink-0 bg-black/30 relative border border-white/5">
                                <img
                                  src={getImageUrl(image.path)}
                                  alt={image.filename}
                                  className="w-full h-full object-cover"
                                />
                                {/* 类型标签 */}
                                {image.image_type && (
                                  <div
                                    className={`absolute bottom-0 right-0 px-1 text-[9px] leading-tight text-white/90 font-medium ${image.image_type === "input"
                                        ? "bg-green-500/80 backdrop-blur-sm"
                                        : "bg-purple-500/80 backdrop-blur-sm"
                                      }`}
                                    title={image.image_type === "input" ? "Uploaded" : "Generated"}
                                  >
                                    {image.image_type === "input" ? "IN" : "GEN"}
                                  </div>
                                )}
                              </div>
                              {/* 图片信息 */}
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate text-white/80">{image.filename}</p>
                                <p className="text-xs text-white/40">
                                  {formatFileSize(image.size)} ·{" "}
                                  {new Date(image.created_at * 1000).toLocaleString('en-US', {
                                    year: 'numeric',
                                    month: 'numeric',
                                    day: 'numeric',
                                    hour: '2-digit',
                                    minute: '2-digit'
                                  })}
                                </p>
                              </div>
                              {/* 删除按钮 */}
                              <button
                                className="glass-btn btn-xs btn-square text-error/70 hover:text-error hover:bg-error/10"
                                onClick={(e) => confirmDeleteImage(e, image.path, image.filename)}
                                disabled={isLoading}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 空状态 */}
        {fileStats.image_count === 0 && fileStats.cache_size === 0 && (
          <div className="text-center py-8 text-white/30">
            <Image className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>No stored images or cache</p>
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex gap-2 pt-3 border-t border-white/10">
          <button
            className="glass-btn btn-sm flex-1"
            onClick={refreshStats}
            disabled={isLoading}
          >
            {isLoading ? <LoadingIndicator size="sm" variant="dots" /> : <RefreshCw className="w-4 h-4" />}
            Refresh
          </button>
          <button
            className="glass-btn btn-sm flex-1"
            onClick={handleClearCache}
            disabled={isLoading || fileStats.cache_size === 0}
          >
            <FolderOpen className="w-4 h-4" />
            Clear Cache
          </button>
          <button
            className="glass-btn btn-sm flex-1 text-error hover:bg-error/10 hover:border-error/30"
            onClick={confirmClearAllImages}
            disabled={isLoading || fileStats.image_count === 0}
          >
            <Trash2 className="w-4 h-4" />
            Clear All Images
          </button>
        </div>
      </div>
    );
  };

  // 渲染浏览器环境内容
  const renderBrowserStorage = () => {
    return (
      <div className="space-y-4">
        {/* 存储位置 */}
        <div className="bg-white/5 rounded-lg p-3 border border-white/5">
          <p className="text-xs text-white/40 mb-1 uppercase tracking-wider">Location</p>
          <p className="text-sm font-mono text-white/80">{storagePath}</p>
        </div>

        {/* 说明信息 */}
        <div className="bg-info/10 rounded-lg p-3 text-sm border border-info/20">
          <p className="font-medium mb-2 text-info flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            Browser Storage
          </p>
          <ul className="text-xs space-y-1 text-white/70 list-disc list-inside">
            <li>Data is stored in browser localStorage</li>
            <li>Images are stored as base64 strings</li>
            <li>Clearing browser data will lose all data</li>
            <li>Desktop app recommended for better storage management</li>
          </ul>
        </div>

        {/* 操作按钮 */}
        <div className="flex gap-2 pt-3 border-t border-white/10">
          <button
            className="glass-btn btn-sm flex-1"
            onClick={refreshStats}
            disabled={isLoading}
          >
            {isLoading ? <LoadingIndicator size="sm" variant="dots" /> : <RefreshCw className="w-4 h-4" />}
            Refresh
          </button>
        </div>
      </div>
    );
  };

  const modalContent = createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      {/* 背景遮罩 */}
      <div
        className={`
          absolute inset-0 bg-black/40 backdrop-blur-sm
          transition-all duration-200 ease-out
          ${isVisible && !isClosing ? "opacity-100" : "opacity-0"}
        `}
        onClick={handleClose}
      />

      {/* Modal 内容 */}
      <div
        className={`
          relative glass-panel rounded-2xl shadow-2xl w-[650px] max-h-[85vh] overflow-hidden flex flex-col
          transition-all duration-200 ease-out border border-white/10
          ${isVisible && !isClosing
            ? "opacity-100 scale-100 translate-y-0"
            : "opacity-0 scale-95 translate-y-4"
          }
        `}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/20 rounded-lg text-primary border border-primary/20">
              <HardDrive className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-outfit font-semibold text-white">Storage Management</h2>
              <p className="text-xs text-white/50">
                Manage your application's stored images
              </p>
            </div>
          </div>
          <button className="glass-btn btn-square btn-sm rounded-full text-white/70 hover:text-white" onClick={handleClose}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 内容区域 */}
        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
          {/* 加载状态 */}
          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <LoadingIndicator size="lg" variant="dots" className="text-primary" />
            </div>
          )}

          {/* 错误状态 */}
          {error && (
            <div className="alert bg-error/10 border-error/20 text-error mb-4">
              <AlertTriangle className="w-5 h-5" />
              <span>{error}</span>
            </div>
          )}

          {/* 根据环境渲染内容 */}
          {!isLoading && isTauri && renderFileStorage()}
          {!isLoading && !isTauri && renderBrowserStorage()}
        </div>

        {/* 删除确认对话框 */}
        {deleteConfirm && (
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-10">
            <div className="glass-panel border border-error/30 rounded-xl p-5 mx-4 max-w-sm shadow-2xl animate-in zoom-in-95 duration-200">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-error/20 rounded-lg text-error">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <h3 className="font-semibold text-white">Confirm Deletion</h3>
              </div>
              <p className="text-sm text-white/70 mb-5 leading-relaxed">
                {getDeleteConfirmMessage()}
              </p>
              <div className="flex gap-2 justify-end">
                <button
                  className="glass-btn btn-sm"
                  onClick={() => setDeleteConfirm(null)}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-error btn-sm"
                  onClick={executeDelete}
                >
                  Confirm Delete
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );

  return (
    <>
      {modalContent}
      {/* 图片详情预览 */}
      {selectedImage && (
        <ImageDetailModal
          imageInfo={selectedImage}
          onClose={() => setSelectedImage(null)}
        />
      )}
    </>
  );
}
