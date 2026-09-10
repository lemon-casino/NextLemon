import type {
  BrandKit,
  BrandSpecDocument,
  BrandKitSummary,
  BrandValidationReport,
  DesignTemplate,
  DesignTemplateCapability,
  DesignTemplateCapabilityCheck,
  DesignTemplateCapabilityMatrix,
  DesignTemplateVariant,
  DesignTemplateSummary,
} from "@/types/brand";
import type { CreativeAsset } from "@/types/creative";

export const REQUIRED_DESIGN_TEMPLATE_KINDS = ["social-image", "poster", "brand-board", "ppt", "video-cover"] as const;

export const DESIGN_TEMPLATES: DesignTemplate[] = [
  {
    id: "social-square-launch",
    kind: "social-image",
    planKind: "image",
    name: "社媒方图",
    description: "适合小红书、朋友圈、Instagram 的 1:1 视觉图。",
    outputKind: "image",
    defaultBrief: "生成一张用于新品发布的社媒方图，主体明确，文字空间充足。",
    promptGuidance: [
      "画面中心需要有清晰主视觉，保留标题和行动号召区域。",
      "构图适合移动端信息流快速浏览。",
      "避免复杂小字，视觉层级要一眼可读。",
    ],
    aspectRatio: "1:1",
    deliverables: [
      {
        id: "square-image",
        title: "1:1 社媒主图",
        kind: "image",
        required: true,
        description: "可直接发布或进入素材库复用的方形视觉图。",
      },
      {
        id: "caption-brief",
        title: "发布文案方向",
        kind: "text",
        required: false,
        description: "沉淀标题、行动号召和可替换文案区说明。",
      },
    ],
    recommendedWorkflowNodes: [
      { nodeType: "promptNode", label: "社媒图提示词", required: true, purpose: "沉淀 brief、品牌和模板约束。" },
      { nodeType: "imageGeneratorProNode", label: "社媒图生成", required: true, purpose: "输出 1:1 主视觉。" },
    ],
    acceptanceCriteria: [
      "首屏缩略图能在 1 秒内读出主体和标题区。",
      "画面中至少保留一个可放置标题或 CTA 的清晰区域。",
      "品牌色或品牌语气在画面中有明确体现。",
    ],
    tags: ["social", "launch", "square"],
    modelHint: "gemini-3-pro-image-preview",
  },
  {
    id: "poster-vertical-campaign",
    kind: "poster",
    planKind: "image",
    name: "竖版海报",
    description: "适合活动、产品和品牌传播的 3:4 海报。",
    outputKind: "image",
    defaultBrief: "生成一张竖版活动海报，包含强标题区、视觉主体和底部信息区。",
    promptGuidance: [
      "使用纵向构图，顶部标题、中部主体、底部信息区清晰分层。",
      "留出可替换文案区域，避免把所有信息压在一个焦点上。",
      "适合打印和移动端长图预览。",
    ],
    aspectRatio: "3:4",
    deliverables: [
      {
        id: "vertical-poster",
        title: "3:4 竖版海报",
        kind: "image",
        required: true,
        description: "适合活动传播、产品介绍或移动端预览的竖版成图。",
      },
      {
        id: "poster-copy-map",
        title: "海报文案分区",
        kind: "text",
        required: false,
        description: "说明标题、卖点、时间地点和行动号召的版面位置。",
      },
    ],
    recommendedWorkflowNodes: [
      { nodeType: "promptNode", label: "海报提示词", required: true, purpose: "定义海报主题、层级和品牌限制。" },
      { nodeType: "imageGeneratorProNode", label: "海报生成", required: true, purpose: "输出 3:4 竖版视觉。" },
    ],
    acceptanceCriteria: [
      "标题、中部视觉主体、底部信息区三段层级清楚。",
      "移动端缩小预览时仍能读出核心主题。",
      "画面不依赖密集小字传达主要信息。",
    ],
    tags: ["poster", "campaign"],
    modelHint: "gemini-3-pro-image-preview",
  },
  {
    id: "brand-board-starter",
    kind: "brand-board",
    planKind: "brand",
    name: "品牌板",
    description: "沉淀品牌色、字体、Logo 参考和视觉方向。",
    outputKind: "image",
    defaultBrief: "生成一张品牌视觉板，包含品牌色、字体气质、Logo 使用氛围和图片风格参考。",
    promptGuidance: [
      "以品牌一致性为首要目标，呈现颜色、字体、图形语言和影像氛围。",
      "输出应像可复用的品牌 moodboard，而不是单张广告图。",
      "如果有 Logo 或参考图，保持其识别度和视觉语气。",
    ],
    aspectRatio: "16:9",
    deliverables: [
      {
        id: "brand-board",
        title: "品牌视觉板",
        kind: "image",
        required: true,
        description: "集中展示品牌色、字体气质、Logo 氛围和图片风格。",
      },
      {
        id: "brand-spec",
        title: "品牌规范 JSON",
        kind: "project",
        required: true,
        description: "可导出的品牌规范，供后续计划和批量模板复用。",
      },
    ],
    recommendedWorkflowNodes: [
      { nodeType: "promptNode", label: "品牌板提示词", required: true, purpose: "整理品牌资产、语气和视觉方向。" },
      { nodeType: "imageGeneratorProNode", label: "品牌板生成", required: true, purpose: "输出 16:9 moodboard。" },
    ],
    acceptanceCriteria: [
      "品牌色、字体气质、Logo/参考图关系清楚可复用。",
      "输出像品牌系统参考，而不是单张广告图。",
      "后续社媒图、海报或 PPT 能直接继承该视觉方向。",
    ],
    tags: ["brand", "moodboard"],
    modelHint: "gemini-3-pro-image-preview",
  },
  {
    id: "ppt-business-deck",
    kind: "ppt",
    planKind: "ppt",
    name: "商务 PPT",
    description: "生成 8-12 页结构化演示文稿工作流。",
    outputKind: "workflow",
    defaultBrief: "生成一份商务汇报 PPT，包含封面、背景、洞察、方案、路线图和总结。",
    promptGuidance: [
      "页面结构要适合口头汇报，少堆文字，多用标题和图表式表达。",
      "视觉风格保持统一，页面之间要有一致的版式节奏。",
      "每页只表达一个核心观点。",
    ],
    aspectRatio: "16:9",
    pageCountRange: "8-12",
    deliverables: [
      {
        id: "ppt-workflow",
        title: "PPT 生成工作流",
        kind: "workflow",
        required: true,
        description: "包含提示词、PPT 内容生成和 PPTX 组装节点。",
      },
      {
        id: "pptx-file",
        title: "可导出 PPTX",
        kind: "project",
        required: true,
        description: "最终可以导出的结构化演示文稿。",
      },
    ],
    recommendedWorkflowNodes: [
      { nodeType: "promptNode", label: "PPT 总提示词", required: true, purpose: "定义汇报目标、受众和品牌约束。" },
      { nodeType: "pptContentNode", label: "PPT 内容生成", required: true, purpose: "生成大纲、页面文案和页面图像。" },
      { nodeType: "pptAssemblerNode", label: "PPT 组装", required: true, purpose: "把页面结果组装成 PPTX。" },
    ],
    acceptanceCriteria: [
      "每页只表达一个核心观点，标题具备结论性。",
      "页面之间视觉节奏一致，适合口头汇报。",
      "工作流节点连接完整，可以从提示词推进到 PPTX 组装。",
    ],
    tags: ["ppt", "business"],
    modelHint: "gemini-3-pro-preview + gemini-3-pro-image-preview",
  },
  {
    id: "video-cover-landscape",
    kind: "video-cover",
    planKind: "video",
    name: "视频封面/短片",
    description: "适合横版视频封面和 10 秒短片起始视觉。",
    outputKind: "video",
    defaultBrief: "生成一个横版视频封面/短片创意，适合品牌宣传，开场画面有明确记忆点。",
    promptGuidance: [
      "开场 2 秒必须出现清晰视觉钩子。",
      "运动方式要简洁，避免镜头语言过度复杂。",
      "适合 16:9 横版展示。",
    ],
    aspectRatio: "16:9",
    videoSize: "1280x720",
    deliverables: [
      {
        id: "video-cover",
        title: "16:9 视频封面",
        kind: "image",
        required: true,
        description: "可作为视频首帧或封面使用的横版视觉。",
      },
      {
        id: "short-video",
        title: "10 秒短片任务",
        kind: "video",
        required: false,
        description: "包含开场钩子和基础运动要求的视频生成任务。",
      },
    ],
    recommendedWorkflowNodes: [
      { nodeType: "promptNode", label: "视频创意提示词", required: true, purpose: "定义开场钩子、镜头和品牌语气。" },
      { nodeType: "videoGeneratorNode", label: "视频生成", required: true, purpose: "输出 1280x720 横版短片或封面动效。" },
    ],
    acceptanceCriteria: [
      "开场 2 秒有明确视觉钩子和记忆点。",
      "镜头运动简单可执行，不依赖过多切换。",
      "首帧可以独立作为视频封面使用。",
    ],
    tags: ["video", "cover"],
    modelHint: "sora-2",
  },
];

export function getDesignTemplate(templateId: string): DesignTemplate | null {
  return DESIGN_TEMPLATES.find((template) => template.id === templateId) || null;
}

export function createBrandKitSummary(brandKit: BrandKit): BrandKitSummary {
  return {
    id: brandKit.id,
    name: brandKit.name,
    colors: brandKit.colors.filter(Boolean),
    fonts: brandKit.fonts,
    logoAssetId: brandKit.logoAssetId,
    tone: brandKit.tone === "custom" ? brandKit.customTone || "custom" : brandKit.tone,
    referenceAssetIds: brandKit.referenceAssetIds,
  };
}

export function createDesignTemplateSummary(template: DesignTemplate): DesignTemplateSummary {
  return {
    id: template.id,
    kind: template.kind,
    planKind: template.planKind,
    name: template.name,
    outputKind: template.outputKind,
    aspectRatio: template.aspectRatio,
    videoSize: template.videoSize,
    pageCountRange: template.pageCountRange,
    deliverables: template.deliverables,
    recommendedWorkflowNodes: template.recommendedWorkflowNodes,
    acceptanceCriteria: template.acceptanceCriteria,
    promptGuidance: template.promptGuidance,
    tags: template.tags,
  };
}

export function buildTemplateBrief(template: DesignTemplate, brief: string): string {
  const normalizedBrief = brief.trim();
  if (!normalizedBrief) return template.defaultBrief;
  if (normalizedBrief === template.defaultBrief) return normalizedBrief;
  return [template.defaultBrief, "", "具体需求：", normalizedBrief].join("\n");
}

export function getTemplateVariants(template: DesignTemplate): DesignTemplateVariant[] {
  const common: DesignTemplateVariant[] = [
    {
      id: "balanced",
      name: "均衡版",
      description: "保留模板默认节奏，适合通用生产。",
      briefSuffix: "采用均衡视觉方案，优先保证品牌一致性、信息层级和可复用性。",
      promptGuidance: ["风格控制在稳定、清晰、可交付的范围内。"],
      acceptanceCriteria: ["不牺牲交付清晰度来追求装饰感。"],
      tags: ["balanced"],
    },
    {
      id: "bold",
      name: "强传播版",
      description: "更强主视觉和对比度，适合活动传播。",
      briefSuffix: "强化视觉冲击力和传播记忆点，标题区域需要更有张力。",
      promptGuidance: ["提高视觉对比和焦点强度，但不要牺牲品牌识别。"],
      acceptanceCriteria: ["主视觉焦点明确，缩略图状态下仍有传播记忆点。"],
      tags: ["bold"],
    },
    {
      id: "systematic",
      name: "系统化版",
      description: "更注重规范、模块和后续批量延展。",
      briefSuffix: "采用系统化设计语言，保留后续批量变体、系列化延展和品牌规范沉淀空间。",
      promptGuidance: ["输出应呈现可复用的版式系统，而不是一次性装饰。"],
      acceptanceCriteria: ["版式、色彩和字体约束能被后续同系列物料复用。"],
      tags: ["systematic"],
    },
  ];

  if (template.kind === "ppt") {
    return [
      common[0],
      {
        id: "executive",
        name: "高管汇报版",
        description: "强调结论、数字和决策路径。",
        briefSuffix: "面向高管汇报，页面应先给结论，再给关键证据和行动建议。",
        promptGuidance: ["每页标题必须表达观点，减少铺陈式段落。"],
        acceptanceCriteria: ["关键结论、证据和下一步动作在页面结构中直接可见。"],
        tags: ["executive"],
      },
      common[2],
    ];
  }

  if (template.kind === "video-cover") {
    return [
      common[0],
      {
        id: "motion-hook",
        name: "动效钩子版",
        description: "强化开场 2 秒的动作记忆点。",
        briefSuffix: "强调开场 2 秒视觉钩子，镜头运动需要干净、明确、可执行。",
        promptGuidance: ["优先设计开场画面和第一段运动，不要加入过多镜头切换。"],
        acceptanceCriteria: ["首帧和前 2 秒运动可以独立说明传播主题。"],
        tags: ["motion-hook"],
      },
      common[2],
    ];
  }

  return common;
}

export function applyTemplateVariant(template: DesignTemplate, variant: DesignTemplateVariant): DesignTemplate {
  return {
    ...template,
    id: `${template.id}__${variant.id}`,
    name: `${template.name} · ${variant.name}`,
    defaultBrief: [template.defaultBrief, variant.briefSuffix].join("\n"),
    promptGuidance: [...template.promptGuidance, ...variant.promptGuidance],
    acceptanceCriteria: [...template.acceptanceCriteria, ...(variant.acceptanceCriteria || [])],
    tags: [...template.tags, ...variant.tags],
  };
}

export function createDesignTemplateCapabilityMatrix(
  templates: DesignTemplate[] = DESIGN_TEMPLATES
): DesignTemplateCapabilityMatrix {
  const capabilities = templates.map(createDesignTemplateCapability);
  const kindSet = new Set(templates.map((template) => template.kind));
  const missingKinds = REQUIRED_DESIGN_TEMPLATE_KINDS.filter((kind) => !kindSet.has(kind));
  const checks: DesignTemplateCapabilityCheck[] = [
    {
      id: "required-kinds",
      status: missingKinds.length === 0 ? "passed" : "failed",
      severity: "error",
      message: missingKinds.length === 0 ? "全部必需模板类型已覆盖。" : `缺少模板类型：${missingKinds.join(", ")}`,
    },
    {
      id: "template-readiness",
      status: capabilities.every((capability) => capability.ready) ? "passed" : "failed",
      severity: "error",
      message: capabilities.every((capability) => capability.ready)
        ? "全部模板具备可执行交付物、节点、验收和变体。"
        : "存在未满足可执行条件的模板。",
    },
  ];

  return {
    schemaVersion: 1,
    requiredKinds: [...REQUIRED_DESIGN_TEMPLATE_KINDS],
    templateCount: templates.length,
    readyTemplateCount: capabilities.filter((capability) => capability.ready).length,
    variantCount: capabilities.reduce((sum, capability) => sum + capability.variantCount, 0),
    missingKinds,
    outputKinds: uniqueSorted(templates.map((template) => template.outputKind)),
    deliverableKinds: uniqueSorted(capabilities.flatMap((capability) => capability.deliverableKinds)),
    workflowNodeTypes: uniqueSorted(capabilities.flatMap((capability) => capability.requiredWorkflowNodeTypes)),
    templates: capabilities,
    checks,
  };
}

export function createDesignTemplateCapability(template: DesignTemplate): DesignTemplateCapability {
  const variants = getTemplateVariants(template);
  const checks = createDesignTemplateCapabilityChecks(template, variants);
  return {
    id: template.id,
    kind: template.kind,
    planKind: template.planKind,
    outputKind: template.outputKind,
    format: getTemplateFormat(template),
    modelHint: template.modelHint,
    tags: template.tags,
    requiredDeliverableIds: template.deliverables.filter((item) => item.required).map((item) => item.id),
    optionalDeliverableIds: template.deliverables.filter((item) => !item.required).map((item) => item.id),
    deliverableKinds: uniqueSorted(template.deliverables.map((item) => item.kind)) as DesignTemplateCapability["deliverableKinds"],
    requiredWorkflowNodeTypes: template.recommendedWorkflowNodes.filter((item) => item.required).map((item) => item.nodeType),
    optionalWorkflowNodeTypes: template.recommendedWorkflowNodes.filter((item) => !item.required).map((item) => item.nodeType),
    promptGuidanceCount: template.promptGuidance.length,
    acceptanceCriteriaCount: template.acceptanceCriteria.length,
    variantIds: variants.map((variant) => variant.id),
    variantCount: variants.length,
    ready: checks.every((check) => check.status === "passed"),
    checks,
  };
}

function createDesignTemplateCapabilityChecks(
  template: DesignTemplate,
  variants: DesignTemplateVariant[]
): DesignTemplateCapabilityCheck[] {
  const nodeTypes = template.recommendedWorkflowNodes.map((node) => node.nodeType);
  const deliverableKinds = template.deliverables.map((deliverable) => deliverable.kind);
  const format = getTemplateFormat(template);
  const checks: DesignTemplateCapabilityCheck[] = [
    createCapabilityCheck("required-deliverable", template.deliverables.some((item) => item.required), "至少有一个必需交付物。"),
    createCapabilityCheck(
      "required-workflow-node",
      template.recommendedWorkflowNodes.some((item) => item.required),
      "至少有一个必需工作流节点。"
    ),
    createCapabilityCheck("prompt-guidance", template.promptGuidance.length > 0, "包含提示词约束。"),
    createCapabilityCheck("acceptance-criteria", template.acceptanceCriteria.length > 0, "包含验收标准。"),
    createCapabilityCheck("variants", variants.length >= 3, "至少提供 3 个可选变体。"),
    createCapabilityCheck("format", Boolean(format), "包含画幅、视频尺寸或页数范围。"),
    createCapabilityCheck("model-hint", Boolean(template.modelHint.trim()), "包含模型建议。"),
  ];

  if (["social-image", "poster", "brand-board"].includes(template.kind)) {
    checks.push(
      createCapabilityCheck("image-output", template.outputKind === "image", "图片类模板输出 image。"),
      createCapabilityCheck("image-aspect-ratio", Boolean(template.aspectRatio), "图片类模板包含画幅。"),
      createCapabilityCheck("image-nodes", ["promptNode", "imageGeneratorProNode"].every((node) => nodeTypes.includes(node)), "图片类模板包含提示词和图片生成节点。"),
      createCapabilityCheck("image-deliverable", deliverableKinds.includes("image"), "图片类模板包含图片交付物。")
    );
  }

  if (template.kind === "ppt") {
    checks.push(
      createCapabilityCheck("ppt-output", template.outputKind === "workflow" && template.planKind === "ppt", "PPT 模板输出可执行工作流。"),
      createCapabilityCheck("ppt-page-range", Boolean(template.pageCountRange), "PPT 模板包含页数范围。"),
      createCapabilityCheck(
        "ppt-nodes",
        ["promptNode", "pptContentNode", "pptAssemblerNode"].every((node) => nodeTypes.includes(node)),
        "PPT 模板包含提示词、内容生成和组装节点。"
      ),
      createCapabilityCheck(
        "ppt-deliverables",
        (["workflow", "project"] as const).every((kind) => deliverableKinds.includes(kind)),
        "PPT 模板包含工作流和项目交付物。"
      )
    );
  }

  if (template.kind === "video-cover") {
    checks.push(
      createCapabilityCheck("video-plan", template.planKind === "video", "视频模板 planKind 为 video。"),
      createCapabilityCheck("video-format", Boolean(template.aspectRatio && template.videoSize), "视频模板包含画幅和尺寸。"),
      createCapabilityCheck("video-nodes", ["promptNode", "videoGeneratorNode"].every((node) => nodeTypes.includes(node)), "视频模板包含提示词和视频生成节点。"),
      createCapabilityCheck("video-cover-deliverable", deliverableKinds.includes("image"), "视频模板包含封面图片交付物。")
    );
  }

  return checks;
}

function createCapabilityCheck(id: string, passed: boolean, message: string): DesignTemplateCapabilityCheck {
  return {
    id,
    status: passed ? "passed" : "failed",
    severity: "error",
    message,
  };
}

function getTemplateFormat(template: DesignTemplate): string {
  return template.aspectRatio || template.videoSize || template.pageCountRange || template.outputKind;
}

function uniqueSorted<T extends string>(items: T[]): T[] {
  return [...new Set(items.filter(Boolean))].sort();
}

export function validateBrandKitForTemplate(
  brandKit: BrandKit,
  assets: CreativeAsset[],
  template?: DesignTemplate | null
): BrandValidationReport {
  const assetIds = new Set(assets.map((asset) => asset.id));
  const issues: BrandValidationReport["issues"] = [];

  if (!brandKit.name.trim()) {
    issues.push({ id: "name-empty", severity: "error", field: "name", message: "品牌名称不能为空。" });
  }

  const validColors = brandKit.colors.filter((color) => /^#[0-9a-f]{6}$/i.test(color));
  if (validColors.length < 2) {
    issues.push({ id: "colors-min", severity: "warning", field: "colors", message: "建议至少配置 2 个有效品牌色。" });
  }
  if (brandKit.colors.some((color) => !/^#[0-9a-f]{6}$/i.test(color))) {
    issues.push({ id: "colors-invalid", severity: "error", field: "colors", message: "品牌色需要使用 #RRGGBB 格式。" });
  }

  if (!brandKit.fonts.heading || !brandKit.fonts.body) {
    issues.push({ id: "fonts-missing", severity: "warning", field: "fonts", message: "建议同时配置标题字体和正文字体。" });
  }

  if (brandKit.logoAssetId && !assetIds.has(brandKit.logoAssetId)) {
    issues.push({ id: "logo-missing", severity: "error", field: "logo", message: "Logo 素材引用不存在。" });
  } else if (!brandKit.logoAssetId && template?.kind === "brand-board") {
    issues.push({ id: "logo-suggest", severity: "info", field: "logo", message: "品牌板模板建议配置 Logo 素材。" });
  }

  const missingRefs = brandKit.referenceAssetIds.filter((assetId) => !assetIds.has(assetId));
  if (missingRefs.length > 0) {
    issues.push({ id: "references-missing", severity: "error", field: "references", message: "存在失效参考素材引用。" });
  }
  if (brandKit.referenceAssetIds.length === 0) {
    issues.push({ id: "references-suggest", severity: "info", field: "references", message: "建议加入 1-3 张参考图提高品牌稳定性。" });
  }

  if (brandKit.tone === "custom" && !brandKit.customTone?.trim()) {
    issues.push({ id: "tone-custom-empty", severity: "warning", field: "tone", message: "自定义语气为空，会降低提示词约束效果。" });
  }

  const penalty = issues.reduce((score, issue) => {
    if (issue.severity === "error") return score + 28;
    if (issue.severity === "warning") return score + 14;
    return score + 5;
  }, 0);

  return {
    score: Math.max(0, 100 - penalty),
    issues,
  };
}

export function createBrandSpecDocument(
  brandKit: BrandKit,
  assets: CreativeAsset[],
  template?: DesignTemplate | null
): BrandSpecDocument {
  const capabilityMatrix = createDesignTemplateCapabilityMatrix();
  const templateCapability = template ? createDesignTemplateCapability(template) : undefined;
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const logo = brandKit.logoAssetId ? assetById.get(brandKit.logoAssetId) : undefined;
  const references = brandKit.referenceAssetIds
    .map((assetId) => assetById.get(assetId))
    .filter((asset): asset is CreativeAsset => Boolean(asset))
    .map((asset) => ({
      id: asset.id,
      title: asset.title,
      kind: asset.kind,
    }));

  return {
    schemaVersion: 1,
    exportedAt: Date.now(),
    brandKit: createBrandKitSummary(brandKit),
    template: template ? createDesignTemplateSummary(template) : undefined,
    templateCapability,
    templateCatalog: {
      requiredKinds: capabilityMatrix.requiredKinds,
      templateCount: capabilityMatrix.templateCount,
      readyTemplateCount: capabilityMatrix.readyTemplateCount,
      variantCount: capabilityMatrix.variantCount,
      missingKinds: capabilityMatrix.missingKinds,
      outputKinds: capabilityMatrix.outputKinds,
      deliverableKinds: capabilityMatrix.deliverableKinds,
      workflowNodeTypes: capabilityMatrix.workflowNodeTypes,
      checks: capabilityMatrix.checks,
    },
    validation: validateBrandKitForTemplate(brandKit, assets, template),
    assets: {
      logo: logo ? { id: logo.id, title: logo.title } : undefined,
      references,
    },
    promptGuidance: [
      `品牌名称：${brandKit.name}`,
      brandKit.colors.length > 0 ? `品牌色：${brandKit.colors.join(" / ")}` : "",
      brandKit.fonts.heading ? `标题字体：${brandKit.fonts.heading}` : "",
      brandKit.fonts.body ? `正文字体：${brandKit.fonts.body}` : "",
      `品牌语气：${brandKit.tone === "custom" ? brandKit.customTone || "custom" : brandKit.tone}`,
      ...(template?.promptGuidance || []),
    ].filter(Boolean),
    usageNotes: [
      "Logo 和参考图通过素材 ID 引用，导入其他项目时需确保素材存在。",
      "品牌规范可作为设计计划和批量模板的上游约束。",
      "validation.score 低于 75 时，建议先补齐品牌色、字体、Logo 或参考图。",
    ],
  };
}
