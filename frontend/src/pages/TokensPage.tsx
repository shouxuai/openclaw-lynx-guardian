import { startTransition, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type {
  TokenHeatmapDto,
  TokenSummaryDto,
  TokenTrendBucket,
  TokenTrendDto,
  TokenTrendPointDto,
  TokenUsageListItemDto,
} from "@lynx/local-console-shared";

import { getTokenHeatmap, getTokenSummary, getTokenTrend, getTokenUsage } from "../api/tokens";
import type { TokenTimeRangeQuery, TokenUsageListQuery } from "../api/tokens";
import { PageHeader } from "../components/layout/PageHeader";
import { DataTable } from "../components/tables/DataTable";
import { TablePagination } from "../components/tables/TablePagination";
import { mockTokenHeatmap, mockTokenSummary, mockTokenTrend, mockTokenUsage } from "../data/mock-console";
import { paginateMockPage, usePagedListResource } from "../hooks/usePagedListResource";
import { formatCompactTokens, formatDateOnly, formatInteger, formatTimestamp } from "../utils/format";

const WEEKDAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const TOKEN_TREND_POINT_LIMIT = 7;
const TOKEN_TREND_CHART_WIDTH = 720;
const TOKEN_TREND_CHART_HEIGHT = 132;
const TOKEN_TREND_CHART_PADDING = {
  bottom: 16,
  left: 14,
  right: 14,
  top: 12,
};
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

type TokenTimeRangeKey = "last1h" | "last24h" | "last7d" | "last30d" | "all";
type TokenTrendMode = "total" | "byType";

type TokenTimeRangeOption = {
  bucket: TokenTrendBucket;
  durationMs?: number;
  key: TokenTimeRangeKey;
  label: string;
  trendTitle: string;
};

type TrendSlot = {
  key: string;
  point?: TokenTrendPointDto;
  title: string;
};

type BreakdownRow = {
  className: string;
  key: string;
  label: string;
  value: number;
};

type TrendSeriesKey = "total" | "input" | "output" | "cacheRead" | "cacheWrite";

type TrendCoordinate = {
  key: string;
  title: string;
  value: number;
  x: number;
  y: number;
};

type TrendSeriesDefinition = {
  className: string;
  key: TrendSeriesKey;
  label: string;
  testId: string;
};

type TokenTrendPointWithOptionalCache = TokenTrendPointDto & {
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
};

type TokenUsageListItemWithOptionalOrigin = TokenUsageListItemDto & {
  sourceOrigin?: "hook" | "transcript";
};

const TOKEN_TREND_SERIES: TrendSeriesDefinition[] = [
  { key: "input", label: "上下文输入", testId: "token-trend-line-input", className: "token-trend-line--input" },
  { key: "output", label: "模型输出", testId: "token-trend-line-output", className: "token-trend-line--output" },
  {
    key: "cacheRead",
    label: "缓存读取",
    testId: "token-trend-line-cache-read",
    className: "token-trend-line--cache-read",
  },
  {
    key: "cacheWrite",
    label: "缓存写入",
    testId: "token-trend-line-cache-write",
    className: "token-trend-line--cache-write",
  },
];

const TOKEN_TIME_RANGE_OPTIONS: TokenTimeRangeOption[] = [
  { key: "last1h", label: "最近 1 小时", trendTitle: "最近 1 小时消耗趋势", durationMs: HOUR_MS, bucket: "hour" },
  { key: "last24h", label: "最近 24 小时", trendTitle: "最近 24 小时消耗趋势", durationMs: DAY_MS, bucket: "hour" },
  { key: "last7d", label: "最近 7 天", trendTitle: "最近 7 天消耗趋势", durationMs: 7 * DAY_MS, bucket: "day" },
  { key: "last30d", label: "最近 30 天", trendTitle: "最近 30 天消耗趋势", durationMs: 30 * DAY_MS, bucket: "day" },
  { key: "all", label: "全部时间", trendTitle: "全部时间消耗趋势", bucket: "day" },
];

const EMPTY_TOKEN_SUMMARY: TokenSummaryDto = {
  totalTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  actualTokens: 0,
  estimatedTokens: 0,
  measurableTokens: 0,
  measurableInputTokens: 0,
  measurableOutputTokens: 0,
  measurableCacheReadTokens: 0,
  measurableCacheWriteTokens: 0,
  estimatedCount: 0,
  unavailableCount: 0,
  topModels: [],
};

const EMPTY_TOKEN_TREND: TokenTrendDto = {
  bucket: "hour",
  points: [],
};

const EMPTY_TOKEN_HEATMAP: TokenHeatmapDto = {
  timeZone: "local",
  totalTokens: 0,
  hourTotals: Array.from({ length: 24 }, (_, hour) => ({ hour, totalTokens: 0 })),
  weekdayTotals: WEEKDAY_LABELS.map((label, weekday) => ({
    weekday,
    label,
    totalTokens: 0,
  })),
};

function resolveTokenTimeRangeOption(key: TokenTimeRangeKey): TokenTimeRangeOption {
  return TOKEN_TIME_RANGE_OPTIONS.find((item) => item.key === key) ?? TOKEN_TIME_RANGE_OPTIONS[1];
}

function resolveTokenTimeRange(key: TokenTimeRangeKey): { bucket: TokenTrendBucket; query: TokenTimeRangeQuery } {
  const option = resolveTokenTimeRangeOption(key);
  if (option.durationMs === undefined) {
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

function clampTokenCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function percent(value: number, total: number): number {
  if (total <= 0) {
    return 0;
  }

  return Math.round((value / total) * 100);
}

function resolveSourceType(item: TokenUsageListItemDto): "actual" | "estimated" | "unavailable" {
  return item.sourceType ?? (item.isEstimated ? "estimated" : "actual");
}

function formatSourceTypeLabel(sourceType: "actual" | "estimated" | "unavailable"): string {
  const labels: Record<typeof sourceType, string> = {
    actual: "实际",
    estimated: "估算",
    unavailable: "不可用",
  };

  return labels[sourceType];
}

function formatSourceOriginLabel(sourceOrigin?: "hook" | "transcript"): string {
  if (sourceOrigin === "hook") {
    return "实时 hook";
  }

  if (sourceOrigin === "transcript") {
    return "Transcript 回填";
  }

  return "未知来源";
}

function formatHourLabel(timestampMs: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
  }).format(new Date(timestampMs));
}

function formatTrendBucketLabel(bucketStartMs: number, bucket: TokenTrendBucket): string {
  return bucket === "hour" ? formatHourLabel(bucketStartMs) : formatDateOnly(bucketStartMs);
}

function buildTrendAxisLabels(maxTotalTokens: number): string[] {
  const safeMax = clampTokenCount(maxTotalTokens);
  if (safeMax === 0) {
    return ["0", "0", "0"];
  }

  return [formatCompactTokens(safeMax), formatCompactTokens(Math.round(safeMax / 2)), "0"];
}

function buildBreakdownRows(summary: TokenSummaryDto): BreakdownRow[] {
  const inputTokens = summary.measurableInputTokens ?? summary.inputTokens ?? 0;
  const outputTokens = summary.measurableOutputTokens ?? summary.outputTokens ?? 0;
  const cacheReadTokens = summary.measurableCacheReadTokens ?? summary.cacheReadTokens ?? 0;
  const cacheWriteTokens = summary.measurableCacheWriteTokens ?? summary.cacheWriteTokens ?? 0;

  return [
    { key: "input", label: "上下文输入", value: inputTokens, className: "token-breakdown-segment--input" },
    { key: "output", label: "模型输出", value: outputTokens, className: "token-breakdown-segment--output" },
    { key: "cache-read", label: "缓存读取", value: cacheReadTokens, className: "token-breakdown-segment--cache-read" },
    { key: "cache-write", label: "缓存写入", value: cacheWriteTokens, className: "token-breakdown-segment--cache-write" },
  ];
}

function buildTrendSlots(points: TokenTrendPointDto[], bucket: TokenTrendBucket): TrendSlot[] {
  return points.slice(-TOKEN_TREND_POINT_LIMIT).map((point, index) => ({
    key: `${point.bucketStartMs}-${index}`,
    point,
    title: formatTrendBucketLabel(point.bucketStartMs, bucket),
  }));
}

function getTrendSeriesValue(point: TokenTrendPointDto, seriesKey: TrendSeriesKey): number {
  const pointWithCache = point as TokenTrendPointWithOptionalCache;

  if (seriesKey === "input") {
    return point.inputTokens;
  }

  if (seriesKey === "output") {
    return point.outputTokens;
  }

  if (seriesKey === "cacheRead") {
    return pointWithCache.cacheReadTokens ?? 0;
  }

  if (seriesKey === "cacheWrite") {
    return pointWithCache.cacheWriteTokens ?? 0;
  }

  return point.totalTokens;
}

function buildTrendCoordinates(
  points: TokenTrendPointDto[],
  bucket: TokenTrendBucket,
  seriesKey: TrendSeriesKey,
  maxTotalTokens: number,
): TrendCoordinate[] {
  const plotWidth = TOKEN_TREND_CHART_WIDTH - TOKEN_TREND_CHART_PADDING.left - TOKEN_TREND_CHART_PADDING.right;
  const plotHeight = TOKEN_TREND_CHART_HEIGHT - TOKEN_TREND_CHART_PADDING.top - TOKEN_TREND_CHART_PADDING.bottom;
  const denominator = Math.max(1, points.length - 1);
  const safeMax = Math.max(1, clampTokenCount(maxTotalTokens));

  return points.map((point, index) => {
    const value = clampTokenCount(getTrendSeriesValue(point, seriesKey));
    const ratio = Math.min(1, value / safeMax);
    return {
      key: `${seriesKey}-${point.bucketStartMs}-${index}`,
      title: `${formatTrendBucketLabel(point.bucketStartMs, bucket)} · ${formatCompactTokens(value)} tokens`,
      value,
      x: TOKEN_TREND_CHART_PADDING.left + (plotWidth * index) / denominator,
      y: TOKEN_TREND_CHART_PADDING.top + (1 - ratio) * plotHeight,
    };
  });
}

function formatTrendCoordinates(coordinates: TrendCoordinate[]): string {
  return coordinates.map((coordinate) => `${coordinate.x.toFixed(1)},${coordinate.y.toFixed(1)}`).join(" ");
}

function buildTrendAreaPath(coordinates: TrendCoordinate[]): string {
  if (coordinates.length === 0) {
    return "";
  }

  const baselineY = TOKEN_TREND_CHART_HEIGHT - TOKEN_TREND_CHART_PADDING.bottom;
  const [firstCoordinate] = coordinates;
  const lastCoordinate = coordinates[coordinates.length - 1] ?? firstCoordinate;
  const linePath = coordinates.map((coordinate) => `L ${coordinate.x.toFixed(1)} ${coordinate.y.toFixed(1)}`).join(" ");

  return [
    `M ${firstCoordinate.x.toFixed(1)} ${baselineY.toFixed(1)}`,
    linePath,
    `L ${lastCoordinate.x.toFixed(1)} ${baselineY.toFixed(1)}`,
    "Z",
  ].join(" ");
}

function formatUsageIoLabel(item: TokenUsageListItemDto): string {
  return `${formatCompactTokens(item.inputTokens)} -> ${formatCompactTokens(item.outputTokens)}`;
}

function formatUsageIoTitle(item: TokenUsageListItemDto): string {
  return `${formatInteger(item.inputTokens)} -> ${formatInteger(item.outputTokens)}`;
}

function resolveHeatmapLevel(totalTokens: number, maxTokens: number): number {
  const safeMax = clampTokenCount(maxTokens);
  if (safeMax === 0) {
    return 0;
  }

  return Math.min(4, Math.floor((clampTokenCount(totalTokens) / safeMax) * 5));
}

export function TokensPage() {
  const [summary, setSummary] = useState<TokenSummaryDto>(EMPTY_TOKEN_SUMMARY);
  const [trend, setTrend] = useState<TokenTrendDto>(EMPTY_TOKEN_TREND);
  const [heatmap, setHeatmap] = useState<TokenHeatmapDto>(EMPTY_TOKEN_HEATMAP);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [trendLoading, setTrendLoading] = useState(true);
  const [heatmapLoading, setHeatmapLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeRangeKey, setTimeRangeKey] = useState<TokenTimeRangeKey>("last24h");
  const [trendMode, setTrendMode] = useState<TokenTrendMode>("total");

  const selectedTimeRangeOption = useMemo(() => resolveTokenTimeRangeOption(timeRangeKey), [timeRangeKey]);
  const selectedTimeRange = useMemo(() => resolveTokenTimeRange(timeRangeKey), [timeRangeKey]);
  const trendPoints = useMemo(() => trend.points.slice(-TOKEN_TREND_POINT_LIMIT), [trend.points]);
  const trendSlots = useMemo(() => buildTrendSlots(trendPoints, trend.bucket), [trend.bucket, trendPoints]);
  const maxTrendTotalTokens = useMemo(
    () => Math.max(0, ...trendPoints.map((point) => clampTokenCount(point.totalTokens))),
    [trendPoints],
  );
  const trendAxisLabels = useMemo(() => buildTrendAxisLabels(maxTrendTotalTokens), [maxTrendTotalTokens]);
  const totalTrendCoordinates = useMemo(
    () => buildTrendCoordinates(trendPoints, trend.bucket, "total", maxTrendTotalTokens),
    [maxTrendTotalTokens, trend.bucket, trendPoints],
  );
  const totalTrendLinePoints = useMemo(() => formatTrendCoordinates(totalTrendCoordinates), [totalTrendCoordinates]);
  const totalTrendAreaPath = useMemo(() => buildTrendAreaPath(totalTrendCoordinates), [totalTrendCoordinates]);
  const typedTrendSeries = useMemo(
    () => TOKEN_TREND_SERIES.map((series) => ({
      ...series,
      coordinates: buildTrendCoordinates(trendPoints, trend.bucket, series.key, maxTrendTotalTokens),
    })),
    [maxTrendTotalTokens, trend.bucket, trendPoints],
  );
  const breakdownRows = useMemo(() => buildBreakdownRows(summary), [summary]);
  const breakdownTotal = useMemo(() => breakdownRows.reduce((total, row) => total + row.value, 0), [breakdownRows]);
  const summaryTotalTokens = Math.max(summary.totalTokens ?? 0, breakdownTotal);
  const summaryInputTokens = breakdownRows[0]?.value ?? 0;
  const summaryOutputTokens = breakdownRows[1]?.value ?? 0;
  const summaryCacheTokens = (breakdownRows[2]?.value ?? 0) + (breakdownRows[3]?.value ?? 0);
  const actualTokens = summary.actualTokens ?? 0;
  const estimatedTokens = summary.estimatedTokens ?? 0;
  const maxWeekdayTokens = useMemo(
    () => Math.max(1, ...heatmap.weekdayTotals.map((item) => clampTokenCount(item.totalTokens))),
    [heatmap.weekdayTotals],
  );
  const maxHourTokens = useMemo(
    () => Math.max(1, ...heatmap.hourTotals.map((item) => clampTokenCount(item.totalTokens))),
    [heatmap.hourTotals],
  );
  const loadStatus = error
    ? `实时 token 数据不可用：${error}`
    : summaryLoading || trendLoading || heatmapLoading
      ? "正在刷新实时 token 数据"
      : "实时刷新完成";
  const hasTrendPoints = trendSlots.length > 0;

  const {
    items: usageItems,
    loading: usageLoading,
    error: usageError,
    paginationProps: usagePaginationProps,
    retry: retryUsage,
    resetPaging: resetUsagePaging,
    total: usageTotal,
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

        const message = loadError instanceof Error ? loadError.message : "加载 summary 失败";
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
        const nextTrend = await getTokenTrend(selectedTimeRangeOption.bucket, selectedTimeRange.query);
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

        const message = loadError instanceof Error ? loadError.message : "加载 trend 失败";
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
  }, [selectedTimeRange.query, selectedTimeRangeOption.bucket]);

  useEffect(() => {
    const abortController = new AbortController();

    async function loadHeatmap() {
      startTransition(() => {
        setHeatmapLoading(true);
      });

      try {
        const nextHeatmap = await getTokenHeatmap(selectedTimeRange.query);
        if (abortController.signal.aborted) {
          return;
        }

        startTransition(() => {
          setHeatmap(nextHeatmap);
          setError(null);
          setHeatmapLoading(false);
        });
      } catch (loadError) {
        if (abortController.signal.aborted) {
          return;
        }

        const message = loadError instanceof Error ? loadError.message : "加载 heatmap 失败";
        startTransition(() => {
          setHeatmap(import.meta.env.DEV ? mockTokenHeatmap : EMPTY_TOKEN_HEATMAP);
          setError(import.meta.env.DEV ? null : message);
          setHeatmapLoading(false);
        });
      }
    }

    void loadHeatmap();
    return () => {
      abortController.abort();
    };
  }, [selectedTimeRange.query]);

  function handleTimeRangeChange(nextTimeRangeKey: TokenTimeRangeKey): void {
    setTimeRangeKey(nextTimeRangeKey);
    resetUsagePaging();
  }

  function renderTrendLineChart(): ReactNode {
    const plotHeight = TOKEN_TREND_CHART_HEIGHT - TOKEN_TREND_CHART_PADDING.top - TOKEN_TREND_CHART_PADDING.bottom;
    const axisDenominator = Math.max(1, trendAxisLabels.length - 1);
    const latestPoint = trendPoints.at(-1);
    const peakTokens = Math.max(0, ...trendPoints.map((point) => clampTokenCount(point.totalTokens)));

    return (
      <div
        aria-label="Token 趋势"
        className="trend-line-shell token-trend-chart"
        data-testid="token-trend-chart"
        role="img"
      >
        <svg
          aria-label="Token 消耗趋势折线图"
          className="trend-line-chart token-trend-line-chart"
          data-testid="token-trend-line-chart"
          role="img"
          viewBox={`0 0 ${TOKEN_TREND_CHART_WIDTH} ${TOKEN_TREND_CHART_HEIGHT}`}
        >
          <defs>
            <linearGradient id="tokenTrendArea" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--token-total)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--token-total)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <g className="trend-line-chart__grid token-trend-line-grid" aria-hidden="true">
            {trendAxisLabels.map((label, index) => {
              const y = TOKEN_TREND_CHART_PADDING.top + (plotHeight * index) / axisDenominator;
              return (
                <g key={`${label}-${index}`}>
                  <text x={TOKEN_TREND_CHART_PADDING.left + 4} y={y - 4} textAnchor="start">
                    {label}
                  </text>
                  <line
                    x1={TOKEN_TREND_CHART_PADDING.left}
                    x2={TOKEN_TREND_CHART_WIDTH - TOKEN_TREND_CHART_PADDING.right}
                    y1={y}
                    y2={y}
                  />
                </g>
              );
            })}
          </g>

          {trendMode === "total" ? (
            <>
              <path
                className="trend-line-chart__area token-trend-area"
                d={totalTrendAreaPath}
                data-testid="token-trend-area"
              />
              <polyline
                className="trend-line-chart__line token-trend-line token-trend-line--total"
                data-testid="token-trend-line"
                points={totalTrendLinePoints}
              />
              <g className="trend-line-chart__points token-trend-points">
                {totalTrendCoordinates.map((coordinate, index) => (
                  <circle
                    aria-label={coordinate.title}
                    cx={coordinate.x}
                    cy={coordinate.y}
                    data-testid={`token-trend-point-${index}`}
                    key={coordinate.key}
                    r="4"
                  />
                ))}
              </g>
            </>
          ) : (
            <g className="token-trend-series-lines">
              {typedTrendSeries.map((series) => (
                <polyline
                  className={`trend-line-chart__line token-trend-line ${series.className}`}
                  data-testid={series.testId}
                  key={series.key}
                  points={formatTrendCoordinates(series.coordinates)}
                >
                  <title>{series.label}</title>
                </polyline>
              ))}
            </g>
          )}

          <g className="trend-line-chart__labels token-trend-x-labels" aria-hidden="true">
            {totalTrendCoordinates.map((coordinate, index) => (
              <text
                key={`${coordinate.key}-label`}
                x={coordinate.x}
                y={TOKEN_TREND_CHART_HEIGHT - 3}
                textAnchor={index === 0 ? "start" : index === totalTrendCoordinates.length - 1 ? "end" : "middle"}
              >
                {trendSlots[index]?.title ?? ""}
              </text>
            ))}
          </g>
        </svg>

        <div className="trend-line-foot token-trend-foot">
          <span>
            峰值 <strong>{formatCompactTokens(peakTokens)}</strong>
          </span>
          <span>
            最新 <strong>{formatCompactTokens(latestPoint?.totalTokens ?? 0)}</strong>
          </span>
          <span>
            输出 <strong>{formatCompactTokens(latestPoint?.outputTokens ?? 0)}</strong>
          </span>
        </div>

        <dl className="sr-only">
          {trendPoints.map((point, index) => (
            <div key={`${point.bucketStartMs}-${index}`}>
              <dt>{formatTrendBucketLabel(point.bucketStartMs, trend.bucket)}</dt>
              <dd>
                <span>{formatInteger(point.totalTokens)}</span>
              </dd>
              <dd>
                <span>{formatInteger(point.inputTokens)}</span>
              </dd>
              <dd>
                <span>{formatInteger(point.outputTokens)}</span>
              </dd>
              <dd>
                <span>{formatInteger((point as TokenTrendPointWithOptionalCache).cacheReadTokens ?? 0)}</span>
              </dd>
              <dd>
                <span>{formatInteger((point as TokenTrendPointWithOptionalCache).cacheWriteTokens ?? 0)}</span>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }

  function renderHeatmapCell(
    label: string,
    totalTokens: number,
    title: string,
    testId: string,
    className: string,
    key: string,
  ): ReactNode {
    return (
      <div aria-label={title} className={className} data-testid={testId} key={key} title={title}>
        <span className="token-heatmap-cell__swatch" aria-hidden="true" />
        <span className="token-mosaic-cell__label">{label}</span>
        <strong className="token-mosaic-cell__value">{formatCompactTokens(totalTokens)}</strong>
      </div>
    );
  }

  return (
    <div className="page-stack token-page">
      <PageHeader
        title="Token 分析"
        description="查看总量、来源、趋势和热力分布，快速定位 token 消耗结构。"
        eyebrow="TOKEN ANALYTICS"
        actions={(
          <label className="token-range-control">
            <span>时间范围</span>
            <select
              aria-label="时间范围"
              value={timeRangeKey}
              onChange={(event) => handleTimeRangeChange(event.target.value as TokenTimeRangeKey)}
            >
              {TOKEN_TIME_RANGE_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        )}
      />

      <section className="token-metric-strip metric-grid metric-grid--compact">
        <article className="metric-card">
          <p className="metric-card__label">总量</p>
          <strong className="metric-card__value" title={`${formatInteger(summaryTotalTokens)} tokens`}>
            {formatCompactTokens(summaryTotalTokens)}
          </strong>
          <p className="metric-card__note">实际 {formatCompactTokens(actualTokens)} · 估算 {formatCompactTokens(estimatedTokens)}</p>
        </article>
        <article className="metric-card">
          <p className="metric-card__label">上下文输入</p>
          <strong className="metric-card__value" title={`${formatInteger(summaryInputTokens)} tokens`}>
            {formatCompactTokens(summaryInputTokens)}
          </strong>
          <p className="metric-card__note">可观测输入负载</p>
        </article>
        <article className="metric-card">
          <p className="metric-card__label">模型输出</p>
          <strong className="metric-card__value" title={`${formatInteger(summaryOutputTokens)} tokens`}>
            {formatCompactTokens(summaryOutputTokens)}
          </strong>
          <p className="metric-card__note">可观测输出负载</p>
        </article>
        <article className="metric-card">
          <p className="metric-card__label">缓存总量</p>
          <strong className="metric-card__value" title={`${formatInteger(summaryCacheTokens)} tokens`}>
            {formatCompactTokens(summaryCacheTokens)}
          </strong>
          <p className="metric-card__note">读取 + 写入</p>
        </article>
      </section>

      <section className="panel token-breakdown-panel">
        <div className="panel__header">
          <div>
            <h2 className="panel__title">Token 类型拆分</h2>
            <p className="panel__subtitle">按实际可观测输入、输出与缓存维度拆分当前总量。</p>
          </div>
          <div className="small-note" aria-label="加载状态">
            {loadStatus}
          </div>
        </div>
        <div className="token-breakdown-bar" role="img" aria-label="Token 类型拆分">
          {breakdownRows.map((row) => {
            const width = breakdownTotal > 0 && row.value > 0
              ? `${Math.max((row.value / breakdownTotal) * 100, 3)}%`
              : "0%";
            const isVisible = breakdownTotal > 0 && row.value > 0;

            return (
              <span
                className={`token-breakdown-segment ${row.className}`}
                data-testid={`token-breakdown-segment-${row.key}`}
                key={row.key}
                style={{ display: isVisible ? "block" : "none", width } as CSSProperties}
                title={`${row.label} ${formatInteger(row.value)} tokens`}
              />
            );
          })}
        </div>
        <div className="token-breakdown-list">
          {breakdownRows.map((row) => (
            <div className="token-breakdown-item" key={row.key}>
              <span className={`token-breakdown-dot ${row.className}`} />
              <span className="token-breakdown-item__label">{row.label}</span>
              <strong className="token-breakdown-item__value">{formatCompactTokens(row.value)}</strong>
              <span className="small-note">{percent(row.value, breakdownTotal)}%</span>
            </div>
          ))}
        </div>
      </section>

      <section className="panel trend-panel">
        <div className="panel__header">
          <div>
            <h2 className="panel__title">{selectedTimeRangeOption.trendTitle}</h2>
            <p className="panel__subtitle">按总量或按类型查看 token 趋势</p>
          </div>
          <div className="token-mode-toggle" role="group" aria-label="趋势视图切换">
            <button
              aria-pressed={trendMode === "total"}
              className="btn btn--compact"
              type="button"
              onClick={() => setTrendMode("total")}
            >
              总量
            </button>
            <button
              aria-pressed={trendMode === "byType"}
              className="btn btn--compact"
              type="button"
              onClick={() => setTrendMode("byType")}
            >
              按类型
            </button>
          </div>
        </div>
        {hasTrendPoints ? (
          renderTrendLineChart()
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
            <p className="small-note">暂无 Token 趋势</p>
            <div className="chart-empty-grid__axis" style={{ width: "100%" }}>
              <span>--</span>
              <span>--</span>
              <span>--</span>
              <span>--</span>
              <span>--</span>
              <span>--</span>
              <span>--</span>
            </div>
          </div>
        )}
      </section>

      <section className="panel token-mosaic-panel">
        <div className="panel__header">
          <div>
            <h2 className="panel__title">使用热力分布</h2>
            <p className="panel__subtitle">按星期和小时查看 token 活跃度。</p>
          </div>
          <div className="small-note">{heatmap.timeZone}</div>
        </div>
        <div className="token-mosaic-grid token-heatmap-grid">
          <div className="token-weekday-grid" aria-label="星期热力图">
            {WEEKDAY_LABELS.map((label, weekday) => {
              const cell = heatmap.weekdayTotals.find((item) => item.weekday === weekday);
              const totalTokens = cell?.totalTokens ?? 0;
              const title = `${label} · ${formatCompactTokens(totalTokens)} tokens`;

              return renderHeatmapCell(
                label,
                totalTokens,
                title,
                `token-weekday-cell-${weekday}`,
                `token-weekday-cell token-weekday-cell--level-${resolveHeatmapLevel(totalTokens, maxWeekdayTokens)}`,
                `weekday-${weekday}`,
              );
            })}
          </div>
          <div className="token-hour-grid" aria-label="小时热力图">
            {Array.from({ length: 24 }, (_, hour) => {
              const cell = heatmap.hourTotals.find((item) => item.hour === hour);
              const totalTokens = cell?.totalTokens ?? 0;
              const label = String(hour).padStart(2, "0");
              const title = `${label}:00 · ${formatCompactTokens(totalTokens)} tokens`;

              return renderHeatmapCell(
                label,
                totalTokens,
                title,
                `token-hour-cell-${hour}`,
                `token-hour-cell token-hour-cell--level-${resolveHeatmapLevel(totalTokens, maxHourTokens)}`,
                `hour-${hour}`,
              );
            })}
          </div>
        </div>
      </section>

      <section className="table-panel token-table">
        <div className="table-panel__header">
          <div>
            <h2 className="panel__title">实时 hook / Transcript 回填</h2>
            <p className="small-note">
              {loadStatus}，共 {formatInteger(usageTotal)} 条记录
            </p>
          </div>
          <div className="small-note">来源维度：实时 hook / Transcript 回填</div>
        </div>
        <DataTable
          columns={[
            { key: "session", label: "会话 ID" },
            { key: "model", label: "模型" },
            { key: "io", label: "输入 / 输出" },
            { key: "total", label: "总量" },
            { key: "type", label: "类型" },
            { key: "time", label: "触发时间" },
          ]}
          error={usageError}
          loading={usageLoading}
          onRetry={retryUsage}
          rows={usageItems.map((item) => {
            const sourceType = resolveSourceType(item);
            const sourceOrigin = (item as TokenUsageListItemWithOptionalOrigin).sourceOrigin;

            return {
              id: item.usageEventId,
              io: (
                <span className="token-io-cell" title={formatUsageIoTitle(item)}>
                  {formatUsageIoLabel(item)}
                </span>
              ),
              model: (
                <div className="row-stack">
                  <span className={item.model.toLowerCase().includes("claude") ? "model-pill model-pill--dark" : "model-pill"}>
                    {item.model}
                  </span>
                  <span>
                    {item.provider} / {item.model}
                  </span>
                </div>
              ),
              session: item.sessionKey ?? "未知会话",
              time: formatTimestamp(item.occurredAtMs),
              total: sourceType === "unavailable" ? (
                <span className="token-total-token token-total-token--unavailable">不可用</span>
              ) : (
                <strong className="token-total-token" title={`${formatInteger(item.totalTokens)} tokens`}>
                  {formatCompactTokens(item.totalTokens)}
                </strong>
              ),
              type: (
                <div className="token-source-stack">
                  <span className={`token-badge token-badge--status token-badge--${sourceType}`}>
                    {formatSourceTypeLabel(sourceType)}
                  </span>
                  <span className="token-badge token-badge--origin">
                    {formatSourceOriginLabel(sourceOrigin)}
                  </span>
                </div>
              ),
            };
          })}
        />
        <TablePagination {...usagePaginationProps} />
      </section>
    </div>
  );
}
