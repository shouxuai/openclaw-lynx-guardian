import { useMemo, useState, type FormEvent } from "react";
import type { AuditEventDetailDto, AuditEventListItemDto, EnforcementAction, RiskLevel } from "@lynx/local-console-shared";
import { Button, DatePicker, Input, Select } from "antd";
import type { Dayjs } from "dayjs";

import { getEventDetail, listEvents, type EventListQuery } from "../api/events";
import { mockEvents } from "../data/mock-console";
import { ModalDialog } from "../components/feedback/ModalDialog";
import { PageHeader } from "../components/layout/PageHeader";
import { DataTable } from "../components/tables/DataTable";
import { TablePagination } from "../components/tables/TablePagination";
import { paginateMockPage, usePagedListResource } from "../hooks/usePagedListResource";
import { formatInteger, formatTimestamp } from "../utils/format";
import { formatQaRecordId } from "../utils/qa-records";
import {
  formatActionText,
  formatEventCategoryLabel,
  formatHookLabel,
  renderActionBadge,
  renderPolicyDecisionBadge,
  renderRiskBadge,
} from "../utils/status";

const DEFAULT_PAGE_SIZE = 10;
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
const { RangePicker } = DatePicker;

type DateRangeValue = [Dayjs | null, Dayjs | null] | null;

interface EventFilters {
  q: string;
  riskLevel: string;
  category: string;
  enforcementAction: string;
  dateRange: DateRangeValue;
}

const EMPTY_FILTERS: EventFilters = {
  q: "",
  riskLevel: "",
  category: "",
  enforcementAction: "",
  dateRange: null,
};

const RISK_OPTIONS: Array<{ label: string; value: RiskLevel }> = [
  { label: "L0 基础", value: "L0" },
  { label: "L1 关注", value: "L1" },
  { label: "L2 中危", value: "L2" },
  { label: "L3 高危", value: "L3" },
  { label: "L4 严重", value: "L4" },
];

const CATEGORY_OPTIONS = [
  { label: "执行控制", value: "execution_control" },
  { label: "敏感数据", value: "pii_redaction" },
  { label: "提示注入", value: "prompt_injection" },
  { label: "检查任务", value: "lynx_check" },
  { label: "工具事件", value: "tool" },
  { label: "会话输入", value: "input" },
  { label: "Agent 事件", value: "agent" },
];

const ACTION_OPTIONS: Array<{ label: string; value: EnforcementAction }> = [
  { label: "放行", value: "allow" },
  { label: "告警", value: "warn" },
  { label: "脱敏", value: "redact" },
  { label: "需审批", value: "requireApproval" },
  { label: "阻断", value: "block" },
  { label: "仅记录", value: "logOnly" },
];

export function buildDateRangeQuery(value: DateRangeValue): Pick<EventListQuery, "fromMs" | "toMs"> {
  const [fromDate, toDate] = value ?? [];

  return {
    fromMs: fromDate?.startOf("day").valueOf(),
    toMs: toDate?.endOf("day").valueOf(),
  };
}

function buildEventQuery(filters: EventFilters): EventListQuery {
  return {
    q: filters.q.trim() || undefined,
    riskLevel: filters.riskLevel ? [filters.riskLevel as RiskLevel] : undefined,
    category: filters.category || undefined,
    enforcementAction: filters.enforcementAction ? [filters.enforcementAction as EnforcementAction] : undefined,
    ...buildDateRangeQuery(filters.dateRange),
  };
}

function eventMatchesQuery(event: AuditEventListItemDto, query: EventListQuery): boolean {
  if (query.fromMs !== undefined && event.occurredAtMs < query.fromMs) {
    return false;
  }
  if (query.toMs !== undefined && event.occurredAtMs > query.toMs) {
    return false;
  }
  if (query.riskLevel?.length && (!event.riskLevel || !query.riskLevel.includes(event.riskLevel))) {
    return false;
  }
  if (query.category && event.category !== query.category) {
    return false;
  }
  if (query.enforcementAction?.length && !query.enforcementAction.includes(event.enforcementAction)) {
    return false;
  }

  const keyword = query.q?.trim().toLowerCase();
  if (!keyword) {
    return true;
  }

  return [
    event.eventId,
    event.sessionKey,
    event.runId,
    event.toolCallId,
    event.approvalId,
    event.requestId,
    event.hookName,
    event.eventType,
    event.category,
    event.subCategory,
    event.primaryModule,
    event.policyDecision,
    event.enforcementAction,
    event.title,
    event.summary,
    event.recommendation,
    event.contentExcerpt,
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(keyword));
}

function pageMockEvents(query: EventListQuery, pageIndex: number, pageSize: number) {
  return paginateMockPage(
    mockEvents.filter((event) => eventMatchesQuery(event, query)),
    pageIndex,
    pageSize,
  );
}

function resolveEventExcerpt(event: AuditEventListItemDto): string {
  return event.contentExcerpt ?? event.summary ?? formatActionText(event.enforcementAction);
}

function resolveEventRecommendation(event: AuditEventListItemDto): string {
  return event.recommendation ?? event.summary ?? formatActionText(event.enforcementAction);
}

function formatDetailJson(value: Record<string, unknown> | undefined): string {
  return value ? JSON.stringify(value, null, 2) : "暂无";
}

function formatUnknownList(value: unknown): string {
  if (Array.isArray(value)) {
    return value.length > 0 ? value.map((item) => String(item)).join("；") : "暂无";
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  return "暂无";
}

function formatUnknownScalar(value: unknown): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "暂无";
}

function formatScoreBreakdown(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) {
    return "暂无";
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return String(entry);
      }
      const record = entry as Record<string, unknown>;
      const ruleId = String(record.ruleId ?? record.rule_id ?? "unknown_rule");
      const delta = Number(record.delta ?? record.scoreDelta ?? record.score_delta ?? 0);
      return `${ruleId} ${delta >= 0 ? "+" : ""}${delta}`;
    })
    .join("；");
}

function formatEvidenceSummary(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) {
    return "暂无";
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return String(entry);
      }
      const record = entry as Record<string, unknown>;
      return String(record.id ?? record.ruleId ?? record.module ?? record.kind ?? "unknown_evidence");
    })
    .join("；");
}

function renderReportContent(value: string | undefined) {
  const report = value?.trim();
  if (!report) {
    return <pre className="code-panel code-panel--report">暂无</pre>;
  }

  return (
    <div className="code-panel code-panel--report">
      {report.split(/\r?\n/).map((line, index) => (
        <p key={`${index}:${line}`}>{line || "\u00a0"}</p>
      ))}
    </div>
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function hasDisplayValue(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  return true;
}

function pushControlSignal(parts: string[], label: string, value: unknown): void {
  if (!hasDisplayValue(value)) {
    return;
  }
  parts.push(`${label}:${Array.isArray(value) || typeof value === "string" ? formatUnknownList(value) : String(value)}`);
}

function formatControlPlaneSummary(event: AuditEventListItemDto): string {
  const payload = asRecord((event as AuditEventDetailDto).payloadJson);
  const listFields = event as AuditEventListItemDto & Record<string, unknown>;
  const winningArbiter =
    payload?.winningArbiter
    ?? payload?.winning_arbiter
    ?? listFields.winningArbiter
    ?? listFields.winning_arbiter;
  const matchedRules =
    payload?.matchedRules
    ?? payload?.matched_rules
    ?? payload?.matchedModules
    ?? payload?.matched_modules
    ?? listFields.matchedRules
    ?? listFields.matched_rules
    ?? listFields.matchedModules
    ?? listFields.matched_modules;
  const scoreBreakdown =
    payload?.scoreBreakdown
    ?? payload?.score_breakdown
    ?? listFields.scoreBreakdown
    ?? listFields.score_breakdown;
  const evidence =
    payload?.evidence
    ?? payload?.evidenceItems
    ?? payload?.evidence_items
    ?? listFields.evidence
    ?? listFields.evidenceItems
    ?? listFields.evidence_items;
  const parts: string[] = [];

  pushControlSignal(parts, "arbiter", winningArbiter);
  pushControlSignal(parts, "rules", matchedRules);
  if (hasDisplayValue(scoreBreakdown)) {
    pushControlSignal(parts, "trace", formatScoreBreakdown(scoreBreakdown));
  }
  if (hasDisplayValue(evidence)) {
    pushControlSignal(parts, "evidence", formatEvidenceSummary(evidence));
  }
  pushControlSignal(parts, "module", event.primaryModule);
  pushControlSignal(parts, "score", event.riskScore);
  pushControlSignal(parts, "request", event.requestId);
  pushControlSignal(parts, "approval", event.approvalId);
  pushControlSignal(parts, "tool", event.toolCallId);
  pushControlSignal(parts, "decision", event.policyDecision);

  if (parts.length > 0) {
    return parts.join("；");
  }

  return payload
    ? "列表 Payload 未包含控制面证据"
    : "列表未包含控制面证据；打开详情查看完整证据";
}

export function EventsPage() {
  const [draftFilters, setDraftFilters] = useState<EventFilters>(EMPTY_FILTERS);
  const [appliedQuery, setAppliedQuery] = useState<EventListQuery>({});
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedDetail, setSelectedDetail] = useState<AuditEventDetailDto | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  function clearDetailState(): void {
    setSelectedDetail(null);
    setDetailError(null);
    setDetailLoadingId(null);
  }

  const { items, loading, error, paginationProps, resetPaging, retry } = usePagedListResource<
    AuditEventListItemDto,
    EventListQuery
  >({
    fallbackPage: import.meta.env.DEV ? pageMockEvents : undefined,
    initialPageSize: DEFAULT_PAGE_SIZE,
    loadPage: listEvents,
    onPageBoundaryChange: clearDetailState,
    pageSizeOptions: PAGE_SIZE_OPTIONS,
    query: appliedQuery,
    refreshKey,
  });

  const pageSummary = useMemo(() => {
    const highRiskCount = items.filter((event) => event.riskLevel === "L3" || event.riskLevel === "L4").length;
    const reviewCount = items.filter((event) => event.enforcementAction === "requireApproval").length;
    const blockCount = items.filter((event) => event.enforcementAction === "block").length;

    return {
      total: items.length,
      highRiskCount,
      reviewCount,
      blockCount,
    };
  }, [items]);

  const hasActiveFilters = Boolean(
    appliedQuery.q
    || appliedQuery.riskLevel?.length
    || appliedQuery.category
    || appliedQuery.enforcementAction?.length
    || appliedQuery.fromMs !== undefined
    || appliedQuery.toMs !== undefined,
  );
  const statusText = error
    ? `审计日志加载失败：${error}`
    : loading
      ? "正在加载审计日志"
      : "全量追踪系统操作、策略决策及风险判定记录，确保基础设施运行的透明度与合规性。";

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setDatePickerOpen(false);
    resetPaging();
    setAppliedQuery(buildEventQuery(draftFilters));
  }

  function handleReset(): void {
    setDatePickerOpen(false);
    setDraftFilters(EMPTY_FILTERS);
    resetPaging();
    setAppliedQuery({});
  }

  function handleSelectOpenChange(open: boolean): void {
    if (open) {
      setDatePickerOpen(false);
    }
  }

  function handleCloseDetail(): void {
    setSelectedDetail(null);
    setDetailError(null);
    setDetailLoadingId(null);
  }

  async function handleOpenDetail(eventId: string): Promise<void> {
    setDetailLoadingId(eventId);
    setDetailError(null);
    try {
      const detail = await getEventDetail(eventId);
      setSelectedDetail(detail);
    } catch (loadError) {
      const mockDetail = import.meta.env.DEV ? mockEvents.find((event) => event.eventId === eventId) : undefined;
      if (mockDetail) {
        setSelectedDetail(mockDetail);
        setDetailError(null);
      } else {
        setSelectedDetail(null);
        setDetailError(loadError instanceof Error ? loadError.message : "详情加载失败");
      }
    } finally {
      setDetailLoadingId(null);
    }
  }

  const isDetailDialogOpen = Boolean(selectedDetail || detailError);

  return (
    <div className="page-stack">
      <PageHeader
        title="安全审计日志"
        description={statusText}
        eyebrow="SYSTEM INTEGRITY"
        actions={(
          <Button
            className="console-action-button"
            htmlType="button"
            type="primary"
            onClick={() => setRefreshKey((value) => value + 1)}
          >
            立即刷新
          </Button>
        )}
      />

      <section className="audit-summary-grid" aria-label="当前页审计概览">
        <article className="overview-card overview-card--total">
          <div>
            <p className="overview-card__label">当前页</p>
            <strong className="overview-card__value">{formatInteger(pageSummary.total)}</strong>
          </div>
          <p className="overview-card__note">{hasActiveFilters ? "筛选结果" : "最新事件"}</p>
        </article>
        <article className="overview-card overview-card--l3">
          <div>
            <p className="overview-card__label">高危</p>
            <strong className="overview-card__value">{formatInteger(pageSummary.highRiskCount)}</strong>
          </div>
          <p className="overview-card__note">L3 / L4 事件</p>
        </article>
        <article className="overview-card overview-card--l2">
          <div>
            <p className="overview-card__label">复核</p>
            <strong className="overview-card__value">{formatInteger(pageSummary.reviewCount)}</strong>
          </div>
          <p className="overview-card__note">需要人工审批</p>
        </article>
        <article className="overview-card overview-card--l4">
          <div>
            <p className="overview-card__label">阻断</p>
            <strong className="overview-card__value">{formatInteger(pageSummary.blockCount)}</strong>
          </div>
          <p className="overview-card__note">已拒绝执行</p>
        </article>
      </section>

      <section className="filter-panel">
        <form className="audit-filter-form" onSubmit={handleSubmit}>
          <label className="filter-field filter-field--search">
            <span>关键词</span>
            <Input
              allowClear
              aria-label="关键词"
              placeholder="搜索事件 ID、标题、摘要、请求 ID"
              value={draftFilters.q}
              onChange={(event) => setDraftFilters((current) => ({ ...current, q: event.target.value }))}
            />
          </label>

          <label className="filter-field" onMouseDownCapture={() => setDatePickerOpen(false)}>
            <span>风险等级</span>
            <Select
              allowClear
              aria-label="风险等级"
              options={RISK_OPTIONS}
              placeholder="全部级别"
              value={draftFilters.riskLevel || undefined}
              onChange={(value) => setDraftFilters((current) => ({ ...current, riskLevel: value ?? "" }))}
              onOpenChange={handleSelectOpenChange}
            />
          </label>

          <label className="filter-field" onMouseDownCapture={() => setDatePickerOpen(false)}>
            <span>事件类别</span>
            <Select
              allowClear
              aria-label="事件类别"
              options={CATEGORY_OPTIONS}
              placeholder="全部分类"
              value={draftFilters.category || undefined}
              onChange={(value) => setDraftFilters((current) => ({ ...current, category: value ?? "" }))}
              onOpenChange={handleSelectOpenChange}
            />
          </label>

          <label className="filter-field" onMouseDownCapture={() => setDatePickerOpen(false)}>
            <span>策略判定</span>
            <Select
              allowClear
              aria-label="策略判定"
              options={ACTION_OPTIONS}
              placeholder="全部状态"
              value={draftFilters.enforcementAction || undefined}
              onChange={(value) => setDraftFilters((current) => ({
                ...current,
                enforcementAction: value ?? "",
              }))}
              onOpenChange={handleSelectOpenChange}
            />
          </label>

          <label className="filter-field filter-field--date-range">
            <span>发生时间</span>
            <RangePicker
              allowClear
              aria-label="发生时间"
              className="audit-date-range-picker"
              open={datePickerOpen}
              placeholder={["开始日期", "结束日期"]}
              value={draftFilters.dateRange}
              onChange={(dateRange) => setDraftFilters((current) => ({ ...current, dateRange }))}
              onOpenChange={setDatePickerOpen}
            />
          </label>

          <div className="audit-filter-form__actions">
            <Button htmlType="submit" type="primary">应用筛选</Button>
            <Button htmlType="button" onClick={handleReset}>重置条件</Button>
          </div>
        </form>
      </section>

      <section className="table-panel audit-events-table-panel" data-testid="audit-events-table-panel">
        <DataTable
          columns={[
            { key: "event", label: "事件" },
            { key: "qaRecord", label: "问答记录", maxWidth: 220, minWidth: 150, width: 180 },
            { key: "category", label: "类别" },
            { key: "risk", label: "风险等级" },
            { key: "decision", label: "策略判定" },
            { key: "action", label: "执行动作" },
            { key: "controlPlane", label: "控制面证据", maxWidth: 300, minWidth: 210, width: 260 },
            { key: "excerpt", label: "脱敏摘要" },
            { key: "recommendation", label: "处置建议" },
            { key: "time", label: "发生时间" },
            { key: "detail", label: "操作" },
          ]}
          error={error}
          loading={loading}
          onRetry={retry}
          rows={items.map((event) => ({
            id: event.eventId,
            event: (
              <div className="row-stack audit-event-title-cell">
                <strong>{event.title}</strong>
                <code>{event.eventId}</code>
              </div>
            ),
            qaRecord: formatQaRecordId(event.qaRecordId),
            category: formatEventCategoryLabel(event.category),
            risk: renderRiskBadge(event.riskLevel),
            decision: renderPolicyDecisionBadge(event.policyDecision, event.enforcementAction),
            action: renderActionBadge(event.enforcementAction),
            controlPlane: formatControlPlaneSummary(event),
            excerpt: resolveEventExcerpt(event),
            recommendation: resolveEventRecommendation(event),
            time: formatTimestamp(event.occurredAtMs),
            detail: (
              <button
                aria-label={`查看 ${event.eventId} 详情`}
                className="btn btn--compact"
                disabled={detailLoadingId === event.eventId}
                type="button"
                onClick={() => void handleOpenDetail(event.eventId)}
              >
                {detailLoadingId === event.eventId ? "加载中" : "详情"}
              </button>
            ),
          }))}
        />
        <TablePagination
          {...paginationProps}
          ariaLabel="审计日志分页"
        />
      </section>

      <ModalDialog
        closeLabel="关闭详情"
        open={isDetailDialogOpen}
        title={selectedDetail?.title ?? "事件详情"}
        subtitle={
          detailError
            ? `详情加载失败：${detailError}`
            : selectedDetail?.eventId ?? "点击表格中的“详情”查看完整记录。"
        }
        onClose={handleCloseDetail}
      >
        <dl className="detail-panel__grid audit-detail-dialog__grid">
          {[
            { label: "触发点", value: formatHookLabel(selectedDetail?.hookName) },
            { label: "关联问答记录", value: formatQaRecordId(selectedDetail?.qaRecordId) },
            {
              label: "完整脱敏摘要 / 安全审计报告",
              value: renderReportContent(selectedDetail?.contentExcerpt),
            },
            { label: "处置建议", value: selectedDetail?.recommendation ?? selectedDetail?.summary ?? "暂无" },
            { label: "模块", value: selectedDetail?.modules?.join(", ") || selectedDetail?.primaryModule || "暂无" },
            {
              label: "Decision ID",
              value: formatUnknownScalar(
                selectedDetail?.payloadJson?.decisionId
                ?? selectedDetail?.payloadJson?.decision_id
                ?? selectedDetail?.requestId,
              ),
            },
            {
              label: "Winning Arbiter",
              value: formatUnknownScalar(
                selectedDetail?.payloadJson?.winningArbiter
                ?? selectedDetail?.payloadJson?.winning_arbiter,
              ),
            },
            { label: "Matched Rules", value: formatUnknownList(selectedDetail?.payloadJson?.matchedRules ?? selectedDetail?.payloadJson?.matchedModules) },
            { label: "Score Breakdown", value: formatScoreBreakdown(selectedDetail?.payloadJson?.scoreBreakdown) },
            { label: "内容类型", value: selectedDetail?.contentKind ?? "暂无" },
            { label: "内容哈希", value: selectedDetail?.contentHash ?? "暂无" },
            { label: "入库时间", value: selectedDetail ? formatTimestamp(selectedDetail.ingestedAtMs) : "暂无" },
            {
              label: "Payload",
              value: <pre className="code-panel">{formatDetailJson(selectedDetail?.payloadJson)}</pre>,
            },
          ].map((field) => (
            <div key={field.label} className="detail-panel__field">
              <dt>{field.label}</dt>
              <dd>{field.value}</dd>
            </div>
          ))}
        </dl>
      </ModalDialog>
    </div>
  );
}
