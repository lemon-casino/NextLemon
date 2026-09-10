import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("brand spec CLI", () => {
  it("exports template capability and catalog details from the real template service", () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "nextlemon-brand-spec-cli-"));
    const inputPath = path.join(tempDir, "brand-input.json");
    const outputPath = path.join(tempDir, "brand-spec.json");

    writeFileSync(inputPath, `${JSON.stringify(createInput(), null, 2)}\n`);

    const result = spawnSync("node", ["./scripts/export-brand-spec.mjs", "--input", inputPath, "--output", outputPath], {
      cwd: process.cwd(),
      encoding: "utf8",
      shell: process.platform === "win32",
    });

    expect(result.status).toBe(0);
    const spec = JSON.parse(readFileSync(outputPath, "utf8"));

    expect(spec.validation.score).toBe(100);
    expect(spec.templateCapability.ready).toBe(true);
    expect(spec.templateCapability.variantCount).toBe(3);
    expect(spec.templateCapability.requiredWorkflowNodeTypes).toEqual(["promptNode", "imageGeneratorProNode"]);
    expect(spec.templateCapability.checks.every((check) => check.status === "passed")).toBe(true);
    expect(spec.templateCatalog.templateCount).toBe(5);
    expect(spec.templateCatalog.readyTemplateCount).toBe(5);
    expect(spec.templateCatalog.variantCount).toBe(15);
    expect(spec.templateCatalog.workflowNodeTypes).toEqual(
      expect.arrayContaining(["promptNode", "imageGeneratorProNode", "pptContentNode", "pptAssemblerNode", "videoGeneratorNode"])
    );
  });
});

function createInput() {
  return {
    brandKit: {
      id: "brand-cli",
      name: "CLI Brand",
      colors: ["#111827", "#22c55e"],
      fonts: { heading: "Inter", body: "Inter" },
      tone: "professional",
      logoAssetId: "logo",
      referenceAssetIds: ["ref"],
      createdAt: 1,
      updatedAt: 1,
    },
    assets: [
      { id: "logo", kind: "image", title: "Logo", tags: [], source: "upload", createdAt: 1, updatedAt: 1 },
      { id: "ref", kind: "image", title: "Reference", tags: [], source: "upload", createdAt: 1, updatedAt: 1 },
    ],
    template: {
      id: "poster-cli",
      kind: "poster",
      planKind: "image",
      name: "Poster",
      description: "CLI poster template",
      outputKind: "image",
      defaultBrief: "Generate a poster.",
      aspectRatio: "3:4",
      deliverables: [
        {
          id: "poster-image",
          title: "Poster image",
          kind: "image",
          required: true,
          description: "Reusable poster image.",
        },
      ],
      recommendedWorkflowNodes: [
        {
          nodeType: "promptNode",
          label: "Poster prompt",
          required: true,
          purpose: "Create the poster prompt.",
        },
        {
          nodeType: "imageGeneratorProNode",
          label: "Poster generation",
          required: true,
          purpose: "Generate the poster image.",
        },
      ],
      acceptanceCriteria: ["Clear hierarchy."],
      promptGuidance: ["Keep the layout clear."],
      tags: ["poster"],
      modelHint: "gemini-3-pro-image-preview",
    },
  };
}
