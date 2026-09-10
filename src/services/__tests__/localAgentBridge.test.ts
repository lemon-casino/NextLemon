import { describe, expect, it } from "vitest";
import {
  getLocalAgentBridgeConfigBundle,
  getLocalAgentMcpManifest,
  LOCAL_AGENT_BRIDGE_TOOLS,
  createLocalAgentBridgeBrandSpec,
  listLocalAgentBridgeBrandTemplates,
  parseLocalAgentApprovalRequestJson,
  validateLocalAgentBridgeApprovalRequest,
} from "@/services/localAgentBridge";

describe("localAgentBridge", () => {
  it("exposes MCP-like tool manifest with approval-only writes", () => {
    const manifest = getLocalAgentMcpManifest();

    expect(manifest.entry).toBe("window.nextlemonAgentBridge");
    expect(manifest.approvalRequired).toBe(true);
    expect(manifest.security.writesExecuteDirectly).toBe(false);
    expect(manifest.tools).toHaveLength(6);
    expect(manifest.operationCatalog).toHaveLength(15);
    expect(manifest.brandTemplates.supportsBrandSpecExport).toBe(true);
    expect(manifest.brandTemplates.supportsVariantBrandSpec).toBe(true);
    expect(manifest.brandTemplates.expectedTemplateCount).toBe(5);
    expect(manifest.brandTemplates.expectedVariantCount).toBe(15);
    expect(manifest.stdioProxy.command).toBe("npm run mcp:local");
    const writeToolSchema = LOCAL_AGENT_BRIDGE_TOOLS.find((tool) => tool.write)?.inputSchema;
    expect(writeToolSchema?.required).toContain("ops");
    expect((writeToolSchema?.properties?.ops as any).items.oneOf).toHaveLength(15);
  });

  it("exports a client config bundle with examples", () => {
    const bundle = getLocalAgentBridgeConfigBundle();

    expect(bundle.clientConfig.entry).toBe("window.nextlemonAgentBridge");
    expect(bundle.examples.listBrandTemplates.args.includeCapabilityMatrix).toBe(true);
    expect(bundle.examples.createBrandSpec.args.templateId).toBe("poster-vertical-campaign");
    expect(bundle.examples.validateApprovalRequest.args.ops[0].type).toBe("asset.add");
    expect(bundle.examples.requestApproval.args.ops[0].type).toBe("asset.add");
    expect(bundle.notes.some((note) => note.includes("not a standalone"))).toBe(true);
  });

  it("exposes brand templates and creates variant-aware brand specs through the in-app bridge", () => {
    const templates = listLocalAgentBridgeBrandTemplates({
      includePromptGuidance: false,
      includeVariants: true,
      includeAppliedVariants: true,
      includeCapabilityMatrix: true,
    });
    const spec = createLocalAgentBridgeBrandSpec({
      brandKit: {
        id: "bridge-brand",
        name: "Bridge Brand",
        colors: ["#111827", "#f59e0b"],
        fonts: { heading: "Inter", body: "Inter" },
        logoAssetId: "logo",
        tone: "professional",
        referenceAssetIds: ["ref"],
        createdAt: 1,
        updatedAt: 1,
      },
      assets: [
        { id: "logo", kind: "image", title: "Logo", source: "upload", tags: [], createdAt: 1, updatedAt: 1 },
        { id: "ref", kind: "image", title: "Reference", source: "upload", tags: [], createdAt: 1, updatedAt: 1 },
      ],
      templateId: "poster-vertical-campaign",
      variantId: "bold",
    });

    expect(templates.summary.templateCount).toBe(5);
    expect(templates.summary.variantCount).toBe(15);
    expect(templates.summary.appliedVariantCount).toBe(15);
    expect(templates.capabilityMatrix?.readyTemplateCount).toBe(5);
    expect(templates.capabilityMatrix?.workflowNodeTypes).toEqual([
      "imageGeneratorProNode",
      "pptAssemblerNode",
      "pptContentNode",
      "promptNode",
      "videoGeneratorNode",
    ]);
    expect(spec.ok).toBe(true);
    expect(spec.templateId).toBe("poster-vertical-campaign__bold");
    expect(spec.variantId).toBe("bold");
    expect(spec.validation.score).toBe(100);
    expect(spec.templateCapability?.ready).toBe(true);
    expect(spec.templateCapability?.variantCount).toBe(3);
    expect(spec.templateCatalog?.readyTemplateCount).toBe(5);
    expect(spec.templateCatalog?.variantCount).toBe(15);
  });

  it("validates approval requests before creating pending writes", () => {
    const ok = validateLocalAgentBridgeApprovalRequest({
      ops: [{ type: "workflow.selectNodes", nodeIds: [] }],
    });
    const bad = validateLocalAgentBridgeApprovalRequest({
      ops: [{ type: "workflow.runNode", nodeId: "" }],
    });

    expect(ok.ok).toBe(true);
    expect(ok.summary).toContain("选择工作流节点");
    expect(bad.ok).toBe(false);
    expect(bad.errors[0]).toContain("nodeId");
  });

  it("parses file-based external approval requests", () => {
    const request = parseLocalAgentApprovalRequestJson(JSON.stringify({
      packageType: "nextlemon.agent-approval-request",
      schemaVersion: 1,
      id: "request-1",
      title: "External request",
      createdAt: 1,
      opCount: 1,
      opSummary: "选择工作流节点 1",
      operationTypes: ["workflow.selectNodes"],
      approvalPolicy: {
        writesExecuteDirectly: false,
        approvalImportRequired: true,
        requiresUserApproval: true,
      },
      requestHash: "a".repeat(64),
      ops: [{ type: "workflow.selectNodes", nodeIds: [] }],
    }));

    expect(request.id).toBe("request-1");
    expect(request.opCount).toBe(1);
    expect(request.operationTypes).toEqual(["workflow.selectNodes"]);
    expect(request.approvalPolicy?.writesExecuteDirectly).toBe(false);
    expect(request.requestHash).toBe("a".repeat(64));
    expect(request.ops[0].type).toBe("workflow.selectNodes");
  });

  it("rejects invalid external approval request packages", () => {
    expect(() => parseLocalAgentApprovalRequestJson(JSON.stringify({ packageType: "bad" }))).toThrow(
      "不是有效的 NextLemon Agent 审批请求"
    );
  });
});
