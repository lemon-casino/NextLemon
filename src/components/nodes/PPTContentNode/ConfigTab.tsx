import { useRef, useState, useCallback, useEffect } from "react";
import { Settings, FileText, AlignLeft, StickyNote, Cpu, ChevronDown, Check, Image, Palette, BookOpen, Briefcase, Sparkles, FileImage, Wand2 } from "lucide-react";
import type { PPTContentNodeData, PageCountRange, DetailLevel, VisualStyleTemplate } from "./types";
import { IMAGE_PRESET_MODELS, VISUAL_STYLE_TEMPLATES } from "./types";
import { useLLMPresetModels } from "@/config/presetModels";
import { generateText } from "@/services/llmService";

// 独立的文本域组件，正确处理中文输入法
function ComposableTextarea({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [localValue, setLocalValue] = useState(value);
  const isComposingRef = useRef(false);

  // 同步外部 value 变化
  useEffect(() => {
    if (!isComposingRef.current) {
      setLocalValue(value);
    }
  }, [value]);

  return (
    <textarea
      className={className}
      value={localValue}
      placeholder={placeholder}
      onPointerDown={(e) => e.stopPropagation()}
      onChange={(e) => {
        setLocalValue(e.target.value);
        if (!isComposingRef.current) {
          onChange(e.target.value);
        }
      }}
      onCompositionStart={() => { isComposingRef.current = true; }}
      onCompositionEnd={(e) => {
        isComposingRef.current = false;
        onChange(e.currentTarget.value);
      }}
    />
  );
}

interface ConfigTabProps {
  config: PPTContentNodeData["outlineConfig"];
  outlineModel: string;
  imageModel: string;
  // 页面生成配置
  imageConfig: PPTContentNodeData["imageConfig"];
  visualStyleTemplate: VisualStyleTemplate;
  customVisualStylePrompt?: string;
  firstPageIsTitlePage: boolean;
  onChange: (config: Partial<PPTContentNodeData["outlineConfig"]>) => void;
  onModelChange: (model: string) => void;
  onImageModelChange: (model: string) => void;
  onChangeImageConfig: (config: Partial<PPTContentNodeData["imageConfig"]>) => void;
  onChangeStyleTemplate: (template: VisualStyleTemplate) => void;
  onChangeCustomStylePrompt: (prompt: string) => void;
  onChangeFirstPageIsTitlePage: (value: boolean) => void;
}

// 页数范围选项
const pageCountOptions: { value: PageCountRange; label: string }[] = [
  { value: "5-8", label: "5-8 页" },
  { value: "8-12", label: "8-12 页" },
  { value: "12-15", label: "12-15 页" },
  { value: "custom", label: "自定义" },
];

// 详细程度选项
const detailLevelOptions: { value: DetailLevel; label: string; desc: string }[] = [
  { value: "concise", label: "简洁", desc: "要点精炼，讲稿简短" },
  { value: "moderate", label: "适中", desc: "要点完整，讲稿适中" },
  { value: "detailed", label: "详细", desc: "要点丰富，讲稿详细" },
];

// 风格模板配置（含图标）
const styleConfigs: Record<VisualStyleTemplate, {
  icon: React.ReactNode;
  name: string;
}> = {
  academic: {
    icon: <BookOpen className="w-4 h-4" />,
    name: "学术风格",
  },
  business: {
    icon: <Briefcase className="w-4 h-4" />,
    name: "商务风格",
  },
  tech: {
    icon: <Cpu className="w-4 h-4" />,
    name: "科技风格",
  },
  custom: {
    icon: <Sparkles className="w-4 h-4" />,
    name: "自定义",
  },
};

// 清晰度选项
const imageSizeOptions = [
  { value: "1K", label: "1K" },
  { value: "2K", label: "2K" },
  { value: "4K", label: "4K" },
];

export function ConfigTab({
  config,
  outlineModel,
  imageModel,
  imageConfig,
  visualStyleTemplate,
  customVisualStylePrompt,
  firstPageIsTitlePage,
  onChange,
  onModelChange,
  onImageModelChange,
  onChangeImageConfig,
  onChangeStyleTemplate,
  onChangeCustomStylePrompt,
  onChangeFirstPageIsTitlePage,
}: ConfigTabProps) {
  // 模型下拉菜单状态
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [customModel, setCustomModel] = useState("");
  // 图片生成模型下拉菜单状态
  const [showImageModelDropdown, setShowImageModelDropdown] = useState(false);
  const [customImageModel, setCustomImageModel] = useState("");
  // 优化提示词状态
  const [isOptimizing, setIsOptimizing] = useState(false);

  // 获取当前供应商的预设 LLM 模型列表（用于大纲生成）
  const { presetModels: outlinePresetModels } = useLLMPresetModels("llm");

  // 优化自定义风格提示词
  const handleOptimizeStylePrompt = useCallback(async () => {
    if (!customVisualStylePrompt?.trim() || isOptimizing) return;

    setIsOptimizing(true);
    try {
      // 参考学术风格的提示词格式
      const referencePrompt = VISUAL_STYLE_TEMPLATES.academic.prompt;

      const systemPrompt = `你是一个专业的 PPT 视觉设计专家。用户会给你一段简单的风格描述，你需要将其扩展为完整、专业的 PPT 页面生成提示词。

请参考以下标准格式进行输出：

${referencePrompt}

---

注意事项：
1. 必须保留【最重要】模板结构保持要求部分，这是固定的，不要修改
2. 根据用户描述的风格特点，重新编写"视觉风格与设计要求"部分
3. 包含：整体风格、配色方案、中间内容区布局、元素细节
4. 保留"重要说明"部分
5. 使用中文输出
6. 直接输出提示词内容，不要添加任何解释或前缀`;

      const response = await generateText({
        prompt: `请将以下用户的简单风格描述优化为完整的 PPT 页面生成提示词：

用户描述：${customVisualStylePrompt}`,
        model: outlineModel,
        systemPrompt,
        temperature: 0.7,
      });

      if (response.content) {
        onChangeCustomStylePrompt(response.content);
      } else if (response.error) {
        console.error("优化失败:", response.error);
      }
    } catch (error) {
      console.error("优化提示词失败:", error);
    } finally {
      setIsOptimizing(false);
    }
  }, [customVisualStylePrompt, outlineModel, onChangeCustomStylePrompt, isOptimizing]);

  // 检查是否是自定义模型
  const isCustomModel = !outlinePresetModels.some((m) => m.value === outlineModel);

  // 获取显示的模型名称
  const getDisplayModelName = () => {
    const preset = outlinePresetModels.find((m) => m.value === outlineModel);
    return preset ? preset.label : outlineModel;
  };

  // 选择预设模型
  const handleSelectModel = (value: string) => {
    onModelChange(value);
    setShowModelDropdown(false);
    setCustomModel("");
  };

  // 使用自定义模型
  const handleCustomModelSubmit = () => {
    if (customModel.trim()) {
      onModelChange(customModel.trim());
      setShowModelDropdown(false);
    }
  };

  // 检查是否是自定义图片模型
  const isCustomImageModel = !IMAGE_PRESET_MODELS.some((m) => m.value === imageModel);

  // 获取显示的图片模型名称
  const getDisplayImageModelName = () => {
    const preset = IMAGE_PRESET_MODELS.find((m) => m.value === imageModel);
    return preset ? preset.label : imageModel;
  };

  // 选择预设图片模型
  const handleSelectImageModel = (value: string) => {
    onImageModelChange(value);
    setShowImageModelDropdown(false);
    setCustomImageModel("");
  };

  // 使用自定义图片模型
  const handleCustomImageModelSubmit = () => {
    if (customImageModel.trim()) {
      onImageModelChange(customImageModel.trim());
      setShowImageModelDropdown(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* ===== 大纲生成配置 ===== */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm font-medium text-base-content border-b border-base-300 pb-2">
          <div className="p-1 rounded bg-primary/10 text-primary">
            <FileText className="w-4 h-4" />
          </div>
          大纲生成配置
        </div>

        {/* 页数范围 */}
        <div>
          <label className="flex items-center gap-1.5 text-xs font-medium text-base-content/70 mb-2">
            <FileText className="w-3.5 h-3.5" />
            PPT 页数
          </label>
          <div className="grid grid-cols-4 gap-1.5">
            {pageCountOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`
                  btn btn-sm h-9 px-3 text-xs font-normal nopan nodrag
                  transition-all duration-200
                  ${config.pageCountRange === option.value
                    ? "btn-primary shadow-md scale-[1.02]"
                    : "btn-ghost bg-base-200 hover:bg-base-300 hover:scale-[1.01]"
                  }
                `}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onChange({ pageCountRange: option.value });
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
          {/* 自定义页数输入 */}
          {config.pageCountRange === "custom" && (
            <div className="mt-2">
              <input
                type="number"
                className="input input-bordered input-sm w-full"
                placeholder="输入页数（如：10）"
                value={config.customPageCount || ""}
                min={3}
                max={30}
                onPointerDown={(e) => e.stopPropagation()}
                onChange={(e) => {
                  const value = parseInt(e.target.value);
                  if (!isNaN(value) && value >= 3 && value <= 30) {
                    onChange({ customPageCount: value });
                  } else if (e.target.value === "") {
                    onChange({ customPageCount: undefined });
                  }
                }}
              />
            </div>
          )}
        </div>

        {/* 详细程度 */}
        <div>
          <label className="flex items-center gap-1.5 text-xs font-medium text-base-content/70 mb-2">
            <AlignLeft className="w-3.5 h-3.5" />
            详细程度
          </label>
          <div className="grid grid-cols-3 gap-1.5">
            {detailLevelOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`
                  btn btn-sm h-auto py-2 px-2 flex flex-col items-center gap-0.5 nopan nodrag
                  transition-all duration-200
                  ${config.detailLevel === option.value
                    ? "btn-primary shadow-md scale-[1.02]"
                    : "btn-ghost bg-base-200 hover:bg-base-300 hover:scale-[1.01]"
                  }
                `}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onChange({ detailLevel: option.value });
                }}
              >
                <span className="text-xs font-medium">{option.label}</span>
                <span className={`text-xs ${config.detailLevel === option.value ? "opacity-70" : "opacity-60"}`}>
                  {option.desc}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* 自由补充框 */}
        <div>
          <label className="flex items-center gap-1.5 text-xs font-medium text-base-content/70 mb-2">
            <StickyNote className="w-3.5 h-3.5" />
            补充说明（可选）
          </label>
          <ComposableTextarea
            className="textarea textarea-bordered w-full min-h-[80px] text-sm resize-none nopan nodrag"
            placeholder={`输入额外的要求或说明，例如：\n• 重点强调技术创新点\n• 需要包含实验对比数据`}
            value={config.additionalNotes || ""}
            onChange={(value) => onChange({ additionalNotes: value })}
          />
        </div>

        {/* 大纲生成模型选择 */}
        <div className="relative">
          <label className="flex items-center gap-1.5 text-xs font-medium text-base-content/70 mb-2">
            <Cpu className="w-3.5 h-3.5" />
            大纲生成模型
            <span className="text-[10px] text-base-content/40 font-normal">（同用于风格优化）</span>
          </label>
          <button
            type="button"
            className="w-full flex items-center justify-between px-3 py-2 bg-base-200 hover:bg-base-300 rounded-lg text-sm transition-colors border border-base-300 nopan nodrag"
            onClick={() => setShowModelDropdown(!showModelDropdown)}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <span className={isCustomModel ? "text-primary font-medium" : ""}>
              {getDisplayModelName()}
            </span>
            <ChevronDown className={`w-4 h-4 transition-transform ${showModelDropdown ? "rotate-180" : ""}`} />
          </button>

          {/* 下拉菜单 */}
          {showModelDropdown && (
            <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-base-100 border border-base-300 rounded-lg shadow-xl overflow-hidden">
              {/* 预设模型 */}
              {outlinePresetModels.map((model) => (
                <button
                  key={model.value}
                  type="button"
                  className={`w-full px-3 py-2 text-left text-sm hover:bg-base-200 transition-colors flex items-center justify-between nopan nodrag ${
                    outlineModel === model.value ? "bg-primary/10 text-primary" : ""
                  }`}
                  onClick={() => handleSelectModel(model.value)}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <span>{model.label}</span>
                  {outlineModel === model.value && <Check className="w-4 h-4" />}
                </button>
              ))}

              {/* 分隔线 */}
              <div className="border-t border-base-300 my-1" />

              {/* 自定义模型输入 */}
              <div className="p-2">
                <label className="text-xs text-base-content/60 mb-1 block">自定义模型</label>
                <div className="flex gap-1">
                  <input
                    type="text"
                    className="input input-sm input-bordered flex-1 text-sm nopan nodrag"
                    placeholder="输入模型名称..."
                    value={customModel}
                    onChange={(e) => setCustomModel(e.target.value)}
                    onPointerDown={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        handleCustomModelSubmit();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-sm btn-primary nopan nodrag"
                    onClick={handleCustomModelSubmit}
                    onPointerDown={(e) => e.stopPropagation()}
                    disabled={!customModel.trim()}
                  >
                    确定
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ===== 页面生成配置 ===== */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm font-medium text-base-content border-b border-base-300 pb-2">
          <div className="p-1 rounded bg-primary/10 text-primary">
            <FileImage className="w-4 h-4" />
          </div>
          页面生成配置
        </div>

        {/* 视觉风格选择 */}
        <div>
          <label className="flex items-center gap-1.5 text-xs font-medium text-base-content/70 mb-2">
            <Palette className="w-3.5 h-3.5" />
            视觉风格
          </label>
          <div className="grid grid-cols-4 gap-1.5">
            {(["academic", "business", "tech", "custom"] as VisualStyleTemplate[]).map((key) => {
              const styleConfig = styleConfigs[key];
              const isSelected = visualStyleTemplate === key;
              return (
                <button
                  key={key}
                  type="button"
                  className={`
                    btn btn-sm h-9 px-2 text-xs font-normal gap-1 nopan nodrag
                    transition-all duration-200
                    ${isSelected
                      ? "btn-primary shadow-md scale-[1.02]"
                      : "btn-ghost bg-base-200 hover:bg-base-300 hover:scale-[1.01]"
                    }
                  `}
                  onClick={() => onChangeStyleTemplate(key)}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  {styleConfig.icon}
                  {styleConfig.name}
                </button>
              );
            })}
          </div>

          {/* 自定义风格提示词输入 */}
          {visualStyleTemplate === "custom" && (
            <div className="mt-3">
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-base-content/60">自定义风格描述</label>
                <button
                  type="button"
                  className={`
                    btn btn-xs gap-1 nopan nodrag
                    ${isOptimizing ? "btn-disabled" : "btn-ghost text-primary hover:bg-primary/10"}
                  `}
                  onClick={handleOptimizeStylePrompt}
                  onPointerDown={(e) => e.stopPropagation()}
                  disabled={isOptimizing || !customVisualStylePrompt?.trim()}
                  title="使用 AI 优化风格描述为标准化提示词"
                >
                  {isOptimizing ? (
                    <>
                      <span className="loading loading-spinner loading-xs" />
                      优化中...
                    </>
                  ) : (
                    <>
                      <Wand2 className="w-3 h-3" />
                      AI 优化
                    </>
                  )}
                </button>
              </div>
              <ComposableTextarea
                className="textarea textarea-bordered w-full min-h-[120px] text-sm resize-none nopan nodrag"
                placeholder={`描述你想要的 PPT 页面风格，例如：\n• 简约扁平化设计，使用蓝白色调\n• 现代商务风格，强调数据可视化\n• 深色科技感，带有渐变和光效`}
                value={customVisualStylePrompt || ""}
                onChange={onChangeCustomStylePrompt}
              />
              <p className="text-xs text-base-content/50 mt-1">
                提示：输入简单描述后点击「AI 优化」，系统会自动扩展为标准化的风格提示词
              </p>
            </div>
          )}
        </div>

        {/* 清晰度和标题页 - 同行布局 */}
        <div className="flex items-center gap-6">
          {/* 清晰度选择 */}
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-base-content/70 whitespace-nowrap">清晰度</label>
            <div className="flex gap-1">
              {imageSizeOptions.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  className={`
                    px-3 py-1.5 rounded-lg text-xs font-medium nopan nodrag
                    transition-all duration-200
                    ${imageConfig.imageSize === opt.value
                      ? "bg-primary text-primary-content shadow-md scale-[1.02]"
                      : "bg-base-200 text-base-content/70 hover:bg-base-300 hover:scale-[1.01]"
                    }
                  `}
                  onClick={() => onChangeImageConfig({ imageSize: opt.value as "1K" | "2K" | "4K" })}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* 标题页开关 */}
          <label className="flex items-center gap-2 cursor-pointer nopan nodrag">
            <span className="text-xs font-medium text-base-content/70 whitespace-nowrap">首页为标题页</span>
            <input
              type="checkbox"
              className="toggle toggle-primary toggle-sm"
              checked={firstPageIsTitlePage}
              onChange={(e) => onChangeFirstPageIsTitlePage(e.target.checked)}
            />
          </label>
        </div>

        {/* 页面图片生成模型选择 */}
        <div className="relative">
          <label className="flex items-center gap-1.5 text-xs font-medium text-base-content/70 mb-2">
            <Image className="w-3.5 h-3.5" />
            页面图片生成模型
          </label>
          <button
            type="button"
            className="w-full flex items-center justify-between px-3 py-2 bg-base-200 hover:bg-base-300 rounded-lg text-sm transition-colors border border-base-300 nopan nodrag"
            onClick={() => setShowImageModelDropdown(!showImageModelDropdown)}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <span className={isCustomImageModel ? "text-primary font-medium" : ""}>
              {getDisplayImageModelName()}
            </span>
            <ChevronDown className={`w-4 h-4 transition-transform ${showImageModelDropdown ? "rotate-180" : ""}`} />
          </button>

          {/* 下拉菜单 */}
          {showImageModelDropdown && (
            <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-base-100 border border-base-300 rounded-lg shadow-xl overflow-hidden">
              {/* 预设模型 */}
              {IMAGE_PRESET_MODELS.map((model) => (
                <button
                  key={model.value}
                  type="button"
                  className={`w-full px-3 py-2 text-left text-sm hover:bg-base-200 transition-colors flex items-center justify-between nopan nodrag ${
                    imageModel === model.value ? "bg-primary/10 text-primary" : ""
                  }`}
                  onClick={() => handleSelectImageModel(model.value)}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <span>{model.label}</span>
                  {imageModel === model.value && <Check className="w-4 h-4" />}
                </button>
              ))}

              {/* 分隔线 */}
              <div className="border-t border-base-300 my-1" />

              {/* 自定义模型输入 */}
              <div className="p-2">
                <label className="text-xs text-base-content/60 mb-1 block">自定义模型</label>
                <div className="flex gap-1">
                  <input
                    type="text"
                    className="input input-sm input-bordered flex-1 text-sm nopan nodrag"
                    placeholder="输入模型名称..."
                    value={customImageModel}
                    onChange={(e) => setCustomImageModel(e.target.value)}
                    onPointerDown={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        handleCustomImageModelSubmit();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-sm btn-primary nopan nodrag"
                    onClick={handleCustomImageModelSubmit}
                    onPointerDown={(e) => e.stopPropagation()}
                    disabled={!customImageModel.trim()}
                  >
                    确定
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 配置摘要提示 */}
      <div className="bg-base-200 rounded-lg p-3 text-xs">
        <div className="flex items-start gap-2">
          <Settings className="w-4 h-4 mt-0.5 flex-shrink-0 opacity-60" />
          <div>
            <p className="font-medium mb-1">当前配置</p>
            <p className="opacity-60">
              将生成约 {config.pageCountRange === "custom" ? (config.customPageCount || 8) : config.pageCountRange.replace("-", "-")} 页，
              {detailLevelOptions.find(o => o.value === config.detailLevel)?.desc}，
              {visualStyleTemplate === "custom" ? "自定义风格" : styleConfigs[visualStyleTemplate].name}，
              {imageConfig.imageSize} 清晰度
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
