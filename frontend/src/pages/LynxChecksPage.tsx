import type { LynxCheckListItemDto } from "@lynx/local-console-shared";

import { listLynxChecks, type LynxCheckListQuery } from "../api/lynx-checks";
import { mockLynxChecks } from "../data/mock-console";
import { DataTable } from "../components/tables/DataTable";
import { TablePagination } from "../components/tables/TablePagination";
import { paginateMockItems, useCursorListResource } from "../hooks/useCursorListResource";
import { formatDuration, formatInteger, formatTimestamp } from "../utils/format";
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

export function LynxChecksPage() {
  const { items, loading, error, paginationProps } = useCursorListResource<LynxCheckListItemDto, LynxCheckListQuery>({
    fallbackPage: import.meta.env.DEV
      ? (_query, pageIndex, pageSize) => paginateMockItems(mockLynxChecks, pageIndex, pageSize)
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

  return (
    <div className="page-stack">
      <section className="page-header">
        <div>
          <h1 className="page-header__title">检查任务运行情况</h1>
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
            { key: "source", label: "触发源" },
            { key: "status", label: "处理状态" },
            { key: "taskState", label: "Task State", maxWidth: 180, minWidth: 140, width: 160 },
            { key: "evidence", label: "证据", maxWidth: 320, minWidth: 230, width: 280 },
            { key: "delivery", label: "通知状态" },
            { key: "report", label: "报告路径" },
            { key: "created", label: "创建时间" },
            { key: "action", label: "操作" },
          ]}
          rows={items.map((item) => ({
            id: item.requestId,
            request: <code>{item.requestId}</code>,
            source: formatDomainLabel(item.trigger),
            status: renderStateBadge(item.status),
            taskState: item.status,
            evidence: formatTaskEvidence(item),
            delivery: renderStateBadge(item.sendSucceeded ? "completed" : item.sendAttempted ? "failed" : "pending"),
            report: resolveReportPath(item),
            created: formatTimestamp(item.createdAtMs),
            action: "⋮",
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
            <h2 className="panel__title">安全概览</h2>
          </div>
          <p className="panel__subtitle">
            当前列表中 {formatInteger(completedCount)} 个已完成，{formatInteger(failedCount)} 个失败，{formatInteger(successCount)} 个通知成功。
          </p>
          <div className="list-stack">
            <div className="list-item">
              <span>完成任务</span>
              <strong>{formatInteger(completedCount)}</strong>
            </div>
            <div className="list-item">
              <span>通知成功</span>
              <strong>{formatInteger(successCount)} / {formatInteger(attemptedCount)}</strong>
            </div>
            <div className="list-item">
              <span>失败任务</span>
              <strong>{formatInteger(failedCount)}</strong>
            </div>
          </div>
          <button className="btn" type="button">导出安全审计报告</button>
        </article>
      </section>
    </div>
  );
}
