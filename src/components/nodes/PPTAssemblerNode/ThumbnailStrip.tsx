import type { PPTPageData } from "./types";

interface ThumbnailStripProps {
  pages: PPTPageData[];
  currentPage: number;
  onPageSelect: (index: number) => void;
}

export function ThumbnailStrip({
  pages,
  currentPage,
  onPageSelect,
}: ThumbnailStripProps) {
  if (pages.length === 0) {
    return null;
  }

  return (
    <div className="flex gap-1 overflow-x-auto pb-1 -mx-1 px-1">
      {pages.map((page, index) => {
        // 优先使用缩略图，减少内存占用
        const imageUrl = page.thumbnail
          ? `data:image/jpeg;base64,${page.thumbnail}`
          : page.image
          ? `data:image/png;base64,${page.image}`
          : undefined;

        return (
          <button
            key={index}
            className={`
              flex-shrink-0 w-12 h-9 rounded overflow-hidden border-2
              ${currentPage === index
                ? "border-primary ring-2 ring-primary/20"
                : "border-base-300 hover:border-base-content/30"
              }
            `}
            onClick={() => onPageSelect(index)}
            title={`第 ${page.pageNumber} 页: ${page.heading || "无标题"}`}
          >
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={`Page ${page.pageNumber}`}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-base-200 flex items-center justify-center">
                <span className="text-[8px] text-base-content/30">{page.pageNumber}</span>
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
