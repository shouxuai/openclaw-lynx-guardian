import { useMemo, useState, type FormEvent } from "react";
import type { DecisionResponse, RiskLevel, ScoreBreakdown } from "@lynx/local-console-shared";
import { Button, Input, Select } from "antd";

import { listDecisions, type DecisionListQuery } from "../api/decisions";
import { ModalDialog } from "../components/feedback/ModalDialog";
import { StatusBadge } from "../components/feedback/StatusBadge";
import { PageHeader } from "../components/layout/PageHeader";
import { DataTable } from "../components/tables/DataTable";
import { TablePagination } from "../components/tables/TablePagination";
import { usePagedListResource } from "../hooks/usePagedListResource";
import { formatInteger } from "../utils/format";
import { getDecisionTone, renderActionBadge, renderPolicyDecisionBadge, renderRiskBadge } from "../utils/status";

interface DecisionFilters {
  action: string;
  q: string;
  riskLevel: string;
  stage: string;
}

const EMPTY_FILTERS: DecisionFilters = {
  action: "",
  q: "",
  riskLevel: "",
  stage: "",
};

const RISK_OPTIONS: Array<{ label: string; value: RiskLevel }> = [
  { label: "L0 基础", value: "L0" },
  { label: "L1 关注", value: "L1" },
  { label: "L2 中危", value: "L2" },
  { label: "L3 高危", value: "L3" },
  { label: "L4 严重", value: "L4" },
];

const STAGE_OPTIONS = [
  { label: "输入", value: "input" },
  { label: "工具", value: "tool" },
  { label: "输出", value: "output" },
];

const ACTION_OPTIONS = [
  { label: "放行", value: "allow" },
  { label: "告警", value: "warn" },
  { label: "需审批", value: "require_approval" },
  { label: "阻断", value: "deny" },
];

function buildDecisionQuery(filters: DecisionFilters): Omit<DecisionListQuery, "pageNum" | "pageSize"> {
  return {
    action: filters.action ? [filters.action] : undefined,
    q: filters.q.trim() || undefined,
    riskLevel: filters.riskLevel ? [filters.riskLevel as RiskLevel] : undefined,
    stage: filters.stage ? [filters.stage] : undefined,
  };
}

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

function formatDetailJson(value: unknown): string {
  return value ? JSON.stringify(value, null, 2) : "暂无";
}

export function DecisionsPage() {
  const [draftFilters, setDraftFilters] = useState<DecisionFilters>(EMPTY_FILTERS);
  const [appliedQuery, setAppliedQuery] = useState<Omit<DecisionListQuery, "pageNum" | "pageSize">>({});
  const [selectedDecision, setSelectedDecision] = useState<DecisionResponse | null>(null);
  const {
    items,
    loading,
    error,
    paginationProps,
    resetPaging,
    retry,
  } = usePagedListResource<DecisionResponse, DecisionListQuery>({
    loadPage: listDecisions,
    query: appliedQuery,
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    resetPaging();
    setAppliedQuery(buildDecisionQuery(draftFilters));
  }

  function handleReset(): void {
    setDraftFilters(EMPTY_FILTERS);
    resetPaging();
    setAppliedQuery({});
  }

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
      : "展示每次裁决的风险等级、动作和处置结果；证据与评分细节收纳在详情里。";
  const selectedMetadata = selectedDecision?.metadataJson;
  const selectedScriptEvidence = selectedMetadata?.scriptEvidence;
  const selectedResourceEvidence = selectedMetadata?.resourceEvidence;

  return (
    <div className="page-stack">
      <PageHeader
        title="决策观测"
        description={statusDescription}
        eyebrow="DECISION CONTROL PLANE"
      />

      <section className="summary-card-grid">
        <article className="summary-card">
          <p className="summary-card__label">待复核</p>
          <strong className="summary-card__value">{formatInteger(summary.warned)}</strong>
          <p className="summary-card__delta">告警类裁决需要查看详情证据</p>
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

      <section className="filter-panel">
        <form className="audit-filter-form audit-filter-form--compact" onSubmit={handleSubmit}>
          <label className="filter-field filter-field--search">
            <span>关键词</span>
            <Input
              allowClear
              aria-label="关键词"
              placeholder="搜索裁决 ID、规则、模块"
              value={draftFilters.q}
              onChange={(event) => setDraftFilters((current) => ({ ...current, q: event.target.value }))}
            />
          </label>
          <label className="filter-field">
            <span>风险等级</span>
            <Select
              allowClear
              aria-label="风险等级"
              options={RISK_OPTIONS}
              placeholder="全部级别"
              value={draftFilters.riskLevel || undefined}
              onChange={(value) => setDraftFilters((current) => ({ ...current, riskLevel: value ?? "" }))}
            />
          </label>
          <label className="filter-field">
            <span>裁决阶段</span>
            <Select
              allowClear
              aria-label="裁决阶段"
              options={STAGE_OPTIONS}
              placeholder="全部阶段"
              value={draftFilters.stage || undefined}
              onChange={(value) => setDraftFilters((current) => ({ ...current, stage: value ?? "" }))}
            />
          </label>
          <label className="filter-field">
            <span>执行动作</span>
            <Select
              allowClear
              aria-label="执行动作"
              options={ACTION_OPTIONS}
              placeholder="全部动作"
              value={draftFilters.action || undefined}
              onChange={(value) => setDraftFilters((current) => ({ ...current, action: value ?? "" }))}
            />
          </label>
          <div className="audit-filter-form__actions">
            <Button htmlType="submit" type="primary">应用筛选</Button>
            <Button htmlType="button" onClick={handleReset}>重置条件</Button>
          </div>
        </form>
      </section>

      <section className="table-panel">
        <div className="table-panel__header">
          <h2 className="panel__title">裁决记录</h2>
        </div>
        <DataTable
          columns={[
            { key: "decision", label: "裁决", maxWidth: 320, minWidth: 220, width: 260 },
            { key: "risk", label: "风险", maxWidth: 140, minWidth: 110, width: 120 },
            { key: "action", label: "动作", maxWidth: 150, minWidth: 118, width: 132 },
            { key: "approval", label: "审批", maxWidth: 140, minWidth: 110, width: 120 },
            { key: "block", label: "处置结果", maxWidth: 150, minWidth: 118, width: 132 },
            { key: "detail", label: "操作", maxWidth: 140, minWidth: 104, width: 116 },
          ]}
          error={error}
          loading={loading}
          onRetry={retry}
          rows={items.map((decision) => ({
            id: decision.decisionId,
            decision: (
              <div className="row-stack">
                <strong>{decision.decisionId}</strong>
                <span>{decision.stage}</span>
              </div>
            ),
            risk: renderRiskBadge(decision.riskLevel),
            action: renderActionBadge(decision.action),
            approval: formatApprovalState(decision),
            block: (
              <StatusBadge
                label={formatBlockState(decision.block)}
                tone={formatDecisionTone(decision)}
              />
            ),
            detail: (
              <button
                aria-label={`查看 ${decision.decisionId} 裁决详情`}
                className="btn btn--compact"
                type="button"
                onClick={() => setSelectedDecision(decision)}
              >
                详情
              </button>
            ),
          }))}
        />
        <TablePagination {...paginationProps} />
      </section>

      <ModalDialog
        closeLabel="关闭详情"
        open={Boolean(selectedDecision)}
        title="裁决详情"
        subtitle={selectedDecision?.decisionId ?? "查看裁决证据、仲裁器和评分轨迹。"}
        onClose={() => setSelectedDecision(null)}
      >
        <dl className="detail-panel__grid">
          {[
            { label: "裁决 ID", value: selectedDecision?.decisionId ?? "暂无" },
            { label: "阶段", value: selectedDecision?.stage ?? "暂无" },
            { label: "风险等级", value: selectedDecision ? renderRiskBadge(selectedDecision.riskLevel) : "暂无" },
            { label: "动作", value: selectedDecision ? renderActionBadge(selectedDecision.action) : "暂无" },
            { label: "审计策略", value: selectedDecision ? renderPolicyDecisionBadge(selectedDecision.audit.policyDecision, selectedDecision.audit.enforcementAction) : "暂无" },
            { label: "执行动作", value: selectedDecision ? renderActionBadge(selectedDecision.audit.enforcementAction) : "暂无" },
            { label: "审批状态", value: selectedDecision ? formatApprovalState(selectedDecision) : "暂无" },
            { label: "处置结果", value: selectedDecision ? formatBlockState(selectedDecision.block) : "暂无" },
            { label: "获胜仲裁器", value: selectedDecision?.winningArbiter ?? "暂无" },
            { label: "命中模块", value: selectedDecision && selectedDecision.matchedModules.length > 0 ? selectedDecision.matchedModules.join("；") : "暂无" },
            { label: "Matched Rules", value: selectedDecision ? formatMatchedRules(selectedDecision) : "暂无" },
            { label: "Score Breakdown", value: selectedDecision ? formatScoreBreakdown(collectScoreBreakdown(selectedDecision)) : "暂无" },
            { label: "降级原因", value: selectedDecision ? formatDegradedReason(selectedDecision) : "暂无" },
            { label: "策略版本", value: selectedMetadata?.policyVersion ? String(selectedMetadata.policyVersion) : "暂无" },
          ].map((field) => (
            <div key={field.label} className="detail-panel__field">
              <dt>{field.label}</dt>
              <dd>{field.value}</dd>
            </div>
          ))}
        </dl>
        {selectedScriptEvidence ? (
          <section className="detail-section">
            <h3>脚本预检证据</h3>
            <pre className="code-panel">{formatDetailJson(selectedScriptEvidence)}</pre>
          </section>
        ) : null}
        {selectedResourceEvidence ? (
          <section className="detail-section">
            <h3>资源策略证据</h3>
            <pre className="code-panel">{formatDetailJson(selectedResourceEvidence)}</pre>
          </section>
        ) : null}
      </ModalDialog>
    </div>
  );
}
