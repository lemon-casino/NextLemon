import { v4 as uuidv4 } from "uuid";
import {
  createBrandKitSummary,
  createDesignTemplateSummary,
} from "@/services/designTemplateService";
import type { BrandKit, BrandKitSummary, DesignTemplate, DesignTemplateSummary } from "@/types/brand";
import type { CanvasAgentOp, CreativeAssetKind, DesignPlan, DesignPlanStep } from "@/types/creative";

export type DesignPlanKind = "image" | "video" | "ppt" | "brand" | "generic";

interface PlanBlueprint {
  kind: DesignPlanKind;
  title: string;
  outputKind: CreativeAssetKind | "workflow";
  modelHint: string;
  aspectRatio?: DesignTemplate["aspectRatio"];
  videoSize?: DesignTemplate["videoSize"];
  pageCountRange?: string;
}

export interface CreateDesignPlanOptions {
  brandKit?: BrandKit | null;
  template?: DesignTemplate | null;
}

const NODE_GAP_X = 360;
const NODE_START = { x: 160, y: 160 };

export function createDesignPlanFromBrief(brief: string, options: CreateDesignPlanOptions = {}): DesignPlan {
  const normalizedBrief = brief.trim();
  const blueprint = options.template
    ? createTemplateBlueprint(options.template)
    : inferPlanBlueprint(normalizedBrief);
  const timestamp = Date.now();
  const planId = `design-plan-${uuidv4()}`;
  const nodeIds = createPlanNodeIds(planId, blueprint.kind);

  const steps = createPlanSteps(blueprint, options.template || null);
  return {
    id: planId,
    title: blueprint.title,
    brief: normalizedBrief,
    steps,
    status: "draft",
    createdAt: timestamp,
    updatedAt: timestamp,
    metadata: {
      kind: blueprint.kind,
      nodeIds,
      modelHint: blueprint.modelHint,
      outputKind: blueprint.outputKind,
      aspectRatio: blueprint.aspectRatio,
      videoSize: blueprint.videoSize,
      pageCountRange: blueprint.pageCountRange,
      brandKitId: options.brandKit?.id,
      brandKit: options.brandKit ? createBrandKitSummary(options.brandKit) : undefined,
      templateId: options.template?.id,
      template: options.template ? createDesignTemplateSummary(options.template) : undefined,
    },
  };
}

export function validateDesignPlanTopology(plan: DesignPlan): string[] {
  const stepIds = new Set(plan.steps.map((step) => step.id));
  const errors: string[] = [];

  for (const step of plan.steps) {
    for (const dep of step.dependsOn) {
      if (!stepIds.has(dep)) {
        errors.push(`步骤「${step.title}」依赖不存在: ${dep}`);
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(plan.steps.map((step) => [step.id, step]));

  const visit = (stepId: string) => {
    if (visited.has(stepId)) return;
    if (visiting.has(stepId)) {
      errors.push(`计划依赖存在环: ${stepId}`);
      return;
    }

    visiting.add(stepId);
    const step = byId.get(stepId);
    step?.dependsOn.forEach(visit);
    visiting.delete(stepId);
    visited.add(stepId);
  };

  plan.steps.forEach((step) => visit(step.id));
  return Array.from(new Set(errors));
}

export type DesignPlanCostLevel = "none" | "low" | "medium" | "high";

export const DESIGN_PLAN_COST_LABEL: Record<DesignPlanCostLevel, string> = {
  none: "无",
  low: "低",
  medium: "中",
  high: "高",
};

const DESIGN_PLAN_COST_WEIGHT: Record<DesignPlanCostLevel, number> = {
  none: 0,
  low: 1,
  medium: 3,
  high: 6,
};

export function estimateDesignPlanCost(plan: DesignPlan): {
  level: DesignPlanCostLevel;
  label: string;
  heavyStepIds: string[];
} {
  let level: DesignPlanCostLevel = "none";
  const heavyStepIds: string[] = [];

  for (const step of plan.steps) {
    const stepLevel = estimateStepCostLevel(step);
    if (stepLevel === "medium" || stepLevel === "high") {
      heavyStepIds.push(step.id);
    }
    if (DESIGN_PLAN_COST_WEIGHT[stepLevel] > DESIGN_PLAN_COST_WEIGHT[level]) {
      level = stepLevel;
    }
  }

  return {
    level,
    label: DESIGN_PLAN_COST_LABEL[level],
    heavyStepIds,
  };
}

export function estimateStepCostLevel(step: DesignPlanStep): DesignPlanCostLevel {
  const byLabel = (Object.keys(DESIGN_PLAN_COST_LABEL) as DesignPlanCostLevel[]).find(
    (level) => DESIGN_PLAN_COST_LABEL[level] === step.estimatedCost
  );
  if (byLabel) return byLabel;

  if (step.tool.includes("runNode") || step.tool.includes("run")) return "high";
  if (step.tool.includes("generate") || step.outputKind === "image" || step.outputKind === "video") {
    return "medium";
  }
  if (step.tool.includes("addNode") || step.tool.includes("connect")) return "low";
  return "none";
}

export interface DesignPlanDagLayout {
  layers: DesignPlanStep[][];
  hasCycle: boolean;
}

export function layoutDesignPlanDag(steps: DesignPlanStep[]): DesignPlanDagLayout {
  if (steps.length === 0) return { layers: [], hasCycle: false };

  const byId = new Map(steps.map((step) => [step.id, step]));
  const depth = new Map<string, number>();
  const inStack = new Set<string>();
  const done = new Set<string>();
  let hasCycle = false;

  // 最长路径分层；inStack 守卫保证存在环时也能终止。
  const visit = (step: DesignPlanStep): number => {
    if (done.has(step.id)) return depth.get(step.id) || 0;
    if (inStack.has(step.id)) {
      hasCycle = true;
      return 0;
    }
    inStack.add(step.id);
    let level = 0;
    for (const dep of step.dependsOn) {
      const depStep = byId.get(dep);
      if (!depStep) continue;
      level = Math.max(level, visit(depStep) + 1);
    }
    inStack.delete(step.id);
    done.add(step.id);
    depth.set(step.id, level);
    return level;
  };

  steps.forEach(visit);

  const layerCount = Math.max(...steps.map((step) => depth.get(step.id) || 0)) + 1;
  const layers: DesignPlanStep[][] = Array.from({ length: layerCount }, () => []);
  for (const step of steps) {
    layers[depth.get(step.id) || 0].push(step);
  }

  return { layers, hasCycle };
}

export function designPlanToCanvasAgentOps(plan: DesignPlan): CanvasAgentOp[] {
  const errors = validateDesignPlanTopology(plan);
  if (errors.length > 0) {
    throw new Error(errors.join("；"));
  }

  const kind = getPlanKind(plan);
  const nodeIds = getPlanNodeIds(plan, kind);
  const template = getPlanTemplateSummary(plan);
  const aspectRatio = getPlanAspectRatio(plan, kind);
  const videoSize = template?.videoSize || "1280x720";
  const pageCountRange = template?.pageCountRange || "8-12";
  const ops: CanvasAgentOp[] = [
    {
      type: "asset.add",
      asset: {
        kind: "text",
        title: `${plan.title} Brief`,
        text: plan.brief,
        source: "agent",
        tags: ["brief", "design-plan", ...(template ? template.tags : [])],
        metadata: {
          planId: plan.id,
          brandKitId: plan.metadata?.brandKitId,
          templateId: plan.metadata?.templateId,
        },
      },
      canvasItem: {
        position: { x: 80, y: 80 },
        width: 320,
        height: 180,
      },
    },
    {
      type: "workflow.addNode",
      nodeId: nodeIds.prompt,
      nodeType: "promptNode",
      position: NODE_START,
      data: {
        label: `${plan.title} 提示词`,
        prompt: buildPromptFromPlan(plan),
      },
    },
  ];
  const specText = buildPlanSpecAssetText(plan);
  if (specText) {
    ops.push({
      type: "asset.add",
      asset: {
        kind: "text",
        title: `${plan.title} 规格`,
        text: specText,
        source: "agent",
        tags: ["design-spec", "brand-kit", ...(template ? template.tags : [])],
        metadata: {
          planId: plan.id,
          brandKitId: plan.metadata?.brandKitId,
          templateId: plan.metadata?.templateId,
        },
      },
      canvasItem: {
        position: { x: 440, y: 80 },
        width: 360,
        height: 220,
      },
    });
  }

  if (kind === "ppt") {
    ops.push(
      {
        type: "workflow.addNode",
        nodeId: nodeIds.pptContent,
        nodeType: "pptContentNode",
        position: { x: NODE_START.x + NODE_GAP_X, y: NODE_START.y - 80 },
        data: {
          label: `${plan.title} PPT 内容`,
          outlineConfig: {
            pageCountRange,
            detailLevel: "moderate",
            additionalNotes: buildPromptFromPlan(plan),
          },
          imageConfig: {
            aspectRatio: aspectRatio === "4:3" ? "4:3" : "16:9",
            imageSize: "2K",
          },
        },
      },
      {
        type: "workflow.connectNodes",
        source: nodeIds.prompt,
        target: nodeIds.pptContent,
        sourceHandle: "output-prompt",
        targetHandle: "input-prompt",
      },
      {
        type: "workflow.addNode",
        nodeId: nodeIds.pptAssembler,
        nodeType: "pptAssemblerNode",
        position: { x: NODE_START.x + NODE_GAP_X * 2, y: NODE_START.y - 80 },
        data: {
          label: `${plan.title} PPT 组装`,
        },
      },
      {
        type: "workflow.connectNodes",
        source: nodeIds.pptContent,
        target: nodeIds.pptAssembler,
        sourceHandle: "output-results",
        targetHandle: "input-results",
      },
      {
        type: "workflow.selectNodes",
        nodeIds: [nodeIds.prompt, nodeIds.pptContent, nodeIds.pptAssembler],
      }
    );
    return ops;
  }

  if (kind === "video") {
    ops.push(
      {
        type: "workflow.addNode",
        nodeId: nodeIds.output,
        nodeType: "videoGeneratorNode",
        position: { x: NODE_START.x + NODE_GAP_X, y: NODE_START.y },
        data: {
          label: `${plan.title} 视频生成`,
          model: "sora-2",
          seconds: "10",
          size: videoSize,
          status: "idle",
        },
      },
      {
        type: "workflow.connectNodes",
        source: nodeIds.prompt,
        target: nodeIds.output,
        sourceHandle: "output-prompt",
        targetHandle: "input-prompt",
      },
      {
        type: "workflow.selectNodes",
        nodeIds: [nodeIds.prompt, nodeIds.output],
      }
    );
    return ops;
  }

  ops.push(
    {
      type: "workflow.addNode",
      nodeId: nodeIds.output,
      nodeType: "imageGeneratorProNode",
      position: { x: NODE_START.x + NODE_GAP_X, y: NODE_START.y },
      data: {
        label: `${plan.title} 图片生成`,
        model: "gemini-3-pro-image-preview",
        aspectRatio,
        imageSize: "2K",
        status: "idle",
      },
    },
    {
      type: "workflow.connectNodes",
      source: nodeIds.prompt,
      target: nodeIds.output,
      sourceHandle: "output-prompt",
      targetHandle: "input-prompt",
    },
    {
      type: "workflow.selectNodes",
      nodeIds: [nodeIds.prompt, nodeIds.output],
    }
  );

  return ops;
}

export function updateDesignPlanStep(
  plan: DesignPlan,
  stepId: string,
  patch: Partial<DesignPlanStep>
): DesignPlan {
  return {
    ...plan,
    steps: plan.steps.map((step) =>
      step.id === stepId
        ? {
            ...step,
            ...patch,
            dependsOn: patch.dependsOn || step.dependsOn,
          }
        : step
    ),
    updatedAt: Date.now(),
  };
}

export function updateDesignPlan(plan: DesignPlan, patch: Partial<DesignPlan>): DesignPlan {
  return {
    ...plan,
    ...patch,
    metadata: patch.metadata ? { ...(plan.metadata || {}), ...patch.metadata } : plan.metadata,
    updatedAt: Date.now(),
  };
}

function createTemplateBlueprint(template: DesignTemplate): PlanBlueprint {
  const kind = isDesignPlanKind(template.planKind) ? template.planKind : "generic";
  return {
    kind,
    title: `${template.name}设计计划`,
    outputKind: template.outputKind,
    modelHint: template.modelHint,
    aspectRatio: template.aspectRatio,
    videoSize: template.videoSize,
    pageCountRange: template.pageCountRange,
  };
}

function inferPlanBlueprint(brief: string): PlanBlueprint {
  const lower = brief.toLowerCase();
  if (/ppt|slide|presentation|演示|汇报|课件|幻灯/.test(lower)) {
    return {
      kind: "ppt",
      title: "PPT 设计计划",
      outputKind: "workflow",
      modelHint: "gemini-3-pro-preview + gemini-3-pro-image-preview",
    };
  }
  if (/video|视频|短片|封面动效|sora/.test(lower)) {
    return {
      kind: "video",
      title: "视频设计计划",
      outputKind: "video",
      modelHint: "sora-2",
    };
  }
  if (/brand|品牌|logo|视觉识别|vi|色彩|字体/.test(lower)) {
    return {
      kind: "brand",
      title: "品牌视觉计划",
      outputKind: "image",
      modelHint: "gemini-3-pro-image-preview",
    };
  }
  if (/poster|海报|社媒|social|banner|封面|配图|图片|image/.test(lower)) {
    return {
      kind: "image",
      title: "图片创作计划",
      outputKind: "image",
      modelHint: "gemini-3-pro-image-preview",
    };
  }
  return {
    kind: "generic",
    title: "智能创作计划",
    outputKind: "image",
    modelHint: "gemini-3-pro-image-preview",
  };
}

function createPlanSteps(blueprint: PlanBlueprint, template: DesignTemplate | null): DesignPlanStep[] {
  const base: DesignPlanStep[] = [
    {
      id: "brief",
      title: "解析 brief 与目标",
      description: template
        ? `沉淀用户需求，并套用「${template.name}」模板约束。`
        : "沉淀用户需求、目标受众、产物类型和关键约束。",
      tool: "planner.brief",
      outputKind: "workflow",
      dependsOn: [],
      modelHint: "local",
      status: "pending",
      estimatedCost: "无",
    },
    {
      id: "prompt",
      title: "生成可执行提示词",
      description: "把 brief 转成工作流中的 Prompt 节点。",
      tool: "workflow.addNode",
      outputKind: "workflow",
      dependsOn: ["brief"],
      modelHint: blueprint.modelHint,
      status: "pending",
      estimatedCost: "低",
    },
  ];

  if (blueprint.kind === "ppt") {
    return [
      ...base,
      {
        id: "ppt-content",
        title: "创建 PPT 内容生成节点",
        description: "生成大纲、页面文案和页面图像任务。",
        tool: "workflow.addNode",
        outputKind: "workflow",
        dependsOn: ["prompt"],
        modelHint: blueprint.modelHint,
        status: "pending",
        estimatedCost: "高",
      },
      {
        id: "ppt-assemble",
        title: "创建 PPT 组装节点",
        description: "连接内容结果并准备导出 PPTX。",
        tool: "workflow.connectNodes",
        outputKind: "workflow",
        dependsOn: ["ppt-content"],
        modelHint: "pptxgenjs",
        status: "pending",
        estimatedCost: "中",
      },
    ];
  }

  return [
    ...base,
    {
      id: "generate",
      title: blueprint.kind === "video" ? "创建视频生成任务" : "创建视觉生成任务",
      description: "创建模型生成节点，并连接提示词输入。",
      tool: "workflow.addNode",
      outputKind: blueprint.outputKind,
      dependsOn: ["prompt"],
      modelHint: blueprint.modelHint,
      status: "pending",
      estimatedCost: blueprint.kind === "video" ? "高" : "中",
    },
    {
      id: "review",
      title: "沉淀结果到素材库",
      description: "生成后可通过节点右键保存为素材，进入后续复用。",
      tool: "library.saveWorkflowNode",
      outputKind: blueprint.outputKind,
      dependsOn: ["generate"],
      modelHint: "nextlemon",
      status: "pending",
      estimatedCost: "无",
    },
  ];
}

function buildPromptFromPlan(plan: DesignPlan): string {
  const template = getPlanTemplateSummary(plan);
  const brandKit = getPlanBrandSummary(plan);
  const promptSections = [
    `创作任务：${plan.title}`,
    "",
    "用户 brief：",
    plan.brief,
    "",
    "执行要求：",
    "- 保持主题明确，优先满足 brief 的目标场景。",
    "- 输出应可直接用于 NextLemon 后续素材库沉淀。",
    "- 如果涉及品牌或模板，请保持视觉一致性、层次清晰、可复用。",
  ];

  if (template) {
    promptSections.push(
      "",
      "模板约束：",
      `- 模板：${template.name}（${template.kind}）`,
      `- 输出类型：${template.outputKind}`,
      template.aspectRatio ? `- 画幅：${template.aspectRatio}` : "",
      template.videoSize ? `- 视频尺寸：${template.videoSize}` : "",
      template.pageCountRange ? `- 页数范围：${template.pageCountRange}` : "",
      ...template.promptGuidance.map((item) => `- ${item}`),
      template.deliverables.length > 0 ? "- 交付物：" : "",
      ...template.deliverables.map((item) => `  - ${item.title}${item.required ? "（必交付）" : "（可选）"}：${item.description}`),
      template.recommendedWorkflowNodes.length > 0 ? "- 推荐工作流节点：" : "",
      ...template.recommendedWorkflowNodes.map((item) => `  - ${item.label} / ${item.nodeType}：${item.purpose}`),
      template.acceptanceCriteria.length > 0 ? "- 验收标准：" : "",
      ...template.acceptanceCriteria.map((item) => `  - ${item}`)
    );
  }

  if (brandKit) {
    promptSections.push(
      "",
      "品牌套件：",
      `- 品牌名：${brandKit.name}`,
      brandKit.colors.length > 0 ? `- 品牌色：${brandKit.colors.join(" / ")}` : "",
      brandKit.fonts.heading ? `- 标题字体：${brandKit.fonts.heading}` : "",
      brandKit.fonts.body ? `- 正文字体：${brandKit.fonts.body}` : "",
      `- 语气：${brandKit.tone}`,
      brandKit.logoAssetId ? `- Logo 素材 ID：${brandKit.logoAssetId}` : "",
      brandKit.referenceAssetIds.length > 0
        ? `- 参考素材 ID：${brandKit.referenceAssetIds.join(" / ")}`
        : ""
    );
  }

  return promptSections.filter(Boolean).join("\n");
}

function createPlanNodeIds(planId: string, kind: DesignPlanKind) {
  const shortId = planId.slice(-8);
  return {
    prompt: `${shortId}-prompt`,
    output: `${shortId}-output`,
    pptContent: `${shortId}-ppt-content`,
    pptAssembler: `${shortId}-ppt-assembler`,
    kind,
  };
}

function getPlanKind(plan: DesignPlan): DesignPlanKind {
  const kind = plan.metadata?.kind;
  if (kind === "image" || kind === "video" || kind === "ppt" || kind === "brand" || kind === "generic") {
    return kind;
  }
  return "generic";
}

function isDesignPlanKind(value: string): value is DesignPlanKind {
  return value === "image" || value === "video" || value === "ppt" || value === "brand" || value === "generic";
}

function getPlanNodeIds(plan: DesignPlan, kind: DesignPlanKind) {
  const nodeIds = plan.metadata?.nodeIds;
  if (nodeIds && typeof nodeIds === "object") {
    return nodeIds as ReturnType<typeof createPlanNodeIds>;
  }
  return createPlanNodeIds(plan.id, kind);
}

function getPlanAspectRatio(plan: DesignPlan, kind: DesignPlanKind) {
  const template = getPlanTemplateSummary(plan);
  if (template?.aspectRatio) return template.aspectRatio;
  return kind === "brand" || kind === "ppt" ? "16:9" : "1:1";
}

function getPlanTemplateSummary(plan: DesignPlan): DesignTemplateSummary | null {
  const candidate = plan.metadata?.template;
  if (!candidate || typeof candidate !== "object") return null;
  const template = candidate as Partial<DesignTemplateSummary>;
  if (
    typeof template.id !== "string" ||
    typeof template.name !== "string" ||
    typeof template.kind !== "string" ||
    typeof template.outputKind !== "string"
  ) {
    return null;
  }
  return {
    id: template.id,
    kind: template.kind as DesignTemplateSummary["kind"],
    planKind: (template.planKind || "generic") as DesignTemplateSummary["planKind"],
    name: template.name,
    outputKind: template.outputKind as DesignTemplateSummary["outputKind"],
    aspectRatio: template.aspectRatio,
    videoSize: template.videoSize,
    pageCountRange: template.pageCountRange,
    deliverables: Array.isArray(template.deliverables) ? template.deliverables : [],
    recommendedWorkflowNodes: Array.isArray(template.recommendedWorkflowNodes) ? template.recommendedWorkflowNodes : [],
    acceptanceCriteria: Array.isArray(template.acceptanceCriteria) ? template.acceptanceCriteria : [],
    promptGuidance: Array.isArray(template.promptGuidance) ? template.promptGuidance : [],
    tags: Array.isArray(template.tags) ? template.tags : [],
  };
}

function getPlanBrandSummary(plan: DesignPlan): BrandKitSummary | null {
  const candidate = plan.metadata?.brandKit;
  if (!candidate || typeof candidate !== "object") return null;
  const brandKit = candidate as Partial<BrandKitSummary>;
  if (typeof brandKit.id !== "string" || typeof brandKit.name !== "string") return null;
  return {
    id: brandKit.id,
    name: brandKit.name,
    colors: Array.isArray(brandKit.colors) ? brandKit.colors : [],
    fonts: brandKit.fonts || {},
    logoAssetId: brandKit.logoAssetId,
    tone: typeof brandKit.tone === "string" ? brandKit.tone : "professional",
    referenceAssetIds: Array.isArray(brandKit.referenceAssetIds) ? brandKit.referenceAssetIds : [],
  };
}

function buildPlanSpecAssetText(plan: DesignPlan): string {
  const template = getPlanTemplateSummary(plan);
  const brandKit = getPlanBrandSummary(plan);
  if (!template && !brandKit) return "";

  const lines = [`计划：${plan.title}`];
  if (template) {
    lines.push(
      "",
      "模板",
      `- ${template.name}`,
      `- 类型：${template.kind}`,
      template.aspectRatio ? `- 画幅：${template.aspectRatio}` : "",
      template.pageCountRange ? `- 页数：${template.pageCountRange}` : "",
      ...template.promptGuidance.map((item) => `- ${item}`),
      template.deliverables.length > 0 ? "交付物" : "",
      ...template.deliverables.map((item) => `- ${item.title}${item.required ? "（必交付）" : "（可选）"}：${item.description}`),
      template.recommendedWorkflowNodes.length > 0 ? "推荐节点" : "",
      ...template.recommendedWorkflowNodes.map((item) => `- ${item.label} / ${item.nodeType}：${item.purpose}`),
      template.acceptanceCriteria.length > 0 ? "验收标准" : "",
      ...template.acceptanceCriteria.map((item) => `- ${item}`)
    );
  }
  if (brandKit) {
    lines.push(
      "",
      "品牌",
      `- ${brandKit.name}`,
      brandKit.colors.length > 0 ? `- 色彩：${brandKit.colors.join(" / ")}` : "",
      brandKit.fonts.heading ? `- 标题字体：${brandKit.fonts.heading}` : "",
      brandKit.fonts.body ? `- 正文字体：${brandKit.fonts.body}` : "",
      `- 语气：${brandKit.tone}`,
      brandKit.logoAssetId ? `- Logo：${brandKit.logoAssetId}` : "",
      brandKit.referenceAssetIds.length > 0 ? `- 参考：${brandKit.referenceAssetIds.join(" / ")}` : ""
    );
  }
  return lines.filter(Boolean).join("\n");
}
