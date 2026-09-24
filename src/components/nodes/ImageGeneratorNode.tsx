import { memo, useRef, useCallback, useState, useEffect } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { Sparkles, Zap, Play, AlertCircle, Maximize2, AlertTriangle, CircleAlert } from "lucide-react";
import { useFlowStore } from "@/stores/flowStore";
import { useCanvasStore } from "@/stores/canvasStore";
import { generateImage, editImage } from "@/services/imageService";
import { saveImage, getImageUrl, isTauriEnvironment, type InputImageInfo } from "@/services/fileStorageService";
import { ImagePreviewModal } from "@/components/ui/ImagePreviewModal";
import { ErrorDetailModal } from "@/components/ui/ErrorDetailModal";
import { ModelSelector } from "@/components/ui/ModelSelector";
import { useLoadingDots } from "@/hooks/useLoadingDots";
import type { ImageGeneratorNodeData, ImageInputNodeData, ModelType } from "@/types";
import { IMAGE_COUNT_OPTIONS, normalizeImageCount } from "@/types/generation";
import { useImagePresetModels, getDynamicDefaultModel } from "@/config/presetModels";

// 定义节点类型
type ImageGeneratorNode = Node<ImageGeneratorNodeData>;

// Pro 节点预设模型选项 (已废弃，改用 hook)
// const proPresetModels = ...

// Fast 节点预设模型选项 (已废弃，改用 hook)
// const fastPresetModels = ...

// 基础宽高比选项（NanoBanana 使用）
const basicAspectRatioOptions = [
  { value: "1:1", label: "1:1" },
  { value: "16:9", label: "16:9" },
  { value: "9:16", label: "9:16" },
  { value: "4:3", label: "4:3" },
  { value: "3:4", label: "3:4" },
];

// Pro 宽高比选项（NanoBanana Pro 使用，支持更多比例）
const proAspectRatioOptions = [
  { value: "1:1", label: "1:1" },
  { value: "16:9", label: "16:9" },
  { value: "9:16", label: "9:16" },
  { value: "4:3", label: "4:3" },
  { value: "3:4", label: "3:4" },
  { value: "3:2", label: "3:2" },
  { value: "2:3", label: "2:3" },
  { value: "5:4", label: "5:4" },
  { value: "4:5", label: "4:5" },
  { value: "21:9", label: "21:9" },
];

const imageSizeOptions = [
  { value: "1K", label: "1K" },
  { value: "2K", label: "2K" },
  { value: "4K", label: "4K" },
];

// 格式化进度文本：提取最新内容并去除 Markdown
function formatProgressText(text?: string): string {
  if (!text) return "正在建立连接...";

  // 1. 如果包含 [Thinking]，提取最后一个段落
  const thinkingParts = text.split("[Thinking]");
  let content = thinkingParts.length > 1 ? thinkingParts[thinkingParts.length - 1] : text;

  // 2. 去除 Markdown 加粗符号 (**)
  content = content.replace(/\*\*/g, "").trim();

  // 3. 如果内容为空，或者只是空格
  if (!content) return "思考中...";

  return content;
}

// 状态气泡组件
function StatusBubble({ status, progress }: { status: string; progress?: string }) {
  const [expanded, setExpanded] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);

  // 监听状态变化，控制渲染和动画
  useEffect(() => {
    if (status === "loading") {
      setShouldRender(true);
    } else {
      const timer = setTimeout(() => setShouldRender(false), 300);
      return () => clearTimeout(timer);
    }
  }, [status]);

  if (!shouldRender) return null;

  const isExpanded = expanded && status === "loading";

  // 格式化日志内容：将长文本分割为按行显示的数组，并清理格式
  const logLines = (progress || "正在连接...")
    .split("[Thinking]")
    .map(line => line.replace(/\*\*/g, "").trim()) // 去除 markdown 加粗
    .filter(line => line.length > 0);              // 过滤空行

  return (
    <div
      className={`absolute top-0 -right-4 z-50 transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] ${isExpanded
        ? "w-[420px] -translate-y-4 translate-x-[calc(100%+16px)]"
        : "w-64 translate-x-full"
        }`}
    >
      <div
        className={`
          relative overflow-hidden
          bg-base-100/95 backdrop-blur-2xl
          border border-white/20 shadow-2xl shadow-primary/10
          transition-all duration-300
          ${isExpanded
            ? "rounded-2xl ring-1 ring-primary/10"
            : "rounded-full hover:bg-base-100 cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
          }
        `}
        onClick={() => !isExpanded && setExpanded(true)}
      >
        {/* 收起状态的胶囊视图 */}
        <div className={`
          flex items-center gap-3 px-4 py-2.5 transition-opacity duration-300
          ${isExpanded ? "opacity-0 absolute top-0 left-0 pointer-events-none" : "opacity-100"}
        `}>
          {/* 呼吸灯 */}
          <div className="relative flex h-2.5 w-2.5 flex-shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary shadow-lg shadow-primary/50"></span>
          </div>
          {/* 单行文本 */}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-base-content/90 truncate">
              {formatProgressText(progress)}
            </p>
          </div>
        </div>

        {/* 展开状态的详细视图 */}
        <div className={`
          flex flex-col h-full transition-all duration-300 ease-out origin-top
          ${isExpanded ? "opacity-100 scale-100" : "opacity-0 scale-95 absolute inset-0 pointer-events-none"}
        `}>
          {/* 标题栏 */}
          <div
            className="flex items-center justify-between px-4 py-3 border-b border-base-content/5 bg-base-200/30 cursor-pointer hover:bg-base-200/50 transition-colors"
            onClick={(e) => { e.stopPropagation(); setExpanded(false); }}
          >
            <div className="flex items-center gap-2">
              <div className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
              </div>
              <span className="text-xs font-bold text-primary tracking-wide">LIVE LOG</span>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-base-content/40 uppercase font-medium tracking-wider group">
              <span>Collapse</span>
              <div className="w-1.5 h-1.5 border-b border-l border-base-content/30 transform rotate-45 group-hover:-mt-0.5 transition-transform"></div>
            </div>
          </div>

          {/* 日志内容区域 */}
          <div className="p-4 max-h-[60vh] overflow-y-auto custom-scrollbar font-mono text-xs leading-relaxed space-y-2.5">
            {logLines.length > 0 ? (
              logLines.map((line, index) => (
                <div key={index} className="flex gap-2 animate-in fade-in slide-in-from-bottom-1 duration-300 items-start">
                  <span className="text-primary/40 mt-[3px] select-none">›</span>
                  <span className="text-base-content/80 break-words">{line}</span>
                </div>
              ))
            ) : (
              <div className="flex items-center gap-2 text-base-content/40 italic">
                <span className="loading loading-spinner loading-xs opacity-50"></span>
                <span>Connecting to neural network...</span>
              </div>
            )}
            {/* 底部占位，防止内容贴边 */}
            <div className="h-1" />
          </div>

          {/* 底部装饰条 */}
          <div className="h-0.5 w-full bg-gradient-to-r from-transparent via-primary/20 to-transparent opacity-50"></div>
        </div>
      </div>
    </div>
  );
}

// 通用图片生成器节点组件
function ImageGeneratorBase({
  id,
  data,
  selected,
  isPro,
}: NodeProps<ImageGeneratorNode> & { isPro: boolean }) {
  const { updateNodeData, getConnectedInputData, getConnectedInputDataAsync, getEmptyConnectedInputs, getConnectedImagesWithInfo } = useFlowStore();
  const [showPreview, setShowPreview] = useState(false);
  const [showErrorDetail, setShowErrorDetail] = useState(false);

  // 省略号加载动画
  const dots = useLoadingDots(data.status === "loading");

  // 检测空输入连接
  const emptyInputs = getEmptyConnectedInputs(id);
  const hasEmptyImageInputs = emptyInputs.emptyImages.length > 0;

  // 检测是否连接了提示词（包括空提示词的情况）
  const { prompt } = getConnectedInputData(id);
  const isPromptConnected = prompt !== undefined;

  // 保存生成时的画布 ID，用于确保结果更新到正确的画布
  const canvasIdRef = useRef<string | null>(null);

  // 获取对应的预设模型列表
  const nodeType = isPro ? "imageGeneratorPro" : "imageGeneratorFast";
  const { presetModels, defaultModel: configDefaultModel } = useImagePresetModels(nodeType);

  // 默认模型
  // 默认模型
  // 使用 centralized config，不再硬编码 fallback
  const defaultModel: ModelType = (configDefaultModel as ModelType) || getDynamicDefaultModel('image');

  // 使用节点数据中的模型，如果没有则使用默认模型
  const model: ModelType = data.model || defaultModel;

  // 生成张数（属性面板 1-4 张选择，旧数据缺省 1 张）
  const imageCount = normalizeImageCount(data.count);

  // 处理模型变更
  const handleModelChange = (value: string) => {
    updateNodeData<ImageGeneratorNodeData>(id, { model: value });
  };

  /**
   * 更新节点数据，同时更新 canvasStore 确保画布切换后数据正确
   */
  const updateNodeDataWithCanvas = useCallback((nodeId: string, nodeData: Partial<ImageGeneratorNodeData>) => {
    const { activeCanvasId } = useCanvasStore.getState();
    const targetCanvasId = canvasIdRef.current;

    // 始终更新 flowStore（当前活跃画布的数据）
    updateNodeData<ImageGeneratorNodeData>(nodeId, nodeData);

    // 如果目标画布不是当前活跃画布，也需要更新 canvasStore
    if (targetCanvasId && targetCanvasId !== activeCanvasId) {
      const canvasStore = useCanvasStore.getState();
      const canvas = canvasStore.canvases.find(c => c.id === targetCanvasId);

      if (canvas) {
        const updatedNodes = canvas.nodes.map(node => {
          if (node.id === nodeId) {
            return {
              ...node,
              data: { ...node.data, ...nodeData },
            };
          }
          return node;
        });

        useCanvasStore.setState(state => ({
          canvases: state.canvases.map(c =>
            c.id === targetCanvasId
              ? { ...c, nodes: updatedNodes, updatedAt: Date.now() }
              : c
          ),
        }));
      }
    }
  }, [updateNodeData]);

  const handleGenerate = useCallback(async () => {
    // 使用异步版本从文件按需加载图片数据
    const { prompt, images } = await getConnectedInputDataAsync(id);
    const { activeCanvasId } = useCanvasStore.getState();

    // 记录当前画布 ID
    canvasIdRef.current = activeCanvasId;

    if (!prompt) {
      updateNodeDataWithCanvas(id, {
        status: "error",
        error: "请连接提示词节点",
      });
      return;
    }

    updateNodeDataWithCanvas(id, {
      status: "loading",
      error: undefined,
    });

    try {
      // 根据 isPro 确定节点类型
      const nodeType = isPro ? "imageGeneratorPro" : "imageGeneratorFast";

      // 进度回调
      // 进度回调
      const onProgress = (text: string) => {
        // 如果包含 Markdown 图片标记，通过显示特定状态来隐藏乱码
        if (text.includes("![") || text.includes("data:image")) {
          updateNodeDataWithCanvas(id, {
            progress: "正在接收图片数据..."
          });
          return;
        }

        // 显示完整内容 (气泡会自动处理换行和截断)
        // 移除之前的 slice(-30) 限制，让用户看到更完整的思考/绘制过程
        updateNodeDataWithCanvas(id, {
          progress: text || "正在连接 API..."
        });
      };

      const response = images.length > 0
        ? await editImage({
          prompt,
          model,
          inputImages: images,
          aspectRatio: data.aspectRatio,
          imageSize: isPro ? data.imageSize : undefined,
          count: imageCount,
        }, nodeType, onProgress)
        : await generateImage({
          prompt,
          model,
          aspectRatio: data.aspectRatio,
          imageSize: isPro ? data.imageSize : undefined,
          count: imageCount,
        }, nodeType, onProgress);

      // 本次生成的全部图片（多图张数）：images 为聚合数组，imageData 兼容字段兜底首图
      const generatedImages =
        response.images && response.images.length > 0
          ? response.images
          : response.imageData
            ? [response.imageData]
            : [];

      // 部分失败信息（部分请求失败但仍有成功图片）：节点 UI 呈现「成功 N 张、失败 M 张」
      const failedCount = response.failedCount ?? 0;
      const partialPatch = failedCount > 0
        ? {
          partialFailedCount: failedCount,
          partialError: response.partialError,
          error: response.partialError,
        }
        : {
          partialFailedCount: undefined,
          partialError: undefined,
          error: undefined,
        };

      if (generatedImages.length > 0) {
        // 在 Tauri 环境中，将图片保存到文件系统
        if (isTauriEnvironment() && activeCanvasId) {
          try {
            // 1. 先处理输入图片（如果有且未保存到文件系统）
            const connectedImages = getConnectedImagesWithInfo(id);
            const inputImagesMetadata: InputImageInfo[] = [];

            for (const img of connectedImages) {
              let imagePath = img.imagePath;

              // 如果输入图片还没有保存到文件系统，现在保存
              if (!imagePath && img.imageData) {
                try {
                  const inputImageInfo = await saveImage(
                    img.imageData,
                    activeCanvasId,
                    img.id,  // 输入图片节点的 ID
                    undefined,
                    undefined,
                    "input"
                  );
                  imagePath = inputImageInfo.path;

                  // 更新输入图片节点的路径，避免下次重复保存
                  updateNodeData<ImageInputNodeData>(img.id, {
                    imagePath: inputImageInfo.path,
                  });
                } catch (err) {
                  console.warn("保存输入图片失败:", err);
                }
              }

              // 添加到元数据（有路径才添加）
              if (imagePath) {
                inputImagesMetadata.push({
                  path: imagePath,
                  label: img.fileName || "输入图片",
                });
              }
            }

            // 2. 逐张保存生成的图片（save_image 生成唯一文件名，不会互相覆盖），
            //    生成元数据只挂在首图上避免重复
            const outputImagePaths: string[] = [];
            for (const [index, img] of generatedImages.entries()) {
              const imageInfo = await saveImage(
                img,
                activeCanvasId,
                index === 0 ? id : `${id}-${index + 1}`,
                index === 0 ? prompt : undefined,
                index === 0 && inputImagesMetadata.length > 0 ? inputImagesMetadata : undefined,
                "generated"
              );
              outputImagePaths.push(imageInfo.path);
            }

            // 内存优化：只保存文件路径，不保存 base64 到内存
            updateNodeDataWithCanvas(id, {
              status: "success",
              outputImage: undefined,  // 不再保存 base64 到内存
              outputImagePath: outputImagePaths[0],
              outputImages: undefined,
              outputImagePaths,
              outputCount: generatedImages.length,
              ...partialPatch,
            });
          } catch (saveError) {
            // 如果文件保存失败，回退到仅 base64 存储
            console.warn("文件保存失败，回退到 base64 存储:", saveError);
            updateNodeDataWithCanvas(id, {
              status: "success",
              outputImage: generatedImages[0],
              outputImagePath: undefined,
              outputImages: generatedImages,
              outputImagePaths: undefined,
              outputCount: generatedImages.length,
              ...partialPatch,
            });
          }
        } else {
          // 非 Tauri 环境或没有画布 ID，使用 base64 存储
          updateNodeDataWithCanvas(id, {
            status: "success",
            outputImage: generatedImages[0],
            outputImagePath: undefined,
            outputImages: generatedImages,
            outputImagePaths: undefined,
            outputCount: generatedImages.length,
            ...partialPatch,
          });
        }
      } else if (response.error) {
        updateNodeDataWithCanvas(id, {
          status: "error",
          error: response.error,
          errorDetails: response.errorDetails,
        });
      } else {
        updateNodeDataWithCanvas(id, {
          status: "error",
          error: "未返回图片数据",
        });
      }
    } catch {
      updateNodeDataWithCanvas(id, {
        status: "error",
        error: "生成失败",
      });
    }
  }, [id, model, data.aspectRatio, data.imageSize, imageCount, isPro, updateNodeDataWithCanvas, getConnectedInputDataAsync, getConnectedImagesWithInfo]);

  // 节点样式配置
  const headerGradient = isPro
    ? "bg-gradient-to-r from-purple-500 to-pink-500"
    : "bg-gradient-to-r from-amber-500 to-orange-500";
  const outputHandleColor = isPro ? "!bg-pink-500" : "!bg-orange-500";

  return (
    <>
      <div
        className={`
          w-[220px] rounded-xl bg-base-100 shadow-lg border-2 transition-all
          ${selected ? "border-primary shadow-primary/20" : "border-base-300"}
        `}
      >
        {/* 输入端口 - prompt 类型（上方） */}
        <Handle
          type="target"
          position={Position.Left}
          id="input-prompt"
          style={{ top: "30%" }}
          className={`!w-3 !h-3 !bg-blue-500 !border-2 !border-white`}
        />
        {/* 输入端口 - image 类型（下方） */}
        <Handle
          type="target"
          position={Position.Left}
          id="input-image"
          style={{ top: "70%" }}
          className={`!w-3 !h-3 !bg-green-500 !border-2 !border-white`}
        />

        {/* 节点头部 */}
        <div className={`flex items-center justify-between px-3 py-2 ${headerGradient} rounded-t-lg`}>
          <div className="flex items-center gap-2">
            {isPro ? (
              <Sparkles className="w-4 h-4 text-white" />
            ) : (
              <Zap className="w-4 h-4 text-white" />
            )}
            <span className="text-sm font-medium text-white">{data.label}</span>
          </div>
          <div className="flex items-center gap-1">
            {/* 未连接提示词警告 */}
            {!isPromptConnected && (
              <div className="tooltip tooltip-left" data-tip="请连接提示词节点">
                <CircleAlert className="w-4 h-4 text-white/80" />
              </div>
            )}
            {/* 空输入警告图标 */}
            {isPromptConnected && hasEmptyImageInputs && (
              <div className="tooltip tooltip-left" data-tip={`图片输入为空: ${emptyInputs.emptyImages.map(i => i.label).join(", ")}`}>
                <AlertTriangle className="w-4 h-4 text-yellow-300" />
              </div>
            )}
            {isPro && (
              <span className="text-[10px] bg-white/20 px-1.5 py-0.5 rounded text-white">PRO</span>
            )}
          </div>
        </div>

        {/* 节点内容 */}
        <div className="p-2 space-y-2 nodrag">
          {/* 模型选择 - 使用 Portal 渲染避免模糊 */}
          <ModelSelector
            value={model}
            options={presetModels}
            onChange={handleModelChange}
            variant={isPro ? "primary" : "warning"}
            allowCustom={true}
          />

          {/* 配置选项 */}
          <div className="space-y-1.5">
            <div>
              <label className="text-xs text-base-content/60 mb-0.5 block">宽高比</label>
              <div className="grid grid-cols-5 gap-1">
                {(isPro ? proAspectRatioOptions : basicAspectRatioOptions).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`
                      btn btn-xs px-0
                      ${(data.aspectRatio || "1:1") === opt.value
                        ? (isPro ? "btn-primary" : "btn-warning")
                        : "btn-ghost bg-base-200"
                      }
                    `}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      updateNodeData<ImageGeneratorNodeData>(id, {
                        aspectRatio: opt.value as ImageGeneratorNodeData["aspectRatio"],
                      });
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs text-base-content/60 mb-0.5 block">张数</label>
              <div className="grid grid-cols-4 gap-1">
                {IMAGE_COUNT_OPTIONS.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    className={`
                      btn btn-xs px-0
                      ${imageCount === opt
                        ? (isPro ? "btn-primary" : "btn-warning")
                        : "btn-ghost bg-base-200"
                      }
                    `}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      updateNodeData<ImageGeneratorNodeData>(id, { count: opt });
                    }}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
            {isPro && (
              <div>
                <label className="text-xs text-base-content/60 mb-0.5 block">分辨率</label>
                <div className="grid grid-cols-3 gap-1">
                  {imageSizeOptions.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className={`
                        btn btn-xs
                        ${(data.imageSize || "1K") === opt.value
                          ? "btn-primary"
                          : "btn-ghost bg-base-200"
                        }
                      `}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        updateNodeData<ImageGeneratorNodeData>(id, {
                          imageSize: opt.value as ImageGeneratorNodeData["imageSize"],
                        });
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 生成按钮 */}
          {/* 生成按钮 */}
          <button
            className={`btn btn-sm w-full gap-2 ${data.status === "loading" || !isPromptConnected
              ? "btn-disabled"
              : isPro ? "btn-primary" : "btn-warning"
              }`}
            onClick={handleGenerate}
            onPointerDown={(e) => e.stopPropagation()}
            disabled={data.status === "loading" || !isPromptConnected}
          >
            {data.status === "loading" ? (
              <span>生成中{dots}</span>
            ) : !isPromptConnected ? (
              <span className="text-base-content/50">待连接提示词</span>
            ) : (
              <div className="flex items-center gap-2">
                <Play className="w-4 h-4" />
                <span>生成图片</span>
              </div>
            )}
          </button>

          {/* 错误信息 */}
          {data.status === "error" && data.error && (
            <div
              className="flex items-start gap-2 text-error text-xs bg-error/10 p-2 rounded cursor-pointer hover:bg-error/20 transition-colors"
              onClick={() => setShowErrorDetail(true)}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />
              <span className="line-clamp-3 break-all">{data.error}</span>
            </div>
          )}

          {/* 部分失败提示：多图部分请求失败但仍有成功图片 */}
          {data.status === "success" && typeof data.partialFailedCount === "number" && data.partialFailedCount > 0 && (
            <div
              className="flex items-start gap-2 text-warning text-xs bg-warning/10 p-2 rounded cursor-pointer hover:bg-warning/20 transition-colors"
              onClick={() => data.error && setShowErrorDetail(true)}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />
              <span className="line-clamp-3 break-all">
                {`成功 ${typeof data.outputCount === "number" ? data.outputCount : data.outputImages?.length ?? 0} 张、失败 ${data.partialFailedCount} 张${data.partialError ? `：${data.partialError}` : ""}`}
              </span>
            </div>
          )}

          {/* 预览图 - 桌面端使用本地文件存储（多图张数时预览首图并显示张数角标） */}
          {(data.outputImage || data.outputImagePath) && (
            <div
              className="relative group cursor-pointer"
              onClick={() => setShowPreview(true)}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div className="w-full h-[120px] overflow-hidden rounded-lg bg-base-200">
                <img
                  src={
                    data.outputImagePath
                      ? getImageUrl(data.outputImagePath)
                      : `data:image/png;base64,${data.outputImage}`
                  }
                  alt="Generated"
                  className="w-full h-full object-cover"
                />
              </div>
              {typeof data.outputCount === "number" && data.outputCount > 1 && (
                <span className="absolute top-1 right-1 z-10 text-[10px] bg-black/60 text-white px-1.5 py-0.5 rounded">
                  共 {data.outputCount} 张
                </span>
              )}
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center">
                <Maximize2 className="w-6 h-6 text-white" />
              </div>
            </div>
          )}
        </div>

        <Handle
          type="source"
          position={Position.Right}
          id="output-image"
          className={`!w-3 !h-3 ${outputHandleColor} !border-2 !border-white`}
        />
      </div>

      {/* 浮动状态气泡 - 移到节点外部避免被 clip */}
      <StatusBubble status={data.status} progress={data.progress} />

      {/* 预览弹窗 - 支持文件路径和 base64 */}
      {showPreview && (data.outputImage || data.outputImagePath) && (
        <ImagePreviewModal
          imageData={data.outputImage}
          imagePath={data.outputImagePath}
          onClose={() => setShowPreview(false)}
        />
      )}

      {/* 错误详情弹窗 */}
      {showErrorDetail && data.error && (
        <ErrorDetailModal
          error={data.error}
          errorDetails={data.errorDetails}
          title="执行错误"
          onClose={() => setShowErrorDetail(false)}
        />
      )}
    </>
  );
}

// NanoBanana Pro 节点 (支持 4K)
export const ImageGeneratorProNode = memo((props: NodeProps<ImageGeneratorNode>) => {
  return <ImageGeneratorBase {...props} isPro={true} />;
});
ImageGeneratorProNode.displayName = "ImageGeneratorProNode";

// NanoBanana 节点 (快速)
export const ImageGeneratorFastNode = memo((props: NodeProps<ImageGeneratorNode>) => {
  return <ImageGeneratorBase {...props} isPro={false} />;
});
ImageGeneratorFastNode.displayName = "ImageGeneratorFastNode";
