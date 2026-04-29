import { startTransition, useEffect, useState, type FormEvent } from "react";
import type { LynxCheckDetailDto, LynxCheckListItemDto } from "@lynx/local-console-shared";
import { Button, Input, Select } from "antd";

import { getLynxCheckDetail, listLynxChecks, type LynxCheckListQuery } from "../api/lynx-checks";
import { mockLynxChecks } from "../data/mock-console";
import { PageHeader } from "../components/layout/PageHeader";
import { DataTable } from "../components/tables/DataTable";
import { TablePagination } from "../components/tables/TablePagination";
import { paginateMockPage, usePagedListResource } from "../hooks/usePagedListResource";
import { formatDuration, formatInteger, formatTimestamp } from "../utils/format";
import { formatQaRecordId } from "../utils/qa-records";
import { formatDomainLabel, renderStateBadge } from "../utils/status";

function isRunningTask(status: string): boolean {
  return [
    "created",
    "queued",
    "collecting",
    "analyzing",
    "report_skeleton_ready",
    "awaiting_llm_report",
    "delivering",
    "running",
  ].includes(status);
}

interface CheckFilters {
  q: string;
  status: string;
  trigger: string;
}

const EMPTY_FILTERS: CheckFilters = {
  q: "",
  status: "",
  trigger: "",
};

const STATUS_OPTIONS = [
  { label: "已完成", value: "completed" },
  { label: "运行中", value: "running" },
  { label: "失败", value: "failed" },
  { label: "等待中", value: "pending" },
];

const TRIGGER_OPTIONS = [
  { label: "手动触发", value: "manual" },
  { label: "命令触发", value: "lynx_command" },
  { label: "定时任务", value: "scheduled" },
];

function buildCheckQuery(filters: CheckFilters): Omit<LynxCheckListQuery, "pageNum" | "pageSize"> {
  return {
    q: filters.q.trim() || undefined,
    status: filters.status || undefined,
    trigger: filters.trigger || undefined,
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function readReportPath(value: unknown): string | undefined {
  const reportPath = asRecord(value)?.reportPath;
  return typeof reportPath === "string" && reportPath.trim().length > 0 ? reportPath : undefined;
}

function resolveReportPath(item: LynxCheckListItemDto): string {
  const extended = item as LynxCheckListItemDto & {
    evidenceBundle?: unknown;
    facts?: unknown;
  };

  return item.reportPath
    ?? readReportPath(extended.facts)
    ?? readReportPath(extended.evidenceBundle)
    ?? "--";
}

function resolveTaskDuration(item: LynxCheckListItemDto): number | undefined {
  if (!item.completedAtMs || item.completedAtMs <= item.createdAtMs) {
    return undefined;
  }
  return item.completedAtMs - item.createdAtMs;
}

function renderReportMarkdown(reportMarkdown: string | undefined) {
  if (!reportMarkdown?.trim()) {
    return <p className="small-note">当前检测记录暂无完整 Markdown 报告。</p>;
  }

  return (
    <section className="report-side-panel__body" aria-label="检测报告 Markdown 正文">
      <span className="report-side-panel__bodyTitle">报告正文</span>
      <pre className="code-panel code-panel--report report-side-panel__markdown" data-testid="lynx-check-report-markdown">{reportMarkdown}</pre>
    </section>
  );
}

export function LynxChecksPage() {
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<LynxCheckDetailDto | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [draftFilters, setDraftFilters] = useState<CheckFilters>(EMPTY_FILTERS);
  const [appliedQuery, setAppliedQuery] = useState<Omit<LynxCheckListQuery, "pageNum" | "pageSize">>({});
  const { items, loading, error, paginationProps, resetPaging, retry } = usePagedListResource<LynxCheckListItemDto, LynxCheckListQuery>({
    fallbackPage: import.meta.env.DEV
      ? (_query, pageIndex, pageSize) => paginateMockPage(mockLynxChecks, pageIndex, pageSize)
      : undefined,
    loadPage: listLynxChecks,
    onPageBoundaryChange: () => setSelectedRequestId(null),
    query: appliedQuery,
  });

  const runningCount = items.filter((item) => isRunningTask(item.status)).length;
  const completedCount = items.filter((item) => item.status === "completed").length;
  const failedCount = items.filter((item) => item.status === "failed").length;
  const attemptedCount = items.filter((item) => item.sendAttempted).length;
  const successCount = items.filter((item) => item.sendSucceeded).length;
  const durations = items.map(resolveTaskDuration).filter((value): value is number => value !== undefined);
  const averageDurationMs = durations.length > 0
    ? Math.round(durations.reduce((total, value) => total + value, 0) / durations.length)
    : undefined;
  const failRate = attemptedCount === 0 ? "0%" : `${(((attemptedCount - successCount) / attemptedCount) * 100).toFixed(2)}%`;
  const statusText = error ? `检查任务加载失败：${error}` : loading ? "正在加载 lynx_checks 数据流" : "左侧筛选检测任务，右侧直接查看最近检测报告。";

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setSelectedRequestId(null);
    resetPaging();
    setAppliedQuery(buildCheckQuery(draftFilters));
  }

  function handleReset(): void {
    setDraftFilters(EMPTY_FILTERS);
    setSelectedRequestId(null);
    resetPaging();
    setAppliedQuery({});
  }

  useEffect(() => {
    if (items.length === 0) {
      setSelectedRequestId(null);
      return;
    }

    if (selectedRequestId && items.some((item) => item.requestId === selectedRequestId)) {
      return;
    }

    setSelectedRequestId(items[0].requestId);
  }, [items, selectedRequestId]);

  useEffect(() => {
    if (!selectedRequestId) {
      setSelectedDetail(null);
      setDetailError(null);
      return;
    }

    let active = true;
    const requestId = selectedRequestId;

    async function loadDetail() {
      try {
        const detail = await getLynxCheckDetail(requestId);
        if (!active) {
          return;
        }

        startTransition(() => {
          setSelectedDetail(detail);
          setDetailError(null);
        });
      } catch (loadError) {
        if (!active) {
          return;
        }

        startTransition(() => {
          setSelectedDetail(null);
          setDetailError(loadError instanceof Error ? loadError.message : "检测报告详情加载失败");
        });
      }
    }

    void loadDetail();

    return () => {
      active = false;
    };
  }, [selectedRequestId]);

  const selectedListItem = items.find((item) => item.requestId === selectedRequestId) ?? null;
  const reportEntries = items
    .map((item) => ({
      requestId: item.requestId,
      reportPath: resolveReportPath(item),
    }))
    .filter((entry) => entry.reportPath !== "--");

  return (
    <div className="page-stack">
      <PageHeader
        title="检测报告"
        description={statusText}
        eyebrow="LYNX CHECKS"
        actions={<button className="btn btn--dark" type="button" onClick={retry}>刷新数据</button>}
      />

      <section className="metric-grid metric-grid--compact">
        <article className="metric-card">
          <p className="metric-card__label">总任务量</p>
          <strong className="metric-card__value">{items.length}</strong>
          <p className="metric-card__note">{items.length > 0 ? "当前列表" : "暂无任务"}</p>
        </article>
        <article className="metric-card">
          <p className="metric-card__label">正在运行</p>
          <strong className="metric-card__value">{runningCount}</strong>
          <p className="metric-card__note">包含手动与定时任务</p>
        </article>
        <article className="metric-card">
          <p className="metric-card__label">失败率</p>
          <strong className="metric-card__value">{failRate}</strong>
          <p className="metric-card__note">{failedCount} 个失败任务</p>
        </article>
        <article className="metric-card">
          <p className="metric-card__label">平均耗时</p>
          <strong className="metric-card__value">{formatDuration(averageDurationMs)}</strong>
          <p className="metric-card__note">
            {durations.length > 0 ? `基于 ${formatInteger(durations.length)} 个完成任务` : "当前列表暂无完成耗时"}
          </p>
        </article>
      </section>

      <section className="filter-panel">
        <form className="audit-filter-form audit-filter-form--compact" onSubmit={handleSubmit}>
          <label className="filter-field filter-field--search">
            <span>关键词</span>
            <Input
              allowClear
              aria-label="关键词"
              placeholder="搜索请求 ID、会话、问答记录"
              value={draftFilters.q}
              onChange={(event) => setDraftFilters((current) => ({ ...current, q: event.target.value }))}
            />
          </label>
          <label className="filter-field">
            <span>处理状态</span>
            <Select
              allowClear
              aria-label="处理状态"
              options={STATUS_OPTIONS}
              placeholder="全部状态"
              value={draftFilters.status || undefined}
              onChange={(value) => setDraftFilters((current) => ({ ...current, status: value ?? "" }))}
            />
          </label>
          <label className="filter-field">
            <span>触发方式</span>
            <Select
              allowClear
              aria-label="触发方式"
              options={TRIGGER_OPTIONS}
              placeholder="全部方式"
              value={draftFilters.trigger || undefined}
              onChange={(value) => setDraftFilters((current) => ({ ...current, trigger: value ?? "" }))}
            />
          </label>
          <div className="audit-filter-form__actions">
            <Button htmlType="submit" type="primary">应用筛选</Button>
            <Button htmlType="button" onClick={handleReset}>重置条件</Button>
          </div>
        </form>
      </section>

      <section className="split-grid split-grid--report" data-testid="lynx-checks-workspace">
        <article className="table-panel">
          <div className="table-panel__header">
            <div>
              <h2 className="panel__title">任务执行列表</h2>
              <p className="panel__subtitle">只保留排查时第一眼需要看的状态字段。</p>
            </div>
          </div>
          <DataTable
            columns={[
              { key: "request", label: "请求" },
              { key: "status", label: "处理状态" },
              { key: "source", label: "触发方式" },
              { key: "delivery", label: "通知" },
              { key: "created", label: "创建时间" },
              { key: "action", label: "操作" },
            ]}
            error={error}
            loading={loading}
            onRetry={retry}
            rows={items.map((item) => ({
              id: item.requestId,
              request: (
                <div className="row-stack">
                  <strong>{item.requestId}</strong>
                  <span>{formatQaRecordId(item.qaRecordId)}</span>
                </div>
              ),
              source: formatDomainLabel(item.trigger),
              status: renderStateBadge(item.status),
              delivery: renderStateBadge(item.sendSucceeded ? "completed" : item.sendAttempted ? "failed" : "pending"),
              created: formatTimestamp(item.createdAtMs),
              action: (
                <button
                  aria-label={`查看 ${item.requestId} 检测报告`}
                  className="btn btn--compact"
                  type="button"
                  onClick={() => setSelectedRequestId(item.requestId)}
                >
                  查看报告
                </button>
              ),
            }))}
          />
          <TablePagination {...paginationProps} />
        </article>

        <article className="panel report-side-panel">
          <div className="panel__header">
            <div>
              <h2 className="panel__title">最近检测报告</h2>
              <p className="panel__subtitle">
                {selectedDetail?.requestId || selectedRequestId ? `报告：${selectedDetail?.requestId ?? selectedRequestId}` : "暂无记录"}
              </p>
            </div>
            <span className="status-badge status-badge--info">
              {runningCount > 0 ? `${runningCount} 个运行中` : "最近记录"}
            </span>
          </div>
          <div className="report-side-panel__meta">
            <span>问答记录：{formatQaRecordId(selectedDetail?.qaRecordId ?? selectedListItem?.qaRecordId)}</span>
            <span>当前报告：{selectedDetail?.requestId ?? selectedListItem?.requestId ?? "暂无"}</span>
          </div>
          {detailError ? (
            <p className="small-note">检测报告详情加载失败：{detailError}</p>
          ) : renderReportMarkdown(selectedDetail?.reportMarkdown)}
          {reportEntries.length > 0 ? (
            <div className="report-side-panel__paths" aria-label="本页报告索引">
              <span>本页报告索引</span>
              {reportEntries.map((entry) => (
                <code key={entry.requestId}>{entry.reportPath}</code>
              ))}
            </div>
          ) : null}
        </article>
      </section>
    </div>
  );
}
