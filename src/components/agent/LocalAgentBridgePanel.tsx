import { useMemo, useRef, useState } from "react";
import { Check, Code2, Download, Eye, ShieldCheck, Trash2, Upload } from "lucide-react";
import {
  getLocalAgentBridgeConfigBundle,
  getLocalAgentMcpManifest,
  LOCAL_AGENT_BRIDGE_TOOLS,
  parseLocalAgentApprovalRequestJson,
  readLocalAgentBridgeSnapshot,
  requestLocalAgentBridgeApproval,
} from "@/services/localAgentBridge";
import { useLocalAgentBridgeStore } from "@/stores/localAgentBridgeStore";
import { toast } from "@/stores/toastStore";
import type { CanvasAgentOp } from "@/types/creative";

export function LocalAgentBridgePanel() {
  const approvalFileInputRef = useRef<HTMLInputElement>(null);
  const enabled = useLocalAgentBridgeStore((state) => state.enabled);
  const allowWriteRequests = useLocalAgentBridgeStore((state) => state.allowWriteRequests);
  const installedAt = useLocalAgentBridgeStore((state) => state.installedAt);
  const lastSnapshotAt = useLocalAgentBridgeStore((state) => state.lastSnapshotAt);
  const lastWriteRequestAt = useLocalAgentBridgeStore((state) => state.lastWriteRequestAt);
  const lastError = useLocalAgentBridgeStore((state) => state.lastError);
  const auditLog = useLocalAgentBridgeStore((state) => state.auditLog);
  const setEnabled = useLocalAgentBridgeStore((state) => state.setEnabled);
  const setAllowWriteRequests = useLocalAgentBridgeStore((state) => state.setAllowWriteRequests);
  const clearAuditLog = useLocalAgentBridgeStore((state) => state.clearAuditLog);
  const [snapshotSummary, setSnapshotSummary] = useState("");

  const statusLabel = useMemo(() => {
    if (!enabled) return "关闭";
    return installedAt ? "已挂载" : "待挂载";
  }, [enabled, installedAt]);

  const handleReadSnapshot = async () => {
    const result = await readLocalAgentBridgeSnapshot();
    setSnapshotSummary(summarizeSnapshot(result.snapshot));
    toast.success("本地桥快照已读取");
  };

  const handleDemoApproval = async () => {
    const op: CanvasAgentOp = {
      type: "asset.add",
      asset: {
        kind: "text",
        title: "本地 Agent 桥测试",
        text: "这是一条通过本地 Agent 桥提交、需要用户审批的写操作。",
        tags: ["local-agent-bridge", "approval-test"],
        source: "agent",
      },
      canvasItem: {
        position: { x: 160, y: 160 },
        width: 320,
        height: 160,
      },
    };
    const result = await requestLocalAgentBridgeApproval({
      title: "本地 Agent 桥测试写操作",
      ops: [op],
    });
    if (result.ok) {
      toast.info("测试写操作已进入审批队列");
    } else {
      toast.error(result.errors?.join("；") || "本地桥请求失败");
    }
  };

  const handleExportManifest = () => {
    downloadJson("nextlemon-local-agent-mcp-manifest.json", getLocalAgentMcpManifest());
    toast.success("MCP 工具清单已导出");
  };

  const handleExportConfigBundle = () => {
    downloadJson("nextlemon-local-agent-bridge-config.json", getLocalAgentBridgeConfigBundle());
    toast.success("本地 Agent 配置包已导出");
  };

  const handleImportApprovalRequest = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const request = parseLocalAgentApprovalRequestJson(await file.text());
      const result = await requestLocalAgentBridgeApproval({
        ...request,
        title: request.title || `外部 MCP 请求 ${request.id}`,
      });
      if (result.ok) {
        toast.info(result.requestHash ? "外部 MCP 审批请求已进入队列，审计 hash 已保留" : "外部 MCP 审批请求已进入队列");
      } else {
        toast.error(result.errors?.join("；") || "审批请求导入失败");
      }
    } catch (error) {
      toast.error(`审批请求导入失败: ${error instanceof Error ? error.message : "未知错误"}`);
    }
  };

  return (
    <details className="border-b border-base-300/60 bg-base-100 px-3 py-2">
      <input
        ref={approvalFileInputRef}
        className="hidden"
        type="file"
        accept="application/json,.json"
        onChange={(event) => void handleImportApprovalRequest(event)}
      />
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs font-semibold">
          <ShieldCheck className="h-3.5 w-3.5 text-success" />
          本地 Agent 桥
        </span>
        <span className={`badge badge-xs ${enabled ? "badge-success" : "badge-outline"}`}>{statusLabel}</span>
      </summary>

      <div className="mt-3 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <label className="flex items-center gap-2 rounded-lg border border-base-300 p-2 text-xs">
            <input
              className="toggle toggle-primary toggle-xs"
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            启用桥
          </label>
          <label className="flex items-center gap-2 rounded-lg border border-base-300 p-2 text-xs">
            <input
              className="toggle toggle-warning toggle-xs"
              type="checkbox"
              checked={allowWriteRequests}
              disabled={!enabled}
              onChange={(event) => setAllowWriteRequests(event.target.checked)}
            />
            写请求
          </label>
        </div>

        <div className="grid grid-cols-5 gap-2">
          <button className="btn btn-ghost btn-xs gap-1" onClick={() => void handleReadSnapshot()}>
            <Eye className="h-3.5 w-3.5" />
            快照
          </button>
          <button className="btn btn-ghost btn-xs gap-1" disabled={!enabled || !allowWriteRequests} onClick={() => void handleDemoApproval()}>
            <Check className="h-3.5 w-3.5" />
            测试审批
          </button>
          <button className="btn btn-ghost btn-xs gap-1" onClick={handleExportManifest}>
            <Download className="h-3.5 w-3.5" />
            清单
          </button>
          <button className="btn btn-ghost btn-xs gap-1" onClick={handleExportConfigBundle}>
            <Code2 className="h-3.5 w-3.5" />
            配置
          </button>
          <button
            className="btn btn-ghost btn-xs gap-1"
            disabled={!enabled || !allowWriteRequests}
            onClick={() => approvalFileInputRef.current?.click()}
          >
            <Upload className="h-3.5 w-3.5" />
            导入
          </button>
        </div>

        <div className="rounded-md bg-base-200/70 p-2 text-[11px] text-base-content/55">
          <div>入口：window.nextlemonAgentBridge</div>
          <div>审计：{auditLog.length} 条</div>
          {installedAt && <div>挂载：{new Date(installedAt).toLocaleString()}</div>}
          {lastSnapshotAt && <div>快照：{new Date(lastSnapshotAt).toLocaleTimeString()}</div>}
          {lastWriteRequestAt && <div>写入：{new Date(lastWriteRequestAt).toLocaleTimeString()}</div>}
          {lastError && <div className="text-error">错误：{lastError}</div>}
          {snapshotSummary && <div className="mt-1 text-base-content/70">{snapshotSummary}</div>}
        </div>

        <div className="space-y-1">
          {LOCAL_AGENT_BRIDGE_TOOLS.map((tool) => (
            <div key={tool.name} className="flex items-center justify-between gap-2 rounded-md border border-base-300 px-2 py-1 text-[11px]">
              <span className="flex min-w-0 items-center gap-1">
                <Code2 className="h-3 w-3 text-base-content/35" />
                <span className="truncate font-mono">{tool.name}</span>
              </span>
              <span className={`badge badge-xs ${tool.write ? "badge-warning" : "badge-success"}`}>
                {tool.write ? "write" : "read"}
              </span>
            </div>
          ))}
        </div>

        {auditLog.length > 0 && (
          <div className="rounded-md border border-base-300 p-2">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-base-content/55">审计日志</span>
              <button className="btn btn-ghost btn-xs btn-circle" title="清空审计日志" onClick={clearAuditLog}>
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
            <div className="max-h-28 space-y-1 overflow-y-auto">
              {auditLog.slice(0, 6).map((entry) => (
                <div key={entry.id} className="rounded bg-base-200/70 px-2 py-1 text-[11px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{entry.message}</span>
                    <span className="text-base-content/35">{new Date(entry.createdAt).toLocaleTimeString()}</span>
                  </div>
                  <div className="text-base-content/40">{entry.type}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </details>
  );
}

function summarizeSnapshot(snapshot: unknown): string {
  if (!snapshot || typeof snapshot !== "object") return "快照已生成";
  const record = snapshot as Record<string, unknown>;
  const workflow = getRecord(record.workflow);
  const creative = getRecord(record.creative);
  const workflowNodes = Array.isArray(workflow.nodes) ? workflow.nodes.length : 0;
  const creativeAssets = Array.isArray(creative.assets) ? creative.assets.length : 0;
  const creativeItems = Array.isArray(creative.items) ? creative.items.length : 0;
  return `工作流节点 ${workflowNodes}，素材 ${creativeAssets}，画布实例 ${creativeItems}`;
}

function getRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function downloadJson(fileName: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
