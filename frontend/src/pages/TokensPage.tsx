import { startTransition, useEffect, useMemo, useState } from "react";
import type {
  TokenSummaryDto,
  TokenTrendDto,
  TokenUsageListItemDto,
} from "@lynx/local-console-shared";

import { getTokenSummary, getTokenTrend, getTokenUsage } from "../api/tokens";
import { DataTable } from "../components/tables/DataTable";
import { DEFAULT_TABLE_PAGE_SIZE, DEFAULT_TABLE_PAGE_SIZE_OPTIONS, TablePagination } from "../components/tables/TablePagination";
import { mockTokenSummary, mockTokenTrend, mockTokenUsage } from "../data/mock-console";
import { paginateMockItems } from "../hooks/useCursorListResource";
import { formatInteger, formatTimestamp } from "../utils/format";
import { renderStateBadge } from "../utils/status";

const EMPTY_TOKEN_SUMMARY: TokenSummaryDto = {
  totalTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  estimatedCount: 0,
  topModels: [],
};

const EMPTY_TOKEN_TREND: TokenTrendDto = {
  bucket: "hour",
  points: [],
};

function percent(value: number, total: number): number {
  if (total === 0) {
    return 0;
  }

  return Math.round((value / total) * 100);
}

function formatRatio(input: number, output: number): string {
  if (output === 0) {
    return input === 0 ? "0:0" : "∞:1";
  }

  return `${(input / output).toFixed(2)}:1`;
}

export function TokensPage() {
  const [summary, setSummary] = useState<TokenSummaryDto>(EMPTY_TOKEN_SUMMARY);
  const [trend, setTrend] = useState<TokenTrendDto>(EMPTY_TOKEN_TREND);
  const [usageItems, setUsageItems] = useState<TokenUsageListItemDto[]>([]);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [usageLoading, setUsageLoading] = useState(true);
  const [trendLoading, setTrendLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pageCursors, setPageCursors] = useState<Array<string | undefined>>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_TABLE_PAGE_SIZE);
  const [nextCursor, setNextCursor] = useState<string | undefined>();

  const currentCursor = pageCursors[pageIndex];

  useEffect(() => {
    const abortController = new AbortController();

    async function loadSummary() {
      try {
        const nextSummary = await getTokenSummary();
        if (abortController.signal.aborted) {
          return;
        }

        startTransition(() => {
          setSummary(nextSummary);
          setError(null);
          setSummaryLoading(false);
        });
      } catch (loadError) {
        if (abortController.signal.aborted) {
          return;
        }

        const message = loadError instanceof Error ? loadError.message : "未知错误";
        startTransition(() => {
          setSummary(import.meta.env.DEV ? mockTokenSummary : EMPTY_TOKEN_SUMMARY);
          setError(import.meta.env.DEV ? null : message);
          setSummaryLoading(false);
        });
      }
    }

    void loadSummary();
    return () => {
      abortController.abort();
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function loadUsage() {
      startTransition(() => {
        setUsageLoading(true);
      });

      try {
        const nextUsage = await getTokenUsage({
          limit: pageSize,
          cursor: currentCursor,
        });
        if (!active) {
          return;
        }

        startTransition(() => {
          setUsageItems(nextUsage.items);
          setNextCursor(nextUsage.nextCursor);
          setError(null);
          setUsageLoading(false);
        });
      } catch (loadError) {
        if (!active) {
          return;
        }

        const fallback = import.meta.env.DEV ? paginateMockItems(mockTokenUsage, pageIndex, pageSize) : undefined;
        const message = loadError instanceof Error ? loadError.message : "未知错误";
        startTransition(() => {
          setUsageItems(fallback?.items ?? []);
          setNextCursor(fallback?.nextCursor);
          setError(fallback ? null : message);
          setUsageLoading(false);
        });
      }
    }

    void loadUsage();
    return () => {
      active = false;
    };
  }, [currentCursor, pageIndex, pageSize]);

  useEffect(() => {
    const abortController = new AbortController();

    async function loadTrend() {
      try {
        const nextTrend = await getTokenTrend("hour");
        if (abortController.signal.aborted) {
          return;
        }

        startTransition(() => {
          setTrend(nextTrend);
          setError(null);
          setTrendLoading(false);
        });
      } catch (loadError) {
        if (abortController.signal.aborted) {
          return;
        }

        const message = loadError instanceof Error ? loadError.message : "未知错误";
        startTransition(() => {
          setTrend(import.meta.env.DEV ? mockTokenTrend : EMPTY_TOKEN_TREND);
          setError(import.meta.env.DEV ? null : message);
          setTrendLoading(false);
        });
      }
    }

    void loadTrend();
    return () => {
      abortController.abort();
    };
  }, []);

  const totalTransferTokens = summary.inputTokens + summary.outputTokens;
  const inputPercent = percent(summary.inputTokens, totalTransferTokens);
  const outputPercent = percent(summary.outputTokens, totalTransferTokens);
  const trendLabels = useMemo(() => {
    if (trend.points.length > 0) {
      return trend.points.slice(-7).map((point) => formatTimestamp(point.bucketStartMs).split(" ")[0]);
    }

    return ["10/21", "10/22", "10/23", "10/24", "10/25", "10/26", "今日"];
  }, [trend.points]);
  const loading = summaryLoading || usageLoading || trendLoading;
  const loadStatus = error ? `实时数据不可用：${error}` : loading ? "正在刷新中" : "实时刷新中";

  function resetUsagePaging(): void {
    setPageCursors([undefined]);
    setPageIndex(0);
    setNextCursor(undefined);
  }

  function handleNextPage(): void {
    if (!nextCursor) {
      return;
    }

    setPageCursors((current) => {
      const next = current.slice(0, pageIndex + 1);
      next[pageIndex + 1] = nextCursor;
      return next;
    });
    setPageIndex((current) => current + 1);
  }

  function handlePageChange(nextPageIndex: number): void {
    if (nextPageIndex === pageIndex) {
      return;
    }
    if (nextPageIndex === pageCursors.length && nextCursor) {
      handleNextPage();
      return;
    }
    if (nextPageIndex >= 0 && nextPageIndex < pageCursors.length) {
      setPageIndex(nextPageIndex);
    }
  }

  function handlePageSizeChange(nextPageSize: number): void {
    setPageSize(nextPageSize);
    resetUsagePaging();
  }

  return (
    <div className="page-stack">
      <section className="token-hero">
        <div>
          <h1 className="token-hero__title">Token 统计报表</h1>
          <p className="token-hero__subtitle">实时量化模型消耗与基础设施负载</p>
        </div>
        <div className="page-header__actions">
          <button className="btn" type="button">过去 24 小时</button>
          <button className="btn btn--dark" type="button">导出报告</button>
        </div>
      </section>

      <section className="summary-card-grid">
        <article className="summary-card">
          <p className="summary-card__label">今日消耗总数</p>
          <strong className="summary-card__value">
            {formatInteger(summary.totalTokens)}
            <span className="summary-card__unit">Tokens</span>
          </strong>
          <p className="summary-card__delta">↗ +12.5% 较昨日</p>
        </article>

        <article className="summary-card ratio-card">
          <div className="ratio-list">
            <p className="summary-card__label">输入/输出比例</p>
            <div className="ratio-row">
              <div className="ratio-row__meta">
                <span>输入 (Input)</span>
                <strong>{inputPercent}%</strong>
              </div>
              <div className="ratio-track">
                <div className="ratio-fill" style={{ width: `${inputPercent}%` }} />
              </div>
            </div>
            <div className="ratio-row">
              <div className="ratio-row__meta">
                <span>输出 (Output)</span>
                <strong>{outputPercent}%</strong>
              </div>
              <div className="ratio-track">
                <div className="ratio-fill ratio-fill--dark" style={{ width: `${outputPercent}%` }} />
              </div>
            </div>
          </div>
          <div className="ratio-ring">
            <strong>{formatRatio(summary.inputTokens, summary.outputTokens)}</strong>
          </div>
        </article>

        <article className="summary-card">
          <p className="summary-card__label">模型平均负载 (LATENCY)</p>
          <strong className="summary-card__value">
            342ms
          </strong>
          <p className="summary-card__unit">P95 延迟指标</p>
          <div className="latency-bars" aria-hidden="true">
            <span style={{ height: "32px" }} />
            <span style={{ height: "44px" }} />
            <span />
            <span style={{ height: "48px" }} />
            <span style={{ height: "28px" }} />
          </div>
          <p className="summary-card__delta">● 系统状态: 稳定</p>
        </article>
      </section>

      <section className="panel trend-panel">
        <div className="panel__header">
          <h2 className="panel__title">7 日消耗趋势分析</h2>
          <div className="trend-panel__legend">
            <span><i className="legend-swatch legend-swatch--blue" />GPT-4o</span>
            <span><i className="legend-swatch legend-swatch--black" />Claude 3.5</span>
          </div>
        </div>
        <div className="chart-empty-grid">
          <div className="chart-empty-grid__axis">
            {trendLabels.map((label, index) => (
              <span key={`${label}-${index}`}>{label}</span>
            ))}
          </div>
        </div>
      </section>

      <section className="table-panel token-table">
        <div className="table-panel__header">
          <h2 className="panel__title">实时审计数据流</h2>
          <span className="small-note">{loadStatus} · · ·</span>
        </div>
        <DataTable
          columns={[
            { key: "session", label: "会话 ID" },
            { key: "model", label: "模型名称" },
            { key: "io", label: "输入 / 输出" },
            { key: "total", label: "总词元" },
            { key: "type", label: "类型" },
            { key: "time", label: "触发时间" },
          ]}
          rows={usageItems.map((item) => ({
            id: item.usageEventId,
            session: item.sessionKey ?? "未知会话",
            model: (
              <div className="row-stack">
                <span className={item.model.toLowerCase().includes("claude") ? "model-pill model-pill--dark" : "model-pill"}>
                  {item.model}
                </span>
                <span>{item.provider} / {item.model}</span>
              </div>
            ),
            io: `${formatInteger(item.inputTokens)} → ${formatInteger(item.outputTokens)}`,
            total: <strong>{formatInteger(item.totalTokens)}</strong>,
            type: renderStateBadge(item.isEstimated ? "estimated" : "actual"),
            time: formatTimestamp(item.occurredAtMs),
          }))}
        />
        <TablePagination
          hasNextPage={Boolean(nextCursor)}
          itemCount={usageItems.length}
          loading={usageLoading}
          pageCount={pageCursors.length}
          pageIndex={pageIndex}
          pageSize={pageSize}
          pageSizeOptions={DEFAULT_TABLE_PAGE_SIZE_OPTIONS}
          onNextPage={handleNextPage}
          onPageChange={handlePageChange}
          onPageSizeChange={handlePageSizeChange}
          onPreviousPage={() => setPageIndex((current) => Math.max(0, current - 1))}
        />
      </section>
    </div>
  );
}
