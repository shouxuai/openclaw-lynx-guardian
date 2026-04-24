import { startTransition, useEffect, useState } from "react";
import type { DashboardOverviewDto } from "@lynx/local-console-shared";

import { getDashboardOverview } from "../api/dashboard";
import { DistributionCard } from "../components/cards/DistributionCard";
import { MetricCard } from "../components/cards/MetricCard";
import { TrendCard } from "../components/cards/TrendCard";
import { StatusBadge } from "../components/feedback/StatusBadge";
import { PageHeader } from "../components/layout/PageHeader";
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

  const headerDescription = loading
    ? "正在从本地控制台后端加载概览数据。"
    : error
      ? `概览数据加载失败：${error}`
      : "展示来自本地控制台后端的实时统计与最近风险记录。";
  const headerTone = error ? "danger" : loading ? "info" : "success";
  const headerLabel = error ? "请求失败" : loading ? "加载中" : "实时数据";

  return (
    <div className="page-stack">
      <PageHeader
        title="总览"
        description={headerDescription}
        eyebrow="本地控制台"
        actions={<StatusBadge label={headerLabel} tone={headerTone} />}
      />

      <section className="metric-grid">
        <MetricCard label="事件" value={formatInteger(dashboard.totals.eventCount)} note="最近窗口内事件数" />
        <MetricCard label="高风险" value={formatInteger(dashboard.totals.highRiskEventCount)} note="L3-L4 风险事件" />
        <MetricCard label="工具调用" value={formatInteger(dashboard.totals.toolCallCount)} note="已进入审计链路" />
        <MetricCard label="审批" value={formatInteger(dashboard.totals.approvalCount)} note="人工复核记录" />
        <MetricCard label="巡检" value={formatInteger(dashboard.totals.lynxCheckCount)} note="手动与定时任务" />
        <MetricCard label="令牌" value={formatInteger(dashboard.totals.totalTokens)} note="累计令牌消耗" />
      </section>

      <section className="split-grid split-grid--equal">
        <DistributionCard
          title="风险分布"
          subtitle="按风险等级聚合审计事件"
          items={dashboard.riskDistribution.map((item) => ({
            label: item.riskLevel,
            value: item.count,
          }))}
        />
        <DistributionCard
          title="执行动作分布"
          subtitle="来自真实策略动作的聚合结果"
          items={dashboard.enforcementDistribution.map((item) => ({
            label: formatActionLabel(item.enforcementAction),
            value: item.count,
          }))}
        />
      </section>

      <section className="split-grid split-grid--equal">
        <TrendCard
          title="事件趋势"
          subtitle="后端按时间桶聚合的事件计数"
          points={dashboard.eventTrend.map((point) => ({
            label: formatTimestamp(point.bucketStartMs),
            value: point.value,
          }))}
        />
        <TrendCard
          title="令牌趋势"
          subtitle="后端按时间桶聚合的令牌用量"
          points={dashboard.tokenTrend.map((point) => ({
            label: formatTimestamp(point.bucketStartMs),
            value: point.value,
          }))}
        />
      </section>

      <section className="split-grid">
        <article className="panel">
          <div className="panel__header">
            <div>
              <h2 className="panel__title">最近高风险事件</h2>
              <p className="panel__subtitle">优先展示需要关注的最新事件。</p>
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
          <article className="panel">
            <div className="panel__header">
              <div>
                <h2 className="panel__title">最近工具调用</h2>
                <p className="panel__subtitle">展示最近进入控制台审计的工具调用。</p>
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

          <article className="panel">
            <div className="panel__header">
              <div>
                <h2 className="panel__title">最近审批</h2>
                <p className="panel__subtitle">帮助快速确认待处理与刚处理完成的审批。</p>
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
