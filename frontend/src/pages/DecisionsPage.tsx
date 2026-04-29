import { startTransition, useEffect, useMemo, useState } from "react";
import type { DecisionResponse, ScoreBreakdown } from "@lynx/local-console-shared";

import { listDecisions } from "../api/decisions";
import { StatusBadge } from "../components/feedback/StatusBadge";
import { PageHeader } from "../components/layout/PageHeader";
import { DataTable } from "../components/tables/DataTable";
import { formatInteger } from "../utils/format";
import { getDecisionTone, renderActionBadge, renderPolicyDecisionBadge, renderRiskBadge } from "../utils/status";

const EMPTY_DECISIONS: DecisionResponse[] = [];

function formatBlockState(block: boolean): string {
  return block ? "已阻断" : "未阻断";
}

function formatDecisionTone(decision: DecisionResponse): "neutral" | "info" | "warning" | "danger" | "success" {
  const tone = getDecisionTone({
    action: decision.action,
    block: decision.block,
    degraded: Boolean(decision.degraded),
    enforcementAction: decision.audit.enforcementAction,
    eventSeverity: decision.audit.eventSeverity,
    requiresApproval: decision.requiresApproval,
    riskLevel: decision.riskLevel,
  });

  if (tone === "error") {
    return "danger";
  }
  if (tone === "warning") {
    return "warning";
  }
  if (tone === "processing") {
    return "info";
  }
  return decision.action === "allow" ? "success" : "neutral";
}

function collectScoreBreakdown(decision: DecisionResponse): ScoreBreakdown[] {
  return decision.arbiters.flatMap((arbiter) => arbiter.scoreBreakdown ?? []);
}

function formatScoreDelta(delta: number): string {
  return delta >= 0 ? `+${formatInteger(delta)}` : formatInteger(delta);
}

function formatScoreBreakdown(breakdown: ScoreBreakdown[]): string {
  if (breakdown.length === 0) {
    return "暂无评分细节";
  }

  return breakdown
    .map((item) => `${item.ruleId} ${formatScoreDelta(item.delta)}`)
    .join("；");
}

function collectMatchedRules(decision: DecisionResponse): string[] {
  const rules = new Set<string>();
  for (const arbiter of decision.arbiters) {
    for (const evidence of arbiter.evidence ?? []) {
      if (evidence.id) {
        rules.add(evidence.id);
      }
    }
    for (const score of arbiter.scoreBreakdown ?? []) {
      if (score.ruleId) {
        rules.add(score.ruleId);
      }
    }
  }
  return Array.from(rules);
}

function formatMatchedRules(decision: DecisionResponse): string {
  const rules = collectMatchedRules(decision);
  return rules.length > 0 ? rules.join(", ") : "暂无";
}

function formatApprovalState(decision: DecisionResponse): string {
  return decision.requiresApproval ? "需要审批" : "无需审批";
}

function formatDegradedReason(decision: DecisionResponse): string {
  if (!decision.degraded) {
    return "无降级";
  }

  return decision.degraded.reason || "后端降级但已记录裁决";
}

export function DecisionsPage() {
  const [items, setItems] = useState<DecisionResponse[]>(EMPTY_DECISIONS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const abortController = new AbortController();

    async function loadDecisions() {
      try {
        const nextItems = await listDecisions();
        if (abortController.signal.aborted) {
          return;
        }
        startTransition(() => {
          setItems(nextItems);
          setError(null);
          setLoading(false);
        });
      } catch (loadError) {
        if (abortController.signal.aborted) {
          return;
        }
        startTransition(() => {
          setItems(EMPTY_DECISIONS);
          setError(loadError instanceof Error ? loadError.message : "决策记录加载失败");
          setLoading(false);
        });
      }
    }

    void loadDecisions();
    return () => abortController.abort();
  }, []);

  const summary = useMemo(() => {
    const warned = items.filter((item) => !item.block && item.audit.eventSeverity === "warn").length;
    const blocked = items.filter((item) => item.block).length;
    const approvals = items.filter((item) => item.requiresApproval).length;
    return { warned, blocked, approvals };
  }, [items]);

  const statusDescription = error
    ? `决策记录加载失败：${error}`
    : loading
      ? "正在加载 Go 控制面裁决记录"
      : "展示每次裁决的风险等级、动作、仲裁器、证据和评分轨迹。";

  return (
    <div className="page-stack">
      <PageHeader
        title="决策观测"
        description={statusDescription}
        eyebrow="DECISION CONTROL PLANE"
      />

      <section className="summary-card-grid">
        <article className="summary-card">
          <p className="summary-card__label">未阻断告警</p>
          <strong className="summary-card__value">{formatInteger(summary.warned)}</strong>
          <p className="summary-card__delta">未阻断告警仍需复核风险和证据</p>
        </article>
        <article className="summary-card">
          <p className="summary-card__label">已阻断</p>
          <strong className="summary-card__value">{formatInteger(summary.blocked)}</strong>
          <p className="summary-card__unit">L4 / deny / block</p>
        </article>
        <article className="summary-card">
          <p className="summary-card__label">需要审批</p>
          <strong className="summary-card__value">{formatInteger(summary.approvals)}</strong>
          <p className="summary-card__unit">allow-current-chain 前置状态</p>
        </article>
      </section>

      <section className="table-panel">
        <div className="table-panel__header">
          <h2 className="panel__title">裁决记录</h2>
          <span className="small-note">block:false 只表示未阻断，不等于安全</span>
        </div>
        <DataTable
          columns={[
            { key: "decision", label: "Decision ID", maxWidth: 260, minWidth: 180, width: 220 },
            { key: "stage", label: "阶段", maxWidth: 140, minWidth: 110, width: 120 },
            { key: "risk", label: "风险", maxWidth: 140, minWidth: 110, width: 120 },
            { key: "action", label: "动作", maxWidth: 150, minWidth: 118, width: 132 },
            { key: "policy", label: "Policy", maxWidth: 160, minWidth: 128, width: 144 },
            { key: "enforcement", label: "Enforcement", maxWidth: 160, minWidth: 128, width: 144 },
            { key: "approval", label: "审批", maxWidth: 140, minWidth: 110, width: 120 },
            { key: "block", label: "阻断", maxWidth: 140, minWidth: 110, width: 120 },
            { key: "arbiter", label: "获胜仲裁器", maxWidth: 180, minWidth: 140, width: 160 },
            { key: "modules", label: "命中模块", maxWidth: 220, minWidth: 160, width: 190 },
            { key: "rules", label: "Matched Rules", maxWidth: 260, minWidth: 190, width: 230 },
            { key: "score", label: "评分轨迹", maxWidth: 320, minWidth: 230, width: 280 },
            { key: "degraded", label: "降级原因", maxWidth: 240, minWidth: 180, width: 210 },
          ]}
          rows={items.map((decision) => ({
            id: decision.decisionId,
            decision: decision.decisionId,
            stage: decision.stage,
            risk: renderRiskBadge(decision.riskLevel),
            action: renderActionBadge(decision.action),
            policy: renderPolicyDecisionBadge(decision.audit.policyDecision, decision.audit.enforcementAction),
            enforcement: renderActionBadge(decision.audit.enforcementAction),
            approval: formatApprovalState(decision),
            block: (
              <StatusBadge
                label={formatBlockState(decision.block)}
                tone={formatDecisionTone(decision)}
              />
            ),
            arbiter: decision.winningArbiter,
            modules: decision.matchedModules.length > 0 ? decision.matchedModules.join(", ") : "暂无",
            rules: formatMatchedRules(decision),
            score: formatScoreBreakdown(collectScoreBreakdown(decision)),
            degraded: formatDegradedReason(decision),
          }))}
        />
      </section>
    </div>
  );
}
