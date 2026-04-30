import { useMemo, useState, type FormEvent } from "react";
import type {
  RiskLevel,
  SecurityEventDetailDto,
  SecurityEventKind,
  SecurityEventListItemDto,
} from "@lynx/local-console-shared";
import { Button, DatePicker, Input, Select } from "antd";
import type { Dayjs } from "dayjs";

import {
  getSecurityEventDetail,
  listSecurityEvents,
  type SecurityEventListQuery,
} from "../api/security-events";
import { ModalDialog } from "../components/feedback/ModalDialog";
import { PageHeader } from "../components/layout/PageHeader";
import { DataTable } from "../components/tables/DataTable";
import { TablePagination } from "../components/tables/TablePagination";
import { usePagedListResource } from "../hooks/usePagedListResource";
import { formatInteger, formatTimestamp } from "../utils/format";
import { formatQaRecordId } from "../utils/qa-records";
import { renderActionBadge, renderPolicyDecisionBadge, renderRiskBadge } from "../utils/status";

const DEFAULT_PAGE_SIZE = 10;
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
const { RangePicker } = DatePicker;

type DateRangeValue = [Dayjs | null, Dayjs | null] | null;

interface EventFilters {
  q: string;
  riskLevel: string;
  eventKind: string;
  dateRange: DateRangeValue;
}

const EMPTY_FILTERS: EventFilters = {
  q: "",
  riskLevel: "",
  eventKind: "",
  dateRange: null,
};

const RISK_OPTIONS: Array<{ label: string; value: RiskLevel }> = [
  { label: "L0 基础", value: "L0" },
  { label: "L1 关注", value: "L1" },
  { label: "L2 中危", value: "L2" },
  { label: "L3 高危", value: "L3" },
  { label: "L4 严重", value: "L4" },
];

const RISK_SUMMARY_CARDS: Array<{
  riskLevel: RiskLevel;
  label: string;
  note: string;
  cssClass: string;
}> = [
  { riskLevel: "L0", label: "L0", note: "基础", cssClass: "overview-card--l0" },
  { riskLevel: "L1", label: "L1", note: "关注", cssClass: "overview-card--l1" },
  { riskLevel: "L2", label: "L2", note: "中危", cssClass: "overview-card--l2" },
  { riskLevel: "L3", label: "L3", note: "高危", cssClass: "overview-card--l3" },
  { riskLevel: "L4", label: "L4", note: "严重", cssClass: "overview-card--l4" },
];

const EVENT_KIND_OPTIONS: Array<{ label: string; value: SecurityEventKind }> = [
  { label: "输入", value: "input" },
  { label: "工具", value: "tool" },
  { label: "输出", value: "output" },
  { label: "安装", value: "install" },
  { label: "过程", value: "process" },
];

const EVENT_KIND_LABELS: Record<SecurityEventKind, string> = {
  input: "输入",
  tool: "工具",
  output: "输出",
  install: "安装",
  process: "过程",
};

const PROCESS_KIND_LABELS: Record<string, string> = {
  conversation: "会话",
  skill_install: "Skill 安装",
  plugin_install: "插件安装",
  lynx_check: "检测任务",
  approval: "审批",
  batch_operation: "批量操作",
  other: "其他",
};

export function buildDateRangeQuery(value: DateRangeValue): Pick<SecurityEventListQuery, "fromMs" | "toMs"> {
  const [fromDate, toDate] = value ?? [];

  return {
    fromMs: fromDate?.startOf("day").valueOf(),
    toMs: toDate?.endOf("day").valueOf(),
  };
}

function buildEventQuery(filters: EventFilters): SecurityEventListQuery {
  return {
    q: filters.q.trim() || undefined,
    riskLevel: filters.riskLevel ? [filters.riskLevel as RiskLevel] : undefined,
    eventKind: filters.eventKind ? filters.eventKind as SecurityEventKind : undefined,
    ...buildDateRangeQuery(filters.dateRange),
  };
}

function formatEventKind(kind: SecurityEventKind): string {
  return EVENT_KIND_LABELS[kind] ?? kind;
}

function formatProcessKind(kind: string): string {
  return PROCESS_KIND_LABELS[kind] ?? kind;
}

function formatProcessCell(event: SecurityEventListItemDto): string {
  const processLabel = formatProcessKind(event.processKind);
  if (event.eventKind === "tool") {
    return processLabel;
  }
  return `${processLabel} · ${formatEventKind(event.eventKind)}`;
}

function resolveObjectText(event: SecurityEventListItemDto): string {
  return event.objectLabel ?? event.contentExcerpt ?? event.summary ?? event.title;
}

function formatRawEvidence(event: SecurityEventListItemDto): string {
  return `${formatInteger(event.rawAuditCount)} 条`;
}

function formatDetailJson(value: Record<string, unknown> | undefined): string {
  return value ? JSON.stringify(value, null, 2) : "暂无";
}

export function EventsPage() {
  const [draftFilters, setDraftFilters] = useState<EventFilters>(EMPTY_FILTERS);
  const [appliedQuery, setAppliedQuery] = useState<SecurityEventListQuery>({});
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedDetail, setSelectedDetail] = useState<SecurityEventDetailDto | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  function clearDetailState(): void {
    setSelectedDetail(null);
    setDetailError(null);
    setDetailLoadingId(null);
  }

  const { items, loading, error, paginationProps, resetPaging, retry } = usePagedListResource<
    SecurityEventListItemDto,
    SecurityEventListQuery
  >({
    initialPageSize: DEFAULT_PAGE_SIZE,
    loadPage: listSecurityEvents,
    onPageBoundaryChange: clearDetailState,
    pageSizeOptions: PAGE_SIZE_OPTIONS,
    query: appliedQuery,
    refreshKey,
  });

  const pageSummary = useMemo(() => {
    const riskCounts = Object.fromEntries(
      RISK_SUMMARY_CARDS.map((card) => [
        card.riskLevel,
        items.filter((event) => event.riskLevel === card.riskLevel).length,
      ]),
    ) as Record<RiskLevel, number>;

    return {
      total: items.length,
      riskCounts,
    };
  }, [items]);

  const statusText = error
    ? `安全事件加载失败：${error}`
    : loading
      ? "正在加载安全事件"
      : "按用户能感知的输入检查、工具调用检查、输出检查、安装和任务过程展示安全事件。";

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    resetPaging();
    setAppliedQuery(buildEventQuery(draftFilters));
  }

  function handleReset(): void {
    setDraftFilters(EMPTY_FILTERS);
    resetPaging();
    setAppliedQuery({});
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
      const detail = await getSecurityEventDetail(eventId);
      setSelectedDetail(detail);
    } catch (loadError) {
      setSelectedDetail(null);
      setDetailError(loadError instanceof Error ? loadError.message : "详情加载失败");
    } finally {
      setDetailLoadingId(null);
    }
  }

  const isDetailDialogOpen = Boolean(selectedDetail || detailError);

  return (
    <div className="page-stack">
      <PageHeader
        title="审计日志"
        description={statusText}
        eyebrow="SECURITY EVENTS"
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

      <section className="audit-summary-grid" aria-label="当前页安全事件概览">
        <article className="overview-card overview-card--total">
          <div>
            <p className="overview-card__label">当前页</p>
            <strong className="overview-card__value">{formatInteger(pageSummary.total)}</strong>
          </div>
          <p className="overview-card__note">安全事件</p>
        </article>
        {RISK_SUMMARY_CARDS.map((card) => (
          <article key={card.riskLevel} className={`overview-card ${card.cssClass}`}>
            <div>
              <p className="overview-card__label">{card.label}</p>
              <strong className="overview-card__value">
                {formatInteger(pageSummary.riskCounts[card.riskLevel])}
              </strong>
            </div>
            <p className="overview-card__note">{card.note}</p>
          </article>
        ))}
      </section>

      <section className="filter-panel">
        <form className="audit-filter-form" onSubmit={handleSubmit}>
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
            <span>事件类型</span>
            <Select
              allowClear
              aria-label="事件类型"
              options={EVENT_KIND_OPTIONS}
              placeholder="全部类型"
              value={draftFilters.eventKind || undefined}
              onChange={(value) => setDraftFilters((current) => ({ ...current, eventKind: value ?? "" }))}
            />
          </label>

          <label className="filter-field filter-field--search">
            <span>关键词</span>
            <Input
              allowClear
              aria-label="关键词"
              placeholder="搜索事件 ID、标题、摘要、对象"
              value={draftFilters.q}
              onChange={(event) => setDraftFilters((current) => ({ ...current, q: event.target.value }))}
            />
          </label>

          <label className="filter-field filter-field--date-range">
            <span>发生时间</span>
            <RangePicker
              allowClear
              aria-label="发生时间"
              className="audit-date-range-picker"
              placeholder={["开始日期", "结束日期"]}
              value={draftFilters.dateRange}
              onChange={(dateRange) => setDraftFilters((current) => ({ ...current, dateRange }))}
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
            { key: "time", label: "时间" },
            { key: "type", label: "事件类型" },
            { key: "process", label: "过程" },
            { key: "object", label: "对象/内容", maxWidth: 420, minWidth: 260, width: 340 },
            { key: "risk", label: "风险等级" },
            { key: "action", label: "处置动作" },
            { key: "qaRecord", label: "关联问答", maxWidth: 220, minWidth: 150, width: 180 },
            { key: "raw", label: "原始证据" },
            { key: "detail", label: "操作" },
          ]}
          emptyDescription="暂无安全事件"
          error={error}
          loading={loading}
          loadingLabel="正在加载安全事件"
          onRetry={retry}
          rows={items.map((event) => ({
            id: event.eventId,
            time: formatTimestamp(event.occurredAtMs),
            type: formatEventKind(event.eventKind),
            process: formatProcessCell(event),
            object: (
              <div className="row-stack audit-event-title-cell">
                <strong>{event.title}</strong>
                <span>{resolveObjectText(event)}</span>
                <code>{event.eventId}</code>
              </div>
            ),
            risk: renderRiskBadge(event.riskLevel),
            action: renderActionBadge(event.enforcementAction),
            qaRecord: formatQaRecordId(event.qaRecordId),
            raw: formatRawEvidence(event),
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
        subtitle={detailError ? `详情加载失败：${detailError}` : selectedDetail?.eventId ?? "查看事件聚合与原始证据"}
        onClose={handleCloseDetail}
      >
        <dl className="detail-panel__grid audit-detail-dialog__grid">
          {[
            { label: "事件类型", value: selectedDetail ? formatEventKind(selectedDetail.eventKind) : "暂无" },
            { label: "过程", value: selectedDetail ? formatProcessKind(selectedDetail.processKind) : "暂无" },
            { label: "风险等级", value: selectedDetail ? renderRiskBadge(selectedDetail.riskLevel) : "暂无" },
            { label: "策略判定", value: selectedDetail ? renderPolicyDecisionBadge(selectedDetail.policyDecision, selectedDetail.enforcementAction) : "暂无" },
            { label: "处置动作", value: selectedDetail ? renderActionBadge(selectedDetail.enforcementAction) : "暂无" },
            { label: "关联问答", value: formatQaRecordId(selectedDetail?.qaRecordId) },
            { label: "对象/内容", value: selectedDetail ? resolveObjectText(selectedDetail) : "暂无" },
            { label: "发生时间", value: selectedDetail ? formatTimestamp(selectedDetail.occurredAtMs) : "暂无" },
            {
              label: "Detail JSON",
              value: <pre className="code-panel">{formatDetailJson(selectedDetail?.detailJson)}</pre>,
            },
          ].map((field) => (
            <div key={field.label} className="detail-panel__field">
              <dt>{field.label}</dt>
              <dd>{field.value}</dd>
            </div>
          ))}
        </dl>

        <section className="detail-panel">
          <div className="panel__header">
            <div>
              <h2 className="panel__title">原始证据</h2>
              <p className="panel__subtitle">支撑该安全事件的 hook 级审计流水</p>
            </div>
          </div>
          <DataTable
            columns={[
              { key: "time", label: "时间" },
              { key: "event", label: "事件" },
              { key: "hook", label: "Hook" },
              { key: "category", label: "分类" },
              { key: "risk", label: "风险" },
            ]}
            emptyDescription="暂无原始证据"
            rows={(selectedDetail?.rawAuditEvents ?? []).map((event) => ({
              id: event.eventId,
              time: formatTimestamp(event.occurredAtMs),
              event: event.eventId,
              hook: event.hookName,
              category: event.category,
              risk: renderRiskBadge(event.riskLevel),
            }))}
          />
        </section>
      </ModalDialog>
    </div>
  );
}
