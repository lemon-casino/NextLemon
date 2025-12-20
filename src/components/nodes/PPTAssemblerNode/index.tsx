import { memo, useState, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import {
  FileDown,
  AlertCircle,
  RefreshCw,
  Presentation,
  FileText,
  CheckCircle2,
  Eye,
  X,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Settings2,
  Zap,
  Image as ImageIcon,
  Loader2,
  Eraser,
  Play,
  Square,
  Layers,
  Settings,
  ScanText,
  Paintbrush,
  RotateCcw,
} from "lucide-react";
import { useFlowStore } from "@/stores/flowStore";
import type { PPTAssemblerNodeData, PPTPageData } from "./types";
import { downloadPPT, downloadScripts, downloadBackgroundPPT } from "./pptBuilder";
import { useLoadingDots } from "@/hooks/useLoadingDots";
import type { PPTContentNodeData } from "../PPTContentNode/types";
import { ImagePreviewModal } from "@/components/ui/ImagePreviewModal";
import { ErrorDetailModal } from "@/components/ui/ErrorDetailModal";
import {
  processPageForEditable,
  testOcrConnection,
  testInpaintConnection,
  checkServicesAvailable,
} from "@/services/ocrInpaintService";
import { generateThumbnail } from "@/utils/imageCompression";

// 定义节点类型
type PPTAssemblerNode = Node<PPTAssemblerNodeData>;

// 导出模式选项
const exportModeOptions = [
  { value: "image", label: "纯图片", icon: ImageIcon, desc: "每页为完整图片" },
  { value: "background", label: "仅背景", icon: Eraser, desc: "去除文字，保留背景" },
];

// 标签页类型
type TabType = "preview" | "config" | "background";

// PPT 组装节点
export const PPTAssemblerNode = memo(({ id, data, selected }: NodeProps<PPTAssemblerNode>) => {
  const { nodes, edges, updateNodeData } = useFlowStore();

  // 省略号加载动画
  const dots = useLoadingDots(data.status === "generating" || data.status === "processing");

  // 当前预览页面
  const [currentPage, setCurrentPage] = useState(0);

  // 配置面板状态
  const [showPanel, setShowPanel] = useState(false);
  const [isPanelVisible, setIsPanelVisible] = useState(false);

  // 当前标签页
  const [activeTab, setActiveTab] = useState<TabType>("preview");

  // 图片全屏预览
  const [showFullPreview, setShowFullPreview] = useState(false);
  // 预览模式：原图 vs 处理后
  const [previewMode, setPreviewMode] = useState<"original" | "processed">("original");

  // 服务测试状态
  const [ocrTestStatus, setOcrTestStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [inpaintTestStatus, setInpaintTestStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [ocrTestMessage, setOcrTestMessage] = useState("");
  const [inpaintTestMessage, setInpaintTestMessage] = useState("");

  // 错误详情弹窗
  const [showErrorDetail, setShowErrorDetail] = useState(false);

  // 处理控制
  const isProcessingRef = useRef(false);
  const stopRequestedRef = useRef(false);
  // 用于硬停止的 AbortController
  const abortControllerRef = useRef<AbortController | null>(null);

  // 处理配置面板的打开/关闭动画
  const openPanel = useCallback(() => {
    setShowPanel(true);
    requestAnimationFrame(() => setIsPanelVisible(true));
  }, []);

  const closePanel = useCallback(() => {
    setIsPanelVisible(false);
    setTimeout(() => setShowPanel(false), 200);
  }, []);

  // 从上游节点获取页面数据
  const fetchUpstreamData = useCallback(() => {
    // 找到连接到当前节点 input-results 端口的边
    const inputEdge = edges.find(
      (edge) => edge.target === id && edge.targetHandle === "input-results"
    );

    if (!inputEdge) {
      return [];
    }

    // 找到源节点
    const sourceNode = nodes.find((n) => n.id === inputEdge.source);
    if (!sourceNode || sourceNode.type !== "pptContentNode") {
      return [];
    }

    const sourceData = sourceNode.data as PPTContentNodeData;

    // 转换页面数据格式
    const pages: PPTPageData[] = sourceData.pages
      .filter((p) => (p.status === "completed" || p.status === "skipped") && (p.result?.image || p.manualImage))
      .map((p) => ({
        pageNumber: p.pageNumber,
        heading: p.heading,
        points: p.points,
        script: p.script,
        image: p.manualImage || p.result?.image || "",
        thumbnail: p.manualThumbnail || p.result?.thumbnail,
        // 重置处理状态
        processStatus: undefined,
        processedBackground: undefined,
        processedThumbnail: undefined,
        processError: undefined,
      }));

    return pages;
  }, [id, nodes, edges]);

  // 刷新数据
  const handleRefresh = useCallback(() => {
    const pages = fetchUpstreamData();
    updateNodeData<PPTAssemblerNodeData>(id, {
      pages,
      status: "idle",
      processingProgress: null,
    });
    // 重置当前页面为第一页
    if (currentPage >= pages.length) {
      setCurrentPage(Math.max(0, pages.length - 1));
    }
    // 重置预览模式
    setPreviewMode("original");
  }, [id, fetchUpstreamData, updateNodeData, currentPage]);

  // 初始加载时获取数据
  useEffect(() => {
    if (data.pages.length === 0) {
      handleRefresh();
    }
  }, []);

  // 获取 PPT 标题
  const getPPTTitle = useCallback(() => {
    const inputEdge = edges.find(
      (edge) => edge.target === id && edge.targetHandle === "input-results"
    );
    if (inputEdge) {
      const sourceNode = nodes.find((n) => n.id === inputEdge.source);
      if (sourceNode && sourceNode.type === "pptContentNode") {
        const sourceData = sourceNode.data as PPTContentNodeData;
        return sourceData.outline?.title || "PPT 演示文稿";
      }
    }
    return "PPT 演示文稿";
  }, [id, nodes, edges]);

  // 测试 OCR 服务
  const handleTestOcr = useCallback(async () => {
    setOcrTestStatus("testing");
    setOcrTestMessage("");
    try {
      const result = await testOcrConnection(data.ocrApiUrl);
      setOcrTestStatus(result.success ? "success" : "error");
      setOcrTestMessage(result.message);
    } catch (error) {
      setOcrTestStatus("error");
      setOcrTestMessage(error instanceof Error ? error.message : "测试失败");
    }
  }, [data.ocrApiUrl]);

  // 测试 IOPaint 服务
  const handleTestInpaint = useCallback(async () => {
    setInpaintTestStatus("testing");
    setInpaintTestMessage("");
    try {
      const result = await testInpaintConnection(data.inpaintApiUrl);
      setInpaintTestStatus(result.success ? "success" : "error");
      setInpaintTestMessage(result.message);
    } catch (error) {
      setInpaintTestStatus("error");
      setInpaintTestMessage(error instanceof Error ? error.message : "测试失败");
    }
  }, [data.inpaintApiUrl]);

  // 开始背景处理
  const handleStartProcessing = useCallback(async () => {
    if (isProcessingRef.current) return;

    isProcessingRef.current = true;
    stopRequestedRef.current = false;

    // 创建新的 AbortController
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    // 检查服务可用性
    const servicesCheck = await checkServicesAvailable({
      ocrApiUrl: data.ocrApiUrl,
      inpaintApiUrl: data.inpaintApiUrl,
    });

    // 检查是否在服务检查期间被停止
    if (abortController.signal.aborted) {
      isProcessingRef.current = false;
      return;
    }

    if (!servicesCheck.ocrAvailable) {
      updateNodeData<PPTAssemblerNodeData>(id, {
        status: "error",
        error: `OCR 服务连接失败: ${servicesCheck.ocrMessage}`,
      });
      isProcessingRef.current = false;
      abortControllerRef.current = null;
      return;
    }

    if (!servicesCheck.inpaintAvailable) {
      updateNodeData<PPTAssemblerNodeData>(id, {
        status: "error",
        error: `IOPaint 服务连接失败: ${servicesCheck.inpaintMessage}`,
      });
      isProcessingRef.current = false;
      abortControllerRef.current = null;
      return;
    }

    // 获取最新数据的辅助函数
    const getLatestPages = (): PPTPageData[] => {
      const node = useFlowStore.getState().nodes.find(n => n.id === id);
      return (node?.data as PPTAssemblerNodeData)?.pages || [];
    };

    // 初始化所有页面状态为 pending
    const initialPages = data.pages.map(p => ({
      ...p,
      processStatus: (p.processStatus === 'completed' && p.processedBackground) ? 'completed' as const : 'pending' as const,
      processError: undefined,
    }));

    updateNodeData<PPTAssemblerNodeData>(id, {
      status: "processing",
      error: undefined,
      pages: initialPages,
      processingProgress: { current: 0, total: data.pages.length, currentStep: 'ocr' },
    });

    const config = {
      ocrApiUrl: data.ocrApiUrl,
      inpaintApiUrl: data.inpaintApiUrl,
    };

    const totalPages = data.pages.length;

    // 逐页处理
    for (let i = 0; i < totalPages; i++) {
      // 检查是否被中断（硬停止）
      if (abortController.signal.aborted || stopRequestedRef.current) {
        // 用户请求停止 - 重置所有 processing 状态的页面为 pending
        const latestPages = getLatestPages();
        const resetPages = latestPages.map(p =>
          p.processStatus === 'processing'
            ? { ...p, processStatus: 'pending' as const, processError: undefined }
            : p
        );

        updateNodeData<PPTAssemblerNodeData>(id, {
          status: "idle",
          pages: resetPages,
          processingProgress: null,
        });
        isProcessingRef.current = false;
        abortControllerRef.current = null;
        return;
      }

      // 获取最新的页面数据
      const latestPages = getLatestPages();
      const page = latestPages[i];

      if (!page) continue;

      // 如果已经处理过，跳过
      if (page.processStatus === 'completed' && page.processedBackground) {
        continue;
      }

      // 更新当前页面为处理中
      const updatedPagesProcessing = latestPages.map((p, idx) =>
        idx === i ? { ...p, processStatus: 'processing' as const } : p
      );
      updateNodeData<PPTAssemblerNodeData>(id, {
        pages: updatedPagesProcessing,
        processingProgress: { current: i + 1, total: totalPages, currentStep: 'ocr' },
      });

      try {
        // 再次检查是否被中断
        if (abortController.signal.aborted || stopRequestedRef.current) {
          throw new Error("已停止");
        }

        // 调用处理服务
        const result = await processPageForEditable(page.image, config);

        // 处理完成后再检查一次是否被中断
        if (abortController.signal.aborted || stopRequestedRef.current) {
          throw new Error("已停止");
        }

        // 生成缩略图
        const processedThumbnail = await generateThumbnail(result.backgroundImage, {
          maxWidth: 400,
          quality: 0.7,
        });

        // 获取最新数据并更新
        const currentPages = getLatestPages();
        const updatedPages = currentPages.map((p, idx) =>
          idx === i ? {
            ...p,
            processStatus: 'completed' as const,
            processedBackground: result.backgroundImage,
            processedThumbnail,
            processError: undefined,
          } : p
        );

        updateNodeData<PPTAssemblerNodeData>(id, {
          pages: updatedPages,
        });

        // 自动切换到处理后预览
        if (i === currentPage) {
          setPreviewMode("processed");
        }

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "处理失败";

        // 如果是停止导致的错误，重置为 pending 状态
        if (errorMessage === "已停止" || abortController.signal.aborted || stopRequestedRef.current) {
          const currentPages = getLatestPages();
          const resetPages = currentPages.map(p =>
            p.processStatus === 'processing'
              ? { ...p, processStatus: 'pending' as const, processError: undefined }
              : p
          );

          updateNodeData<PPTAssemblerNodeData>(id, {
            pages: resetPages,
            status: "idle",
            processingProgress: null,
          });

          isProcessingRef.current = false;
          abortControllerRef.current = null;
          return;
        }

        // 获取最新数据并更新为错误状态
        const currentPages = getLatestPages();
        const updatedPages = currentPages.map((p, idx) =>
          idx === i ? {
            ...p,
            processStatus: 'error' as const,
            processError: errorMessage,
          } : p
        );

        updateNodeData<PPTAssemblerNodeData>(id, {
          pages: updatedPages,
          status: "error",
          error: `第 ${page.pageNumber} 页处理失败: ${errorMessage}`,
        });

        isProcessingRef.current = false;
        abortControllerRef.current = null;
        return;
      }
    }

    // 处理完成
    updateNodeData<PPTAssemblerNodeData>(id, {
      status: "ready",
      processingProgress: null,
    });

    isProcessingRef.current = false;
    abortControllerRef.current = null;
  }, [id, data.pages, data.ocrApiUrl, data.inpaintApiUrl, updateNodeData, currentPage]);

  // 停止处理 - 硬停止：立即中断，重置所有正在处理的页面状态
  const handleStopProcessing = useCallback(() => {
    // 设置停止标志
    stopRequestedRef.current = true;

    // 中断 AbortController（虽然 Tauri invoke 不支持中断，但可以用于后续检查）
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // 硬停止：立即重置所有 processing 状态的页面为 pending，并更新 UI
    const node = useFlowStore.getState().nodes.find(n => n.id === id);
    const currentData = node?.data as PPTAssemblerNodeData | undefined;
    const currentPages = currentData?.pages || [];

    // 重置所有 processing 的页面为 pending
    const resetPages = currentPages.map(p =>
      p.processStatus === 'processing'
        ? { ...p, processStatus: 'pending' as const, processError: undefined }
        : p
    );

    // 立即更新状态为 idle
    updateNodeData<PPTAssemblerNodeData>(id, {
      status: "idle",
      pages: resetPages,
      processingProgress: null,
      error: undefined,
    });

    // 重置处理标志
    isProcessingRef.current = false;
  }, [id, updateNodeData]);

  // 单页重试
  const handleRetryPage = useCallback(async (pageIndex: number) => {
    if (isProcessingRef.current) return;

    const page = data.pages[pageIndex];
    if (!page) return;

    isProcessingRef.current = true;

    // 获取最新数据的辅助函数
    const getLatestPages = (): PPTPageData[] => {
      const node = useFlowStore.getState().nodes.find(n => n.id === id);
      return (node?.data as PPTAssemblerNodeData)?.pages || [];
    };

    // 更新当前页面为处理中
    const latestPages = getLatestPages();
    const updatedPagesProcessing = latestPages.map((p, idx) =>
      idx === pageIndex ? { ...p, processStatus: 'processing' as const, processError: undefined } : p
    );
    updateNodeData<PPTAssemblerNodeData>(id, {
      pages: updatedPagesProcessing,
      status: "processing",
      error: undefined,
      processingProgress: { current: pageIndex + 1, total: data.pages.length, currentStep: 'ocr' },
    });

    const config = {
      ocrApiUrl: data.ocrApiUrl,
      inpaintApiUrl: data.inpaintApiUrl,
    };

    try {
      // 调用处理服务
      const result = await processPageForEditable(page.image, config);

      // 生成缩略图
      const processedThumbnail = await generateThumbnail(result.backgroundImage, {
        maxWidth: 400,
        quality: 0.7,
      });

      // 获取最新数据并更新
      const currentPages = getLatestPages();
      const updatedPages = currentPages.map((p, idx) =>
        idx === pageIndex ? {
          ...p,
          processStatus: 'completed' as const,
          processedBackground: result.backgroundImage,
          processedThumbnail,
          processError: undefined,
        } : p
      );

      updateNodeData<PPTAssemblerNodeData>(id, {
        pages: updatedPages,
        status: "idle",
        processingProgress: null,
      });

      // 自动切换到处理后预览
      if (pageIndex === currentPage) {
        setPreviewMode("processed");
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "处理失败";

      // 获取最新数据并更新为错误状态
      const currentPages = getLatestPages();
      const updatedPages = currentPages.map((p, idx) =>
        idx === pageIndex ? {
          ...p,
          processStatus: 'error' as const,
          processError: errorMessage,
        } : p
      );

      updateNodeData<PPTAssemblerNodeData>(id, {
        pages: updatedPages,
        status: "idle",
        error: `第 ${page.pageNumber} 页处理失败: ${errorMessage}`,
        processingProgress: null,
      });
    }

    isProcessingRef.current = false;
  }, [id, data.pages, data.ocrApiUrl, data.inpaintApiUrl, updateNodeData, currentPage]);

  // 下载 PPT（纯图片模式）
  const handleDownloadImagePPT = useCallback(async () => {
    if (data.pages.length === 0) return;

    const title = getPPTTitle();

    updateNodeData<PPTAssemblerNodeData>(id, {
      status: "generating",
      error: undefined,
    });

    try {
      await downloadPPT({
        title,
        pages: data.pages,
        aspectRatio: "16:9",
      });

      updateNodeData<PPTAssemblerNodeData>(id, {
        status: "ready",
      });
    } catch (error) {
      updateNodeData<PPTAssemblerNodeData>(id, {
        status: "error",
        error: error instanceof Error ? error.message : "导出失败",
      });
    }
  }, [id, data.pages, getPPTTitle, updateNodeData]);

  // 下载 PPT（仅背景模式）
  const handleDownloadBackgroundPPT = useCallback(async () => {
    // 检查是否所有页面都已处理
    const allProcessed = data.pages.every(p => p.processStatus === 'completed' && p.processedBackground);
    if (!allProcessed) {
      updateNodeData<PPTAssemblerNodeData>(id, {
        status: "error",
        error: "请先完成所有页面的背景处理",
      });
      return;
    }

    const title = getPPTTitle();

    updateNodeData<PPTAssemblerNodeData>(id, {
      status: "generating",
      error: undefined,
    });

    try {
      // 构建处理后的页面数据
      const processedPages = data.pages.map(p => ({
        backgroundImage: p.processedBackground!,
        textBoxes: [],
        originalPage: p,
      }));

      await downloadBackgroundPPT({
        title,
        pages: processedPages,
        aspectRatio: "16:9",
      });

      updateNodeData<PPTAssemblerNodeData>(id, {
        status: "ready",
      });
    } catch (error) {
      updateNodeData<PPTAssemblerNodeData>(id, {
        status: "error",
        error: error instanceof Error ? error.message : "导出失败",
      });
    }
  }, [id, data.pages, getPPTTitle, updateNodeData]);

  // 下载 PPT（根据模式）
  const handleDownloadPPT = useCallback(() => {
    if (data.exportMode === "image") {
      handleDownloadImagePPT();
    } else {
      handleDownloadBackgroundPPT();
    }
  }, [data.exportMode, handleDownloadImagePPT, handleDownloadBackgroundPPT]);

  // 下载讲稿
  const handleDownloadScripts = useCallback(async () => {
    if (data.pages.length === 0) return;
    const title = getPPTTitle();
    await downloadScripts(data.pages, title);
  }, [data.pages, getPPTTitle]);

  // 当前预览的页面
  const currentPageData = data.pages[currentPage];

  // 是否正在处理中
  const isProcessing = data.status === "processing" || data.status === "generating";

  // 计算处理进度统计
  const processedCount = data.pages.filter(p => p.processStatus === 'completed').length;
  const errorCount = data.pages.filter(p => p.processStatus === 'error').length;
  const pendingCount = data.pages.filter(p => !p.processStatus || p.processStatus === 'pending').length;

  // 检查是否可以下载（仅背景模式需要先处理）
  const canDownload = data.exportMode === "image"
    ? data.pages.length > 0
    : data.pages.every(p => p.processStatus === 'completed' && p.processedBackground);

  return (
    <>
      <div
        className={`
          w-[280px] rounded-xl bg-base-100 shadow-lg border-2
          ${selected ? "border-primary shadow-primary/20" : "border-base-300"}
        `}
      >
        {/* 输入端口 */}
        <Handle
          type="target"
          position={Position.Left}
          id="input-results"
          className="!w-3 !h-3 !bg-purple-500 !border-2 !border-white"
          title="PPT 页面数据"
        />

        {/* 节点头部 */}
        <div className="flex items-center justify-between px-3 py-2 bg-gradient-to-r from-emerald-500 to-teal-500 rounded-t-lg">
          <div className="flex items-center gap-2">
            <Presentation className="w-4 h-4 text-white" />
            <span className="text-sm font-medium text-white">{data.label}</span>
          </div>
          <span className="text-[10px] bg-white/20 px-1.5 py-0.5 rounded text-white">
            导出
          </span>
        </div>

        {/* 节点内容 - 精简版 */}
        <div className="p-3 space-y-3 nodrag">
          {/* 数据源状态 */}
          <div
            className={`
              flex items-center gap-2 px-2.5 py-2 rounded-lg border
              ${data.pages.length > 0
                ? "bg-success/5 border-success/30"
                : "bg-warning/5 border-warning/30"
              }
            `}
          >
            <div className={`
              p-1.5 rounded-md
              ${data.pages.length > 0 ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}
            `}>
              <FileText className="w-3.5 h-3.5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-medium text-base-content/70">页面数据</div>
              <div className={`text-xs ${data.pages.length > 0 ? "text-base-content/60" : "text-warning"}`}>
                {data.pages.length > 0 ? `共 ${data.pages.length} 页` : "请连接 PPT 内容节点"}
              </div>
            </div>
            {data.pages.length > 0 ? (
              <CheckCircle2 className="w-4 h-4 text-success flex-shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-warning flex-shrink-0" />
            )}
            <button
              className="btn btn-ghost btn-xs p-1"
              onClick={handleRefresh}
              title="刷新数据"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
          </div>

          {/* 导出模式快速展示 */}
          <div className="flex items-center justify-between text-xs">
            <span className="text-base-content/60">导出模式</span>
            <span className={`font-medium ${data.exportMode === 'background' ? 'text-secondary' : 'text-primary'}`}>
              {data.exportMode === 'image' ? '纯图片' : '仅背景'}
            </span>
          </div>

          {/* 处理进度（仅在处理中显示） */}
          {data.status === "processing" && data.processingProgress && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-base-content/60 flex items-center gap-1">
                  {data.processingProgress.currentStep === 'ocr' ? (
                    <><ScanText className="w-3 h-3" />识别文字</>
                  ) : (
                    <><Paintbrush className="w-3 h-3" />修复背景</>
                  )}
                </span>
                <span className="text-primary font-medium">
                  {data.processingProgress.current}/{data.processingProgress.total}
                </span>
              </div>
              <progress
                className="progress progress-primary w-full h-1.5"
                value={data.processingProgress.current}
                max={data.processingProgress.total}
              />
            </div>
          )}

          {/* 打开配置面板按钮 */}
          <button
            className="btn btn-outline btn-sm w-full gap-2"
            onClick={openPanel}
          >
            <Settings className="w-4 h-4" />
            打开配置面板
          </button>

          {/* 快速下载按钮 */}
          <div className="flex gap-2">
            <button
              className={`btn btn-primary flex-1 gap-1 ${
                isProcessing || !canDownload ? "btn-disabled" : ""
              }`}
              onClick={handleDownloadPPT}
              disabled={isProcessing || !canDownload}
            >
              {data.status === "generating" ? (
                <span>生成中{dots}</span>
              ) : (
                <>
                  <FileDown className="w-4 h-4" />
                  下载
                </>
              )}
            </button>
            <button
              className="btn btn-outline gap-1"
              onClick={handleDownloadScripts}
              disabled={data.pages.length === 0}
              title="导出讲稿"
            >
              <FileText className="w-4 h-4" />
            </button>
          </div>

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
        </div>
      </div>

      {/* 配置面板 Modal - 使用 Portal 渲染到 body */}
      {showPanel && createPortal(
        <div
          className={`
            fixed inset-0 flex items-center justify-center z-50
            transition-all duration-200 ease-out
            ${isPanelVisible ? "bg-black/50" : "bg-black/0"}
          `}
          onClick={closePanel}
        >
          <div
            className={`
              bg-base-100 rounded-xl shadow-2xl w-[900px] max-h-[85vh] flex flex-col
              transition-all duration-200 ease-out
              ${isPanelVisible
                ? "opacity-100 scale-100 translate-y-0"
                : "opacity-0 scale-95 translate-y-4"
              }
            `}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 面板头部 */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-base-300">
              <div className="flex items-center gap-2">
                <Presentation className="w-5 h-5 text-primary" />
                <span className="font-medium text-lg">PPT 组装配置</span>
                <span className="text-sm text-base-content/50">
                  共 {data.pages.length} 页
                </span>
              </div>
              <button
                className="btn btn-ghost btn-sm btn-circle"
                onClick={closePanel}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 标签页导航 */}
            <div className="flex items-center gap-1 px-5 pt-3 border-b border-base-300">
              <button
                className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors
                  ${activeTab === 'preview'
                    ? 'bg-primary/10 text-primary border-b-2 border-primary -mb-[1px]'
                    : 'text-base-content/60 hover:text-base-content hover:bg-base-200'
                  }
                `}
                onClick={() => setActiveTab('preview')}
              >
                <Eye className="w-4 h-4 inline mr-1.5" />
                预览
              </button>
              <button
                className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors
                  ${activeTab === 'config'
                    ? 'bg-primary/10 text-primary border-b-2 border-primary -mb-[1px]'
                    : 'text-base-content/60 hover:text-base-content hover:bg-base-200'
                  }
                `}
                onClick={() => setActiveTab('config')}
              >
                <Settings2 className="w-4 h-4 inline mr-1.5" />
                配置
              </button>
              {data.exportMode === 'background' && (
                <button
                  className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors
                    ${activeTab === 'background'
                      ? 'bg-secondary/10 text-secondary border-b-2 border-secondary -mb-[1px]'
                      : 'text-base-content/60 hover:text-base-content hover:bg-base-200'
                    }
                  `}
                  onClick={() => setActiveTab('background')}
                >
                  <Layers className="w-4 h-4 inline mr-1.5" />
                  背景处理
                  {processedCount > 0 && processedCount < data.pages.length && (
                    <span className="ml-1.5 text-xs bg-warning/20 text-warning px-1.5 py-0.5 rounded">
                      {processedCount}/{data.pages.length}
                    </span>
                  )}
                  {processedCount === data.pages.length && data.pages.length > 0 && (
                    <CheckCircle2 className="w-3.5 h-3.5 ml-1.5 text-success inline" />
                  )}
                </button>
              )}
            </div>

            {/* 面板内容 */}
            <div className="flex-1 overflow-y-auto p-5">
              {/* 预览标签页 */}
              {activeTab === 'preview' && (
                <div className="space-y-4">
                  {currentPageData ? (
                    <>
                      {/* 预览模式切换（仅在有处理结果时显示） */}
                      {currentPageData.processedBackground && (
                        <div className="flex items-center justify-center gap-2">
                          <button
                            className={`btn btn-sm ${previewMode === 'original' ? 'btn-primary' : 'btn-ghost'}`}
                            onClick={() => setPreviewMode('original')}
                          >
                            原图
                          </button>
                          <button
                            className={`btn btn-sm ${previewMode === 'processed' ? 'btn-secondary' : 'btn-ghost'}`}
                            onClick={() => setPreviewMode('processed')}
                          >
                            处理后
                          </button>
                        </div>
                      )}

                      {/* 主预览区域 */}
                      <div
                        className="relative bg-base-200 rounded-lg overflow-hidden cursor-pointer group"
                        onClick={() => {
                          const hasImage = previewMode === 'processed'
                            ? currentPageData.processedBackground
                            : currentPageData.image;
                          if (hasImage) setShowFullPreview(true);
                        }}
                      >
                        <div className="aspect-video">
                          {(() => {
                            const showProcessed = previewMode === 'processed' && currentPageData.processedBackground;
                            // 处理后的图片直接显示原图，原图模式显示缩略图
                            const imageToShow = showProcessed
                              ? currentPageData.processedBackground
                              : currentPageData.thumbnail || currentPageData.image;
                            const imageFormat = showProcessed
                              ? 'png'
                              : currentPageData.thumbnail
                              ? 'jpeg'
                              : 'png';

                            return imageToShow ? (
                              <img
                                src={`data:image/${imageFormat};base64,${imageToShow}`}
                                alt={`Page ${currentPageData.pageNumber}`}
                                className="w-full h-full object-contain"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <span className="text-sm text-base-content/30">暂无图片</span>
                              </div>
                            );
                          })()}
                        </div>

                        {/* 悬浮放大按钮 - 仅原图模式显示 */}
                        {previewMode === 'original' && currentPageData.image && (
                          <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <Maximize2 className="w-10 h-10 text-white" />
                          </div>
                        )}

                        {/* 模式标签 */}
                        {currentPageData.processedBackground && (
                          <div className={`absolute top-2 right-2 text-xs px-2 py-1 rounded ${
                            previewMode === 'processed' ? 'bg-secondary text-secondary-content' : 'bg-primary text-primary-content'
                          }`}>
                            {previewMode === 'processed' ? '处理后' : '原图'}
                          </div>
                        )}
                      </div>

                      {/* 页面信息 */}
                      <div className="text-center">
                        <div className="text-base font-medium">{currentPageData.heading}</div>
                        <div className="text-sm text-base-content/50 mt-1">
                          第 {currentPage + 1} 页 / 共 {data.pages.length} 页
                        </div>
                      </div>

                      {/* 导航和缩略图 */}
                      <div className="flex items-center gap-3">
                        <button
                          className="btn btn-ghost btn-sm btn-circle flex-shrink-0"
                          onClick={() => setCurrentPage(currentPage - 1)}
                          disabled={currentPage === 0}
                        >
                          <ChevronLeft className="w-5 h-5" />
                        </button>

                        {/* 缩略图条 */}
                        <div className="flex-1 overflow-x-auto">
                          <div className="flex gap-2 justify-center">
                            {data.pages.map((page, index) => {
                              const showProcessed = previewMode === 'processed' && page.processedBackground;
                              const thumbUrl = showProcessed
                                ? page.processedThumbnail
                                  ? `data:image/jpeg;base64,${page.processedThumbnail}`
                                  : `data:image/png;base64,${page.processedBackground}`
                                : page.thumbnail
                                ? `data:image/jpeg;base64,${page.thumbnail}`
                                : page.image
                                ? `data:image/png;base64,${page.image}`
                                : undefined;

                              return (
                                <button
                                  key={index}
                                  className={`
                                    relative flex-shrink-0 w-16 h-10 rounded overflow-hidden border-2
                                    ${currentPage === index
                                      ? "border-primary ring-2 ring-primary/20"
                                      : "border-base-300 hover:border-base-content/30"
                                    }
                                  `}
                                  onClick={() => setCurrentPage(index)}
                                  title={`第 ${page.pageNumber} 页: ${page.heading || "无标题"}`}
                                >
                                  {thumbUrl ? (
                                    <img
                                      src={thumbUrl}
                                      alt={`Page ${page.pageNumber}`}
                                      className="w-full h-full object-cover"
                                    />
                                  ) : (
                                    <div className="w-full h-full bg-base-200 flex items-center justify-center">
                                      <span className="text-[10px] text-base-content/30">{page.pageNumber}</span>
                                    </div>
                                  )}
                                  {/* 处理状态指示 */}
                                  {page.processStatus === 'completed' && (
                                    <div className="absolute bottom-0 right-0 bg-success text-success-content p-0.5 rounded-tl">
                                      <CheckCircle2 className="w-2.5 h-2.5" />
                                    </div>
                                  )}
                                  {page.processStatus === 'processing' && (
                                    <div className="absolute bottom-0 right-0 bg-info text-info-content p-0.5 rounded-tl">
                                      <Loader2 className="w-2.5 h-2.5 animate-spin" />
                                    </div>
                                  )}
                                  {page.processStatus === 'error' && (
                                    <div className="absolute bottom-0 right-0 bg-error text-error-content p-0.5 rounded-tl">
                                      <AlertCircle className="w-2.5 h-2.5" />
                                    </div>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <button
                          className="btn btn-ghost btn-sm btn-circle flex-shrink-0"
                          onClick={() => setCurrentPage(currentPage + 1)}
                          disabled={currentPage === data.pages.length - 1}
                        >
                          <ChevronRight className="w-5 h-5" />
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center justify-center h-[300px]">
                      <span className="text-base-content/40">无页面数据</span>
                    </div>
                  )}
                </div>
              )}

              {/* 配置标签页 */}
              {activeTab === 'config' && (
                <div className="space-y-6">
                  {/* 导出模式 */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium">导出模式</label>
                    <div className="flex gap-2">
                      {exportModeOptions.map((opt) => {
                        const Icon = opt.icon;
                        return (
                          <button
                            key={opt.value}
                            className={`
                              btn flex-1 gap-2
                              ${data.exportMode === opt.value
                                ? opt.value === 'background' ? "btn-secondary" : "btn-primary"
                                : "btn-ghost bg-base-200"
                              }
                            `}
                            onClick={() => {
                              updateNodeData<PPTAssemblerNodeData>(id, {
                                exportMode: opt.value as PPTAssemblerNodeData["exportMode"],
                              });
                              // 切换到仅背景模式时，自动切换到背景处理标签页
                              if (opt.value === 'background') {
                                setActiveTab('background');
                              }
                            }}
                          >
                            <Icon className="w-4 h-4" />
                            <div className="text-left">
                              <div>{opt.label}</div>
                              <div className="text-[10px] opacity-70">{opt.desc}</div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    {data.exportMode === 'background' && (
                      <div className="text-sm text-info/80 flex items-center gap-1 mt-2">
                        <Zap className="w-4 h-4" />
                        需要配置 OCR + IOPaint 服务，并完成背景处理后才能下载
                      </div>
                    )}
                  </div>

                  {/* 服务配置（仅在背景模式显示） */}
                  {data.exportMode === 'background' && (
                    <>
                      <div className="divider">服务配置</div>

                      {/* OCR 服务配置 */}
                      <div className="space-y-2">
                        <label className="text-sm font-medium">PaddleOCR / EasyOCR 服务地址</label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            className="input input-bordered flex-1"
                            value={data.ocrApiUrl}
                            onChange={(e) => {
                              updateNodeData<PPTAssemblerNodeData>(id, {
                                ocrApiUrl: e.target.value,
                              });
                              setOcrTestStatus("idle");
                            }}
                            placeholder="http://127.0.0.1:8866"
                          />
                          <button
                            className={`btn ${
                              ocrTestStatus === "testing" ? "btn-disabled" : "btn-outline"
                            }`}
                            onClick={handleTestOcr}
                            disabled={ocrTestStatus === "testing"}
                          >
                            {ocrTestStatus === "testing" ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              "测试"
                            )}
                          </button>
                        </div>
                        {ocrTestStatus !== "idle" && (
                          <div className={`text-sm flex items-center gap-1 ${
                            ocrTestStatus === "success" ? "text-success" : "text-error"
                          }`}>
                            {ocrTestStatus === "success" ? (
                              <CheckCircle2 className="w-4 h-4" />
                            ) : (
                              <AlertCircle className="w-4 h-4" />
                            )}
                            {ocrTestMessage}
                          </div>
                        )}
                      </div>

                      {/* IOPaint 服务配置 */}
                      <div className="space-y-2">
                        <label className="text-sm font-medium">IOPaint 服务地址</label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            className="input input-bordered flex-1"
                            value={data.inpaintApiUrl}
                            onChange={(e) => {
                              updateNodeData<PPTAssemblerNodeData>(id, {
                                inpaintApiUrl: e.target.value,
                              });
                              setInpaintTestStatus("idle");
                            }}
                            placeholder="http://127.0.0.1:8080"
                          />
                          <button
                            className={`btn ${
                              inpaintTestStatus === "testing" ? "btn-disabled" : "btn-outline"
                            }`}
                            onClick={handleTestInpaint}
                            disabled={inpaintTestStatus === "testing"}
                          >
                            {inpaintTestStatus === "testing" ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              "测试"
                            )}
                          </button>
                        </div>
                        {inpaintTestStatus !== "idle" && (
                          <div className={`text-sm flex items-center gap-1 ${
                            inpaintTestStatus === "success" ? "text-success" : "text-error"
                          }`}>
                            {inpaintTestStatus === "success" ? (
                              <CheckCircle2 className="w-4 h-4" />
                            ) : (
                              <AlertCircle className="w-4 h-4" />
                            )}
                            {inpaintTestMessage}
                          </div>
                        )}
                      </div>

                      {/* 部署提示 */}
                      <div className="text-xs text-base-content/50 bg-base-200 p-3 rounded-lg space-y-2">
                        <p className="font-medium">快速部署（Docker Compose）:</p>
                        <code className="block bg-base-300 p-2 rounded text-[11px] overflow-x-auto whitespace-pre">
{`cd docker
docker-compose up -d`}
                        </code>
                        <div className="text-[11px] opacity-70 pt-1 border-t border-base-300">
                          <p>• EasyOCR: http://127.0.0.1:8866 (文字检测识别)</p>
                          <p>• IOPaint: http://127.0.0.1:8080 (AI 背景修复)</p>
                          <p className="mt-1 text-warning">⚠ 首次启动需下载模型，约 3-5 分钟</p>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* 背景处理标签页 */}
              {activeTab === 'background' && data.exportMode === 'background' && (
                <div className="h-full flex flex-col space-y-3">
                  {/* 控制区域 - 紧凑布局 */}
                  <div className="flex items-center justify-between bg-base-200/30 rounded-xl px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      {/* 进度信息 */}
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-base-content/70">
                          进度：{processedCount}/{data.pages.length} 页
                        </span>
                        <div className="w-32 h-1.5 bg-base-300 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              processedCount === data.pages.length ? "bg-success" : "bg-secondary"
                            }`}
                            style={{ width: `${data.pages.length > 0 ? Math.round((processedCount / data.pages.length) * 100) : 0}%` }}
                          />
                        </div>
                        <span className={`text-sm font-medium ${processedCount === data.pages.length ? "text-success" : "text-secondary"}`}>
                          {data.pages.length > 0 ? Math.round((processedCount / data.pages.length) * 100) : 0}%
                        </span>
                      </div>

                      {/* 统计 */}
                      <div className="flex items-center gap-2 text-xs text-base-content/50">
                        <span className="flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-base-content/30" />
                          待处理 {pendingCount}
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-success" />
                          完成 {processedCount}
                        </span>
                        {errorCount > 0 && (
                          <span className="flex items-center gap-1 text-error">
                            <span className="w-1.5 h-1.5 rounded-full bg-error" />
                            失败 {errorCount}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* 控制按钮 */}
                    <div className="flex items-center gap-2">
                      {data.status === 'processing' && (
                        <span className="inline-flex items-center gap-1 text-secondary text-sm">
                          <span className="loading loading-spinner loading-xs" />
                          处理中
                        </span>
                      )}
                      {processedCount === data.pages.length && data.pages.length > 0 && data.status !== 'processing' && (
                        <span className="inline-flex items-center gap-1 text-success text-sm">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          已完成
                        </span>
                      )}

                      {data.status === 'processing' ? (
                        <button
                          className="btn btn-warning btn-sm gap-1"
                          onClick={handleStopProcessing}
                        >
                          <Square className="w-3.5 h-3.5" />
                          停止
                        </button>
                      ) : (
                        <button
                          className="btn btn-secondary btn-sm gap-1.5"
                          onClick={handleStartProcessing}
                          disabled={data.pages.length === 0 || processedCount === data.pages.length}
                        >
                          <Play className="w-3.5 h-3.5" />
                          {processedCount === data.pages.length ? '已完成' : processedCount > 0 ? '继续' : '开始处理'}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* 当前处理状态提示 */}
                  {data.status === 'processing' && data.processingProgress && (
                    <div className="flex items-center gap-2 text-sm text-base-content/60 bg-secondary/10 rounded-lg px-3 py-2">
                      <Loader2 className="w-4 h-4 animate-spin text-secondary" />
                      <span>
                        正在处理第 {data.processingProgress.current} 页
                        {data.processingProgress.currentStep === 'ocr' && ' - 识别文字...'}
                        {data.processingProgress.currentStep === 'inpaint' && ' - 修复背景...'}
                      </span>
                    </div>
                  )}

                  {/* 页面处理状态列表 */}
                  <div className="flex-1 overflow-y-auto space-y-1.5">
                    {data.pages.map((page, index) => (
                      <div
                        key={index}
                        className={`
                          flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-all
                          ${page.processStatus === 'completed' ? 'bg-success/5 border-success/20' : ''}
                          ${page.processStatus === 'processing' ? 'bg-secondary/5 border-secondary/30' : ''}
                          ${page.processStatus === 'error' ? 'bg-error/5 border-error/20' : ''}
                          ${!page.processStatus || page.processStatus === 'pending' ? 'bg-base-200/50 border-base-300' : ''}
                          hover:border-primary/50
                        `}
                        onClick={() => {
                          setCurrentPage(index);
                          setActiveTab('preview');
                          if (page.processedBackground) {
                            setPreviewMode('processed');
                          }
                        }}
                      >
                        {/* 缩略图 */}
                        <div className="w-14 h-9 rounded overflow-hidden bg-base-300 flex-shrink-0">
                          {page.processedThumbnail ? (
                            <img
                              src={`data:image/jpeg;base64,${page.processedThumbnail}`}
                              alt={`Page ${page.pageNumber}`}
                              className="w-full h-full object-cover"
                            />
                          ) : page.thumbnail ? (
                            <img
                              src={`data:image/jpeg;base64,${page.thumbnail}`}
                              alt={`Page ${page.pageNumber}`}
                              className="w-full h-full object-cover opacity-50"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <span className="text-[10px] text-base-content/30">{page.pageNumber}</span>
                            </div>
                          )}
                        </div>

                        {/* 页面信息 */}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">
                            第 {page.pageNumber} 页：{page.heading}
                          </div>
                          <div className="text-xs text-base-content/50">
                            {page.processStatus === 'completed' && '✓ 处理完成'}
                            {page.processStatus === 'processing' && '处理中...'}
                            {page.processStatus === 'error' && `✗ ${page.processError}`}
                            {(!page.processStatus || page.processStatus === 'pending') && '等待处理'}
                          </div>
                        </div>

                        {/* 操作按钮 */}
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {/* 重试按钮 - 失败或已完成时显示 */}
                          {(page.processStatus === 'error' || page.processStatus === 'completed') && (
                            <button
                              className={`btn btn-ghost btn-xs p-1 ${
                                page.processStatus === 'error' ? 'text-error hover:bg-error/10' : 'text-base-content/50 hover:bg-base-300'
                              }`}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRetryPage(index);
                              }}
                              disabled={data.status === 'processing'}
                              title="重新处理"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                            </button>
                          )}

                          {/* 状态图标 */}
                          {page.processStatus === 'completed' && (
                            <CheckCircle2 className="w-4 h-4 text-success" />
                          )}
                          {page.processStatus === 'processing' && (
                            <Loader2 className="w-4 h-4 text-secondary animate-spin" />
                          )}
                          {page.processStatus === 'error' && (
                            <AlertCircle className="w-4 h-4 text-error" />
                          )}
                          {(!page.processStatus || page.processStatus === 'pending') && (
                            <div className="w-4 h-4 rounded-full border-2 border-base-content/20" />
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 面板底部 */}
            <div className="flex items-center justify-between px-5 py-3.5 border-t border-base-300">
              <div className="text-xs text-base-content/50">
                {data.exportMode === 'image' && '纯图片模式：直接导出 PPT 图片'}
                {data.exportMode === 'background' && (
                  canDownload
                    ? '所有页面处理完成，可以下载'
                    : '请先完成背景处理'
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="btn btn-outline gap-2"
                  onClick={handleDownloadScripts}
                  disabled={data.pages.length === 0}
                >
                  <FileText className="w-4 h-4" />
                  导出讲稿
                </button>
                <button
                  className={`btn btn-primary gap-2 ${
                    isProcessing || !canDownload ? "btn-disabled" : ""
                  }`}
                  onClick={handleDownloadPPT}
                  disabled={isProcessing || !canDownload}
                >
                  {data.status === "generating" ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      生成中{dots}
                    </>
                  ) : (
                    <>
                      <FileDown className="w-4 h-4" />
                      下载 PPTX
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* 图片全屏预览 */}
      {showFullPreview && currentPageData && (
        <ImagePreviewModal
          imageData={
            previewMode === 'processed' && currentPageData.processedBackground
              ? currentPageData.processedBackground
              : currentPageData.image
          }
          onClose={() => setShowFullPreview(false)}
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
});

PPTAssemblerNode.displayName = "PPTAssemblerNode";

export default PPTAssemblerNode;
