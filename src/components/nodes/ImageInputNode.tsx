import { memo, useCallback, useRef, useState } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { ImagePlus, Upload, X, Maximize2 } from "lucide-react";
import { useFlowStore } from "@/stores/flowStore";
import { useCanvasStore } from "@/stores/canvasStore";
import { ImagePreviewModal } from "@/components/ui/ImagePreviewModal";
import { getImageUrl, saveImage, isTauriEnvironment } from "@/services/fileStorageService";
import type { ImageInputNodeData } from "@/types";

// 定义节点类型
type ImageInputNode = Node<ImageInputNodeData>;

// 图片输入节点
export const ImageInputNode = memo(({ id, data, selected }: NodeProps<ImageInputNode>) => {
  const updateNodeData = useFlowStore((state) => state.updateNodeData);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const processFile = useCallback(async (file: File) => {
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      console.warn("Only image files are supported");
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(",")[1];
      const { activeCanvasId } = useCanvasStore.getState();

      // 内存优化：在 Tauri 环境中立即保存到文件系统，不在内存中保留 base64
      if (isTauriEnvironment() && activeCanvasId) {
        try {
          const imageInfo = await saveImage(
            base64,
            activeCanvasId,
            id,
            undefined,
            undefined,
            "input"
          );
          // 只保存文件路径，不保存 base64 到内存
          updateNodeData<ImageInputNodeData>(id, {
            imageData: undefined,
            fileName: file.name,
            imagePath: imageInfo.path,
          });
        } catch (err) {
          console.warn("保存图片到文件系统失败，回退到内存存储:", err);
          // 回退：保存到内存
          updateNodeData<ImageInputNodeData>(id, {
            imageData: base64,
            fileName: file.name,
            imagePath: undefined,
          });
        }
      } else {
        // 非 Tauri 环境：保存到内存
        updateNodeData<ImageInputNodeData>(id, {
          imageData: base64,
          fileName: file.name,
          imagePath: undefined,
        });
      }
    };
    reader.readAsDataURL(file);
  }, [id, updateNodeData]);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (file.type.startsWith("image/")) {
        await processFile(file);
      }
    }
  }, [processFile]);

  const handleClearImage = useCallback(() => {
    updateNodeData<ImageInputNodeData>(id, {
      imageData: undefined,
      fileName: undefined,
      imagePath: undefined,
    });
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [id, updateNodeData]);

  return (
    <>
      <div
        className={`
        w-[200px] rounded-xl bg-base-100 shadow-lg border-2 transition-all cursor-default
        ${selected ? "border-primary shadow-primary/20" : isDragging ? "border-primary ring-2 ring-primary/30" : "border-base-300"}
      `}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* 节点头部 */}
        <div className="flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-green-500 to-emerald-500 rounded-t-lg">
          <ImagePlus className="w-4 h-4 text-white" />
          <span className="text-sm font-medium text-white">{data.label}</span>
        </div>

        {/* 节点内容 */}
        <div className="p-2 nodrag">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileSelect}
          />

          {data.imageData || data.imagePath ? (
            <div className="relative">
              <div
                className="w-full h-[120px] overflow-hidden rounded-lg bg-base-200 cursor-pointer group pointer-events-none"
                onClick={() => setShowPreview(true)}
              >
                <img
                  src={
                    data.imagePath
                      ? getImageUrl(data.imagePath)
                      : data.imageData
                        ? `data:image/png;base64,${data.imageData}`
                        : ""
                  }
                  alt="Input"
                  className={`w-full h-full object-cover transition-opacity ${isDragging ? "opacity-50" : "opacity-100"}`}
                />
                {/* 遮罩优化：使其不拦截父级拖拽事件 */}
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center pointer-events-auto">
                  <Maximize2 className="w-6 h-6 text-white" />
                </div>
              </div>
              <button
                className="btn btn-circle btn-xs btn-error absolute top-1 right-1 opacity-80 hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  handleClearImage();
                }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <X className="w-3 h-3" />
              </button>
              {data.fileName && (
                <p className="text-xs text-base-content/60 mt-1.5 truncate px-0.5">
                  {data.fileName}
                </p>
              )}
            </div>
          ) : (
            <button
              className="btn btn-ghost w-full h-[120px] border-2 border-dashed border-base-300 hover:border-primary flex-col gap-1"
              onClick={() => fileInputRef.current?.click()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <Upload className="w-6 h-6 text-base-content/40" />
              <span className="text-xs text-base-content/60">点击上传图片</span>
            </button>
          )}
        </div>

        {/* 输出端口 - image 类型 */}
        <Handle
          type="source"
          position={Position.Right}
          id="output-image"
          className="!w-3 !h-3 !bg-green-500 !border-2 !border-white"
        />
      </div>

      {/* 预览弹窗 */}
      {showPreview && (data.imageData || data.imagePath) && (
        <ImagePreviewModal
          imageData={data.imageData}
          imagePath={data.imagePath}
          onClose={() => setShowPreview(false)}
          fileName={data.fileName}
        />
      )}
    </>
  );
});

ImageInputNode.displayName = "ImageInputNode";
