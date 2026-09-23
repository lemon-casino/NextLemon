/**
 * 节点执行适配器
 * 为每种节点类型提供统一的执行接口
 */

import type { Node, Edge } from "@xyflow/react";
import type {
  CustomNodeData,
  ImageGeneratorNodeData,
  LLMContentNodeData,
  VideoGeneratorNodeData,
  PPTContentNodeData,
} from "@/types";
import type { NodeExecutionResult } from "@/types/workflow";
import { shouldSkipNode } from "@/types/workflow";
import { useFlowStore } from "@/stores/flowStore";
import { useCanvasStore } from "@/stores/canvasStore";
import { useCreativeStore } from "@/stores/creativeStore";
import { generateImage, editImage } from "@/services/imageService";
import { generateLLMContent, generateText } from "@/services/llmService";
import { createVideoTask, pollVideoTask } from "@/services/videoService";
import { saveImage, isTauriEnvironment, readImage } from "@/services/fileStorageService";
import { generateThumbnail } from "@/utils/imageCompression";
import type { PPTPageItem, ConnectedImageInfo } from "@/components/nodes/PPTContentNode/types";
import {
  buildPageImagePrompt,
  buildSystemPrompt,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_OUTLINE_MODEL,
  getVisualStylePrompt,
  PPT_OUTLINE_JSON_SCHEMA,
} from "@/components/nodes/PPTContentNode/types";
import {
  createPageItemsFromOutline,
  mapWithConcurrency,
  parseOutlineContent,
  PPT_PAGE_MAX_PARALLEL,
  resolveAssetMentionsInPrompt,
} from "@/components/nodes/PPTContentNode/executionCore";

// 自定义节点类型
type CustomNode = Node<CustomNodeData>;

/**
 * 从指定画布获取连接的输入数据（异步版本，支持从文件加载图片）
 * 解决画布切换时数据读取错误的问题
 */
async function getConnectedInputDataFromCanvas(
  nodeId: string,
  canvasId: string
): Promise<{
  prompt?: string;
  images: string[];
  files: Array<{ data: string; mimeType: string; fileName?: string }>;
}> {
  const { activeCanvasId } = useCanvasStore.getState();

  // 如果是当前活跃画布，使用 flowStore 的异步版本
  if (canvasId === activeCanvasId) {
    return finalizeGenerationInput(
      await useFlowStore.getState().getConnectedInputDataAsync(nodeId)
    );
  }

  // 否则从 canvasStore 读取目标画布的数据
  const canvas = useCanvasStore.getState().canvases.find((c) => c.id === canvasId);
  if (!canvas) {
    return { images: [], files: [] };
  }

  const nodes = canvas.nodes as CustomNode[];
  const edges = canvas.edges as Edge[];
  const incomingEdges = edges.filter((edge) => edge.target === nodeId);

  let prompt: string | undefined;
  const images: string[] = [];
  const files: Array<{ data: string; mimeType: string; fileName?: string }> = [];

  for (const edge of incomingEdges) {
    const sourceNode = nodes.find((n) => n.id === edge.source);
    if (!sourceNode) continue;

    const targetHandle = edge.targetHandle;

    if (targetHandle === "input-prompt") {
      if (sourceNode.type === "promptNode") {
        const data = sourceNode.data as { prompt?: string };
        prompt = data.prompt;
      } else if (sourceNode.type === "llmContentNode") {
        const data = sourceNode.data as { outputContent?: string };
        prompt = data.outputContent;
      }
    } else if (targetHandle === "input-image") {
      let imageData: string | undefined;
      if (sourceNode.type === "imageInputNode") {
        const data = sourceNode.data as { imageData?: string; imagePath?: string };
        // 优先从文件加载
        if (data.imagePath) {
          try {
            imageData = await readImage(data.imagePath);
          } catch (err) {
            console.warn("从文件加载图片失败:", err);
            imageData = data.imageData;
          }
        } else {
          imageData = data.imageData;
        }
      } else if (sourceNode.type === "imageGeneratorProNode" || sourceNode.type === "imageGeneratorFastNode") {
        const data = sourceNode.data as { outputImage?: string; outputImagePath?: string };
        // 优先从文件加载
        if (data.outputImagePath) {
          try {
            imageData = await readImage(data.outputImagePath);
          } catch (err) {
            console.warn("从文件加载图片失败:", err);
            imageData = data.outputImage;
          }
        } else {
          imageData = data.outputImage;
        }
      }
      if (imageData) {
        images.push(imageData);
      }
    } else if (targetHandle === "input-file") {
      if (sourceNode.type === "fileUploadNode") {
        const data = sourceNode.data as { fileData?: string; mimeType?: string; fileName?: string };
        if (data.fileData && data.mimeType) {
          files.push({
            data: data.fileData,
            mimeType: data.mimeType,
            fileName: data.fileName,
          });
        }
      }
    } else {
      // 兼容旧连接
      if (sourceNode.type === "promptNode") {
        const data = sourceNode.data as { prompt?: string };
        prompt = data.prompt;
      } else if (sourceNode.type === "llmContentNode") {
        const data = sourceNode.data as { outputContent?: string };
        prompt = data.outputContent;
      } else if (sourceNode.type === "imageInputNode") {
        const data = sourceNode.data as { imageData?: string; imagePath?: string };
        let imageData: string | undefined;
        if (data.imagePath) {
          try {
            imageData = await readImage(data.imagePath);
          } catch (err) {
            console.warn("从文件加载图片失败:", err);
            imageData = data.imageData;
          }
        } else {
          imageData = data.imageData;
        }
        if (imageData) images.push(imageData);
      } else if (sourceNode.type === "imageGeneratorProNode" || sourceNode.type === "imageGeneratorFastNode") {
        const data = sourceNode.data as { outputImage?: string; outputImagePath?: string };
        let imageData: string | undefined;
        if (data.outputImagePath) {
          try {
            imageData = await readImage(data.outputImagePath);
          } catch (err) {
            console.warn("从文件加载图片失败:", err);
            imageData = data.outputImage;
          }
        } else {
          imageData = data.outputImage;
        }
        if (imageData) images.push(imageData);
      } else if (sourceNode.type === "fileUploadNode") {
        const data = sourceNode.data as { fileData?: string; mimeType?: string; fileName?: string };
        if (data.fileData && data.mimeType) {
          files.push({ data: data.fileData, mimeType: data.mimeType, fileName: data.fileName });
        }
      }
    }
  }

  return finalizeGenerationInput({ prompt, images, files });
}

/**
 * 汇总生成输入：还原 prompt 中的 @[asset_N] 提及
 * 命中的素材图片追加为图片参考输入，prompt 中对应 token 替换为【图1】【图2】式编号引用
 * （无命中时行为不变；两条画布读取路径统一经过此处）
 */
async function finalizeGenerationInput(input: {
  prompt?: string;
  images: string[];
  files: Array<{ data: string; mimeType: string; fileName?: string }>;
}): Promise<{
  prompt?: string;
  images: string[];
  files: Array<{ data: string; mimeType: string; fileName?: string }>;
}> {
  const mentionResolved = await resolveMentionInputs(input.prompt);

  return {
    prompt: mentionResolved.prompt,
    images: [...input.images, ...mentionResolved.images],
    files: input.files,
  };
}

/**
 * 解析 prompt 中的 @[asset_N] 提及（此前仅用于提交校验，生成时不还原）
 * 从 creativeStore 查找命中素材，图片素材作为图片参考输入返回
 */
async function resolveMentionInputs(
  prompt: string | undefined
): Promise<{ prompt?: string; images: string[] }> {
  if (!prompt) return { prompt, images: [] };

  const { assets } = useCreativeStore.getState();
  // 素材图片优先从文件路径加载（Tauri），加载失败时由执行核心回退 dataUrl 或保持原样
  const { prompt: resolvedPrompt, images } = await resolveAssetMentionsInPrompt(
    prompt,
    assets,
    readImage
  );
  return { prompt: resolvedPrompt, images };
}

/**
 * 画布感知的节点数据更新
 * 确保即使用户切换画布，状态也能正确更新到目标画布
 */
function updateNodeDataWithCanvas<T extends CustomNodeData>(
  nodeId: string,
  canvasId: string,
  data: Partial<T>
): void {
  const { activeCanvasId } = useCanvasStore.getState();

  if (canvasId === activeCanvasId) {
    // 目标画布是当前活跃画布，直接更新 flowStore
    const { updateNodeData } = useFlowStore.getState();
    updateNodeData<T>(nodeId, data);
  } else {
    // 目标画布不是当前活跃画布，只更新 canvasStore
    // 不要更新 flowStore，因为 flowStore 现在加载的是其他画布的数据
    const canvasStore = useCanvasStore.getState();
    const canvas = canvasStore.canvases.find((c) => c.id === canvasId);

    if (canvas) {
      const updatedNodes = canvas.nodes.map((node) => {
        if (node.id === nodeId) {
          return { ...node, data: { ...node.data, ...data } };
        }
        return node;
      });

      useCanvasStore.setState((state) => ({
        canvases: state.canvases.map((c) =>
          c.id === canvasId ? { ...c, nodes: updatedNodes, updatedAt: Date.now() } : c
        ),
      }));
    }
  }
}

/**
 * 执行图片生成节点
 */
async function executeImageGeneratorNode(
  node: CustomNode,
  canvasId: string,
  signal?: AbortSignal
): Promise<NodeExecutionResult> {
  const data = node.data as ImageGeneratorNodeData;
  const isPro = node.type === "imageGeneratorProNode";
  const nodeType = isPro ? "imageGeneratorPro" : "imageGeneratorFast";
  // 使用画布感知的数据读取，解决画布切换问题（异步从文件加载图片）
  const { prompt, images } = await getConnectedInputDataFromCanvas(node.id, canvasId);

  // 验证输入
  if (!prompt) {
    updateNodeDataWithCanvas<ImageGeneratorNodeData>(node.id, canvasId, {
      status: "error",
      error: "缺少必需的提示词输入",
    });
    return { success: false, error: "缺少必需的提示词输入" };
  }

  // 更新状态为加载中
  updateNodeDataWithCanvas<ImageGeneratorNodeData>(node.id, canvasId, {
    status: "loading",
    error: undefined,
  });

  try {
    // 调用服务
    const response =
      images.length > 0
        ? await editImage(
          {
            prompt,
            model: data.model,
            inputImages: images,
            aspectRatio: data.aspectRatio,
            imageSize: isPro ? data.imageSize : undefined,
          },
          nodeType,
          undefined, // onProgress
          signal
        )
        : await generateImage(
          {
            prompt,
            model: data.model,
            aspectRatio: data.aspectRatio,
            imageSize: isPro ? data.imageSize : undefined,
          },
          nodeType,
          undefined, // onProgress
          signal
        );

    // 检查是否被取消
    if (signal?.aborted) {
      updateNodeDataWithCanvas<ImageGeneratorNodeData>(node.id, canvasId, {
        status: "idle",
      });
      return { success: false, error: "已取消" };
    }

    if (response.error) {
      updateNodeDataWithCanvas<ImageGeneratorNodeData>(node.id, canvasId, {
        status: "error",
        error: response.error,
        errorDetails: response.errorDetails,
      });
      return { success: false, error: response.error };
    }

    // 保存图片
    let imagePath: string | undefined;
    if (isTauriEnvironment() && response.imageData) {
      try {
        const imageInfo = await saveImage(response.imageData, canvasId, node.id);
        imagePath = imageInfo.path;
      } catch {
        // 文件保存失败，回退到 base64
      }
    }

    // 更新成功状态
    updateNodeDataWithCanvas<ImageGeneratorNodeData>(node.id, canvasId, {
      status: "success",
      outputImage: response.imageData,
      outputImagePath: imagePath,
      error: undefined,
    });

    return {
      success: true,
      output: { imageData: response.imageData, imagePath },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "执行失败";

    // 检查是否是中断错误
    if (error instanceof Error && error.name === "AbortError") {
      updateNodeDataWithCanvas<ImageGeneratorNodeData>(node.id, canvasId, {
        status: "idle",
      });
      return { success: false, error: "已取消" };
    }

    updateNodeDataWithCanvas<ImageGeneratorNodeData>(node.id, canvasId, {
      status: "error",
      error: errorMessage,
    });

    return { success: false, error: errorMessage };
  }
}

/**
 * 执行 LLM 内容生成节点
 */
async function executeLLMContentNode(
  node: CustomNode,
  canvasId: string,
  signal?: AbortSignal
): Promise<NodeExecutionResult> {
  const data = node.data as LLMContentNodeData;
  // 使用画布感知的数据读取，解决画布切换问题（异步从文件加载图片）
  const { prompt, files } = await getConnectedInputDataFromCanvas(node.id, canvasId);

  // 验证输入
  if (!prompt && files.length === 0) {
    updateNodeDataWithCanvas<LLMContentNodeData>(node.id, canvasId, {
      status: "error",
      error: "缺少必需的提示词或文件输入",
    });
    return { success: false, error: "缺少必需的提示词或文件输入" };
  }

  // 更新状态为加载中
  updateNodeDataWithCanvas<LLMContentNodeData>(node.id, canvasId, {
    status: "loading",
    error: undefined,
    outputContent: "",
  });

  try {
    // 检查中断
    if (signal?.aborted) {
      updateNodeDataWithCanvas<LLMContentNodeData>(node.id, canvasId, {
        status: "idle",
      });
      return { success: false, error: "已取消" };
    }

    const response = await generateLLMContent({
      prompt: prompt || "请分析这个文件的内容",
      model: data.model,
      systemPrompt: data.systemPrompt || undefined,
      temperature: data.temperature,
      maxTokens: data.maxTokens,
      files: files.length > 0 ? files : undefined,
    });

    // 检查中断
    if (signal?.aborted) {
      updateNodeDataWithCanvas<LLMContentNodeData>(node.id, canvasId, {
        status: "idle",
      });
      return { success: false, error: "已取消" };
    }

    if (response.error) {
      updateNodeDataWithCanvas<LLMContentNodeData>(node.id, canvasId, {
        status: "error",
        error: response.error,
        errorDetails: response.errorDetails,
      });
      return { success: false, error: response.error };
    }

    // 更新成功状态
    updateNodeDataWithCanvas<LLMContentNodeData>(node.id, canvasId, {
      status: "success",
      outputContent: response.content,
      error: undefined,
    });

    return {
      success: true,
      output: { content: response.content },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "执行失败";

    updateNodeDataWithCanvas<LLMContentNodeData>(node.id, canvasId, {
      status: "error",
      error: errorMessage,
    });

    return { success: false, error: errorMessage };
  }
}

/**
 * 执行视频生成节点
 */
async function executeVideoGeneratorNode(
  node: CustomNode,
  canvasId: string,
  signal?: AbortSignal
): Promise<NodeExecutionResult> {
  const data = node.data as VideoGeneratorNodeData;
  // 使用画布感知的数据读取，解决画布切换问题（异步从文件加载图片）
  const { prompt, images } = await getConnectedInputDataFromCanvas(node.id, canvasId);

  // 验证输入
  if (!prompt) {
    updateNodeDataWithCanvas<VideoGeneratorNodeData>(node.id, canvasId, {
      status: "error",
      error: "缺少必需的提示词输入",
    });
    return { success: false, error: "缺少必需的提示词输入" };
  }

  // 更新状态为加载中
  updateNodeDataWithCanvas<VideoGeneratorNodeData>(node.id, canvasId, {
    status: "loading",
    error: undefined,
    taskStage: "queued",
    progress: 0,
  });

  try {
    // 检查是否已取消
    if (signal?.aborted) {
      updateNodeDataWithCanvas<VideoGeneratorNodeData>(node.id, canvasId, {
        status: "idle",
      });
      return { success: false, error: "已取消" };
    }

    // 创建任务（传递 signal 以支持取消）
    const createResult = await createVideoTask({
      prompt,
      model: data.model,
      seconds: data.seconds,
      size: data.size,
      inputImage: images.length > 0 ? images[0] : undefined,
    }, signal);

    if (createResult.error || !createResult.taskId) {
      const errorMsg = createResult.error || "创建任务失败";
      updateNodeDataWithCanvas<VideoGeneratorNodeData>(node.id, canvasId, {
        status: "error",
        error: errorMsg,
      });
      return { success: false, error: errorMsg };
    }

    const taskId = createResult.taskId;

    // 更新任务 ID
    updateNodeDataWithCanvas<VideoGeneratorNodeData>(node.id, canvasId, {
      taskId,
      taskStage: "queued",
    });

    // 轮询等待完成（传递 signal 以支持取消）
    const pollResult = await pollVideoTask(taskId, (info) => {
      // 检查中断
      if (signal?.aborted) return;

      // 更新进度
      updateNodeDataWithCanvas<VideoGeneratorNodeData>(node.id, canvasId, {
        progress: info.progress,
        taskStage: info.stage,
      });
    }, 120, 5000, signal);

    // 检查中断
    if (signal?.aborted) {
      updateNodeDataWithCanvas<VideoGeneratorNodeData>(node.id, canvasId, {
        status: "idle",
        taskStage: undefined,
        progress: undefined,
      });
      return { success: false, error: "已取消" };
    }

    if (pollResult.error) {
      updateNodeDataWithCanvas<VideoGeneratorNodeData>(node.id, canvasId, {
        status: "error",
        error: pollResult.error,
        taskStage: "failed",
      });
      return { success: false, error: pollResult.error };
    }

    // 更新成功状态
    updateNodeDataWithCanvas<VideoGeneratorNodeData>(node.id, canvasId, {
      status: "success",
      taskStage: "completed",
      progress: 100,
      error: undefined,
    });

    return {
      success: true,
      output: { taskId },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "执行失败";

    updateNodeDataWithCanvas<VideoGeneratorNodeData>(node.id, canvasId, {
      status: "error",
      error: errorMessage,
      taskStage: "failed",
    });

    return { success: false, error: errorMessage };
  }
}

/**
 * 执行 PPT 内容生成节点
 * 两阶段自动执行（与手动按钮相同的服务路径）：
 * 1. 大纲未就绪时，自动按"生成大纲"按钮的路径生成大纲；
 * 2. 大纲就绪后，按"开始生成"按钮的路径逐页生成页面图片（遵守并发上限）。
 */
async function executePPTContentNode(
  node: CustomNode,
  canvasId: string,
  signal?: AbortSignal
): Promise<NodeExecutionResult> {
  const data = node.data as PPTContentNodeData;
  // 使用画布感知的数据读取，解决画布切换问题（异步从文件加载图片）
  const { prompt, files } = await getConnectedInputDataFromCanvas(node.id, canvasId);

  // 验证输入
  if (!prompt && files.length === 0) {
    const errorMsg = "缺少必需的提示词或文件输入";
    updateNodeDataWithCanvas<PPTContentNodeData>(node.id, canvasId, {
      error: errorMsg,
    });
    return { success: false, error: errorMsg };
  }

  // 检查中断
  if (signal?.aborted) {
    return { success: false, error: "已取消" };
  }

  // 阶段一：大纲未就绪时自动生成大纲（与手动"生成大纲"按钮相同的服务路径）
  if (data.outlineStatus !== "ready") {
    const outlineResult = await generatePPTOutlineStage(
      node.id,
      canvasId,
      prompt || "根据文件内容生成 PPT 大纲",
      files,
      data
    );
    if (!outlineResult.success) {
      return outlineResult;
    }
  }

  // 阶段二：逐页生成页面图片（与手动"开始生成"按钮相同的服务路径）
  return generatePPTPagesStage(node.id, canvasId, signal);
}

/**
 * 阶段一：生成 PPT 大纲
 * 与 usePPTContentExecution.generateOutline 相同的服务路径：
 * buildSystemPrompt + generateText（结构化输出）+ parseOutlineContent 校验。
 */
async function generatePPTOutlineStage(
  nodeId: string,
  canvasId: string,
  prompt: string,
  files: Array<{ data: string; mimeType: string; fileName?: string }>,
  data: PPTContentNodeData
): Promise<NodeExecutionResult> {
  updateNodeDataWithCanvas<PPTContentNodeData>(nodeId, canvasId, {
    outlineStatus: "generating",
    outlineError: undefined,
  });

  try {
    // 根据配置构建系统提示词，使用用户配置的模型或默认模型
    const response = await generateText({
      prompt,
      model: data.outlineModel || DEFAULT_OUTLINE_MODEL,
      systemPrompt: buildSystemPrompt(data.outlineConfig),
      files,
      responseJsonSchema: PPT_OUTLINE_JSON_SCHEMA,
    });

    if (response.error || !response.content) {
      const errorMsg = response.error || "LLM 未返回内容";
      updateNodeDataWithCanvas<PPTContentNodeData>(nodeId, canvasId, {
        outlineStatus: "error",
        outlineError: errorMsg,
      });
      return { success: false, error: errorMsg };
    }

    // 解析并校验大纲结构（与手动路径共享同一纯函数）
    const parsed = parseOutlineContent(response.content);
    if (parsed.error || !parsed.outline) {
      updateNodeDataWithCanvas<PPTContentNodeData>(nodeId, canvasId, {
        outlineStatus: "error",
        outlineError: parsed.error,
      });
      return { success: false, error: parsed.error };
    }

    // 初始化页面列表
    const pages = createPageItemsFromOutline(parsed.outline);

    updateNodeDataWithCanvas<PPTContentNodeData>(nodeId, canvasId, {
      outlineStatus: "ready",
      outline: parsed.outline,
      pages,
      progress: { completed: 0, total: pages.length },
    });

    return { success: true, output: { outline: parsed.outline } };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "生成大纲时发生错误";
    updateNodeDataWithCanvas<PPTContentNodeData>(nodeId, canvasId, {
      outlineStatus: "error",
      outlineError: errorMsg,
    });
    return { success: false, error: errorMsg };
  }
}

/**
 * 阶段二：逐页生成 PPT 页面图片
 * 与 usePPTContentExecution.startGeneration / generatePageImage 相同的服务路径，
 * 使用信号量并发（上限 PPT_PAGE_MAX_PARALLEL，与工作流引擎默认并发数一致）。
 */
async function generatePPTPagesStage(
  nodeId: string,
  canvasId: string,
  signal?: AbortSignal
): Promise<NodeExecutionResult> {
  if (signal?.aborted) {
    return { success: false, error: "已取消" };
  }

  // 大纲生成可能已更新 store，这里从正确的画布读取最新节点数据
  const data = readPPTContentNodeData(nodeId, canvasId);
  if (!data) {
    const errorMsg = "PPT 节点数据不存在";
    updateNodeDataWithCanvas<PPTContentNodeData>(nodeId, canvasId, {
      error: errorMsg,
    });
    return { success: false, error: errorMsg };
  }

  // 检查是否有待生成的页面
  const pages = data.pages || [];
  const pendingPages = pages.filter((p) => p.status === "pending");
  if (pendingPages.length === 0) {
    // 所有页面已完成或没有页面
    if (pages.length > 0) {
      return { success: true }; // 已经完成了
    }
    const errorMsg = "没有待生成的页面";
    updateNodeDataWithCanvas<PPTContentNodeData>(nodeId, canvasId, {
      error: errorMsg,
    });
    return { success: false, error: errorMsg };
  }

  // 获取连接图片（画布感知、异步从文件加载）并挑选模板基底图
  const connectedImages = await getConnectedImagesInfoFromCanvas(nodeId, canvasId);
  const templateImage = pickTemplateImage(connectedImages, data.selectedTemplateId);
  if (!templateImage) {
    const errorMsg = "请上传模板基底图";
    updateNodeDataWithCanvas<PPTContentNodeData>(nodeId, canvasId, {
      error: errorMsg,
    });
    return { success: false, error: errorMsg };
  }

  updateNodeDataWithCanvas<PPTContentNodeData>(nodeId, canvasId, {
    generationStatus: "running",
    error: undefined,
  });

  // 并发生成所有待处理页面（信号量限流）
  await mapWithConcurrency(pendingPages, PPT_PAGE_MAX_PARALLEL, (page) =>
    generatePPTPageImage(nodeId, canvasId, page, {
      templateImage,
      connectedImages,
      data,
      signal,
    })
  );

  // 检查最终状态（从正确的画布读取）
  const finalData = readPPTContentNodeData(nodeId, canvasId);
  const finalPages = finalData?.pages || pages;
  const failedPages = finalPages.filter((p) => p.status === "failed");
  const allDone = finalPages.every(
    (p) => p.status === "completed" || p.status === "skipped" || p.status === "failed"
  );

  // 检查中断（页面状态已由 worker 恢复为 pending，这里清理节点级状态，
  // 避免 generationStatus 永久卡在 "running" 导致 UI 一直显示"生成中"）
  if (signal?.aborted) {
    updateNodeDataWithCanvas<PPTContentNodeData>(nodeId, canvasId, {
      generationStatus: "idle",
    });
    return { success: false, error: "已取消" };
  }

  // 用户在自动执行期间点了暂停（节点 UI 的暂停入口会把 generationStatus 置为
  // "paused" 并把 running 页面重置为 pending）：保留 "paused"，不用完成态覆盖
  const isPaused = finalData?.generationStatus === "paused";

  if (allDone) {
    if (!isPaused) {
      updateNodeDataWithCanvas<PPTContentNodeData>(nodeId, canvasId, {
        generationStatus: failedPages.length > 0 ? "error" : "completed",
      });
    }
  } else if (!isPaused) {
    // 部分页面仍处于 pending（例如被中断恢复），回退到空闲状态
    updateNodeDataWithCanvas<PPTContentNodeData>(nodeId, canvasId, {
      generationStatus: "idle",
    });
  }

  if (failedPages.length > 0) {
    const errorMsg = `${failedPages.length} 个页面生成失败`;
    updateNodeDataWithCanvas<PPTContentNodeData>(nodeId, canvasId, {
      error: errorMsg,
    });
    return {
      success: false,
      error: errorMsg,
      output: { pages: finalPages },
    };
  }

  // 暂停后仍有页面未完成：如实向工作流返回未完成，而不是误报成功
  if (isPaused && !allDone) {
    return {
      success: false,
      error: "生成已暂停",
      output: { pages: finalPages },
    };
  }

  return {
    success: true,
    output: { pages: finalPages },
  };
}

/**
 * 生成单页 PPT 页面图片
 * 与 usePPTContentExecution.generatePageImage 相同的服务路径
 */
async function generatePPTPageImage(
  nodeId: string,
  canvasId: string,
  page: PPTPageItem,
  context: {
    templateImage: string;
    connectedImages: ConnectedImageInfo[];
    data: PPTContentNodeData;
    signal?: AbortSignal;
  }
): Promise<boolean> {
  const { templateImage, connectedImages, data, signal } = context;

  // 已取消时不再把页面置为 running
  if (signal?.aborted) {
    return false;
  }

  // 更新状态为 running（原子操作）
  updatePPTPageState(nodeId, canvasId, page.id, { status: "running", error: undefined });

  try {
    // 获取当前页引用的补充图片
    const supplementImageRefs = page.supplement?.imageRefs || [];
    const supplementImages = supplementImageRefs
      .map((refId) => connectedImages.find((img) => img.id === refId))
      .filter((img): img is ConnectedImageInfo => !!img);

    // 判断是否为标题页（第一页且开启了标题页模式）
    const isTitlePage = page.pageNumber === 1 && data.firstPageIsTitlePage;

    // 构建完整的页面图片生成提示词（使用视觉风格模板，包含补充信息）
    const visualStylePrompt = getVisualStylePrompt(data.visualStyleTemplate, data.customVisualStylePrompt);
    const prompt = buildPageImagePrompt(
      page,
      visualStylePrompt,
      supplementImages.map((img) => ({ fileName: img.fileName || `图片-${img.id.slice(0, 4)}` })),
      isTitlePage
    );

    // 准备输入图片：基底图 + 补充图片
    const inputImages = [templateImage, ...supplementImages.map((img) => img.imageData)];

    // 使用模板基底图 + 完整提示词生成 PPT 页面（用户配置的图片模型或默认模型）
    const imageModelToUse = data.imageModel || DEFAULT_IMAGE_MODEL;
    const response = await editImage(
      {
        prompt,
        model: imageModelToUse,
        inputImages,
        aspectRatio: data.imageConfig.aspectRatio,
        imageSize: data.imageConfig.imageSize,
      },
      "imageGeneratorPro",
      undefined, // onProgress
      signal
    );

    // 检查是否被取消（中断的页面恢复为待生成）
    if (signal?.aborted || response.error === "已取消") {
      updatePPTPageState(nodeId, canvasId, page.id, { status: "pending", error: undefined });
      return false;
    }

    if (response.error) {
      updatePPTPageState(nodeId, canvasId, page.id, { status: "failed", error: response.error });
      return false;
    }

    if (!response.imageData) {
      updatePPTPageState(nodeId, canvasId, page.id, { status: "failed", error: "未返回图片数据" });
      return false;
    }

    // 获取当前页面的 attempts 数（从正确的画布读取最新数据）
    const currentData = readPPTContentNodeData(nodeId, canvasId);
    const currentPage = currentData?.pages.find((p) => p.id === page.id);
    const attempts = (currentPage?.result?.attempts || 0) + 1;

    // 在 Tauri 环境下保存图片到文件系统
    let imagePath: string | undefined;
    let thumbnailPath: string | undefined;
    if (isTauriEnvironment() && canvasId) {
      try {
        const imageInfo = await saveImage(
          response.imageData,
          canvasId,
          `${nodeId}-page-${page.pageNumber}`
        );
        imagePath = imageInfo.path;
      } catch (saveError) {
        // 文件保存失败不影响主流程，只是没有本地存储
        console.warn("PPT 页面图片保存到文件系统失败:", saveError);
      }
    }

    // 生成缩略图用于画布预览（减少内存占用）
    let thumbnail: string | undefined;
    try {
      thumbnail = await generateThumbnail(response.imageData, {
        maxWidth: 800,
        quality: 0.85,
        format: "jpeg",
      });

      // 在 Tauri 环境下也保存缩略图
      if (isTauriEnvironment() && canvasId && thumbnail) {
        try {
          const thumbInfo = await saveImage(
            thumbnail,
            canvasId,
            `${nodeId}-page-${page.pageNumber}-thumb`
          );
          thumbnailPath = thumbInfo.path;
        } catch (thumbSaveError) {
          console.warn("缩略图保存失败:", thumbSaveError);
        }
      }
    } catch (thumbError) {
      console.warn("缩略图生成失败:", thumbError);
    }

    // 更新为成功状态（原子操作）
    updatePPTPageState(nodeId, canvasId, page.id, {
      status: "completed",
      result: {
        image: response.imageData,
        imagePath,
        thumbnail,
        thumbnailPath,
        generatedAt: Date.now(),
        attempts,
      },
      error: undefined,
    });

    return true;
  } catch (error) {
    // 检查是否是中断错误（中断的页面恢复为待生成）
    if (error instanceof Error && error.name === "AbortError") {
      updatePPTPageState(nodeId, canvasId, page.id, { status: "pending", error: undefined });
      return false;
    }

    updatePPTPageState(nodeId, canvasId, page.id, {
      status: "failed",
      error: error instanceof Error ? error.message : "生成失败",
    });
    return false;
  }
}

/**
 * 从正确的画布读取 PPT 节点最新数据
 */
function readPPTContentNodeData(
  nodeId: string,
  canvasId: string
): PPTContentNodeData | undefined {
  const { activeCanvasId } = useCanvasStore.getState();

  if (canvasId === activeCanvasId) {
    const { nodes } = useFlowStore.getState();
    const node = nodes.find((n) => n.id === nodeId);
    return node?.data as PPTContentNodeData | undefined;
  }

  const canvas = useCanvasStore.getState().canvases.find((c) => c.id === canvasId);
  const node = canvas?.nodes.find((n) => n.id === nodeId);
  return node?.data as PPTContentNodeData | undefined;
}

/**
 * PPT 节点单页状态原子更新（并发安全、画布感知）
 * 与 usePPTContentExecution.updatePageState 保持一致
 */
function updatePPTPageState(
  nodeId: string,
  canvasId: string,
  pageId: string,
  pageUpdates: Partial<PPTPageItem>
): void {
  const currentData = readPPTContentNodeData(nodeId, canvasId);
  if (!currentData) return;

  const updatedPages = currentData.pages.map((p) =>
    p.id === pageId ? { ...p, ...pageUpdates } : p
  );

  const newCompleted = updatedPages.filter(
    (p) => p.status === "completed" || p.status === "skipped"
  ).length;

  updateNodeDataWithCanvas<PPTContentNodeData>(nodeId, canvasId, {
    pages: updatedPages,
    progress: { completed: newCompleted, total: updatedPages.length },
  });
}

/**
 * 画布感知地获取连接的图片信息（异步从文件加载）
 * 与 flowStore.getConnectedImagesWithInfoAsync 行为一致，供模板基底图与补充图片使用
 */
async function getConnectedImagesInfoFromCanvas(
  nodeId: string,
  canvasId: string
): Promise<ConnectedImageInfo[]> {
  const { activeCanvasId } = useCanvasStore.getState();

  // 当前活跃画布直接使用 flowStore 的异步版本
  if (canvasId === activeCanvasId) {
    const images = await useFlowStore.getState().getConnectedImagesWithInfoAsync(nodeId);
    return images.map((img) => ({
      id: img.id,
      fileName: img.fileName,
      imageData: img.imageData,
    }));
  }

  // 否则从 canvasStore 读取目标画布的数据
  const canvas = useCanvasStore.getState().canvases.find((c) => c.id === canvasId);
  if (!canvas) return [];

  const nodes = canvas.nodes as CustomNode[];
  const edges = canvas.edges as Edge[];
  const images: ConnectedImageInfo[] = [];

  for (const edge of edges.filter((e) => e.target === nodeId)) {
    const sourceNode = nodes.find((n) => n.id === edge.source);
    if (!sourceNode) continue;

    const targetHandle = edge.targetHandle;
    // 只处理图片输入端口
    if (targetHandle !== "input-image" && targetHandle) continue;

    if (sourceNode.type === "imageInputNode") {
      const data = sourceNode.data as { imageData?: string; imagePath?: string; fileName?: string };
      let imageData = data.imageData;
      if (data.imagePath) {
        try {
          imageData = await readImage(data.imagePath);
        } catch (err) {
          console.warn("从文件加载图片失败:", err);
          imageData = data.imageData;
        }
      }
      if (imageData) {
        images.push({
          id: sourceNode.id,
          fileName: data.fileName || `图片-${sourceNode.id.slice(0, 4)}`,
          imageData,
        });
      }
    } else if (sourceNode.type === "imageGeneratorProNode" || sourceNode.type === "imageGeneratorFastNode") {
      const data = sourceNode.data as { outputImage?: string; outputImagePath?: string; label?: string };
      let imageData = data.outputImage;
      if (data.outputImagePath) {
        try {
          imageData = await readImage(data.outputImagePath);
        } catch (err) {
          console.warn("从文件加载图片失败:", err);
          imageData = data.outputImage;
        }
      }
      if (imageData) {
        images.push({
          id: sourceNode.id,
          fileName: data.label || `生成-${sourceNode.id.slice(0, 4)}`,
          imageData,
        });
      }
    }
  }

  return images;
}

/**
 * 挑选模板基底图：与 PPTContentNode.getTemplateImage 一致（选中优先，否则第一张）
 */
function pickTemplateImage(
  images: ConnectedImageInfo[],
  selectedTemplateId?: string
): string | undefined {
  if (images.length === 0) return undefined;

  // 如果有选中的基底图 ID，使用它
  if (selectedTemplateId) {
    const selected = images.find((img) => img.id === selectedTemplateId);
    if (selected) return selected.imageData;
  }

  // 默认使用第一张
  return images[0].imageData;
}

/**
 * 节点执行器类
 */
export class NodeExecutor {
  /**
   * 执行单个节点
   */
  async executeNode(
    node: CustomNode,
    canvasId: string,
    signal?: AbortSignal
  ): Promise<NodeExecutionResult> {
    const nodeType = node.type;

    // 检查是否应该跳过
    if (!nodeType || shouldSkipNode(nodeType)) {
      return { success: true }; // 跳过的节点视为成功
    }

    // 根据节点类型分发执行
    switch (nodeType) {
      case "imageGeneratorProNode":
      case "imageGeneratorFastNode":
        return executeImageGeneratorNode(node, canvasId, signal);

      case "llmContentNode":
        return executeLLMContentNode(node, canvasId, signal);

      case "videoGeneratorNode":
        return executeVideoGeneratorNode(node, canvasId, signal);

      case "pptContentNode":
        return executePPTContentNode(node, canvasId, signal);

      default:
        // 未知节点类型，跳过
        console.warn(`[NodeExecutor] 未知节点类型: ${nodeType}`);
        return { success: true };
    }
  }
}

// 导出单例
export const nodeExecutor = new NodeExecutor();
