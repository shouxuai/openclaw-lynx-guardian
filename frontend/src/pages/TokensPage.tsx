import { startTransition, useEffect, useMemo, useState, type CSSProperties } from "react";
import type {
  TokenSummaryDto,
  TokenTrendBucket,
  TokenTrendDto,
  TokenTrendPointDto,
  TokenUsageListItemDto,
} from "@lynx/local-console-shared";

import { getTokenSummary, getTokenTrend, getTokenUsage } from "../api/tokens";
import type { TokenTimeRangeQuery, TokenUsageListQuery } from "../api/tokens";
import { DataTable } from "../components/tables/DataTable";
import { TablePagination } from "../components/tables/TablePagination";
import { mockTokenSummary, mockTokenTrend, mockTokenUsage } from "../data/mock-console";
import { paginateMockPage, usePagedListResource } from "../hooks/usePagedListResource";
import { formatDateOnly, formatInteger, formatTimestamp } from "../utils/format";

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
const TOKEN_TREND_EMPTY_LABEL_COUNT = 7;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

type TokenTimeRangeKey = "last1h" | "last24h" | "last7d" | "last30d" | "all";

type TokenTrendDisplaySlot = {
  key: string;
  label: string;
  point?: TokenTrendPointDto;
};

const TOKEN_TIME_RANGE_OPTIONS: Array<{
  bucket: TokenTrendBucket;
  durationMs?: number;
  key: TokenTimeRangeKey;
  label: string;
  trendTitle: string;
}> = [
  { key: "last1h", label: "最近 1 小时", trendTitle: "最近 1 小时消耗趋势", durationMs: HOUR_MS, bucket: "hour" },
  { key: "last24h", label: "最近 24 小时", trendTitle: "最近 24 小时消耗趋势", durationMs: DAY_MS, bucket: "hour" },
  { key: "last7d", label: "最近 7 天", trendTitle: "最近 7 天消耗趋势", durationMs: 7 * DAY_MS, bucket: "day" },
  { key: "last30d", label: "最近 30 天", trendTitle: "最近 30 天消耗趋势", durationMs: 30 * DAY_MS, bucket: "day" },
  { key: "all", label: "全部时间", trendTitle: "全部时间消耗趋势", bucket: "day" },
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

function formatHourLabel(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function formatTrendLabel(point: TokenTrendPointDto, bucket: TokenTrendBucket): string {
  return bucket === "hour" ? formatHourLabel(point.bucketStartMs) : formatDateOnly(point.bucketStartMs);
}

function formatTrendBucketLabel(bucketStartMs: number, bucket: TokenTrendBucket): string {
  return bucket === "hour" ? formatHourLabel(bucketStartMs) : formatDateOnly(bucketStartMs);
}

function clampTokenCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function buildTrendBarHeight(point: TokenTrendPointDto, maxTotalTokens: number): string {
  const totalTokens = clampTokenCount(point.totalTokens);
  if (totalTokens === 0 || maxTotalTokens === 0) {
    return "2%";
  }

  return `${Math.max((totalTokens / maxTotalTokens) * 100, 18)}%`;
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

function resolveTokenTimeRangeOption(key: TokenTimeRangeKey) {
  return TOKEN_TIME_RANGE_OPTIONS.find((item) => item.key === key) ?? TOKEN_TIME_RANGE_OPTIONS[1];
}

function floorToTrendBucket(timestamp: number, bucket: TokenTrendBucket): number {
  const date = new Date(timestamp);
  if (bucket === "hour") {
    date.setMinutes(0, 0, 0);
    return date.getTime();
  }

  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function mergeTrendPoint(existing: TokenTrendPointDto | undefined, point: TokenTrendPointDto, bucketStartMs: number): TokenTrendPointDto {
  return {
    bucketStartMs,
    inputTokens: clampTokenCount(existing?.inputTokens ?? 0) + clampTokenCount(point.inputTokens),
    outputTokens: clampTokenCount(existing?.outputTokens ?? 0) + clampTokenCount(point.outputTokens),
    totalTokens: clampTokenCount(existing?.totalTokens ?? 0) + clampTokenCount(point.totalTokens),
  };
}

function buildTrendDisplaySlots(
  points: TokenTrendPointDto[],
  bucket: TokenTrendBucket,
  option: ReturnType<typeof resolveTokenTimeRangeOption>,
  query: TokenTimeRangeQuery,
): TokenTrendDisplaySlot[] {
  const visiblePoints = points.slice(-TOKEN_TREND_POINT_LIMIT);
  if (!option.durationMs || query.fromMs === undefined || query.toMs === undefined) {
    if (visiblePoints.length > 0) {
      return visiblePoints.map((point, index) => ({
        key: `${point.bucketStartMs}-${index}`,
        label: formatTrendLabel(point, bucket),
        point,
      }));
    }

    return buildEmptyTrendLabels(option, query).map((label, index) => ({
      key: `empty-${index}-${label}`,
      label,
    }));
  }

  const unitMs = bucket === "hour" ? HOUR_MS : DAY_MS;
  const slotCount = option.key === "last1h" ? 1 : TOKEN_TREND_POINT_LIMIT;
  const totalUnits = Math.max(1, Math.ceil((query.toMs - query.fromMs) / unitMs));
  const unitsPerSlot = Math.max(1, Math.ceil(totalUnits / slotCount));
  const endBucketStartMs = floorToTrendBucket(query.toMs, bucket);
  const firstBucketStartMs = endBucketStartMs - (slotCount * unitsPerSlot - 1) * unitMs;

  const slots: TokenTrendDisplaySlot[] = Array.from({ length: slotCount }, (_, index) => {
    const bucketStartMs = firstBucketStartMs + index * unitsPerSlot * unitMs;
    return {
      key: `${bucketStartMs}-${index}`,
      label: formatTrendBucketLabel(bucketStartMs, bucket),
    };
  });

  let mappedPointCount = 0;
  for (const point of visiblePoints) {
    const pointBucketStartMs = floorToTrendBucket(point.bucketStartMs, bucket);
    const slotIndex = Math.floor((pointBucketStartMs - firstBucketStartMs) / (unitsPerSlot * unitMs));
    if (slotIndex < 0 || slotIndex >= slots.length) {
      continue;
    }

    const slotBucketStartMs = firstBucketStartMs + slotIndex * unitsPerSlot * unitMs;
    slots[slotIndex] = {
      ...slots[slotIndex],
      point: mergeTrendPoint(slots[slotIndex].point, point, slotBucketStartMs),
    };
    mappedPointCount += 1;
  }

  if (mappedPointCount === 0 && visiblePoints.length > 0) {
    const startIndex = Math.max(0, slots.length - visiblePoints.length);
    visiblePoints.forEach((point, index) => {
      const slotIndex = startIndex + index;
      if (!slots[slotIndex]) {
        return;
      }

      slots[slotIndex] = {
        ...slots[slotIndex],
        point: {
          ...point,
          bucketStartMs: floorToTrendBucket(point.bucketStartMs, bucket),
        },
      };
    });
  }

  return slots;
}

function buildEmptyTrendLabels(option: ReturnType<typeof resolveTokenTimeRangeOption>, query: TokenTimeRangeQuery): string[] {
  const toMs = query.toMs ?? Date.now();
  const fromMs = query.fromMs ?? (toMs - (option.durationMs ?? 6 * DAY_MS));
  const spanMs = Math.max(toMs - fromMs, option.bucket === "hour" ? HOUR_MS : DAY_MS);
  const stepMs = TOKEN_TREND_EMPTY_LABEL_COUNT > 1 ? spanMs / (TOKEN_TREND_EMPTY_LABEL_COUNT - 1) : spanMs;

  return Array.from({ length: TOKEN_TREND_EMPTY_LABEL_COUNT }, (_, index) => {
    const tickMs = Math.round(fromMs + stepMs * index);
    return option.bucket === "hour" ? formatHourLabel(tickMs) : formatDateOnly(tickMs);
  });
}

function formatActualUsageSummary(
  actualTokens: number,
  estimatedTokens: number,
  estimatedCount: number,
  unavailableCount: number,
): string {
  if (actualTokens > 0) {
    return `实际 ${formatInteger(actualTokens)} · 估算 ${formatInteger(estimatedTokens)}`;
  }

  if (estimatedTokens > 0 || estimatedCount > 0) {
    return `实际未返回：模型未提供 usage · 估算 ${formatInteger(estimatedTokens)}`;
  }

  if (unavailableCount > 0) {
    return "实际未返回：模型未提供 usage";
  }

  return "暂无 usage 数据";
}

function buildTrendAxisLabels(maxTotalTokens: number): string[] {
  const safeMax = clampTokenCount(maxTotalTokens);
  if (safeMax === 0) {
    return ["0", "0", "0"];
  }

  return [
    formatInteger(safeMax),
    formatInteger(Math.round(safeMax / 2)),
    "0",
  ];
}

export function TokensPage() {
  const [summary, setSummary] = useState<TokenSummaryDto>(EMPTY_TOKEN_SUMMARY);
  const [trend, setTrend] = useState<TokenTrendDto>(EMPTY_TOKEN_TREND);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [trendLoading, setTrendLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeRangeKey, setTimeRangeKey] = useState<TokenTimeRangeKey>("last24h");

  const selectedTimeRangeOption = useMemo(() => resolveTokenTimeRangeOption(timeRangeKey), [timeRangeKey]);
  const selectedTimeRange = useMemo(() => resolveTokenTimeRange(timeRangeKey), [timeRangeKey]);
  const {
    items: usageItems,
    loading: usageLoading,
    error: usageError,
    paginationProps: usagePaginationProps,
    retry: retryUsage,
    resetPaging: resetUsagePaging,
  } = usePagedListResource<TokenUsageListItemDto, TokenUsageListQuery>({
    fallbackPage: import.meta.env.DEV
      ? (_query, pageIndex, pageSize) => paginateMockPage(mockTokenUsage, pageIndex, pageSize)
      : undefined,
    loadPage: getTokenUsage,
    query: selectedTimeRange.query,
  });

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

  const measurableTokens = summary.measurableTokens ?? summary.totalTokens;
  const measurableInputTokens = summary.measurableInputTokens ?? summary.inputTokens;
  const measurableOutputTokens = summary.measurableOutputTokens ?? summary.outputTokens;
  const totalTransferTokens = measurableInputTokens + measurableOutputTokens;
  const inputPercent = percent(measurableInputTokens, totalTransferTokens);
  const outputPercent = percent(measurableOutputTokens, totalTransferTokens);
  const estimatedCount = summary.estimatedCount ?? 0;
  const unavailableCount = summary.unavailableCount ?? 0;
  const actualTokens = summary.actualTokens ?? 0;
  const estimatedTokens = summary.estimatedTokens ?? 0;
  const actualUsageSummary = formatActualUsageSummary(actualTokens, estimatedTokens, estimatedCount, unavailableCount);
  const trendSlots = useMemo(
    () => buildTrendDisplaySlots(trend.points, trend.bucket, selectedTimeRangeOption, selectedTimeRange.query),
    [selectedTimeRange.query, selectedTimeRangeOption, trend.bucket, trend.points],
  );
  const hasTrendPoints = trendSlots.some((slot) => slot.point);
  const maxTrendTotalTokens = Math.max(...trendSlots.map((slot) => clampTokenCount(slot.point?.totalTokens ?? 0)), 0);
  const trendAxisLabels = useMemo(() => buildTrendAxisLabels(maxTrendTotalTokens), [maxTrendTotalTokens]);
  const topModelLegend = useMemo(() => {
    const models = summary.topModels
      .map((item) => item.model)
      .filter((model) => model.trim().length > 0)
      .slice(0, 2);

    return models.length > 0 ? models : ["暂无模型"];
  }, [summary.topModels]);
  const loading = summaryLoading || usageLoading || trendLoading;
  const combinedError = error ?? usageError;
  const loadStatus = combinedError ? `实时数据不可用：${combinedError}` : loading ? "正在刷新中" : "实时刷新中";

  function handleTimeRangeChange(nextTimeRangeKey: TokenTimeRangeKey): void {
    setTimeRangeKey(nextTimeRangeKey);
    resetUsagePaging();
  }

  return (
    <div className="page-stack">
      <section className="token-hero">
        <div>
          <h1 className="sr-only">Token 统计报表</h1>
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
          <p className="summary-card__label">当前范围消耗总数</p>
          <p className="summary-card__label">{loading ? "正在刷新 token usage" : "可计量总量"}</p>
          <strong className="summary-card__value">
            {formatInteger(measurableTokens)}
            <span className="summary-card__unit">Tokens</span>
          </strong>
          <p className="summary-card__delta">
            {actualUsageSummary}
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
          <div
            className="ratio-ring"
            style={{
              background: totalTransferTokens > 0
                ? `conic-gradient(var(--accent) 0 ${inputPercent * 3.6}deg, #6d28d9 ${inputPercent * 3.6}deg 360deg)`
                : undefined,
            }}
          >
            <strong>{formatRatio(measurableInputTokens, measurableOutputTokens)}</strong>
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
          <h2 className="panel__title">{selectedTimeRangeOption.trendTitle}</h2>
          <div className="trend-panel__legend">
            {topModelLegend.map((model, index) => (
              <span key={model}>
                <i className={`legend-swatch ${index === 0 ? "legend-swatch--blue" : "legend-swatch--black"}`} />
                {model}
              </span>
            ))}
          </div>
        </div>
        {hasTrendPoints ? (
          <div
            aria-label="Token 消耗趋势"
            className="chart-empty-grid token-trend-chart"
            data-testid="token-trend-chart"
            role="img"
            style={{ "--token-trend-slot-count": trendSlots.length } as CSSProperties}
          >
            <div className="token-trend-body">
              <div className="token-trend-y-axis" data-testid="token-trend-y-axis" aria-label="Token 纵轴">
                {trendAxisLabels.map((label, index) => (
                  <span key={`${label}-${index}`}>{label}</span>
                ))}
              </div>
              <div
                className="token-trend-plot"
                style={{ "--token-trend-slot-count": trendSlots.length } as CSSProperties}
              >
                <div className="token-trend-gridlines" aria-hidden="true">
                  {trendAxisLabels.map((label, index) => (
                    <span className="token-trend-gridline" key={`${label}-${index}`} />
                  ))}
                </div>
                {trendSlots.map((slot, index) => {
                  const point = slot.point;
                  if (!point) {
                    return (
                      <div
                        key={slot.key}
                        className="token-trend-slot token-trend-slot--empty"
                        data-testid={`token-trend-slot-${index}`}
                        data-token-trend-slot="empty"
                      >
                        <span className="token-trend-empty-marker" title={`${slot.label} 暂无 token usage`} />
                      </div>
                    );
                  }

                  const totalTokens = clampTokenCount(point.totalTokens);
                  const inputTokens = clampTokenCount(point.inputTokens);
                  const outputTokens = clampTokenCount(point.outputTokens);

                  return (
                    <div
                      key={slot.key}
                      aria-label={`${slot.label} 总计 ${formatInteger(totalTokens)} tokens，输入 ${formatInteger(inputTokens)}，输出 ${formatInteger(outputTokens)}`}
                      className="token-trend-slot"
                      data-testid={`token-trend-slot-${index}`}
                      data-token-trend-slot="filled"
                    >
                      <div
                        className="token-trend-bar"
                        data-testid={`token-trend-total-${index}`}
                        data-total-tokens={totalTokens}
                        style={{
                          height: buildTrendBarHeight(point, maxTrendTotalTokens),
                          minHeight: totalTokens > 0 ? "48px" : "4px",
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
                      <strong className="token-trend-value">
                        总计 {formatInteger(totalTokens)}
                      </strong>
                      <span className="token-trend-meta">
                        输入 {formatInteger(inputTokens)}
                      </span>
                      <span className="token-trend-meta">
                        输出 {formatInteger(outputTokens)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="chart-empty-grid__axis">
              {trendSlots.map((slot, index) => (
                <span key={`${slot.label}-${index}`}>{slot.label}</span>
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
              {trendSlots.map((slot, index) => (
                <span key={`${slot.label}-${index}`}>{slot.label}</span>
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
          error={usageError}
          loading={usageLoading}
          onRetry={retryUsage}
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
          {...usagePaginationProps}
        />
      </section>
    </div>
  );
}
