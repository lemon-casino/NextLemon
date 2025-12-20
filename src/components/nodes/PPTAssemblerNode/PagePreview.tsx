import { useState } from "react";
import { ChevronLeft, ChevronRight, Maximize2 } from "lucide-react";
import type { PPTPageData } from "./types";
import { ImagePreviewModal } from "@/components/ui/ImagePreviewModal";

interface PagePreviewProps {
  pages: PPTPageData[];
  currentPage: number;
  onPageChange: (page: number) => void;
}

export function PagePreview({
  pages,
  currentPage,
  onPageChange,
}: PagePreviewProps) {
  const [showFullPreview, setShowFullPreview] = useState(false);

  const page = pages[currentPage];

  if (!page) {
    return (
      <div className="flex items-center justify-center h-[150px] bg-base-200 rounded-lg">
        <span className="text-base-content/40 text-sm">无页面数据</span>
      </div>
    );
  }

  // 优先使用缩略图预览，减少内存占用
  const previewImageUrl = page.thumbnail
    ? `data:image/jpeg;base64,${page.thumbnail}`
    : page.image
    ? `data:image/png;base64,${page.image}`
    : undefined;

  return (
    <>
      <div className="space-y-2">
        {/* 预览区域 - 使用缩略图显示 */}
        <div
          className="relative bg-base-200 rounded-lg overflow-hidden cursor-pointer group"
          onClick={() => page.image && setShowFullPreview(true)}
        >
          <div className="aspect-video">
            {previewImageUrl ? (
              <img
                src={previewImageUrl}
                alt={`Page ${page.pageNumber}`}
                className="w-full h-full object-contain"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <span className="text-xs text-base-content/30">暂无图片</span>
              </div>
            )}
          </div>

          {/* 悬浮放大按钮 */}
          {page.image && (
            <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 flex items-center justify-center">
              <Maximize2 className="w-8 h-8 text-white" />
            </div>
          )}
        </div>

        {/* 页面信息 */}
        <div className="text-xs text-base-content/60 truncate" title={page.heading}>
          {page.heading}
        </div>

        {/* 导航控制 */}
        <div className="flex items-center justify-between">
          <button
            className="btn btn-ghost btn-sm btn-circle"
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage === 0}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <span className="text-xs text-base-content/60">
            第 {currentPage + 1} 页 / 共 {pages.length} 页
          </span>

          <button
            className="btn btn-ghost btn-sm btn-circle"
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage === pages.length - 1}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 图片全屏预览 - 使用原图显示高质量图片 */}
      {showFullPreview && page.image && (
        <ImagePreviewModal
          imageData={page.image}
          onClose={() => setShowFullPreview(false)}
        />
      )}
    </>
  );
}
