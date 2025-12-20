// PPT 组装节点类型定义
import type { ErrorDetails } from "@/types";

// PPT 页面数据（从上游接收）
export interface PPTPageData {
  pageNumber: number;
  heading: string;
  points: string[];
  script: string;
  image: string;  // base64 图片 - 完整的 PPT 页面图片（用于导出）
  thumbnail?: string;  // 缩略图 base64（JPEG 格式，用于画布预览）

  // 仅背景模式处理后的数据
  processedBackground?: string;  // 处理后的背景图 base64（去除文字后）
  processedThumbnail?: string;   // 处理后的背景图缩略图
  processStatus?: 'pending' | 'processing' | 'completed' | 'error';  // 处理状态
  processError?: string;  // 处理错误信息
}

// PPT 组装节点数据
export interface PPTAssemblerNodeData {
  [key: string]: unknown;
  label: string;

  // 幻灯片比例
  aspectRatio: "16:9" | "4:3";

  // 页面数据（从上游同步）
  pages: PPTPageData[];

  // 状态
  status: "idle" | "generating" | "processing" | "ready" | "error";
  error?: string;
  errorDetails?: ErrorDetails;  // 详细错误信息

  // === 可编辑导出功能 ===
  // 导出模式：
  // - image: 纯图片（原始图片直接嵌入）
  // - background: 仅背景（去除文字后的背景图，用户自行添加文字）
  exportMode: "image" | "background";

  // OCR 服务地址
  ocrApiUrl: string;

  // IOPaint 服务地址
  inpaintApiUrl: string;

  // 处理进度（当前处理页面索引和详细步骤）
  processingProgress?: {
    current: number;
    total: number;
    currentStep?: 'ocr' | 'inpaint';  // 当前步骤：OCR识别 或 背景修复
  } | null;
}
