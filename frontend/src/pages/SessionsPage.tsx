import type { SessionDetailDto, SessionListItemDto } from "@lynx/local-console-shared";

import { getSessionDetail, listSessions } from "../api/sessions";
import { MetricCard } from "../components/cards/MetricCard";
import { DetailPanel } from "../components/detail/DetailPanel";
import { StatusBadge } from "../components/feedback/StatusBadge";
import { FilterBar } from "../components/filters/FilterBar";
import { PageHeader } from "../components/layout/PageHeader";
import { DataTable } from "../components/tables/DataTable";
import { mockFilterSets } from "../data/mock-console";
import { useListDetailResource } from "../hooks/useListDetailResource";
import { formatInteger, formatTimestamp } from "../utils/format";
import { formatDomainLabel, renderRiskBadge } from "../utils/status";

function formatTokenSummary(summary: SessionDetailDto["tokenSummary"] | undefined) {
  if (!summary) {
    return "暂无";
  }

  return [
    `总量：${formatInteger(summary.totalTokens ?? 0)}`,
    `输入：${formatInteger(summary.inputTokens ?? 0)}`,
    `输出：${formatInteger(summary.outputTokens ?? 0)}`,
  ].join("\n");
}

export function SessionsPage() {
  const { items, detail, loading, error } = useListDetailResource<SessionListItemDto, SessionDetailDto>({
    loadList: () => listSessions({ limit: 20 }),
    loadDetail: getSessionDetail,
    getItemId: (item) => item.sessionKey,
  });

  const activeCount = items.filter((item) => !item.endedAtMs).length;
  const groupCount = items.filter((item) => item.isGroup).length;
  const highRiskCount = items.filter((item) => (item.highRiskEventCount ?? 0) > 0).length;
  const headerDescription = loading
    ? "正在从本地控制台后端加载会话索引。"
    : error
      ? `会话数据加载失败：${error}`
      : "展示真实会话列表与默认详情快照。";
  const headerTone = error ? "danger" : loading ? "info" : "success";
  const headerLabel = error ? "请求失败" : loading ? "加载中" : "实时数据";

  return (
    <div className="page-stack">
      <PageHeader
        title="会话"
        description={headerDescription}
        eyebrow="会话索引"
        actions={<StatusBadge label={headerLabel} tone={headerTone} />}
      />
      <section className="metric-grid metric-grid--compact">
        <MetricCard label="总会话" value={`${items.length}`} note="默认展示最近 20 条" />
        <MetricCard label="活跃会话" value={`${activeCount}`} note="尚未结束的会话" />
        <MetricCard label="群聊会话" value={`${groupCount}`} note="按 isGroup 聚合" />
        <MetricCard label="高风险会话" value={`${highRiskCount}`} note="含高风险事件的会话" />
      </section>
      <FilterBar chips={mockFilterSets.sessions} />
      <section className="split-grid">
        <article className="panel">
          <div className="panel__header">
            <div>
              <h2 className="panel__title">会话台账</h2>
              <p className="panel__subtitle">列表与详情都来自真实会话查询接口。</p>
            </div>
          </div>
          <DataTable
            columns={[
              { key: "session", label: "会话" },
              { key: "profile", label: "渠道" },
              { key: "events", label: "事件数" },
              { key: "risk", label: "风险" },
              { key: "lastSeen", label: "最近活动" },
            ]}
            rows={items.map((session) => ({
              id: session.sessionKey,
              session: session.sessionKey,
              profile: formatDomainLabel(session.channelProfile),
              events: formatInteger(session.eventCount ?? 0),
              risk: renderRiskBadge((session.highRiskEventCount ?? 0) > 0 ? "L3" : "L1"),
              lastSeen: formatTimestamp(session.lastSeenAtMs),
            }))}
          />
        </article>
        <DetailPanel
          title={detail?.sessionKey ?? "暂无会话"}
          subtitle={
            detail
              ? `${formatDomainLabel(detail.channelProfile)} · ${detail.requesterOuId ?? "暂无请求人"}`
              : "等待后端返回会话详情"
          }
          fields={[
            { label: "最近事件", value: formatInteger(detail?.recentEvents.length ?? 0) },
            { label: "最近工具调用", value: formatInteger(detail?.recentToolCalls.length ?? 0) },
            { label: "最近审批", value: formatInteger(detail?.recentApprovals.length ?? 0) },
            { label: "令牌摘要", value: formatTokenSummary(detail?.tokenSummary) },
          ]}
        />
      </section>
    </div>
  );
}
