import type {
  CustomNode,
  CustomNodeData,
  PPTAssemblerNodeData,
  PPTContentNodeData,
} from "@/types";
import type { CreativeAssetDraft } from "@/types/creative";

export function createCreativeAssetDraftsFromWorkflowNode(node: CustomNode): CreativeAssetDraft[] {
  const pptDrafts = createPptAssetDraftsFromNode(node);
  if (pptDrafts.length > 0) return pptDrafts;

  const draft = createCreativeAssetDraftFromNode(node);
  return draft ? [draft] : [];
}

export function getDefaultWorkflowNodeData(
  nodeType: string,
  data?: Partial<CustomNodeData>
): CustomNodeData {
  const defaultData = getNodeDefaultData(nodeType);
  return {
    ...defaultData,
    ...(data || {}),
  } as CustomNodeData;
}

function createCreativeAssetDraftFromNode(node: CustomNode): CreativeAssetDraft | null {
  const label = typeof node.data.label === "string" ? node.data.label : "工作流素材";

  if (node.type === "promptNode") {
    const prompt = typeof node.data.prompt === "string" ? node.data.prompt : "";
    if (!prompt.trim()) return null;
    return {
      kind: "text",
      title: label,
      text: prompt,
      source: "workflow",
      metadata: { nodeId: node.id, nodeType: node.type },
    };
  }

  if (node.type === "llmContentNode") {
    const outputContent = typeof node.data.outputContent === "string" ? node.data.outputContent : "";
    if (!outputContent.trim()) return null;
    return {
      kind: "text",
      title: label,
      text: outputContent,
      source: "workflow",
      metadata: { nodeId: node.id, nodeType: node.type },
    };
  }

  if (node.type === "imageInputNode") {
    const imagePath = typeof node.data.imagePath === "string" ? node.data.imagePath : undefined;
    const imageData = typeof node.data.imageData === "string" ? node.data.imageData : undefined;
    if (!imagePath && !imageData) return null;
    return {
      kind: "image",
      title: label,
      dataUrl: imageData ? base64ToDataUrl(imageData, "image/png") : undefined,
      storagePath: imagePath,
      fileName: typeof node.data.fileName === "string" ? node.data.fileName : undefined,
      mimeType: "image/png",
      source: "workflow",
      metadata: { nodeId: node.id, nodeType: node.type },
    };
  }

  if (node.type === "imageGeneratorProNode" || node.type === "imageGeneratorFastNode") {
    const outputImagePath = typeof node.data.outputImagePath === "string" ? node.data.outputImagePath : undefined;
    const outputImage = typeof node.data.outputImage === "string" ? node.data.outputImage : undefined;
    if (!outputImagePath && !outputImage) return null;
    return {
      kind: "image",
      title: label,
      dataUrl: outputImage ? base64ToDataUrl(outputImage, "image/png") : undefined,
      storagePath: outputImagePath,
      mimeType: "image/png",
      source: "workflow",
      metadata: { nodeId: node.id, nodeType: node.type },
    };
  }

  if (node.type === "videoGeneratorNode") {
    const outputVideo = typeof node.data.outputVideo === "string" ? node.data.outputVideo : undefined;
    if (!outputVideo) return null;
    return {
      kind: "video",
      title: label,
      dataUrl: outputVideo,
      mimeType: "video/mp4",
      source: "workflow",
      metadata: { nodeId: node.id, nodeType: node.type },
    };
  }

  if (node.type === "fileUploadNode") {
    const mimeType = typeof node.data.mimeType === "string" ? node.data.mimeType : "";
    const fileData = typeof node.data.fileData === "string" ? node.data.fileData : "";
    const fileName = typeof node.data.fileName === "string" ? node.data.fileName : undefined;
    if (!mimeType || !fileData) return null;
    if (!mimeType.startsWith("image/") && !mimeType.startsWith("video/") && !mimeType.startsWith("audio/")) {
      return null;
    }
    return {
      kind: mimeType.startsWith("image/") ? "image" : mimeType.startsWith("video/") ? "video" : "audio",
      title: fileName || label,
      dataUrl: base64ToDataUrl(fileData, mimeType),
      mimeType,
      fileName,
      bytes: typeof node.data.fileSize === "number" ? node.data.fileSize : undefined,
      source: "workflow",
      metadata: { nodeId: node.id, nodeType: node.type },
    };
  }

  return null;
}

function createPptAssetDraftsFromNode(node: CustomNode): CreativeAssetDraft[] {
  const label = typeof node.data.label === "string" ? node.data.label : "PPT 页面";

  if (node.type === "pptContentNode") {
    const data = node.data as PPTContentNodeData;
    return (data.pages || [])
      .map((page): CreativeAssetDraft | null => {
        const imagePath = page.result?.imagePath || page.manualImagePath;
        const image = page.result?.image || page.manualImage;
        if (!imagePath && !image) return null;

        return {
          kind: "image",
          title: `${label} - P${page.pageNumber} ${page.heading}`,
          dataUrl: image ? base64ToDataUrl(image, "image/png") : undefined,
          storagePath: imagePath,
          mimeType: "image/png",
          source: "workflow",
          tags: ["PPT"],
          metadata: {
            nodeId: node.id,
            nodeType: node.type,
            pageId: page.id,
            pageNumber: page.pageNumber,
            heading: page.heading,
          },
        };
      })
      .filter((draft): draft is CreativeAssetDraft => Boolean(draft));
  }

  if (node.type === "pptAssemblerNode") {
    const data = node.data as PPTAssemblerNodeData;
    return (data.pages || [])
      .map((page): CreativeAssetDraft | null => {
        const image = page.processedBackground || page.image;
        if (!image) return null;

        return {
          kind: "image",
          title: `${label} - P${page.pageNumber} ${page.heading}`,
          dataUrl: base64ToDataUrl(image, "image/png"),
          mimeType: "image/png",
          source: "workflow",
          tags: ["PPT"],
          metadata: {
            nodeId: node.id,
            nodeType: node.type,
            pageNumber: page.pageNumber,
            heading: page.heading,
            exportMode: data.exportMode,
          },
        };
      })
      .filter((draft): draft is CreativeAssetDraft => Boolean(draft));
  }

  return [];
}

function getNodeDefaultData(nodeType: string): Record<string, unknown> {
  switch (nodeType) {
    case "promptNode":
      return { label: "提示词", prompt: "" };
    case "imageInputNode":
      return { label: "图片输入" };
    case "fileUploadNode":
      return { label: "文件上传" };
    case "imageGeneratorProNode":
      return { label: "NanoBanana Pro", aspectRatio: "1:1", imageSize: "1K", status: "idle" };
    case "imageGeneratorFastNode":
      return { label: "NanoBanana", aspectRatio: "1:1", status: "idle" };
    case "llmContentNode":
      return {
        label: "LLM 内容生成",
        model: "gemini-2.5-flash",
        systemPrompt: "",
        temperature: 0.7,
        maxTokens: 8192,
        status: "idle",
      };
    case "videoGeneratorNode":
      return { label: "视频生成", model: "sora-2", seconds: "10", size: "1280x720", status: "idle" };
    case "pptContentNode":
      return {
        label: "PPT 内容生成",
        activeTab: "config",
        outlineConfig: { pageCountRange: "8-12", detailLevel: "moderate", additionalNotes: "" },
        outlineModel: "gemini-3-pro-preview",
        imageModel: "gemini-3-pro-image-preview",
        outlineStatus: "idle",
        imageConfig: { aspectRatio: "16:9", imageSize: "2K" },
        visualStyleTemplate: "academic",
        firstPageIsTitlePage: true,
        pages: [],
        generationStatus: "idle",
        progress: { completed: 0, total: 0 },
      };
    case "pptAssemblerNode":
      return {
        label: "PPT 组装",
        aspectRatio: "16:9",
        pages: [],
        status: "idle",
        exportMode: "image",
        ocrApiUrl: "http://127.0.0.1:8866",
        inpaintApiUrl: "http://127.0.0.1:8080",
      };
    default:
      return { label: nodeType };
  }
}

function base64ToDataUrl(base64: string, mimeType: string) {
  if (base64.startsWith("data:") || base64.startsWith("http://") || base64.startsWith("https://")) {
    return base64;
  }
  return `data:${mimeType};base64,${base64}`;
}
