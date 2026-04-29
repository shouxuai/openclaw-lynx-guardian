import { startTransition, useEffect, useState } from "react";
import type { LynxCheckDetailDto, LynxCheckListItemDto } from "@lynx/local-console-shared";

import { getLynxCheckDetail, listLynxChecks, type LynxCheckListQuery } from "../api/lynx-checks";
import { mockLynxChecks } from "../data/mock-console";
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

function formatTaskEvidence(item: LynxCheckListItemDto): string {
  const extended = item as LynxCheckListItemDto & {
    evidence?: unknown;
    evidenceBundle?: unknown;
    facts?: unknown;
  };
  const evidence = extended.evidenceBundle ?? extended.evidence ?? extended.facts;
  if (!evidence) {
    return item.errorMessage || "暂无";
  }
  if (typeof evidence === "string") {
    return evidence;
  }
  return JSON.stringify(evidence);
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

function formatTaskLogLine(item: LynxCheckListItemDto): string {
  const reportPath = resolveReportPath(item);
  return [
    `[${formatTimestamp(item.createdAtMs)}]`,
    item.status,
    item.requestId,
    reportPath !== "--" ? `report:${reportPath}` : undefined,
    item.errorMessage ? `error:${item.errorMessage}` : undefined,
  ].filter(Boolean).join(" ");
}

function renderReportMarkdown(reportMarkdown: string | undefined) {
  if (!reportMarkdown) {
    return <p className="small-note">当前检测记录暂无完整 Markdown 报告。</p>;
  }

  return (
    <div className="code-panel">
      {reportMarkdown.split(/\r?\n/).map((line, index) => (
        <p key={`${index}:${line}`}>{line || "\u00a0"}</p>
      ))}
    </div>
  );
}

export function LynxChecksPage() {
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<LynxCheckDetailDto | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const { items, loading, error, paginationProps } = usePagedListResource<LynxCheckListItemDto, LynxCheckListQuery>({
    fallbackPage: import.meta.env.DEV
      ? (_query, pageIndex, pageSize) => paginateMockPage(mockLynxChecks, pageIndex, pageSize)
      : undefined,
    loadPage: listLynxChecks,
    query: {},
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
  const taskLogText = loading
    ? "正在加载检查任务列表"
    : items.length > 0
      ? items.map(formatTaskLogLine).join("\n")
      : "当前列表暂无检查任务日志";
  const statusText = error ? `检查任务加载失败：${error}` : loading ? "正在加载 lynx_checks 数据流" : "基于当前列表展示 lynx_checks 任务状态、通知结果和报告路径。";

  useEffect(() => {
    if (selectedRequestId || items.length === 0) {
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

  return (
    <div className="page-stack">
      <section className="page-header">
        <div>
          <h1 className="page-header__title">检测</h1>
          <p className="page-header__description">{statusText}</p>
        </div>
        <button className="btn btn--dark" type="button">刷新数据</button>
      </section>

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

      <section className="table-panel">
        <div className="table-panel__header">
          <h2 className="panel__title">任务执行列表</h2>
          <div className="page-header__actions">
            <button className="btn" type="button">搜索请求 ID...</button>
            <button className="btn" type="button">筛选</button>
          </div>
        </div>
        <DataTable
          columns={[
            { key: "request", label: "请求 ID" },
            { key: "qaRecord", label: "问答记录", maxWidth: 220, minWidth: 150, width: 180 },
            { key: "source", label: "触发源" },
            { key: "status", label: "处理状态" },
            { key: "taskState", label: "Task State", maxWidth: 180, minWidth: 140, width: 160 },
            { key: "evidence", label: "证据", maxWidth: 320, minWidth: 230, width: 280 },
            { key: "delivery", label: "通知状态" },
            { key: "report", label: "报告路径" },
            { key: "created", label: "创建时间" },
            { key: "action", label: "操作" },
          ]}
          loading={loading}
          rows={items.map((item) => ({
            id: item.requestId,
            request: <code>{item.requestId}</code>,
            qaRecord: formatQaRecordId(item.qaRecordId),
            source: formatDomainLabel(item.trigger),
            status: renderStateBadge(item.status),
            taskState: item.status,
            evidence: formatTaskEvidence(item),
            delivery: renderStateBadge(item.sendSucceeded ? "completed" : item.sendAttempted ? "failed" : "pending"),
            report: resolveReportPath(item),
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
      </section>

      <section className="split-grid split-grid--equal">
        <article className="panel">
          <div className="panel__header">
            <h2 className="panel__title">当前列表事件</h2>
            <span className="status-badge status-badge--info">
              {runningCount > 0 ? `${runningCount} 个运行中` : "无运行中任务"}
            </span>
          </div>
          <pre className="code-panel">{taskLogText}</pre>
        </article>

        <article className="panel">
          <div className="panel__header">
            <h2 className="panel__title">最近检测报告</h2>
            <span className="status-badge status-badge--info">
              {selectedDetail?.requestId || selectedRequestId ? `报告: ${selectedDetail?.requestId ?? selectedRequestId}` : "暂无记录"}
            </span>
          </div>
          {detailError ? (
            <p className="small-note">检测报告详情加载失败：{detailError}</p>
          ) : renderReportMarkdown(selectedDetail?.reportMarkdown)}
        </article>
      </section>
    </div>
  );
}
