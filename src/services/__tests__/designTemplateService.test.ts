import { describe, expect, it } from "vitest";
import {
  DESIGN_TEMPLATES,
  applyTemplateVariant,
  createBrandSpecDocument,
  createDesignTemplateCapabilityMatrix,
  getDesignTemplate,
  getTemplateVariants,
  validateBrandKitForTemplate,
} from "@/services/designTemplateService";
import type { BrandKit, DesignTemplateKind } from "@/types/brand";

const baseBrand: BrandKit = {
  id: "brand-1",
  name: "Lemon",
  colors: ["#111827", "#22c55e"],
  fonts: { heading: "Inter", body: "Noto Sans SC" },
  tone: "professional",
  logoAssetId: "asset-logo",
  referenceAssetIds: ["asset-ref"],
  createdAt: 1,
  updatedAt: 1,
};

describe("designTemplateService", () => {
  it("keeps the built-in template catalog complete and structurally actionable", () => {
    const requiredKinds: DesignTemplateKind[] = ["social-image", "poster", "brand-board", "ppt", "video-cover"];
    const imageKinds = new Set<DesignTemplateKind>(["social-image", "poster", "brand-board"]);
    const ids = DESIGN_TEMPLATES.map((template) => template.id);

    expect(new Set(ids).size).toBe(ids.length);
    for (const kind of requiredKinds) {
      expect(DESIGN_TEMPLATES.some((template) => template.kind === kind)).toBe(true);
    }

    for (const template of DESIGN_TEMPLATES) {
      expect(template.id.trim()).not.toBe("");
      expect(template.name.trim()).not.toBe("");
      expect(template.description.trim()).not.toBe("");
      expect(template.defaultBrief.trim()).not.toBe("");
      expect(template.modelHint.trim()).not.toBe("");
      expect(template.promptGuidance.length).toBeGreaterThan(0);
      expect(template.deliverables.length).toBeGreaterThan(0);
      expect(template.deliverables.some((item) => item.required)).toBe(true);
      expect(template.recommendedWorkflowNodes.length).toBeGreaterThan(0);
      expect(template.recommendedWorkflowNodes.some((item) => item.required)).toBe(true);
      expect(template.acceptanceCriteria.length).toBeGreaterThan(0);
      expect(template.tags.length).toBeGreaterThan(0);

      for (const deliverable of template.deliverables) {
        expect(deliverable.id.trim()).not.toBe("");
        expect(deliverable.title.trim()).not.toBe("");
        expect(deliverable.description.trim()).not.toBe("");
      }

      for (const node of template.recommendedWorkflowNodes) {
        expect(node.nodeType.trim()).not.toBe("");
        expect(node.label.trim()).not.toBe("");
        expect(node.purpose.trim()).not.toBe("");
      }

      if (imageKinds.has(template.kind)) {
        expect(template.outputKind).toBe("image");
        expect(template.aspectRatio).toBeTruthy();
        expect(template.recommendedWorkflowNodes.map((item) => item.nodeType)).toEqual(
          expect.arrayContaining(["promptNode", "imageGeneratorProNode"])
        );
      }

      if (template.kind === "ppt") {
        expect(template.outputKind).toBe("workflow");
        expect(template.pageCountRange).toBeTruthy();
        expect(template.recommendedWorkflowNodes.map((item) => item.nodeType)).toEqual(
          expect.arrayContaining(["promptNode", "pptContentNode", "pptAssemblerNode"])
        );
      }

      if (template.kind === "video-cover") {
        expect(template.videoSize).toBeTruthy();
        expect(template.recommendedWorkflowNodes.map((item) => item.nodeType)).toEqual(
          expect.arrayContaining(["promptNode", "videoGeneratorNode"])
        );
      }
    }
  });

  it("creates template variants that merge prompt guidance and tags", () => {
    const template = getDesignTemplate("social-square-launch");
    expect(template).not.toBeNull();
    const variant = getTemplateVariants(template!)[1];
    const applied = applyTemplateVariant(template!, variant);

    expect(applied.id).toContain(variant.id);
    expect(applied.promptGuidance.length).toBeGreaterThan(template!.promptGuidance.length);
    expect(applied.acceptanceCriteria.length).toBeGreaterThan(template!.acceptanceCriteria.length);
    expect(applied.tags).toContain(variant.tags[0]);
  });

  it("exposes a machine-readable capability matrix for agent template selection", () => {
    const matrix = createDesignTemplateCapabilityMatrix();
    const ppt = matrix.templates.find((template) => template.id === "ppt-business-deck");
    const video = matrix.templates.find((template) => template.id === "video-cover-landscape");

    expect(matrix.schemaVersion).toBe(1);
    expect(matrix.templateCount).toBe(5);
    expect(matrix.readyTemplateCount).toBe(5);
    expect(matrix.variantCount).toBe(15);
    expect(matrix.missingKinds).toEqual([]);
    expect(matrix.checks.every((check) => check.status === "passed")).toBe(true);
    expect(matrix.workflowNodeTypes).toEqual(
      expect.arrayContaining(["promptNode", "imageGeneratorProNode", "pptContentNode", "pptAssemblerNode", "videoGeneratorNode"])
    );
    expect(matrix.deliverableKinds).toEqual(expect.arrayContaining(["image", "workflow", "project", "text", "video"]));

    expect(ppt?.ready).toBe(true);
    expect(ppt?.format).toBe("16:9");
    expect(ppt?.requiredWorkflowNodeTypes).toEqual(["promptNode", "pptContentNode", "pptAssemblerNode"]);
    expect(ppt?.requiredDeliverableIds).toEqual(["ppt-workflow", "pptx-file"]);
    expect(ppt?.variantIds).toEqual(expect.arrayContaining(["balanced", "executive", "systematic"]));

    expect(video?.ready).toBe(true);
    expect(video?.requiredWorkflowNodeTypes).toEqual(["promptNode", "videoGeneratorNode"]);
    expect(video?.variantIds).toEqual(expect.arrayContaining(["motion-hook"]));
  });

  it("keeps template deliverables, workflow nodes, and acceptance criteria structured", () => {
    const template = getDesignTemplate("ppt-business-deck");

    expect(template?.deliverables.some((item) => item.kind === "workflow" && item.required)).toBe(true);
    expect(template?.recommendedWorkflowNodes.map((item) => item.nodeType)).toEqual([
      "promptNode",
      "pptContentNode",
      "pptAssemblerNode",
    ]);
    expect(template?.acceptanceCriteria.length).toBeGreaterThan(1);
  });

  it("validates brand kit completeness against referenced assets", () => {
    const template = getDesignTemplate("brand-board-starter");
    const report = validateBrandKitForTemplate(baseBrand, [
      { id: "asset-logo", kind: "image", title: "Logo", tags: [], source: "upload", createdAt: 1, updatedAt: 1 },
      { id: "asset-ref", kind: "image", title: "Ref", tags: [], source: "upload", createdAt: 1, updatedAt: 1 },
    ], template);

    expect(report.score).toBe(100);
    expect(report.issues).toHaveLength(0);
  });

  it("reports invalid colors and missing asset references", () => {
    const report = validateBrandKitForTemplate(
      { ...baseBrand, colors: ["green"], logoAssetId: "missing-logo", referenceAssetIds: ["missing-ref"] },
      [],
      null
    );

    expect(report.score).toBeLessThan(60);
    expect(report.issues.some((issue) => issue.id === "colors-invalid")).toBe(true);
    expect(report.issues.some((issue) => issue.id === "logo-missing")).toBe(true);
  });

  it("exports a reusable brand spec document", () => {
    const template = getDesignTemplate("social-square-launch");
    const spec = createBrandSpecDocument(baseBrand, [
      { id: "asset-logo", kind: "image", title: "Logo", tags: [], source: "upload", createdAt: 1, updatedAt: 1 },
      { id: "asset-ref", kind: "image", title: "Reference", tags: [], source: "upload", createdAt: 1, updatedAt: 1 },
    ], template);

    expect(spec.schemaVersion).toBe(1);
    expect(spec.brandKit.name).toBe("Lemon");
    expect(spec.assets.logo?.title).toBe("Logo");
    expect(spec.template?.deliverables.length).toBeGreaterThan(0);
    expect(spec.template?.acceptanceCriteria.length).toBeGreaterThan(0);
    expect(spec.templateCapability?.requiredWorkflowNodeTypes).toEqual(["promptNode", "imageGeneratorProNode"]);
    expect(spec.templateCapability?.checks.every((check) => check.status === "passed")).toBe(true);
    expect(spec.templateCatalog?.templateCount).toBe(5);
    expect(spec.templateCatalog?.readyTemplateCount).toBe(5);
    expect(spec.templateCatalog?.variantCount).toBe(15);
    expect(spec.templateCatalog?.workflowNodeTypes).toEqual(
      expect.arrayContaining(["promptNode", "imageGeneratorProNode", "pptContentNode", "pptAssemblerNode", "videoGeneratorNode"])
    );
    expect(spec.promptGuidance.some((item) => item.includes("品牌名称"))).toBe(true);
  });
});
