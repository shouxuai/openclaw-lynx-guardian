import { startTransition, useEffect, useState } from "react";
import type { DashboardOverviewDto } from "@lynx/local-console-shared";

import { getDashboardOverview } from "../api/dashboard";
import { StatusBadge } from "../components/feedback/StatusBadge";
import { DataTable } from "../components/tables/DataTable";
import { formatInteger, formatTimestamp } from "../utils/format";
import {
  formatActionLabel,
  formatToolLabel,
  renderActionBadge,
  renderRiskBadge,
  renderStateBadge,
} from "../utils/status";

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

const RISK_COLORS: Record<string, string> = {
  L0: "var(--risk-l0)",
  L1: "var(--risk-l1)",
  L2: "var(--risk-l2)",
  L3: "var(--risk-l3)",
  L4: "var(--risk-l4)",
};

function getRiskCount(dashboard: DashboardOverviewDto, levels: string[]) {
  return dashboard.riskDistribution
    .filter((item) => levels.includes(item.riskLevel))
    .reduce((sum, item) => sum + item.count, 0);
}

function buildRiskRingBackground(dashboard: DashboardOverviewDto) {
  const items = dashboard.riskDistribution.filter((item) => item.count > 0);
  const total = items.reduce((sum, item) => sum + item.count, 0);

  if (total === 0) {
    return "conic-gradient(rgba(186, 200, 230, 0.35) 0deg 360deg)";
  }

  let current = 0;
  return `conic-gradient(${items.map((item) => {
    const start = current;
    current += (item.count / total) * 360;
    return `${RISK_COLORS[item.riskLevel] ?? "var(--accent)"} ${start}deg ${current}deg`;
  }).join(", ")})`;
}

export function DashboardPage() {
  const [dashboard, setDashboard] = useState<DashboardOverviewDto>(EMPTY_DASHBOARD);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadDashboard() {
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
          setDashboard(EMPTY_DASHBOARD);
          setLoading(false);
          setError(message);
        });
      }
    }

    void loadDashboard();

    return () => {
      active = false;
    };
  }, []);

  const statusTone = error ? "danger" : loading ? "info" : "success";
  const statusLabel = error ? "请求失败" : loading ? "加载中" : "实时数据";
  const headlineDescription = loading
    ? "正在从本地控制台后端加载总览数据。"
    : error
      ? `总览数据加载失败：${error}`
      : "将风险事件、工具调用、审批链路与令牌用量汇聚到同一块值班大屏。";

  const lowRiskCount = getRiskCount(dashboard, ["L0", "L1"]);
  const mediumRiskCount = getRiskCount(dashboard, ["L2"]);
  const highRiskCount = getRiskCount(dashboard, ["L3"]);
  const criticalRiskCount = getRiskCount(dashboard, ["L4"]);
  const highRiskRatio = dashboard.totals.eventCount === 0
    ? "0%"
    : `${Math.round((dashboard.totals.highRiskEventCount / dashboard.totals.eventCount) * 100)}%`;
  const riskRingBackground = buildRiskRingBackground(dashboard);

  const overviewCards = [
    {
      title: "基础态势",
      value: formatInteger(lowRiskCount),
      note: "L0-L1 低风险与记录型日志",
      tone: "calm",
    },
    {
      title: "关注态势",
      value: formatInteger(mediumRiskCount),
      note: "L2 需要关注的风险事件",
      tone: "watch",
    },
    {
      title: "高危态势",
      value: formatInteger(highRiskCount),
      note: "L3 高优先级告警",
      tone: "elevated",
    },
    {
      title: "严重态势",
      value: formatInteger(criticalRiskCount),
      note: "L4 需立即处理的事件",
      tone: "critical",
    },
    {
      title: "审批记录",
      value: formatInteger(dashboard.totals.approvalCount),
      note: "人工复核与授权链路",
      tone: "violet",
    },
    {
      title: "日志总量",
      value: formatInteger(dashboard.totals.eventCount),
      note: "当前时间窗内全部事件",
      tone: "accent",
    },
  ] as const;

  const headlineStats = [
    {
      label: "高风险占比",
      value: highRiskRatio,
      note: "L3-L4 事件",
    },
    {
      label: "工具调用",
      value: formatInteger(dashboard.totals.toolCallCount),
      note: "已进入审计链路",
    },
    {
      label: "巡检记录",
      value: formatInteger(dashboard.totals.lynxCheckCount),
      note: "手动与定时任务",
    },
    {
      label: "令牌总量",
      value: formatInteger(dashboard.totals.totalTokens),
      note: "累计资源消耗",
    },
  ];

  const topActions = dashboard.enforcementDistribution
    .filter((item) => item.count > 0)
    .slice(0, 5);

  return (
    <div className="page-stack page-stack--dashboard">
      <section className="dashboard-hero">
        <div className="dashboard-hero__content">
          <div className="dashboard-hero__eyebrowRow">
            <p className="dashboard-hero__eyebrow">MULTI-DIMENSION LOG WORKBENCH</p>
            <StatusBadge label={statusLabel} tone={statusTone} />
          </div>
          <h1 className="dashboard-hero__title">日志态势总览</h1>
          <p className="dashboard-hero__description">{headlineDescription}</p>
          <div className="dashboard-hero__tags">
            <span className="dashboard-tag">多维日志</span>
            <span className="dashboard-tag">值班视角</span>
            <span className="dashboard-tag">本地守护</span>
          </div>
        </div>

        <div className="dashboard-hero__stats">
          {headlineStats.map((item) => (
            <article key={item.label} className="dashboard-kpi">
              <p className="dashboard-kpi__label">{item.label}</p>
              <strong className="dashboard-kpi__value">{item.value}</strong>
              <p className="dashboard-kpi__note">{item.note}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="dashboard-signalGrid" aria-label="风险总览卡带">
        {overviewCards.map((card) => (
          <article key={card.title} className={`dashboard-signal dashboard-signal--${card.tone}`}>
            <p className="dashboard-signal__label">{card.title}</p>
            <strong className="dashboard-signal__value">{card.value}</strong>
            <p className="dashboard-signal__note">{card.note}</p>
          </article>
        ))}
      </section>

      <section className="dashboard-insightGrid">
        <article className="panel dashboard-panel">
          <div className="panel__header">
            <div>
              <p className="dashboard-sectionLabel">RISK MIX</p>
              <h2 className="panel__title">风险分布</h2>
              <p className="panel__subtitle">将真实风险层级聚合成一张可快速判断的环形概览。</p>
            </div>
          </div>

          <div className="risk-ring">
            <div className="risk-ring__chart" style={{ background: riskRingBackground }}>
              <div className="risk-ring__inner">
                <strong>{formatInteger(dashboard.totals.eventCount)}</strong>
                <span>总事件</span>
              </div>
            </div>
            <ul className="risk-ring__legend">
              {dashboard.riskDistribution.map((item) => (
                <li key={item.riskLevel} className="risk-ring__legendItem">
                  <span
                    className="risk-ring__swatch"
                    style={{ background: RISK_COLORS[item.riskLevel] ?? "var(--accent)" }}
                  />
                  <span className="risk-ring__legendLabel">{item.riskLevel}</span>
                  <strong className="risk-ring__legendValue">{formatInteger(item.count)}</strong>
                </li>
              ))}
            </ul>
          </div>
        </article>

        <article className="panel dashboard-panel">
          <div className="panel__header">
            <div>
              <p className="dashboard-sectionLabel">TREND & ACTIONS</p>
              <h2 className="panel__title">趋势与动作</h2>
              <p className="panel__subtitle">同时看事件强度、令牌走势和策略动作分布。</p>
            </div>
          </div>

          <div className="dashboard-trendStack">
            <div className="dashboard-trendBlock">
              <div className="dashboard-trendBlock__header">
                <span>事件趋势</span>
                <strong>{formatInteger(dashboard.totals.eventCount)}</strong>
              </div>
              <div className="dashboard-trendBars">
                {dashboard.eventTrend.map((point) => (
                  <div key={`events-${point.bucketStartMs}`} className="dashboard-trendPoint">
                    <div
                      className="dashboard-trendBar"
                      style={{
                        height: `${Math.max(
                          (point.value / Math.max(...dashboard.eventTrend.map((entry) => entry.value), 1)) * 100,
                          10,
                        )}%`,
                      }}
                    />
                    <span className="dashboard-trendLabel">{formatTimestamp(point.bucketStartMs)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="dashboard-trendBlock dashboard-trendBlock--secondary">
              <div className="dashboard-trendBlock__header">
                <span>令牌趋势</span>
                <strong>{formatInteger(dashboard.totals.totalTokens)}</strong>
              </div>
              <div className="dashboard-trendBars">
                {dashboard.tokenTrend.map((point) => (
                  <div key={`tokens-${point.bucketStartMs}`} className="dashboard-trendPoint">
                    <div
                      className="dashboard-trendBar dashboard-trendBar--violet"
                      style={{
                        height: `${Math.max(
                          (point.value / Math.max(...dashboard.tokenTrend.map((entry) => entry.value), 1)) * 100,
                          10,
                        )}%`,
                      }}
                    />
                    <span className="dashboard-trendLabel">{formatTimestamp(point.bucketStartMs)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="dashboard-actionCloud">
            {topActions.map((item) => (
              <div key={item.enforcementAction} className="dashboard-actionPill">
                <span>{formatActionLabel(item.enforcementAction)}</span>
                <strong>{formatInteger(item.count)}</strong>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="dashboard-workbench">
        <article className="panel dashboard-panel dashboard-panel--table">
          <div className="panel__header">
            <div>
              <p className="dashboard-sectionLabel">PRIORITY LOGS</p>
              <h2 className="panel__title">最近高风险事件</h2>
              <p className="panel__subtitle">优先展示需要值班同学第一时间关注的最新事件。</p>
            </div>
          </div>

          <DataTable
            columns={[
              { key: "title", label: "标题" },
              { key: "risk", label: "风险" },
              { key: "action", label: "动作" },
              { key: "time", label: "发生时间" },
            ]}
            rows={dashboard.recentHighRiskEvents.map((event) => ({
              id: event.eventId,
              title: (
                <div className="row-stack">
                  <strong>{event.title}</strong>
                  <span>{event.summary ?? "暂无摘要"}</span>
                </div>
              ),
              risk: renderRiskBadge(event.riskLevel),
              action: renderActionBadge(event.enforcementAction),
              time: formatTimestamp(event.occurredAtMs),
            }))}
          />
        </article>

        <div className="page-stack page-stack--compact">
          <article className="panel dashboard-panel">
            <div className="panel__header">
              <div>
                <p className="dashboard-sectionLabel">TOOL STREAM</p>
                <h2 className="panel__title">最近工具调用</h2>
                <p className="panel__subtitle">追踪最近进入控制台审计的工具调用结果。</p>
              </div>
            </div>
            <div className="list-stack">
              {dashboard.recentToolCalls.map((call) => (
                <div key={call.toolCallId} className="list-item">
                  <div>
                    <strong>{formatToolLabel(call.toolName)}</strong>
                    <p>{call.resultExcerpt ?? "暂无结果摘要"}</p>
                  </div>
                  {renderStateBadge(call.resultStatus)}
                </div>
              ))}
            </div>
          </article>

          <article className="panel dashboard-panel">
            <div className="panel__header">
              <div>
                <p className="dashboard-sectionLabel">APPROVAL STREAM</p>
                <h2 className="panel__title">最近审批记录</h2>
                <p className="panel__subtitle">快速确认待处理与刚处理完成的审批链路。</p>
              </div>
            </div>
            <div className="list-stack">
              {dashboard.recentApprovals.map((approval) => (
                <div key={approval.approvalId} className="list-item">
                  <div>
                    <strong>{approval.promptExcerpt ?? "暂无审批摘要"}</strong>
                    <p>{approval.requesterOuId ?? "未知申请人"} · {approval.module}</p>
                  </div>
                  {renderStateBadge(approval.resolution)}
                </div>
              ))}
            </div>
          </article>
        </div>
      </section>
    </div>
  );
}
