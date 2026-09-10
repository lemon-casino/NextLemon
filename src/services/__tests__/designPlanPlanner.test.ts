import { describe, expect, it } from "vitest";
import { getDesignTemplate } from "@/services/designTemplateService";
import {
  createDesignPlanFromBrief,
  designPlanToCanvasAgentOps,
  estimateDesignPlanCost,
  layoutDesignPlanDag,
  validateDesignPlanTopology,
} from "@/services/designPlanPlanner";
import type { BrandKit } from "@/types/brand";
import type { CanvasAgentOp, DesignPlan } from "@/types/creative";

const brandKit: BrandKit = {
  id: "brand-test",
  name: "Lemon Studio",
  colors: ["#111827", "#22c55e"],
  fonts: { heading: "Inter", body: "Noto Sans SC" },
  tone: "friendly",
  referenceAssetIds: ["asset-reference"],
  createdAt: 1,
  updatedAt: 1,
};

describe("designPlanPlanner", () => {
  it("injects brand kit and template metadata into executable prompts", () => {
    const template = getDesignTemplate("poster-vertical-campaign");
    expect(template).not.toBeNull();

    const plan = createDesignPlanFromBrief("面向新品发布", {
      brandKit,
      template,
    });
    const ops = designPlanToCanvasAgentOps(plan);
    const promptOp = ops.find(
      (op): op is Extract<CanvasAgentOp, { type: "workflow.addNode" }> =>
        op.type === "workflow.addNode" && op.nodeType === "promptNode"
    );
    const specAssetOp = ops.find(
      (op): op is Extract<CanvasAgentOp, { type: "asset.add" }> =>
        op.type === "asset.add" && Boolean(op.asset.tags?.includes("design-spec"))
    );

    expect(plan.metadata?.brandKitId).toBe("brand-test");
    expect(plan.metadata?.templateId).toBe("poster-vertical-campaign");
    expect(promptOp?.data?.prompt).toContain("Lemon Studio");
    expect(promptOp?.data?.prompt).toContain("#22c55e");
    expect(promptOp?.data?.prompt).toContain("竖版海报");
    expect(promptOp?.data?.prompt).toContain("交付物");
    expect(promptOp?.data?.prompt).toContain("验收标准");
    expect(specAssetOp?.type).toBe("asset.add");
    expect(specAssetOp?.asset.text).toContain("推荐节点");
  });

  it("detects missing dependencies and dependency cycles", () => {
    const plan: DesignPlan = {
      id: "plan-cycle",
      title: "Cycle",
      brief: "test",
      status: "draft",
      createdAt: 1,
      updatedAt: 1,
      steps: [
        {
          id: "a",
          title: "A",
          tool: "planner",
          outputKind: "workflow",
          dependsOn: ["b"],
          status: "pending",
        },
        {
          id: "b",
          title: "B",
          tool: "planner",
          outputKind: "workflow",
          dependsOn: ["a", "missing"],
          status: "pending",
        },
      ],
    };

    const errors = validateDesignPlanTopology(plan);
    expect(errors.some((error) => error.includes("依赖不存在"))).toBe(true);
    expect(errors.some((error) => error.includes("存在环"))).toBe(true);
  });

  it("fills estimated cost for generated plan steps and summarizes plan cost", () => {
    const imagePlan = createDesignPlanFromBrief("生成一张品牌海报图片");
    expect(imagePlan.steps.map((step) => step.estimatedCost)).toEqual(["无", "低", "中", "无"]);
    expect(estimateDesignPlanCost(imagePlan).label).toBe("中");

    const videoPlan = createDesignPlanFromBrief("生成一段产品视频短片");
    const videoCost = estimateDesignPlanCost(videoPlan);
    expect(videoCost.label).toBe("高");
    expect(videoCost.heavyStepIds).toContain("generate");

    const pptPlan = createDesignPlanFromBrief("做一份产品介绍 PPT 演示");
    expect(estimateDesignPlanCost(pptPlan).label).toBe("高");
    expect(estimateDesignPlanCost(pptPlan).heavyStepIds).toContain("ppt-content");
  });

  it("layers plan steps into DAG columns by dependency depth", () => {
    const plan = createDesignPlanFromBrief("生成一张宣传图片");
    const layout = layoutDesignPlanDag(plan.steps);
    expect(layout.hasCycle).toBe(false);
    expect(layout.layers).toHaveLength(4);
    expect(layout.layers[0][0].id).toBe("brief");
    expect(layout.layers[1][0].id).toBe("prompt");
    expect(layout.layers[2][0].id).toBe("generate");
    expect(layout.layers[3][0].id).toBe("review");
  });

  it("places parallel steps in the same layer and flags cycles without looping", () => {
    const plan: DesignPlan = {
      id: "plan-parallel",
      title: "Parallel",
      brief: "test",
      status: "draft",
      createdAt: 1,
      updatedAt: 1,
      steps: [
        {
          id: "root",
          title: "Root",
          tool: "planner",
          outputKind: "workflow",
          dependsOn: [],
          status: "pending",
        },
        {
          id: "left",
          title: "Left",
          tool: "planner",
          outputKind: "workflow",
          dependsOn: ["root"],
          status: "pending",
        },
        {
          id: "right",
          title: "Right",
          tool: "planner",
          outputKind: "workflow",
          dependsOn: ["root"],
          status: "pending",
        },
        {
          id: "join",
          title: "Join",
          tool: "planner",
          outputKind: "workflow",
          dependsOn: ["left", "right"],
          status: "pending",
        },
      ],
    };

    const layout = layoutDesignPlanDag(plan.steps);
    expect(layout.hasCycle).toBe(false);
    expect(layout.layers.map((layer) => layer.map((step) => step.id))).toEqual([
      ["root"],
      ["left", "right"],
      ["join"],
    ]);

    const cyclePlan: DesignPlan = { ...plan, steps: plan.steps.slice(0, 2) };
    cyclePlan.steps[0] = { ...cyclePlan.steps[0], dependsOn: ["left"] };
    const cycleLayout = layoutDesignPlanDag(cyclePlan.steps);
    expect(cycleLayout.hasCycle).toBe(true);
  });
});
