import { memo, useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { X, Check, Loader2, ImageIcon } from "lucide-react";

// 内置模板定义
export interface BuiltinTemplate {
  id: string;
  name: string;
  description: string;
  thumbnailUrl: string;  // 缩略图 URL（用于展示）
  fullUrl: string;       // 完整图片 URL（用于加载）
}

// 内置模板列表
export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    id: "template_1",
    name: "简约蓝",
    description: "简洁的蓝色调商务模板，适合学术和技术演示",
    thumbnailUrl: "/templates/template_1.png",
    fullUrl: "/templates/template_1.png",
  },
  // 后续可以添加更多模板
];

interface BuiltinTemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (template: BuiltinTemplate, imageData: string) => void;
}

// 将图片 URL 转换为 base64
async function imageUrlToBase64(url: string): Promise<string> {
  const response = await fetch(url);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // 提取 base64 部分（去掉 data:image/xxx;base64, 前缀）
      const base64 = result.split(",")[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export const BuiltinTemplateModal = memo(({ isOpen, onClose, onSelect }: BuiltinTemplateModalProps) => {
  const [isVisible, setIsVisible] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // 处理弹窗动画
  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => setIsVisible(true));
    } else {
      setIsVisible(false);
    }
  }, [isOpen]);

  // 处理关闭
  const handleClose = useCallback(() => {
    setIsVisible(false);
    setTimeout(() => {
      onClose();
      setSelectedId(null);
    }, 200);
  }, [onClose]);

  // ESC 键关闭
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleClose]);

  // 处理选择确认
  const handleConfirm = useCallback(async () => {
    if (!selectedId) return;

    const template = BUILTIN_TEMPLATES.find(t => t.id === selectedId);
    if (!template) return;

    setIsLoading(true);
    try {
      // 加载图片并转换为 base64
      const imageData = await imageUrlToBase64(template.fullUrl);
      onSelect(template, imageData);
      handleClose();
    } catch (error) {
      console.error("加载模板图片失败:", error);
    } finally {
      setIsLoading(false);
    }
  }, [selectedId, onSelect, handleClose]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className={`
        fixed inset-0 flex items-center justify-center z-50
        transition-all duration-200 ease-out
        ${isVisible ? "bg-black/50" : "bg-black/0"}
      `}
      onClick={handleClose}
    >
      <div
        className={`
          bg-base-100 rounded-xl shadow-2xl w-[600px] max-h-[80vh] flex flex-col
          transition-all duration-200 ease-out
          ${isVisible
            ? "opacity-100 scale-100 translate-y-0"
            : "opacity-0 scale-95 translate-y-4"
          }
        `}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-base-300">
          <div className="flex items-center gap-2">
            <ImageIcon className="w-5 h-5 text-primary" />
            <span className="font-medium text-lg">选择内置模板</span>
          </div>
          <button
            className="btn btn-ghost btn-sm btn-circle"
            onClick={handleClose}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 模板列表 */}
        <div className="flex-1 overflow-y-auto p-5">
          <div className="grid grid-cols-2 gap-4">
            {BUILTIN_TEMPLATES.map((template) => {
              const isSelected = selectedId === template.id;
              return (
                <div
                  key={template.id}
                  className={`
                    relative rounded-xl border-2 overflow-hidden cursor-pointer
                    transition-all duration-200
                    ${isSelected
                      ? "border-primary shadow-lg shadow-primary/20"
                      : "border-base-300 hover:border-base-content/30"
                    }
                  `}
                  onClick={() => setSelectedId(template.id)}
                >
                  {/* 缩略图 */}
                  <div className="aspect-video bg-base-200 relative overflow-hidden">
                    <img
                      src={template.thumbnailUrl}
                      alt={template.name}
                      className="w-full h-full object-cover"
                    />
                    {/* 选中指示器 */}
                    {isSelected && (
                      <div className="absolute top-2 right-2 w-6 h-6 bg-primary rounded-full flex items-center justify-center">
                        <Check className="w-4 h-4 text-primary-content" />
                      </div>
                    )}
                  </div>
                  {/* 信息 */}
                  <div className="p-3">
                    <div className="font-medium text-sm">{template.name}</div>
                    <div className="text-xs text-base-content/60 mt-0.5">
                      {template.description}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 空状态提示 */}
          {BUILTIN_TEMPLATES.length === 0 && (
            <div className="text-center py-12 text-base-content/50">
              <ImageIcon className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>暂无内置模板</p>
            </div>
          )}
        </div>

        {/* 底部操作 */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-base-300">
          <button
            className="btn btn-ghost"
            onClick={handleClose}
          >
            取消
          </button>
          <button
            className="btn btn-primary gap-2"
            onClick={handleConfirm}
            disabled={!selectedId || isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                加载中...
              </>
            ) : (
              "使用此模板"
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
});

BuiltinTemplateModal.displayName = "BuiltinTemplateModal";
