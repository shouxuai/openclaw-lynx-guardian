import type { AuditEventDetailDto, AuditEventListItemDto } from "@lynx/local-console-shared";

import { getEventDetail, listEvents } from "../api/events";
import { DetailPanel } from "../components/detail/DetailPanel";
import { StatusBadge } from "../components/feedback/StatusBadge";
import { FilterBar } from "../components/filters/FilterBar";
import { PageHeader } from "../components/layout/PageHeader";
import { DataTable } from "../components/tables/DataTable";
import { mockFilterSets } from "../data/mock-console";
import { useListDetailResource } from "../hooks/useListDetailResource";
import { formatTimestamp } from "../utils/format";
import {
  formatEventCategoryLabel,
  formatHookLabel,
  renderActionBadge,
  renderRiskBadge,
} from "../utils/status";

export function EventsPage() {
  const { items, detail, loading, error } = useListDetailResource<AuditEventListItemDto, AuditEventDetailDto>({
    loadList: () => listEvents({ limit: 20 }),
    loadDetail: getEventDetail,
    getItemId: (item) => item.eventId,
  });

  const headerDescription = loading
    ? "正在从本地控制台后端加载事件时间线。"
    : error
      ? `事件数据加载失败：${error}`
      : "按真实审计事件展示时间线与详情。";
  const headerTone = error ? "danger" : loading ? "info" : "success";
  const headerLabel = error ? "请求失败" : loading ? "加载中" : "实时数据";

  return (
    <div className="page-stack">
      <PageHeader
        title="事件"
        description={headerDescription}
        eyebrow="审计时间线"
        actions={<StatusBadge label={headerLabel} tone={headerTone} />}
      />
      <FilterBar chips={mockFilterSets.events} />
      <section className="split-grid">
        <article className="panel">
          <div className="panel__header">
            <div>
              <h2 className="panel__title">事件列表</h2>
              <p className="panel__subtitle">当前默认展示最近 20 条事件。</p>
            </div>
          </div>
          <DataTable
            columns={[
              { key: "category", label: "类别" },
              { key: "title", label: "标题" },
              { key: "risk", label: "风险" },
              { key: "action", label: "动作" },
              { key: "time", label: "发生时间" },
            ]}
            rows={items.map((event) => ({
              id: event.eventId,
              category: formatEventCategoryLabel(event.category),
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
        <DetailPanel
          title={detail?.title ?? "暂无事件"}
          subtitle={detail?.eventId ?? "等待后端返回事件详情"}
          fields={[
            { label: "触发点", value: formatHookLabel(detail?.hookName) },
            { label: "模块", value: detail?.modules?.join(", ") || "暂无" },
            { label: "建议", value: detail?.recommendation ?? "暂无" },
            { label: "摘录", value: detail?.contentExcerpt ?? "暂无" },
          ]}
        />
      </section>
    </div>
  );
}
