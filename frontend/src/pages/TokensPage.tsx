import { startTransition, useEffect, useMemo, useState, type CSSProperties } from "react";
import type {
  TokenSummaryDto,
  TokenTrendBucket,
  TokenTrendDto,
  TokenTrendPointDto,
  TokenUsageListItemDto,
} from "@lynx/local-console-shared";

import { getTokenSummary, getTokenTrend, getTokenUsage } from "../api/tokens";
import type { TokenTimeRangeQuery } from "../api/tokens";
import { DataTable } from "../components/tables/DataTable";
import { DEFAULT_TABLE_PAGE_SIZE, DEFAULT_TABLE_PAGE_SIZE_OPTIONS, TablePagination } from "../components/tables/TablePagination";
import { mockTokenSummary, mockTokenTrend, mockTokenUsage } from "../data/mock-console";
import { paginateMockItems } from "../hooks/useCursorListResource";
import { formatInteger, formatTimestamp } from "../utils/format";

const EMPTY_TOKEN_SUMMARY: TokenSummaryDto = {
  totalTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  actualTokens: 0,
  estimatedTokens: 0,
  estimatedCount: 0,
  unavailableCount: 0,
  topModels: [],
};

const EMPTY_TOKEN_TREND: TokenTrendDto = {
  bucket: "hour",
  points: [],
};

const TOKEN_TREND_POINT_LIMIT = 7;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

type TokenTimeRangeKey = "last1h" | "last24h" | "last7d" | "last30d" | "all";

const TOKEN_TIME_RANGE_OPTIONS: Array<{
  bucket: TokenTrendBucket;
  durationMs?: number;
  key: TokenTimeRangeKey;
  label: string;
}> = [
  { key: "last1h", label: "最近 1 小时", durationMs: HOUR_MS, bucket: "hour" },
  { key: "last24h", label: "最近 24 小时", durationMs: DAY_MS, bucket: "hour" },
  { key: "last7d", label: "最近 7 天", durationMs: 7 * DAY_MS, bucket: "day" },
  { key: "last30d", label: "最近 30 天", durationMs: 30 * DAY_MS, bucket: "day" },
  { key: "all", label: "全部时间", bucket: "day" },
];

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

function resolveSourceType(item: TokenUsageListItemDto): "actual" | "estimated" | "unavailable" {
  return item.sourceType ?? (item.isEstimated ? "estimated" : "actual");
}

function formatSourceTypeLabel(sourceType: "actual" | "estimated" | "unavailable"): string {
  const labels = {
    actual: "实际",
    estimated: "估算",
    unavailable: "不可用",
  };
  return labels[sourceType];
}

function formatTrendLabel(point: TokenTrendPointDto): string {
  return formatTimestamp(point.bucketStartMs).split(" ")[0];
}

function clampTokenCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function buildTrendBarHeight(point: TokenTrendPointDto, maxTotalTokens: number): string {
  const totalTokens = clampTokenCount(point.totalTokens);
  if (totalTokens === 0 || maxTotalTokens === 0) {
    return "2%";
  }

  return `${Math.max((totalTokens / maxTotalTokens) * 100, 8)}%`;
}

function buildTrendSegmentStyle(value: number, totalTokens: number, background: string): CSSProperties {
  const safeValue = clampTokenCount(value);
  const safeTotal = clampTokenCount(totalTokens);

  return {
    background,
    display: safeValue > 0 ? "block" : "none",
    flexBasis: safeTotal > 0 ? `${(safeValue / safeTotal) * 100}%` : "0%",
  };
}

function resolveTokenTimeRange(key: TokenTimeRangeKey): { bucket: TokenTrendBucket; query: TokenTimeRangeQuery } {
  const option = TOKEN_TIME_RANGE_OPTIONS.find((item) => item.key === key) ?? TOKEN_TIME_RANGE_OPTIONS[1];
  if (!option.durationMs) {
    return { bucket: option.bucket, query: {} };
  }

  const toMs = Date.now();
  return {
    bucket: option.bucket,
    query: {
      fromMs: toMs - option.durationMs,
      toMs,
    },
  };
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
  const [timeRangeKey, setTimeRangeKey] = useState<TokenTimeRangeKey>("last24h");

  const currentCursor = pageCursors[pageIndex];
  const selectedTimeRange = useMemo(() => resolveTokenTimeRange(timeRangeKey), [timeRangeKey]);

  useEffect(() => {
    const abortController = new AbortController();

    async function loadSummary() {
      startTransition(() => {
        setSummaryLoading(true);
      });

      try {
        const nextSummary = await getTokenSummary(selectedTimeRange.query);
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
  }, [selectedTimeRange.query]);

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
          ...selectedTimeRange.query,
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
  }, [currentCursor, pageIndex, pageSize, selectedTimeRange.query]);

  useEffect(() => {
    const abortController = new AbortController();

    async function loadTrend() {
      startTransition(() => {
        setTrendLoading(true);
      });

      try {
        const nextTrend = await getTokenTrend(selectedTimeRange.bucket, selectedTimeRange.query);
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
  }, [selectedTimeRange.bucket, selectedTimeRange.query]);

  const totalTransferTokens = summary.inputTokens + summary.outputTokens;
  const inputPercent = percent(summary.inputTokens, totalTransferTokens);
  const outputPercent = percent(summary.outputTokens, totalTransferTokens);
  const estimatedCount = summary.estimatedCount ?? 0;
  const unavailableCount = summary.unavailableCount ?? 0;
  const actualTokens = summary.actualTokens ?? 0;
  const estimatedTokens = summary.estimatedTokens ?? 0;
  const visibleTrendPoints = useMemo(() => trend.points.slice(-TOKEN_TREND_POINT_LIMIT), [trend.points]);
  const trendLabels = useMemo(() => {
    if (visibleTrendPoints.length > 0) {
      return visibleTrendPoints.map(formatTrendLabel);
    }

    return ["10/21", "10/22", "10/23", "10/24", "10/25", "10/26", "今日"];
  }, [visibleTrendPoints]);
  const maxTrendTotalTokens = Math.max(...visibleTrendPoints.map((point) => clampTokenCount(point.totalTokens)), 0);
  const topModelLegend = useMemo(() => {
    const models = summary.topModels
      .map((item) => item.model)
      .filter((model) => model.trim().length > 0)
      .slice(0, 2);

    return models.length > 0 ? models : ["暂无模型"];
  }, [summary.topModels]);
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

  function handleTimeRangeChange(nextTimeRangeKey: TokenTimeRangeKey): void {
    setTimeRangeKey(nextTimeRangeKey);
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
          <label className="token-range-control">
            <span>时间范围</span>
            <select
              aria-label="时间范围"
              value={timeRangeKey}
              onChange={(event) => handleTimeRangeChange(event.target.value as TokenTimeRangeKey)}
            >
              {TOKEN_TIME_RANGE_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="summary-card-grid">
        <article className="summary-card">
          <p className="summary-card__label">今日消耗总数</p>
          <p className="summary-card__label">{loading ? "正在刷新 token usage" : "可计量总量"}</p>
          <strong className="summary-card__value">
            {formatInteger(summary.totalTokens)}
            <span className="summary-card__unit">Tokens</span>
          </strong>
          <p className="summary-card__delta">
            实际 {formatInteger(actualTokens)} · 估算 {formatInteger(estimatedTokens)}
          </p>
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
          <p className="summary-card__label">Usage 来源质量</p>
          <strong className="summary-card__value">
            {formatInteger(estimatedCount + unavailableCount)}
          </strong>
          <p className="summary-card__unit">非 actual 记录</p>
          <div className="latency-bars" aria-hidden="true">
            <span style={{ height: "32px" }} />
            <span style={{ height: "44px" }} />
            <span />
            <span style={{ height: "48px" }} />
            <span style={{ height: "28px" }} />
          </div>
          <p className="summary-card__delta">
            <span>估算记录 {formatInteger(estimatedCount)}</span>
            <span> · </span>
            <span>不可用记录 {formatInteger(unavailableCount)}</span>
          </p>
        </article>
      </section>

      <section className="panel trend-panel">
        <div className="panel__header">
          <h2 className="panel__title">7 日消耗趋势分析</h2>
          <div className="trend-panel__legend">
            {topModelLegend.map((model, index) => (
              <span key={model}>
                <i className={`legend-swatch ${index === 0 ? "legend-swatch--blue" : "legend-swatch--black"}`} />
                {model}
              </span>
            ))}
          </div>
        </div>
        {visibleTrendPoints.length > 0 ? (
          <div
            aria-label="Token 消耗趋势"
            className="chart-empty-grid"
            data-testid="token-trend-chart"
            role="img"
            style={{
              alignItems: "stretch",
              gap: "14px",
              gridTemplateRows: "1fr auto",
            }}
          >
            <div
              style={{
                alignItems: "end",
                borderBottom: "1px solid var(--line)",
                display: "grid",
                gap: "14px",
                gridTemplateColumns: `repeat(${visibleTrendPoints.length}, minmax(0, 1fr))`,
                minHeight: "232px",
              }}
            >
              {visibleTrendPoints.map((point, index) => {
                const totalTokens = clampTokenCount(point.totalTokens);
                const inputTokens = clampTokenCount(point.inputTokens);
                const outputTokens = clampTokenCount(point.outputTokens);

                return (
                  <div
                    key={`${point.bucketStartMs}-${index}`}
                    aria-label={`${formatTrendLabel(point)} 总计 ${formatInteger(totalTokens)} tokens，输入 ${formatInteger(inputTokens)}，输出 ${formatInteger(outputTokens)}`}
                    style={{
                      alignItems: "stretch",
                      display: "grid",
                      gap: "6px",
                      gridTemplateRows: "1fr auto auto auto",
                      minWidth: 0,
                    }}
                  >
                    <div
                      data-testid={`token-trend-total-${index}`}
                      data-total-tokens={totalTokens}
                      style={{
                        alignSelf: "end",
                        background: "#e8edf5",
                        border: "1px solid rgba(148, 163, 184, 0.35)",
                        borderRadius: "8px 8px 4px 4px",
                        boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.5)",
                        display: "flex",
                        flexDirection: "column-reverse",
                        height: buildTrendBarHeight(point, maxTrendTotalTokens),
                        minHeight: totalTokens > 0 ? "16px" : "4px",
                        overflow: "hidden",
                        width: "100%",
                      }}
                      title={`总计 ${formatInteger(totalTokens)} tokens`}
                    >
                      <span
                        data-input-tokens={inputTokens}
                        data-testid={`token-trend-input-${index}`}
                        style={buildTrendSegmentStyle(inputTokens, totalTokens, "var(--accent)")}
                        title={`输入 ${formatInteger(inputTokens)}`}
                      />
                      <span
                        data-output-tokens={outputTokens}
                        data-testid={`token-trend-output-${index}`}
                        style={buildTrendSegmentStyle(outputTokens, totalTokens, "#6d28d9")}
                        title={`输出 ${formatInteger(outputTokens)}`}
                      />
                    </div>
                    <strong style={{ color: "#334155", fontSize: "0.78rem", overflowWrap: "anywhere" }}>
                      总计 {formatInteger(totalTokens)}
                    </strong>
                    <span style={{ color: "#64748b", fontSize: "0.72rem", overflowWrap: "anywhere" }}>
                      输入 {formatInteger(inputTokens)}
                    </span>
                    <span style={{ color: "#64748b", fontSize: "0.72rem", overflowWrap: "anywhere" }}>
                      输出 {formatInteger(outputTokens)}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="chart-empty-grid__axis">
              {trendLabels.map((label, index) => (
                <span key={`${label}-${index}`}>{label}</span>
              ))}
            </div>
          </div>
        ) : (
          <div
            aria-label="Token 趋势为空"
            className="chart-empty-grid"
            style={{
              alignItems: "center",
              gap: "20px",
              gridTemplateRows: "1fr auto",
              justifyItems: "center",
            }}
          >
            <p className="small-note">暂无 Token 趋势点</p>
            <div className="chart-empty-grid__axis" style={{ width: "100%" }}>
              {trendLabels.map((label, index) => (
                <span key={`${label}-${index}`}>{label}</span>
              ))}
            </div>
          </div>
        )}
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
            { key: "type", label: "来源类型" },
            { key: "time", label: "触发时间" },
          ]}
          rows={usageItems.map((item) => {
            const sourceType = resolveSourceType(item);
            return {
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
              total: sourceType === "unavailable"
                ? "未提供"
                : <strong>{formatInteger(item.totalTokens)} tokens</strong>,
              type: (
                <div className="row-stack">
                  <span>{sourceType}</span>
                  <span>{formatSourceTypeLabel(sourceType)}</span>
                </div>
              ),
              time: formatTimestamp(item.occurredAtMs),
            };
          })}
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
