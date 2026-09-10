import { GitBranch } from "lucide-react";
import {
  DESIGN_PLAN_COST_LABEL,
  estimateDesignPlanCost,
  layoutDesignPlanDag,
  type DesignPlanCostLevel,
} from "@/services/designPlanPlanner";
import type { DesignPlan, DesignPlanStep } from "@/types/creative";

const COST_BADGE_CLASS: Record<DesignPlanCostLevel, string> = {
  none: "badge-ghost",
  low: "badge-success",
  medium: "badge-warning",
  high: "badge-error",
};

const STATUS_DOT_CLASS: Record<DesignPlanStep["status"], string> = {
  pending: "bg-base-300",
  approved: "bg-info",
  running: "bg-warning animate-pulse",
  completed: "bg-success",
  failed: "bg-error",
  skipped: "bg-base-200",
};

export function DesignPlanDagView({ plan }: { plan: DesignPlan }) {
  const layout = layoutDesignPlanDag(plan.steps);
  const cost = estimateDesignPlanCost(plan);

  if (layout.layers.length === 0) return null;

  return (
    <div className="mt-3 rounded-md border border-base-300 bg-base-100/70 p-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 text-xs font-semibold text-base-content/60">
          <GitBranch className="h-3.5 w-3.5" />
          步骤依赖视图
        </div>
        <span
          className={`badge badge-sm ${COST_BADGE_CLASS[cost.level]}`}
          title="按步骤内最高成本档位预估"
        >
          预估成本 {DESIGN_PLAN_COST_LABEL[cost.level]}
        </span>
      </div>

      <div className="flex items-stretch gap-2 overflow-x-auto pb-1">
        {layout.layers.map((layer, layerIndex) => (
          <div key={`layer-${layerIndex}`} className="flex items-stretch gap-2">
            {layerIndex > 0 && (
              <div className="flex select-none items-center text-base-content/30">→</div>
            )}
            <div className="flex flex-col gap-2">
              {layer.map((step) => (
                <div
                  key={step.id}
                  className="w-40 flex-shrink-0 rounded-md border border-base-300 bg-base-100 p-2"
                  title={`${step.title}（${step.tool}）${step.description ? `：${step.description}` : ""}`}
                >
                  <div className="flex items-start gap-1.5">
                    <span
                      className={`mt-1 h-2 w-2 flex-shrink-0 rounded-full ${STATUS_DOT_CLASS[step.status]}`}
                    />
                    <div className="min-w-0">
                      <div className="truncate text-[11px] font-medium">{step.title}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <span
                          className={`badge badge-xs ${
                            COST_BADGE_CLASS[estimateStepCostBadge(step.estimatedCost)]
                          }`}
                        >
                          {step.estimatedCost || "无"}
                        </span>
                        {step.modelHint && (
                          <span className="max-w-[7.5rem] truncate badge badge-xs badge-outline">
                            {step.modelHint}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {layout.hasCycle && (
        <div className="mt-2 text-[11px] text-warning">
          计划依赖存在环，请先修正依赖关系后再提交审批。
        </div>
      )}
    </div>
  );
}

function estimateStepCostBadge(label?: string): DesignPlanCostLevel {
  const level = (Object.keys(DESIGN_PLAN_COST_LABEL) as DesignPlanCostLevel[]).find(
    (candidate) => DESIGN_PLAN_COST_LABEL[candidate] === label
  );
  return level || "none";
}
