import { useMemo, useState, type FormEvent } from "react";
import type { DecisionResponse, RiskLevel, ScoreBreakdown } from "@lynx/local-console-shared";
import { Button, Card, Input, Select, Typography } from "antd";

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

const MODULE_LABELS: Record<string, string> = {
  M2: "受保护资源访问",
  M3: "高风险代理/权限操作",
  approval_bypass: "绕过审批意图",
  chain_context: "链路上下文风险",
  protected_file_access: "访问受保护文件",
  concealed_execution: "隐藏执行意图",
  evasive_intent_cn: "中文规避意图",
  output_sensitive_data: "输出敏感信息",
  plugin_integrity: "插件完整性风险",
  secret_leak: "敏感信息泄露",
  semantic: "语义风险信号",
};

const STAGE_LABELS: Record<string, string> = {
  input: "输入",
  tool: "工具",
  tool_call: "工具",
  output: "输出",
  assistant_output: "输出",
};

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

function formatRiskText(decision: DecisionResponse): string {
  const labels: Record<string, string> = {
    L0: "L0 基础",
    L1: "L1 关注",
    L2: "L2 中危",
    L3: "L3 高危",
    L4: "L4 严重",
  };
  return labels[decision.riskLevel] ?? decision.riskLevel;
}

function formatMatchedModulesText(decision: DecisionResponse): string {
  if (decision.matchedModules.length === 0) {
    return "暂无明确模块";
  }
  return decision.matchedModules
    .map((module) => MODULE_LABELS[module] ? `${MODULE_LABELS[module]}（${module}）` : module)
    .join("、");
}

function formatPlainDecisionReason(decision: DecisionResponse): string {
  if (decision.riskLevel === "L4" || decision.block || decision.action === "deny") {
    return "处置结果是拒绝或阻断。L4 是硬拒绝，不能审批放行。";
  }
  if (decision.requiresApproval || decision.action === "require_approval") {
    return "处置结果是需要人工审批，不是直接放行；审批通过后才可能产生后续放行记录。L4 是硬拒绝，不能审批放行。";
  }
  if (decision.action === "allow") {
    return "处置结果是允许继续，但仍保留这次判断依据，方便之后回看为什么没有拦截。L4 是硬拒绝，不能审批放行。";
  }
  return "处置结果不是直接阻断，会保留证据供人工复核。L4 是硬拒绝，不能审批放行。";
}

function formatDecisionReason(decision: DecisionResponse): string {
  return `这次被判为 ${formatRiskText(decision)}，因为命中了 ${formatMatchedModulesText(decision)}。${formatPlainDecisionReason(decision)}`;
}

function formatDecisionStage(stage: string): string {
  return STAGE_LABELS[stage] ?? stage;
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
      : undefined;
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

      <section className="summary-card-grid decision-summary-grid">
        <article className="summary-card">
          <p className="summary-card__label">待复核</p>
          <strong className="summary-card__value">{formatInteger(summary.warned)}</strong>
        </article>
        <article className="summary-card">
          <p className="summary-card__label">已阻断</p>
          <strong className="summary-card__value">{formatInteger(summary.blocked)}</strong>
        </article>
        <article className="summary-card">
          <p className="summary-card__label">需要审批</p>
          <strong className="summary-card__value">{formatInteger(summary.approvals)}</strong>
        </article>
      </section>

      <section className="filter-panel">
        <form className="audit-filter-form audit-filter-form--compact" onSubmit={handleSubmit}>
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
          <div className="audit-filter-form__actions">
            <Button htmlType="submit" type="primary">应用筛选</Button>
            <Button htmlType="button" onClick={handleReset}>重置条件</Button>
          </div>
        </form>
      </section>

      <Card className="table-explanation-card" size="small" title="裁决记录说明">
        <Typography.Paragraph>
          回答“系统为什么这么判”：列表保留裁决、决策理由、风险、动作、审批和处置结果；告警类裁决需要查看详情证据时进入详情。
        </Typography.Paragraph>
      </Card>

      <section className="table-panel">
        <div className="table-panel__header">
          <h2 className="panel__title">裁决记录</h2>
        </div>
        <DataTable
          columns={[
            { key: "decision", label: "裁决", maxWidth: 260, minWidth: 190, width: 220 },
            { key: "reason", label: "决策理由", maxWidth: 410, minWidth: 280, width: 352 },
            { key: "risk", label: "风险", maxWidth: 116, minWidth: 92, width: 102 },
            { key: "action", label: "动作", maxWidth: 116, minWidth: 92, width: 102 },
            { key: "approval", label: "审批", maxWidth: 118, minWidth: 94, width: 104 },
            { key: "block", label: "处置结果", maxWidth: 128, minWidth: 104, width: 112 },
            { key: "detail", label: "操作", maxWidth: 120, minWidth: 96, width: 104 },
          ]}
          error={error}
          loading={loading}
          onRetry={retry}
          rows={items.map((decision) => ({
            id: decision.decisionId,
            decision: (
              <div className="row-stack">
                <strong>{decision.decisionId}</strong>
                <span>{formatDecisionStage(decision.stage)}</span>
              </div>
            ),
            reason: <span className="table-cell-clamp table-cell-clamp--3">{formatDecisionReason(decision)}</span>,
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
        size="wide"
        title="裁决详情"
        subtitle={selectedDecision?.decisionId ?? "查看裁决证据、仲裁器和评分轨迹。"}
        onClose={() => setSelectedDecision(null)}
      >
        {selectedDecision ? (
          <div className="audit-detail-dialog">
            <section className="audit-detail-dialog__hero">
              <div className="audit-detail-dialog__heroText">
                <p className="audit-detail-dialog__eyebrow">裁决概览</p>
                <p className="audit-detail-dialog__heroSubtitle">{selectedDecision.decisionId}</p>
              </div>
              <div className="audit-detail-dialog__chips" aria-label="裁决概览标签">
                <span className="audit-detail-dialog__chip">
                  <span className="audit-detail-dialog__chipLabel">裁决阶段</span>
                  <span className="audit-detail-dialog__chipValue">{formatDecisionStage(selectedDecision.stage)}</span>
                </span>
                <span className="audit-detail-dialog__chip">
                  <span className="audit-detail-dialog__chipLabel">风险等级</span>
                  <span className="audit-detail-dialog__chipValue">{renderRiskBadge(selectedDecision.riskLevel)}</span>
                </span>
                <span className="audit-detail-dialog__chip">
                  <span className="audit-detail-dialog__chipLabel">执行动作</span>
                  <span className="audit-detail-dialog__chipValue">{renderActionBadge(selectedDecision.action)}</span>
                </span>
                <span className="audit-detail-dialog__chip">
                  <span className="audit-detail-dialog__chipLabel">处置结果</span>
                  <span className="audit-detail-dialog__chipValue">
                    <StatusBadge label={formatBlockState(selectedDecision.block)} tone={formatDecisionTone(selectedDecision)} />
                  </span>
                </span>
                <span className="audit-detail-dialog__chip">
                  <span className="audit-detail-dialog__chipLabel">审批状态</span>
                  <span className="audit-detail-dialog__chipValue">{formatApprovalState(selectedDecision)}</span>
                </span>
              </div>
            </section>

            <section className="audit-detail-dialog__section">
              <div className="panel__header audit-detail-dialog__sectionHeader">
                <div>
                  <h2 className="panel__title">基础信息</h2>
                  <p className="panel__subtitle">裁决阶段、审计策略、审批状态和降级上下文。</p>
                </div>
              </div>
              <dl className="detail-panel__grid audit-detail-dialog__summary-grid">
                {[
                  { label: "裁决 ID", value: selectedDecision.decisionId },
                  { label: "阶段", value: formatDecisionStage(selectedDecision.stage) },
                  { label: "风险等级", value: renderRiskBadge(selectedDecision.riskLevel) },
                  { label: "动作", value: renderActionBadge(selectedDecision.action) },
                  { label: "审计策略", value: renderPolicyDecisionBadge(selectedDecision.audit.policyDecision, selectedDecision.audit.enforcementAction) },
                  { label: "执行动作", value: renderActionBadge(selectedDecision.audit.enforcementAction) },
                  { label: "审批状态", value: formatApprovalState(selectedDecision) },
                  { label: "处置结果", value: formatBlockState(selectedDecision.block) },
                  { label: "降级原因", value: formatDegradedReason(selectedDecision) },
                  { label: "策略版本", value: selectedMetadata?.policyVersion ? String(selectedMetadata.policyVersion) : "暂无" },
                ].map((field) => (
                  <div key={field.label} className="detail-panel__field">
                    <dt>{field.label}</dt>
                    <dd>{field.value}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section className="audit-detail-dialog__section">
              <div className="panel__header audit-detail-dialog__sectionHeader">
                <div>
                  <h2 className="panel__title">评分与证据</h2>
                  <p className="panel__subtitle">命中模块、规则和分数变化，用来复核裁决来源。</p>
                </div>
              </div>
              <dl className="detail-panel__grid audit-detail-dialog__summary-grid">
                {[
                  { label: "获胜仲裁器", value: selectedDecision.winningArbiter },
                  { label: "命中模块", value: formatMatchedModulesText(selectedDecision) },
                  { label: "Matched Rules", value: formatMatchedRules(selectedDecision) },
                  { label: "Score Breakdown", value: formatScoreBreakdown(collectScoreBreakdown(selectedDecision)) },
                ].map((field) => (
                  <div key={field.label} className="detail-panel__field">
                    <dt>{field.label}</dt>
                    <dd>{field.value}</dd>
                  </div>
                ))}
              </dl>
            </section>

            {selectedScriptEvidence ? (
              <section className="audit-detail-dialog__section">
                <div className="panel__header audit-detail-dialog__sectionHeader">
                  <div>
                    <h2 className="panel__title">脚本预检证据</h2>
                    <p className="panel__subtitle">脚本风险扫描返回的结构化证据。</p>
                  </div>
                </div>
                <pre className="code-panel audit-detail-dialog__json">{formatDetailJson(selectedScriptEvidence)}</pre>
              </section>
            ) : null}
            {selectedResourceEvidence ? (
              <section className="audit-detail-dialog__section">
                <div className="panel__header audit-detail-dialog__sectionHeader">
                  <div>
                    <h2 className="panel__title">资源策略证据</h2>
                    <p className="panel__subtitle">受保护资源策略返回的结构化证据。</p>
                  </div>
                </div>
                <pre className="code-panel audit-detail-dialog__json">{formatDetailJson(selectedResourceEvidence)}</pre>
              </section>
            ) : null}
          </div>
        ) : null}
      </ModalDialog>
    </div>
  );
}
