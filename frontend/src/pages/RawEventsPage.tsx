import type { AuditEventListItemDto } from "@lynx/local-console-shared";

import { listEvents, type EventListQuery } from "../api/events";
import { PageHeader } from "../components/layout/PageHeader";
import { DataTable } from "../components/tables/DataTable";
import { TablePagination } from "../components/tables/TablePagination";
import { usePagedListResource } from "../hooks/usePagedListResource";
import { formatTimestamp } from "../utils/format";
import { renderActionBadge, renderRiskBadge } from "../utils/status";

export function RawEventsPage() {
  const { items, loading, error, paginationProps, retry } = usePagedListResource<
    AuditEventListItemDto,
    EventListQuery
  >({
    loadPage: listEvents,
    query: {},
  });

  return (
    <div className="page-stack">
      <PageHeader
        title="原始审计流水"
        description="保留 hook 级、后端写入级的原始审计记录，用于排障、取证和高级诊断。"
        eyebrow="RAW AUDIT"
      />

      <section className="table-panel">
        <DataTable
          columns={[
            { key: "time", label: "时间" },
            { key: "event", label: "事件" },
            { key: "hook", label: "Hook" },
            { key: "type", label: "事件类型" },
            { key: "category", label: "原始分类" },
            { key: "risk", label: "风险等级" },
            { key: "action", label: "处置动作" },
            { key: "summary", label: "摘要", maxWidth: 420, minWidth: 260, width: 340 },
          ]}
          emptyDescription="暂无原始审计流水"
          error={error}
          loading={loading}
          loadingLabel="正在加载原始审计流水"
          onRetry={retry}
          rows={items.map((event) => ({
            id: event.eventId,
            time: formatTimestamp(event.occurredAtMs),
            event: (
              <div className="row-stack">
                <strong>{event.eventId}</strong>
                <span>{event.title}</span>
              </div>
            ),
            hook: event.hookName,
            type: event.eventType,
            category: event.category,
            risk: renderRiskBadge(event.riskLevel),
            action: renderActionBadge(event.enforcementAction),
            summary: event.summary ?? event.contentExcerpt ?? "暂无",
          }))}
        />
        <TablePagination {...paginationProps} ariaLabel="原始审计流水分页" />
      </section>
    </div>
  );
}
