import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  Image,
  LayoutTemplate,
  ListChecks,
  Palette,
  Plus,
  Trash2,
  Wand2,
} from "lucide-react";
import { designPlanToCanvasAgentOps, createDesignPlanFromBrief, updateDesignPlan } from "@/services/designPlanPlanner";
import {
  applyTemplateVariant,
  buildTemplateBrief,
  createBrandSpecDocument,
  createDesignTemplateCapability,
  createDesignTemplateCapabilityMatrix,
  DESIGN_TEMPLATES,
  getDesignTemplate,
  getTemplateVariants,
  validateBrandKitForTemplate,
} from "@/services/designTemplateService";
import { useAgentStore } from "@/stores/agentStore";
import { useBrandKitStore } from "@/stores/brandKitStore";
import { useCreativeStore } from "@/stores/creativeStore";
import { toast } from "@/stores/toastStore";
import type { BrandKit, BrandVoiceTone } from "@/types/brand";

const TONE_OPTIONS: Array<{ value: BrandVoiceTone; label: string }> = [
  { value: "professional", label: "专业" },
  { value: "friendly", label: "亲和" },
  { value: "bold", label: "大胆" },
  { value: "minimal", label: "克制" },
  { value: "playful", label: "活泼" },
  { value: "custom", label: "自定义" },
];

export function BrandKitPanel() {
  const brandKits = useBrandKitStore((state) => state.brandKits);
  const activeBrandKitId = useBrandKitStore((state) => state.activeBrandKitId);
  const createBrandKit = useBrandKitStore((state) => state.createBrandKit);
  const updateBrandKit = useBrandKitStore((state) => state.updateBrandKit);
  const deleteBrandKit = useBrandKitStore((state) => state.deleteBrandKit);
  const setActiveBrandKit = useBrandKitStore((state) => state.setActiveBrandKit);
  const assets = useCreativeStore((state) => state.assets);
  const sessions = useAgentStore((state) => state.sessions);
  const activeSessionId = useAgentStore((state) => state.activeSessionId);
  const createSession = useAgentStore((state) => state.createSession);
  const updateSessionMetadata = useAgentStore((state) => state.updateSessionMetadata);
  const appendEvent = useAgentStore((state) => state.appendEvent);
  const addMessage = useAgentStore((state) => state.addMessage);
  const requestApproval = useAgentStore((state) => state.requestApproval);
  const setSessionStatus = useAgentStore((state) => state.setSessionStatus);
  const [selectedTemplateId, setSelectedTemplateId] = useState(DESIGN_TEMPLATES[0].id);
  const [selectedVariantId, setSelectedVariantId] = useState("balanced");
  const [brief, setBrief] = useState(DESIGN_TEMPLATES[0].defaultBrief);
  const templateCapabilityMatrix = useMemo(() => createDesignTemplateCapabilityMatrix(), []);

  const activeBrandKit = useMemo(
    () => brandKits.find((brandKit) => brandKit.id === activeBrandKitId) || brandKits[0] || null,
    [activeBrandKitId, brandKits]
  );
  const selectedTemplate = getDesignTemplate(selectedTemplateId) || DESIGN_TEMPLATES[0];
  const templateVariants = getTemplateVariants(selectedTemplate);
  const selectedVariant =
    templateVariants.find((variant) => variant.id === selectedVariantId) || templateVariants[0];
  const effectiveTemplate = applyTemplateVariant(selectedTemplate, selectedVariant);
  const selectedTemplateCapability = createDesignTemplateCapability(effectiveTemplate);
  const brandReport = activeBrandKit
    ? validateBrandKitForTemplate(activeBrandKit, assets, selectedTemplate)
    : null;
  const imageAssets = useMemo(
    () => assets.filter((asset) => asset.kind === "image"),
    [assets]
  );

  useEffect(() => {
    const template = getDesignTemplate(selectedTemplateId);
    if (template) setBrief(template.defaultBrief);
    setSelectedVariantId("balanced");
  }, [selectedTemplateId]);

  const patchActiveBrand = (patch: Partial<BrandKit>) => {
    if (!activeBrandKit) return;
    updateBrandKit(activeBrandKit.id, patch);
  };

  const updateColor = (index: number, value: string) => {
    if (!activeBrandKit) return;
    patchActiveBrand({
      colors: activeBrandKit.colors.map((color, colorIndex) =>
        colorIndex === index ? value : color
      ),
    });
  };

  const toggleReferenceAsset = (assetId: string) => {
    if (!activeBrandKit) return;
    const exists = activeBrandKit.referenceAssetIds.includes(assetId);
    patchActiveBrand({
      referenceAssetIds: exists
        ? activeBrandKit.referenceAssetIds.filter((id) => id !== assetId)
        : [...activeBrandKit.referenceAssetIds, assetId],
    });
  };

  const ensureLocalSessionId = () => {
    const activeSession = sessions.find((session) => session.id === activeSessionId);
    if (activeSession?.providerKind === "local") return activeSession.id;
    return createSession("品牌模板会话", "local");
  };

  const createTemplatePlan = (submitForApproval: boolean) => {
    if (!activeBrandKit) {
      toast.error("缺少品牌套件");
      return;
    }

    const sessionId = ensureLocalSessionId();
    const planBrief = buildTemplateBrief(effectiveTemplate, brief);
    const draftPlan = createDesignPlanFromBrief(planBrief, {
      brandKit: activeBrandKit,
      template: effectiveTemplate,
    });
    const plan = submitForApproval
      ? updateDesignPlan(draftPlan, { status: "awaiting_approval" })
      : draftPlan;

    addMessage(sessionId, "user", planBrief);
    updateSessionMetadata(sessionId, { activePlan: plan });
    appendEvent(sessionId, {
      id: crypto.randomUUID(),
      type: "plan_propose",
      sessionId,
      plan,
      createdAt: Date.now(),
    });

    if (!submitForApproval) {
      setSessionStatus(sessionId, "idle");
      toast.success("模板设计计划已生成");
      return;
    }

    try {
      const ops = designPlanToCanvasAgentOps(plan);
      const approval = requestApproval(sessionId, "执行模板设计计划", ops);
      if (!approval.ok) {
        toast.error(approval.errors.join("；"));
        return;
      }
      toast.info("模板计划已进入审批队列");
    } catch (error) {
      toast.error(`模板计划转换失败: ${error instanceof Error ? error.message : "未知错误"}`);
    }
  };

  const handleExportBrandSpec = () => {
    if (!activeBrandKit) return;
    downloadJson(
      `${activeBrandKit.name || "brand-kit"}-spec.json`,
      createBrandSpecDocument(activeBrandKit, assets, effectiveTemplate)
    );
    toast.success("品牌规范已导出");
  };

  const handleExportTemplateMatrix = () => {
    downloadJson("nextlemon-design-template-capability-matrix.json", templateCapabilityMatrix);
    toast.success("模板能力矩阵已导出");
  };

  if (!activeBrandKit) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
        <Palette className="h-6 w-6 text-base-content/35" />
        <button className="btn btn-primary btn-sm" onClick={() => createBrandKit("默认品牌套件")}>
          创建品牌套件
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-3">
      <div className="mb-3 grid grid-cols-[1fr_auto] gap-2">
        <select
          className="select select-bordered select-sm min-w-0"
          value={activeBrandKit.id}
          onChange={(event) => setActiveBrandKit(event.target.value)}
        >
          {brandKits.map((brandKit) => (
            <option key={brandKit.id} value={brandKit.id}>
              {brandKit.name}
            </option>
          ))}
        </select>
        <button className="btn btn-primary btn-sm btn-circle" title="新增品牌套件" onClick={() => createBrandKit()}>
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <section className="rounded-lg border border-base-300 bg-base-100 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Palette className="h-4 w-4 text-primary" />
            品牌套件
          </div>
          <button
            className="btn btn-ghost btn-xs btn-circle text-error hover:bg-error/10"
            title="删除品牌套件"
            onClick={() => deleteBrandKit(activeBrandKit.id)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>

        <input
          className="input input-bordered input-sm w-full"
          value={activeBrandKit.name}
          onChange={(event) => patchActiveBrand({ name: event.target.value })}
        />

        <div className="mt-3 space-y-2">
          {activeBrandKit.colors.map((color, index) => (
            <div key={`${color}-${index}`} className="grid grid-cols-[2rem_1fr_auto] items-center gap-2">
              <input
                className="h-8 w-8 cursor-pointer rounded border border-base-300 bg-transparent p-0"
                type="color"
                value={isHexColor(color) ? color : "#000000"}
                onChange={(event) => updateColor(index, event.target.value)}
              />
              <input
                className="input input-bordered input-xs font-mono"
                value={color}
                onChange={(event) => updateColor(index, event.target.value)}
              />
              <button
                className="btn btn-ghost btn-xs btn-circle"
                title="移除颜色"
                onClick={() => patchActiveBrand({ colors: activeBrandKit.colors.filter((_, colorIndex) => colorIndex !== index) })}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
          <button
            className="btn btn-ghost btn-xs w-full gap-1"
            onClick={() => patchActiveBrand({ colors: [...activeBrandKit.colors, "#000000"] })}
          >
            <Plus className="h-3.5 w-3.5" />
            颜色
          </button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <input
            className="input input-bordered input-xs"
            placeholder="标题字体"
            value={activeBrandKit.fonts.heading || ""}
            onChange={(event) => patchActiveBrand({ fonts: { heading: event.target.value } })}
          />
          <input
            className="input input-bordered input-xs"
            placeholder="正文字体"
            value={activeBrandKit.fonts.body || ""}
            onChange={(event) => patchActiveBrand({ fonts: { body: event.target.value } })}
          />
        </div>

        <select
          className="select select-bordered select-xs mt-3 w-full"
          value={activeBrandKit.tone}
          onChange={(event) => patchActiveBrand({ tone: event.target.value as BrandVoiceTone })}
        >
          {TONE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {activeBrandKit.tone === "custom" && (
          <textarea
            className="textarea textarea-bordered mt-2 min-h-16 w-full resize-none text-xs"
            value={activeBrandKit.customTone || ""}
            onChange={(event) => patchActiveBrand({ customTone: event.target.value })}
          />
        )}

        <label className="mt-3 flex items-center gap-2">
          <Image className="h-3.5 w-3.5 text-base-content/40" />
          <select
            className="select select-bordered select-xs min-w-0 flex-1"
            value={activeBrandKit.logoAssetId || ""}
            onChange={(event) => patchActiveBrand({ logoAssetId: event.target.value || undefined })}
          >
            <option value="">无 Logo</option>
            {imageAssets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.title}
              </option>
            ))}
          </select>
        </label>

        {brandReport && (
          <div className="mt-3 rounded-md border border-base-300 bg-base-200/50 p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold">品牌完整度</span>
              <span className={`badge badge-xs ${brandReport.score >= 75 ? "badge-success" : brandReport.score >= 45 ? "badge-warning" : "badge-error"}`}>
                {brandReport.score}
              </span>
            </div>
            {brandReport.issues.length > 0 && (
              <div className="mt-2 max-h-24 space-y-1 overflow-y-auto">
                {brandReport.issues.map((issue) => (
                  <div key={issue.id} className="flex items-start gap-1.5 text-[11px] text-base-content/60">
                    <AlertCircle className={`mt-0.5 h-3 w-3 flex-shrink-0 ${issue.severity === "error" ? "text-error" : issue.severity === "warning" ? "text-warning" : "text-info"}`} />
                    <span>{issue.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {imageAssets.length > 0 && (
          <div className="mt-3 max-h-32 space-y-1 overflow-y-auto rounded-md border border-base-300 p-2">
            {imageAssets.map((asset) => {
              const checked = activeBrandKit.referenceAssetIds.includes(asset.id);
              return (
                <label key={asset.id} className="flex cursor-pointer items-center gap-2 text-xs">
                  <input
                    className="checkbox checkbox-xs"
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleReferenceAsset(asset.id)}
                  />
                  <span className="min-w-0 flex-1 truncate">{asset.title}</span>
                </label>
              );
            })}
          </div>
        )}
      </section>

      <section className="mt-3 rounded-lg border border-base-300 bg-base-100 p-3">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <LayoutTemplate className="h-4 w-4 text-secondary" />
          模板
        </div>
        <div className="grid grid-cols-2 gap-2">
          {DESIGN_TEMPLATES.map((template) => (
            <button
              key={template.id}
              className={`rounded-lg border p-2 text-left text-xs transition-colors ${
                selectedTemplate.id === template.id
                  ? "border-secondary/40 bg-secondary/10"
                  : "border-base-300 bg-base-100 hover:bg-base-200"
              }`}
              onClick={() => setSelectedTemplateId(template.id)}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-semibold">{template.name}</span>
                {selectedTemplate.id === template.id && <Check className="h-3.5 w-3.5 text-secondary" />}
              </div>
              <div className="mt-1 line-clamp-2 text-[11px] text-base-content/50">{template.description}</div>
              <div className="mt-2 flex flex-wrap gap-1">
                <span className="badge badge-xs badge-outline">{template.outputKind}</span>
                {template.aspectRatio && <span className="badge badge-xs badge-outline">{template.aspectRatio}</span>}
              </div>
            </button>
          ))}
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          {templateVariants.map((variant) => (
            <button
              key={variant.id}
              className={`rounded-lg border p-2 text-left text-[11px] transition-colors ${
                selectedVariant.id === variant.id
                  ? "border-accent/50 bg-accent/10"
                  : "border-base-300 bg-base-100 hover:bg-base-200"
              }`}
              onClick={() => setSelectedVariantId(variant.id)}
            >
              <div className="truncate font-semibold">{variant.name}</div>
              <div className="mt-1 line-clamp-2 text-base-content/45">{variant.description}</div>
            </button>
          ))}
        </div>

        <textarea
          className="textarea textarea-bordered mt-3 min-h-24 w-full resize-none text-xs"
          value={brief}
          onChange={(event) => setBrief(event.target.value)}
        />

        <div className="mt-2 rounded-md bg-base-200/70 p-2 text-[11px] text-base-content/55">
          <div className="font-medium text-base-content/70">当前规格</div>
          <div>{effectiveTemplate.name}</div>
          <div>{effectiveTemplate.aspectRatio || effectiveTemplate.videoSize || effectiveTemplate.pageCountRange || effectiveTemplate.outputKind}</div>
          <div className="mt-2 grid grid-cols-3 gap-1 text-center">
            <div className="rounded bg-base-100 px-1 py-1">
              <div className="font-semibold text-base-content/70">{effectiveTemplate.deliverables.length}</div>
              <div>交付物</div>
            </div>
            <div className="rounded bg-base-100 px-1 py-1">
              <div className="font-semibold text-base-content/70">{effectiveTemplate.recommendedWorkflowNodes.length}</div>
              <div>节点</div>
            </div>
            <div className="rounded bg-base-100 px-1 py-1">
              <div className="font-semibold text-base-content/70">{effectiveTemplate.acceptanceCriteria.length}</div>
              <div>验收</div>
            </div>
          </div>
          <div className="mt-2 space-y-1">
            {effectiveTemplate.deliverables.slice(0, 3).map((item) => (
              <div key={item.id} className="flex items-start justify-between gap-2">
                <span className="min-w-0 flex-1 truncate">{item.title}</span>
                <span className={`badge badge-xs ${item.required ? "badge-primary" : "badge-outline"}`}>
                  {item.required ? "必交付" : "可选"}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-3 border-t border-base-300 pt-3 text-[11px] text-base-content/55">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 font-semibold text-base-content/70">
              <ListChecks className="h-3.5 w-3.5 text-accent" />
              模板能力
            </span>
            <span className={`badge badge-xs ${templateCapabilityMatrix.readyTemplateCount === templateCapabilityMatrix.templateCount ? "badge-success" : "badge-warning"}`}>
              {templateCapabilityMatrix.readyTemplateCount}/{templateCapabilityMatrix.templateCount} ready
            </span>
          </div>
          <div className="grid grid-cols-3 gap-1 text-center">
            <div className="rounded bg-base-200/70 px-1 py-1">
              <div className="font-semibold text-base-content/70">{templateCapabilityMatrix.variantCount}</div>
              <div>变体</div>
            </div>
            <div className="rounded bg-base-200/70 px-1 py-1">
              <div className="font-semibold text-base-content/70">{templateCapabilityMatrix.workflowNodeTypes.length}</div>
              <div>节点类</div>
            </div>
            <div className="rounded bg-base-200/70 px-1 py-1">
              <div className="font-semibold text-base-content/70">{templateCapabilityMatrix.deliverableKinds.length}</div>
              <div>交付类</div>
            </div>
          </div>
          <CapabilityPills
            label="全局节点"
            values={templateCapabilityMatrix.workflowNodeTypes}
          />
          <CapabilityPills
            label="当前必需节点"
            values={selectedTemplateCapability.requiredWorkflowNodeTypes}
          />
          <CapabilityPills
            label="当前交付物"
            values={selectedTemplateCapability.requiredDeliverableIds}
          />
          <CapabilityPills
            label="当前变体"
            values={selectedTemplateCapability.variantIds}
          />
          <details className="mt-2">
            <summary className="cursor-pointer font-medium text-base-content/65">
              当前模板检查 · {selectedTemplateCapability.checks.filter((check) => check.status === "passed").length}/{selectedTemplateCapability.checks.length}
            </summary>
            <div className="mt-1 max-h-28 space-y-1 overflow-y-auto">
              {selectedTemplateCapability.checks.map((check) => (
                <div key={check.id} className="flex items-start gap-1.5">
                  <span className={`mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full ${check.status === "passed" ? "bg-success" : "bg-error"}`} />
                  <span>{check.id}：{check.message}</span>
                </div>
              ))}
            </div>
          </details>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button className="btn btn-secondary btn-sm gap-2" onClick={() => createTemplatePlan(false)}>
            <Wand2 className="h-4 w-4" />
            生成计划
          </button>
          <button className="btn btn-primary btn-sm gap-2" onClick={() => createTemplatePlan(true)}>
            <Check className="h-4 w-4" />
            提交审批
          </button>
        </div>
        <button className="btn btn-ghost btn-sm mt-2 w-full gap-2" onClick={handleExportBrandSpec}>
          <LayoutTemplate className="h-4 w-4" />
          导出品牌规范
        </button>
        <button className="btn btn-ghost btn-sm mt-2 w-full gap-2" onClick={handleExportTemplateMatrix}>
          <ListChecks className="h-4 w-4" />
          导出能力矩阵
        </button>
      </section>
    </div>
  );
}

function CapabilityPills({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) return null;
  return (
    <div className="mt-2">
      <div className="mb-1 font-medium text-base-content/60">{label}</div>
      <div className="flex flex-wrap gap-1">
        {values.map((value) => (
          <span key={value} className="badge badge-xs badge-outline">{value}</span>
        ))}
      </div>
    </div>
  );
}

function isHexColor(value: string) {
  return /^#[0-9a-f]{6}$/i.test(value);
}

function downloadJson(fileName: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName.replace(/[\\/:*?"<>|]+/g, "-");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
