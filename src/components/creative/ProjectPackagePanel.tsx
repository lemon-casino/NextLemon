import { useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  CloudDownload,
  CloudUpload,
  Download,
  FileJson,
  PackageOpen,
  RefreshCw,
  Upload,
  XCircle,
} from "lucide-react";
import {
  createProjectPackage,
  exportProjectPackageToFile,
  importProjectPackage,
  parseProjectPackageJson,
} from "@/services/projectPackageService";
import {
  getAgenticReadinessHeadline,
  parseAgenticReadinessReportJson,
} from "@/services/readinessReportService";
import {
  syncProjectPackageFromWebDav,
  uploadProjectPackageToWebDav,
} from "@/services/webDavSyncService";
import { useAgentStore } from "@/stores/agentStore";
import { useBrandKitStore } from "@/stores/brandKitStore";
import { useCanvasStore } from "@/stores/canvasStore";
import { useCreativeStore } from "@/stores/creativeStore";
import { useFlowStore } from "@/stores/flowStore";
import { toast } from "@/stores/toastStore";
import { useWebDavSyncStore } from "@/stores/webDavSyncStore";
import type { ProjectAssetManifestItem } from "@/types/projectPackage";
import type { AgenticReadinessReport, AgenticReadinessStep } from "@/types/readiness";

export function ProjectPackagePanel() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const readinessInputRef = useRef<HTMLInputElement>(null);
  const canvases = useCanvasStore((state) => state.canvases);
  const flowNodes = useFlowStore((state) => state.nodes);
  const flowEdges = useFlowStore((state) => state.edges);
  const creativeAssets = useCreativeStore((state) => state.assets);
  const creativeItems = useCreativeStore((state) => state.canvas.items);
  const brandKits = useBrandKitStore((state) => state.brandKits);
  const sessions = useAgentStore((state) => state.sessions);
  const webDavConfig = useWebDavSyncStore((state) => state.config);
  const lastSyncAt = useWebDavSyncStore((state) => state.lastSyncAt);
  const lastStatus = useWebDavSyncStore((state) => state.lastStatus);
  const lastError = useWebDavSyncStore((state) => state.lastError);
  const updateConfig = useWebDavSyncStore((state) => state.updateConfig);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [readinessReport, setReadinessReport] = useState<AgenticReadinessReport | null>(null);

  const packagePreview = useMemo(() => {
    const projectPackage = createProjectPackage();
    return {
      manifest: projectPackage.manifest,
      assetManifest: projectPackage.assetManifest.slice(0, 8),
      assetManifestTotal: projectPackage.assetManifest.length,
    };
  }, [
    canvases.length,
    flowNodes.length,
    flowEdges.length,
    creativeAssets.length,
    creativeItems.length,
    brandKits.length,
    sessions.length,
  ]);

  const handleExport = async () => {
    const ok = await exportProjectPackageToFile();
    if (ok) toast.success("项目包已导出");
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const text = await file.text();
      const projectPackage = parseProjectPackageJson(text);
      const result = importProjectPackage(projectPackage);
      setWarnings(result.warnings);
      toast.success(
        `已导入 ${result.importedCanvases} 个画布、${result.importedCreativeAssets} 个素材`
      );
    } catch (error) {
      toast.error(`导入失败: ${error instanceof Error ? error.message : "未知错误"}`);
    }
  };

  const handleImportReadinessReport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const report = parseAgenticReadinessReportJson(await file.text());
      setReadinessReport(report);
      toast[report.ok ? "success" : report.summary.failed > 0 ? "error" : "info"](
        `验收报告：${getAgenticReadinessHeadline(report)}`
      );
    } catch (error) {
      toast.error(`验收报告导入失败: ${error instanceof Error ? error.message : "未知错误"}`);
    }
  };

  const handleWebDavUpload = async () => {
    try {
      await uploadProjectPackageToWebDav();
      toast.success("WebDAV 上传完成");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "WebDAV 上传失败");
    }
  };

  const handleWebDavDownload = async () => {
    try {
      const result = await syncProjectPackageFromWebDav();
      setWarnings(result.warnings);
      toast.success("WebDAV 拉取完成，已按 id/时间戳合并本地与远端数据（Agent 会话保持本地）");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "WebDAV 拉取失败");
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-3">
      <input
        ref={fileInputRef}
        className="hidden"
        type="file"
        accept="application/json,.json"
        onChange={(event) => void handleImportFile(event)}
      />
      <input
        ref={readinessInputRef}
        className="hidden"
        type="file"
        accept="application/json,.json"
        onChange={(event) => void handleImportReadinessReport(event)}
      />

      <section className="rounded-lg border border-base-300 bg-base-100 p-3">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <PackageOpen className="h-4 w-4 text-primary" />
          项目包
        </div>
        <div className="grid grid-cols-2 gap-2 text-center text-xs">
          <Metric label="工作流" value={packagePreview.manifest.canvasCount} />
          <Metric label="节点" value={packagePreview.manifest.workflowNodeCount} />
          <Metric label="素材" value={packagePreview.manifest.creativeAssetCount} />
          <Metric label="品牌" value={packagePreview.manifest.brandKitCount} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button className="btn btn-primary btn-sm gap-2" onClick={() => void handleExport()}>
            <Download className="h-4 w-4" />
            导出
          </button>
          <button className="btn btn-ghost btn-sm gap-2" onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-4 w-4" />
            导入
          </button>
        </div>
      </section>

      <section className="mt-3 rounded-lg border border-base-300 bg-base-100 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <CheckCircle2 className="h-4 w-4 text-success" />
            验收报告
          </div>
          {readinessReport && (
            <span className={`badge badge-xs ${readinessReport.ok ? "badge-success" : readinessReport.summary.failed > 0 ? "badge-error" : "badge-warning"}`}>
              {getAgenticReadinessHeadline(readinessReport)}
            </span>
          )}
        </div>
        <button
          className="btn btn-ghost btn-sm mb-3 w-full gap-2"
          onClick={() => readinessInputRef.current?.click()}
        >
          <Upload className="h-4 w-4" />
          导入 readiness 报告
        </button>
        {readinessReport ? (
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <Metric label="通过" value={readinessReport.summary.passed} />
              <Metric label="失败" value={readinessReport.summary.failed} />
              <Metric label="阻塞" value={readinessReport.summary.blocked} />
            </div>
            <div className="rounded-md bg-base-200/70 p-2 text-[11px] text-base-content/55">
              <div>时间：{formatReportTime(readinessReport.checkedAt)}</div>
              <div>发布：{readinessReport.releasable ? "可发布" : "不可发布"}</div>
              <div>构建：{readinessReport.includeBuild ? "已包含" : "未包含"}</div>
            </div>
            <div className="max-h-40 space-y-1 overflow-y-auto">
              {readinessReport.steps.map((step) => (
                <ReadinessStepRow key={step.id} step={step} />
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-base-300 p-3 text-center text-xs text-base-content/40">
            导入 `releases/agentic-readiness-report.json` 预览本地 MCP、品牌模板、MuAPI 和发布包状态
          </div>
        )}
      </section>

      <section className="mt-3 rounded-lg border border-base-300 bg-base-100 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <FileJson className="h-4 w-4 text-secondary" />
            素材清单
          </div>
          <span className="badge badge-xs badge-outline">{packagePreview.assetManifestTotal}</span>
        </div>
        <div className="max-h-48 space-y-2 overflow-y-auto">
          {packagePreview.assetManifest.length === 0 ? (
            <div className="rounded-md border border-dashed border-base-300 p-3 text-center text-xs text-base-content/40">
              暂无外部素材引用
            </div>
          ) : (
            packagePreview.assetManifest.map((item) => (
              <AssetManifestRow key={`${item.source}-${item.id}-${item.fieldPath || ""}`} item={item} />
            ))
          )}
        </div>
        {warnings.length > 0 && (
          <div className="mt-3 max-h-28 space-y-1 overflow-y-auto rounded-md bg-warning/10 p-2 text-[11px] text-warning-content">
            {warnings.slice(0, 5).map((warning) => (
              <div key={warning}>{warning}</div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-3 rounded-lg border border-base-300 bg-base-100 p-3">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <RefreshCw className="h-4 w-4 text-info" />
          WebDAV
        </div>
        <label className="mb-2 flex items-center gap-2 text-xs">
          <input
            className="toggle toggle-info toggle-xs"
            type="checkbox"
            checked={webDavConfig.enabled}
            onChange={(event) => updateConfig({ enabled: event.target.checked })}
          />
          启用同步
        </label>
        <div className="space-y-2">
          <input
            className="input input-bordered input-xs w-full"
            placeholder="https://dav.example.com/nextlemon"
            value={webDavConfig.endpoint}
            onChange={(event) => updateConfig({ endpoint: event.target.value })}
          />
          <input
            className="input input-bordered input-xs w-full"
            placeholder="nextlemon-project.json"
            value={webDavConfig.remotePath}
            onChange={(event) => updateConfig({ remotePath: event.target.value })}
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              className="input input-bordered input-xs"
              placeholder="用户名"
              value={webDavConfig.username || ""}
              onChange={(event) => updateConfig({ username: event.target.value })}
            />
            <input
              className="input input-bordered input-xs"
              placeholder="密码"
              type="password"
              value={webDavConfig.password || ""}
              onChange={(event) => updateConfig({ password: event.target.value })}
            />
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            className="btn btn-info btn-sm gap-2"
            disabled={!webDavConfig.enabled}
            onClick={() => void handleWebDavUpload()}
          >
            <CloudUpload className="h-4 w-4" />
            上传
          </button>
          <button
            className="btn btn-ghost btn-sm gap-2"
            disabled={!webDavConfig.enabled}
            onClick={() => void handleWebDavDownload()}
          >
            <CloudDownload className="h-4 w-4" />
            拉取
          </button>
        </div>
        <div className="mt-2 rounded-md bg-base-200/70 p-2 text-[11px] text-base-content/55">
          <div>状态：{lastStatus || "idle"}</div>
          {lastSyncAt && <div>时间：{new Date(lastSyncAt).toLocaleString()}</div>}
          {lastError && <div className="text-error">错误：{lastError}</div>}
        </div>
      </section>
    </div>
  );
}

function ReadinessStepRow({ step }: { step: AgenticReadinessStep }) {
  const { status, label, detailSummary } = step;
  const Icon = status === "passed" ? CheckCircle2 : status === "failed" ? XCircle : AlertCircle;
  return (
    <details className="rounded-md border border-base-300 px-2 py-1 text-[11px]" open={status !== "passed" && Boolean(detailSummary)}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <Icon className={`h-3.5 w-3.5 flex-shrink-0 ${status === "passed" ? "text-success" : status === "failed" ? "text-error" : "text-warning"}`} />
          <span className="truncate">{label}</span>
        </span>
        <span className={`badge badge-xs ${status === "passed" ? "badge-success" : status === "failed" ? "badge-error" : "badge-warning"}`}>
          {status}
        </span>
      </summary>
      {detailSummary && (
        <div className="mt-2 space-y-1 rounded bg-base-200/60 p-2 text-base-content/55">
          {detailSummary.reason && <div>原因：{detailSummary.reason}</div>}
          {detailSummary.failedEnvKeys.length > 0 && (
            <div className="flex flex-wrap gap-1">
              <span>环境：</span>
              {detailSummary.failedEnvKeys.map((key) => (
                <span key={key} className="badge badge-xs badge-error badge-outline">{key}</span>
              ))}
            </div>
          )}
          {detailSummary.blockingEvidenceIds.length > 0 && (
            <div className="flex flex-wrap gap-1">
              <span>证据：</span>
              {detailSummary.blockingEvidenceIds.slice(0, 8).map((id) => (
                <span key={id} className="badge badge-xs badge-warning badge-outline">{id}</span>
              ))}
              {detailSummary.blockingEvidenceIds.length > 8 && (
                <span className="badge badge-xs badge-outline">+{detailSummary.blockingEvidenceIds.length - 8}</span>
              )}
            </div>
          )}
          {(detailSummary.evidenceChecklistCount !== undefined || detailSummary.endpoint2xxCount !== undefined || detailSummary.strictEvidenceReady !== undefined) && (
            <div>
              strict: {detailSummary.strictEvidenceReady === undefined ? "unknown" : detailSummary.strictEvidenceReady ? "ready" : "blocked"}
              {detailSummary.evidenceChecklistCount !== undefined && ` · checklist ${detailSummary.evidenceChecklistCount}`}
              {detailSummary.endpoint2xxCount !== undefined && ` · endpoint2xx ${detailSummary.endpoint2xxCount}`}
            </div>
          )}
          {(detailSummary.brandSpecScore !== undefined ||
            detailSummary.templateCapabilityReady !== undefined ||
            detailSummary.templateCatalogTemplateCount !== undefined) && (
            <div className="space-y-1">
              <div>
                品牌模板：
                {detailSummary.brandSpecScore !== undefined && ` score ${detailSummary.brandSpecScore}`}
                {detailSummary.brandSpecDeliverableCount !== undefined && ` · deliverables ${detailSummary.brandSpecDeliverableCount}`}
                {detailSummary.brandSpecAcceptanceCriteriaCount !== undefined && ` · criteria ${detailSummary.brandSpecAcceptanceCriteriaCount}`}
              </div>
              <div>
                capability: {detailSummary.templateCapabilityReady === undefined ? "unknown" : detailSummary.templateCapabilityReady ? "ready" : "blocked"}
                {detailSummary.templateCapabilityVariantCount !== undefined && ` · variants ${detailSummary.templateCapabilityVariantCount}`}
                {detailSummary.templateCapabilityCheckCount !== undefined &&
                  ` · checks ${detailSummary.templateCapabilityChecksPassed ?? 0}/${detailSummary.templateCapabilityCheckCount}`}
              </div>
              <div>
                catalog:
                {detailSummary.templateCatalogReadyTemplateCount !== undefined &&
                  detailSummary.templateCatalogTemplateCount !== undefined &&
                  ` ${detailSummary.templateCatalogReadyTemplateCount}/${detailSummary.templateCatalogTemplateCount} ready`}
                {detailSummary.templateCatalogVariantCount !== undefined && ` · variants ${detailSummary.templateCatalogVariantCount}`}
                {detailSummary.templateCatalogCheckCount !== undefined &&
                  ` · checks ${detailSummary.templateCatalogChecksPassed ?? 0}/${detailSummary.templateCatalogCheckCount}`}
              </div>
            </div>
          )}
          {detailSummary.templateCapabilityRequiredWorkflowNodes.length > 0 && (
            <div className="flex flex-wrap gap-1">
              <span>模板节点：</span>
              {detailSummary.templateCapabilityRequiredWorkflowNodes.map((type) => (
                <span key={type} className="badge badge-xs badge-outline">{type}</span>
              ))}
            </div>
          )}
          {detailSummary.templateCatalogWorkflowNodeTypes.length > 0 && (
            <div className="flex flex-wrap gap-1">
              <span>目录节点：</span>
              {detailSummary.templateCatalogWorkflowNodeTypes.map((type) => (
                <span key={type} className="badge badge-xs badge-outline">{type}</span>
              ))}
            </div>
          )}
          {(detailSummary.brandTemplateTemplateCount !== undefined ||
            detailSummary.brandTemplateVariantCount !== undefined ||
            detailSummary.brandTemplateReadyTemplateCount !== undefined ||
            detailSummary.brandTemplatePassedChecks !== undefined) && (
            <div className="space-y-1">
              <div>
                模板目录：
                {detailSummary.brandTemplateReportOk !== undefined && ` report ${detailSummary.brandTemplateReportOk ? "ok" : "failed"}`}
                {detailSummary.brandTemplatePassedTemplates !== undefined &&
                  detailSummary.brandTemplateTemplateCount !== undefined &&
                  ` · templates ${detailSummary.brandTemplatePassedTemplates}/${detailSummary.brandTemplateTemplateCount}`}
                {detailSummary.brandTemplateKindCount !== undefined && ` · kinds ${detailSummary.brandTemplateKindCount}`}
                {detailSummary.brandTemplateVariantCount !== undefined && ` · variants ${detailSummary.brandTemplateVariantCount}`}
              </div>
              <div>
                capability:
                {detailSummary.brandTemplateReadyTemplateCount !== undefined &&
                  detailSummary.brandTemplateCapabilityTemplateCount !== undefined &&
                  ` ${detailSummary.brandTemplateReadyTemplateCount}/${detailSummary.brandTemplateCapabilityTemplateCount} ready`}
                {detailSummary.brandTemplateCapabilityVariantCount !== undefined &&
                  ` · variants ${detailSummary.brandTemplateCapabilityVariantCount}`}
                {detailSummary.brandTemplatePassedChecks !== undefined &&
                  ` · checks ${detailSummary.brandTemplatePassedChecks}/${(detailSummary.brandTemplatePassedChecks ?? 0) + (detailSummary.brandTemplateFailedChecks ?? 0)}`}
              </div>
            </div>
          )}
          {detailSummary.brandTemplateRequiredKinds.length > 0 && (
            <div className="flex flex-wrap gap-1">
              <span>模板类型：</span>
              {detailSummary.brandTemplateRequiredKinds.map((kind) => (
                <span key={kind} className="badge badge-xs badge-outline">{kind}</span>
              ))}
            </div>
          )}
          {detailSummary.brandTemplateTemplateIds.length > 0 && (
            <div className="flex flex-wrap gap-1">
              <span>模板 ID：</span>
              {detailSummary.brandTemplateTemplateIds.map((id) => (
                <span key={id} className="badge badge-xs badge-outline">{id}</span>
              ))}
            </div>
          )}
          {Object.keys(detailSummary.brandTemplateKindBreakdown).length > 0 && (
            <div className="flex flex-wrap gap-1">
              <span>类型计数：</span>
              {Object.entries(detailSummary.brandTemplateKindBreakdown).map(([kind, count]) => (
                <span key={kind} className="badge badge-xs badge-outline">{kind}:{count}</span>
              ))}
            </div>
          )}
          {Object.keys(detailSummary.brandTemplateVariantIdsByTemplate).length > 0 && (
            <div className="space-y-0.5">
              {Object.entries(detailSummary.brandTemplateVariantIdsByTemplate).slice(0, 5).map(([templateId, variantIds]) => (
                <div key={templateId} className="truncate">
                  变体 {templateId}: {variantIds.join(", ")}
                </div>
              ))}
            </div>
          )}
          {detailSummary.brandTemplateWorkflowNodeTypes.length > 0 && (
            <div className="flex flex-wrap gap-1">
              <span>模板节点：</span>
              {detailSummary.brandTemplateWorkflowNodeTypes.map((type) => (
                <span key={type} className="badge badge-xs badge-outline">{type}</span>
              ))}
            </div>
          )}
          {detailSummary.brandTemplateMissingKinds.length > 0 && (
            <div className="flex flex-wrap gap-1">
              <span>缺类型：</span>
              {detailSummary.brandTemplateMissingKinds.map((kind) => (
                <span key={kind} className="badge badge-xs badge-error badge-outline">{kind}</span>
              ))}
            </div>
          )}
          {detailSummary.brandTemplateFailedTemplateIds.length > 0 && (
            <div className="flex flex-wrap gap-1">
              <span>失败模板：</span>
              {detailSummary.brandTemplateFailedTemplateIds.map((id) => (
                <span key={id} className="badge badge-xs badge-error badge-outline">{id}</span>
              ))}
            </div>
          )}
          {(detailSummary.localBridgeToolCount !== undefined ||
            detailSummary.localBridgeOperationCount !== undefined ||
            detailSummary.localBridgeBrandTemplateCount !== undefined ||
            detailSummary.localBridgeBrandSpecToolReady !== undefined ||
            detailSummary.localBridgeWriteTools.length > 0) && (
            <div className="space-y-1">
              <div>
                本地桥：
                {detailSummary.localBridgeReportOk !== undefined && ` report ${detailSummary.localBridgeReportOk ? "ok" : "failed"}`}
                {detailSummary.localBridgeToolCount !== undefined && ` · tools ${detailSummary.localBridgeToolCount}`}
                {detailSummary.localBridgeOperationCount !== undefined && ` · ops ${detailSummary.localBridgeOperationCount}`}
              </div>
              <div>
                品牌桥：
                {detailSummary.localBridgeBrandTemplateReadyCount !== undefined &&
                  detailSummary.localBridgeBrandTemplateCount !== undefined &&
                  ` ${detailSummary.localBridgeBrandTemplateReadyCount}/${detailSummary.localBridgeBrandTemplateCount} ready`}
                {detailSummary.localBridgeBrandTemplateVariantCount !== undefined && ` · variants ${detailSummary.localBridgeBrandTemplateVariantCount}`}
                {detailSummary.localBridgeBrandTemplateToolReady !== undefined &&
                  ` · templates ${detailSummary.localBridgeBrandTemplateToolReady ? "ready" : "blocked"}`}
                {detailSummary.localBridgeBrandSpecToolReady !== undefined &&
                  ` · spec ${detailSummary.localBridgeBrandSpecToolReady ? "ready" : "blocked"}`}
              </div>
            </div>
          )}
          {detailSummary.localBridgeFailedStepIds.length > 0 && (
            <div className="flex flex-wrap gap-1">
              <span>桥失败项：</span>
              {detailSummary.localBridgeFailedStepIds.map((id) => (
                <span key={id} className="badge badge-xs badge-error badge-outline">{id}</span>
              ))}
            </div>
          )}
          {detailSummary.localBridgeReadOnlyBrandTools.length > 0 && (
            <div className="flex flex-wrap gap-1">
              <span>品牌只读：</span>
              {detailSummary.localBridgeReadOnlyBrandTools.map((tool) => (
                <span key={tool} className="badge badge-xs badge-outline">{tool}</span>
              ))}
            </div>
          )}
          {detailSummary.localBridgeWriteTools.length > 0 && (
            <div className="flex flex-wrap gap-1">
              <span>写工具：</span>
              {detailSummary.localBridgeWriteTools.map((tool) => (
                <span key={tool} className="badge badge-xs badge-outline">{tool}</span>
              ))}
            </div>
          )}
          {(detailSummary.localMcpToolCount !== undefined ||
            detailSummary.localMcpOperationCount !== undefined ||
            detailSummary.localMcpReleaseStatus ||
            detailSummary.localMcpApprovalRequestHash) && (
            <div className="space-y-1">
              <div>
                本地 MCP：
                {detailSummary.localMcpReportOk !== undefined && ` report ${detailSummary.localMcpReportOk ? "ok" : "failed"}`}
                {detailSummary.localMcpToolCount !== undefined && ` · tools ${detailSummary.localMcpToolCount}`}
                {detailSummary.localMcpOperationCount !== undefined && ` · ops ${detailSummary.localMcpOperationCount}`}
                {detailSummary.localMcpApprovalSchemaOneOfCount !== undefined && ` · oneOf ${detailSummary.localMcpApprovalSchemaOneOfCount}`}
              </div>
              <div>
                MCP 品牌：
                {detailSummary.localMcpBrandTemplateReadyCount !== undefined &&
                  detailSummary.localMcpBrandTemplateCount !== undefined &&
                  ` ${detailSummary.localMcpBrandTemplateReadyCount}/${detailSummary.localMcpBrandTemplateCount} ready`}
                {detailSummary.localMcpBrandTemplateVariantCount !== undefined && ` · variants ${detailSummary.localMcpBrandTemplateVariantCount}`}
              </div>
              <div>
                远端证据：
                {detailSummary.localMcpMuApiEnvReady !== undefined && ` env ${detailSummary.localMcpMuApiEnvReady ? "ready" : "blocked"}`}
                {detailSummary.localMcpMuApiRealEvidenceReady !== undefined && ` · real ${detailSummary.localMcpMuApiRealEvidenceReady ? "ready" : "blocked"}`}
                {detailSummary.localMcpReleaseStatus && ` · ${detailSummary.localMcpReleaseStatus}`}
              </div>
            </div>
          )}
          {detailSummary.localMcpTransportInputs.length > 0 && (
            <div className="flex flex-wrap gap-1">
              <span>传输：</span>
              {detailSummary.localMcpTransportInputs.map((input) => (
                <span key={input} className="badge badge-xs badge-outline">{input}</span>
              ))}
            </div>
          )}
          {detailSummary.localMcpOperationCategories.length > 0 && (
            <div className="flex flex-wrap gap-1">
              <span>MCP 分类：</span>
              {detailSummary.localMcpOperationCategories.map((category) => (
                <span key={category} className="badge badge-xs badge-outline">{category}</span>
              ))}
            </div>
          )}
          {Object.keys(detailSummary.localMcpOperationCategoryCounts).length > 0 && (
            <div className="flex flex-wrap gap-1">
              <span>分类计数：</span>
              {Object.entries(detailSummary.localMcpOperationCategoryCounts).map(([category, count]) => (
                <span key={category} className="badge badge-xs badge-outline">{category}:{count}</span>
              ))}
            </div>
          )}
          {detailSummary.localMcpOperationTypes.length > 0 && (
            <div className="flex flex-wrap gap-1">
              <span>MCP 操作：</span>
              {detailSummary.localMcpOperationTypes.map((type) => (
                <span key={type} className="badge badge-xs badge-outline">{type}</span>
              ))}
            </div>
          )}
          {detailSummary.localMcpBlockerIds.length > 0 && (
            <div className="flex flex-wrap gap-1">
              <span>MCP blocker：</span>
              {detailSummary.localMcpBlockerIds.map((id) => (
                <span key={id} className="badge badge-xs badge-warning badge-outline">{id}</span>
              ))}
            </div>
          )}
          {detailSummary.localMcpApprovalToolNames.length > 0 && (
            <div className="flex flex-wrap gap-1">
              <span>审批工具：</span>
              {detailSummary.localMcpApprovalToolNames.map((tool) => (
                <span key={tool} className="badge badge-xs badge-outline">{tool}</span>
              ))}
            </div>
          )}
          {detailSummary.localMcpApprovalRequestHash && (
            <div className="truncate">MCP hash：{detailSummary.localMcpApprovalRequestHash}</div>
          )}
          {detailSummary.localMcpApprovalOpSummary && <div>MCP 操作：{detailSummary.localMcpApprovalOpSummary}</div>}
          {(detailSummary.localMcpApprovalWritesExecuteDirectly !== undefined ||
            detailSummary.localMcpApprovalImportRequired !== undefined ||
            detailSummary.localMcpApprovalRequiresUserApproval !== undefined ||
            detailSummary.localMcpApprovalAuditOk !== undefined) && (
            <div>
              审批策略：
              {detailSummary.localMcpApprovalWritesExecuteDirectly !== undefined && ` writesDirect ${String(detailSummary.localMcpApprovalWritesExecuteDirectly)}`}
              {detailSummary.localMcpApprovalImportRequired !== undefined && ` · import ${String(detailSummary.localMcpApprovalImportRequired)}`}
              {detailSummary.localMcpApprovalRequiresUserApproval !== undefined && ` · approval ${String(detailSummary.localMcpApprovalRequiresUserApproval)}`}
              {detailSummary.localMcpApprovalAuditOk !== undefined && ` · audit ${detailSummary.localMcpApprovalAuditOk ? "ok" : "failed"}`}
            </div>
          )}
          {detailSummary.requestHash && <div className="truncate">hash：{detailSummary.requestHash}</div>}
          {detailSummary.opSummary && <div>操作：{detailSummary.opSummary}</div>}
          {detailSummary.operationTypes.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {detailSummary.operationTypes.map((type) => (
                <span key={type} className="badge badge-xs badge-outline">{type}</span>
              ))}
            </div>
          )}
          {detailSummary.reportPath && <div className="truncate">报告：{detailSummary.reportPath}</div>}
          {detailSummary.nextPreflightCommand && <div className="truncate">前置：{detailSummary.nextPreflightCommand}</div>}
          {detailSummary.nextCommand && <div className="truncate">下一步：{detailSummary.nextCommand}</div>}
        </div>
      )}
    </details>
  );
}

function formatReportTime(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : value;
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-base-300 bg-base-200/40 px-2 py-2">
      <div className="text-base font-semibold">{value}</div>
      <div className="text-[11px] text-base-content/45">{label}</div>
    </div>
  );
}

function AssetManifestRow({ item }: { item: ProjectAssetManifestItem }) {
  return (
    <div className="rounded-md border border-base-300 p-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 flex-1 truncate font-medium">{item.title}</span>
        <span className={`badge badge-xs ${item.embedded ? "badge-success" : "badge-warning"}`}>
          {item.embedded ? "内嵌" : "外部"}
        </span>
      </div>
      <div className="mt-1 truncate text-[11px] text-base-content/45">
        {item.storagePath || item.url || item.mimeType || item.kind}
      </div>
    </div>
  );
}
