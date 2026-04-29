import { startTransition, useEffect, useMemo, useState } from "react";
import type { DashboardOverviewDto, RiskBucketDto } from "@lynx/local-console-shared";
import { Link } from "react-router-dom";

import { getDashboardOverview } from "../api/dashboard";
import { DataTable } from "../components/tables/DataTable";
import { mockDashboard } from "../data/mock-console";
import { formatActionText, renderRiskBadge } from "../utils/status";
import { formatDateOnly, formatInteger, formatTimestamp } from "../utils/format";

const EMPTY_DASHBOARD: DashboardOverviewDto = {
  totals: {
    eventCount: 0,
    highRiskEventCount: 0,
    toolCallCount: 0,
    approvalCount: 0,
    lynxCheckCount: 0,
    totalTokens: 0,
  },
  riskDistribution: [],
  enforcementDistribution: [],
  eventTrend: [],
  tokenTrend: [],
  recentHighRiskEvents: [],
  recentToolCalls: [],
  recentApprovals: [],
};

const RISK_META = {
  L0: {
    label: "L0 指标",
    note: "基础安全事件",
    cssClass: "overview-card--l0",
    color: "var(--risk-l0)",
  },
  L1: {
    label: "L1 指标",
    note: "低风险警告",
    cssClass: "overview-card--l1",
    color: "var(--risk-l1)",
  },
  L2: {
    label: "L2 指标",
    note: "中度安全风险",
    cssClass: "overview-card--l2",
    color: "var(--risk-l2)",
  },
  L3: {
    label: "L3 指标",
    note: "高度安全威胁",
    cssClass: "overview-card--l3",
    color: "var(--risk-l3)",
  },
  L4: {
    label: "L4 指标",
    note: "严重系统漏洞",
    cssClass: "overview-card--l4",
    color: "var(--risk-l4)",
  },
} as const;

const RISK_ORDER = ["L4", "L3", "L2", "L1", "L0"] as const;
const RISK_BAR_ORDER = ["L0", "L1", "L2", "L3", "L4"] as const;
const RISK_LEGEND_LABELS = {
  L0: "基础 (L0)",
  L1: "关注 (L1)",
  L2: "中危 (L2)",
  L3: "高危 (L3)",
  L4: "严重 (L4)",
} as const;
const RISK_SHORT_LABELS = {
  L0: "基础",
  L1: "关注",
  L2: "中危",
  L3: "高危",
  L4: "严重",
} as const;
const TREND_CHART = {
  width: 420,
  height: 380,
  top: 42,
  right: 20,
  bottom: 54,
  left: 44,
} as const;

function countRisk(buckets: RiskBucketDto[], riskLevel: string): number {
  return buckets.find((item) => item.riskLevel === riskLevel)?.count ?? 0;
}

function buildRiskRingBackground(dashboard: DashboardOverviewDto): string {
  const total = dashboard.riskDistribution.reduce((sum, item) => sum + item.count, 0);
  if (total === 0) {
    return "conic-gradient(#e8edf5 0deg 360deg)";
  }

  let current = 0;
  return `conic-gradient(${(["L4", "L3", "L2", "L1", "L0"] as const)
    .map((riskLevel) => {
      const count = countRisk(dashboard.riskDistribution, riskLevel);
      if (count === 0) {
        return null;
      }
      const start = current;
      current += (count / total) * 360;
      return `${RISK_META[riskLevel].color} ${start}deg ${current}deg`;
    })
    .filter(Boolean)
    .join(", ")})`;
}

function formatPercent(value: number, total: number): string {
  if (total === 0) {
    return "0%";
  }

  return `${((value / total) * 100).toFixed(1)}%`;
}

function getLocalDayStartMs(timestamp: number): number {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function addLocalDays(dayStartMs: number, days: number): number {
  const date = new Date(dayStartMs);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days).getTime();
}

function buildTrendPoints(dashboard: DashboardOverviewDto) {
  const totalsByDay = new Map<number, number>();
  for (const point of dashboard.eventTrend) {
    const dayStartMs = getLocalDayStartMs(point.bucketStartMs);
    totalsByDay.set(dayStartMs, (totalsByDay.get(dayStartMs) ?? 0) + point.value);
  }

  const endDayStartMs =
    totalsByDay.size > 0 ? Math.max(...totalsByDay.keys()) : getLocalDayStartMs(Date.now());

  return Array.from({ length: 7 }, (_, index) => {
    const dayStartMs = addLocalDays(endDayStartMs, index - 6);

    return {
      label: formatDateOnly(dayStartMs),
      value: totalsByDay.get(dayStartMs) ?? 0,
    };
  });
}

function buildChartMax(maxValue: number): number {
  return Math.max(4, Math.ceil(maxValue / 4) * 4);
}

function buildAxisTicks(maxValue: number): number[] {
  return [maxValue, maxValue * 0.75, maxValue * 0.5, maxValue * 0.25, 0].map(Math.round);
}

export function DashboardPage() {
  const [dashboard, setDashboard] = useState<DashboardOverviewDto>(EMPTY_DASHBOARD);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;

    async function loadDashboard() {
      startTransition(() => {
        setError(null);
        setLoading(true);
      });

      try {
        const nextDashboard = await getDashboardOverview();
        if (!active) {
          return;
        }

        startTransition(() => {
          setDashboard(nextDashboard);
          setLoading(false);
          setError(null);
        });
      } catch (loadError) {
        if (!active) {
          return;
        }

        const message = loadError instanceof Error ? loadError.message : "请求失败";
        startTransition(() => {
          setDashboard(import.meta.env.DEV ? mockDashboard : EMPTY_DASHBOARD);
          setLoading(false);
          setError(import.meta.env.DEV ? null : message);
        });
      }
    }

    void loadDashboard();

    return () => {
      active = false;
    };
  }, [reloadKey]);

  function retryDashboard(): void {
    setReloadKey((current) => current + 1);
  }

  const riskRingBackground = useMemo(() => buildRiskRingBackground(dashboard), [dashboard]);
  const trendPoints = useMemo(() => buildTrendPoints(dashboard), [dashboard]);
  const trendMax = Math.max(...trendPoints.map((point) => point.value), 1);
  const statusText = error ? `数据加载失败：${error}` : loading ? "正在加载实时数据" : null;
  const totalEvents = dashboard.totals.eventCount;

  const metricCards = (["L0", "L1", "L2", "L3", "L4"] as const).map((riskLevel) => ({
    ...RISK_META[riskLevel],
    value: countRisk(dashboard.riskDistribution, riskLevel),
  }));
  const riskLevelBars = RISK_BAR_ORDER.map((riskLevel) => ({
    key: riskLevel,
    count: countRisk(dashboard.riskDistribution, riskLevel),
    color: RISK_META[riskLevel].color,
    shortLabel: RISK_SHORT_LABELS[riskLevel],
    description: RISK_META[riskLevel].note,
    percent: formatPercent(countRisk(dashboard.riskDistribution, riskLevel), totalEvents),
  }));
  const riskLevelBarMax = buildChartMax(Math.max(...riskLevelBars.map((item) => item.count), 1));
  const riskLevelAxisTicks = buildAxisTicks(riskLevelBarMax);
  const trendChartMax = buildChartMax(trendMax);
  const trendAxisTicks = buildAxisTicks(trendChartMax);
  const trendPlotWidth = TREND_CHART.width - TREND_CHART.left - TREND_CHART.right;
  const trendPlotHeight = TREND_CHART.height - TREND_CHART.top - TREND_CHART.bottom;
  const trendLinePoints = trendPoints.map((point, index) => {
    const x = TREND_CHART.left + (index / Math.max(trendPoints.length - 1, 1)) * trendPlotWidth;
    const y = TREND_CHART.top + (1 - point.value / trendChartMax) * trendPlotHeight;

    return { ...point, x, y };
  });
  const trendPolyline = trendLinePoints.map((point) => `${point.x},${point.y}`).join(" ");
  const trendAreaPoints = [
    `${TREND_CHART.left},${TREND_CHART.height - TREND_CHART.bottom}`,
    trendPolyline,
    `${TREND_CHART.width - TREND_CHART.right},${TREND_CHART.height - TREND_CHART.bottom}`,
  ].join(" ");

  const legendItems = RISK_ORDER.map((group) => {
    const count = countRisk(dashboard.riskDistribution, group);

    return {
      key: group,
      label: RISK_LEGEND_LABELS[group],
      count,
      color: RISK_META[group].color,
      percent: formatPercent(count, totalEvents),
    };
  });

  return (
    <div className="page-stack">
      {statusText ? <p className="small-note">{statusText}</p> : null}

      <section className="overview-metric-grid" aria-label="风险等级指标">
        {metricCards.map((card) => (
          <article key={card.label} className={`overview-card ${card.cssClass}`}>
            <div>
              <p className="overview-card__label">{card.label}</p>
              <strong className="overview-card__value">{formatInteger(card.value)}</strong>
            </div>
            <p className="overview-card__note">{card.note}</p>
          </article>
        ))}

        <article className="overview-card overview-card--total">
          <div>
            <p className="overview-card__label">总计</p>
            <strong className="overview-card__value">{formatInteger(totalEvents)}</strong>
          </div>
          <p className="overview-card__note">所有安全事件</p>
        </article>
      </section>

      <section className="dashboard-insightGrid">
        <article className="panel">
          <div className="panel__header">
            <div>
              <h2 className="panel__title">风险分布</h2>
            </div>
            <span className="technical-label">◐</span>
          </div>

          <div className="risk-ring">
            <div className="risk-ring__chart" style={{ background: riskRingBackground }}>
              <div className="risk-ring__inner">
                <strong>{formatInteger(totalEvents)}</strong>
                <span>总事件</span>
              </div>
            </div>
            <ul className="risk-ring__legend">
              {legendItems.map((item) => (
                <li key={item.key} className="risk-ring__legendItem">
                  <span className="risk-ring__swatch" style={{ background: item.color }} />
                  <span>{item.label}</span>
                  <span className="risk-ring__legendPercent">{item.percent}</span>
                </li>
              ))}
            </ul>
          </div>
        </article>

        <article className="panel risk-level-panel">
          <div className="panel__header">
            <div>
              <h2 className="panel__title">威胁等级分布</h2>
              <p className="panel__subtitle">L0 到 L4 事件量与占比</p>
            </div>
            <span className="technical-label">L0-L4</span>
          </div>

          <div className="risk-level-chart" aria-label="L0 到 L4 事件数量">
            <div className="risk-level-chart__axis" aria-hidden="true">
              {riskLevelAxisTicks.map((tick) => (
                <span key={tick}>{tick}</span>
              ))}
            </div>
            <div className="risk-level-chart__plot">
              <div className="risk-level-chart__grid" aria-hidden="true">
                {riskLevelAxisTicks.map((tick) => (
                  <span key={tick} />
                ))}
              </div>
              <div className="risk-level-bars">
                {riskLevelBars.map((item) => {
                  const height = Math.max((item.count / riskLevelBarMax) * 100, item.count > 0 ? 10 : 2);

                  return (
                    <div key={item.key} className="risk-level-bar">
                      <div className="risk-level-bar__track">
                        <div
                          aria-label={`${item.key}: ${item.count}`}
                          className="risk-level-bar__fill"
                          style={{ height: `${height}%`, background: item.color }}
                        />
                      </div>
                      <div className="risk-level-bar__meta">
                        <strong>{item.key}</strong>
                        <span>{item.shortLabel}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="risk-level-summary" aria-label="等级占比">
            {riskLevelBars.map((item) => (
              <span
                key={item.key}
                className="risk-level-summary__item"
                aria-label={`${item.key} ${item.description} 占比 ${item.percent}`}
              >
                <i style={{ background: item.color }} />
                <strong>{item.key}</strong>
                <span>{item.description}</span>
                <em>{item.percent}</em>
              </span>
            ))}
          </div>
        </article>

        <article className="panel trend-line-panel">
          <div className="panel__header">
            <div>
              <h2 className="panel__title">7 日趋势</h2>
              <p className="panel__subtitle">每日安全事件发生次数统计</p>
            </div>
            <span className="status-badge status-badge--info">事件数</span>
          </div>

          <div className="trend-line-shell">
            <svg
              className="trend-line-chart"
              viewBox={`0 0 ${TREND_CHART.width} ${TREND_CHART.height}`}
              role="img"
              aria-label="7 日趋势折线图"
            >
              <defs>
                <linearGradient id="trendLineArea" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.2" />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <g className="trend-line-chart__grid" aria-hidden="true">
                {trendAxisTicks.map((tick) => {
                  const y = TREND_CHART.top + (1 - tick / trendChartMax) * trendPlotHeight;

                  return (
                    <g key={tick}>
                      <text x={TREND_CHART.left - 10} y={y + 4} textAnchor="end">
                        {tick}
                      </text>
                      <line
                        x1={TREND_CHART.left}
                        x2={TREND_CHART.width - TREND_CHART.right}
                        y1={y}
                        y2={y}
                      />
                    </g>
                  );
                })}
              </g>
              <polygon className="trend-line-chart__area" points={trendAreaPoints} />
              <polyline className="trend-line-chart__line" points={trendPolyline} />
              <g className="trend-line-chart__points">
                {trendLinePoints.map((point, index) => (
                  <g key={`${point.label}-${index}`}>
                    <circle cx={point.x} cy={point.y} r="4" />
                    <text x={point.x} y={point.y - 10} textAnchor="middle">
                      {formatInteger(point.value)}
                    </text>
                  </g>
                ))}
              </g>
              <g className="trend-line-chart__labels" aria-hidden="true">
                {trendLinePoints.map((point, index) => (
                  <text
                    key={`${point.label}-${index}`}
                    x={point.x}
                    y={TREND_CHART.height - 10}
                    textAnchor="middle"
                  >
                    {point.label}
                  </text>
                ))}
              </g>
            </svg>
            <div className="trend-line-foot">
              <span>
                峰值 <strong>{formatInteger(trendMax)}</strong>
              </span>
              <span>
                今日 <strong>{formatInteger(trendPoints.at(-1)?.value ?? 0)}</strong>
              </span>
            </div>
          </div>
        </article>
      </section>

      <section className="table-panel">
        <div className="table-panel__header">
          <h2 className="panel__title">最近安全事件</h2>
          <Link className="inline-link" to="/events">查看全部</Link>
        </div>
        <DataTable
          columns={[
            { key: "id", label: "事件 ID" },
            { key: "risk", label: "风险等级" },
            { key: "action", label: "执行动作" },
            { key: "recommendation", label: "处置建议" },
            { key: "time", label: "时间" },
          ]}
          error={error}
          loading={loading}
          onRetry={retryDashboard}
          rows={dashboard.recentHighRiskEvents.map((event) => ({
            id: event.eventId,
            risk: renderRiskBadge(event.riskLevel),
            action: event.title,
            recommendation: event.summary ?? formatActionText(event.enforcementAction),
            time: formatTimestamp(event.occurredAtMs),
          }))}
        />
      </section>
    </div>
  );
}
