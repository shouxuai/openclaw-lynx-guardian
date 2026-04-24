import type { ToolCallDetailDto, ToolCallListItemDto } from "@lynx/local-console-shared";

import { getToolCallDetail, listToolCalls } from "../api/tool-calls";
import { MetricCard } from "../components/cards/MetricCard";
import { DetailPanel } from "../components/detail/DetailPanel";
import { StatusBadge } from "../components/feedback/StatusBadge";
import { FilterBar } from "../components/filters/FilterBar";
import { PageHeader } from "../components/layout/PageHeader";
import { DataTable } from "../components/tables/DataTable";
import { mockFilterSets } from "../data/mock-console";
import { useListDetailResource } from "../hooks/useListDetailResource";
import { formatDuration, formatTimestamp } from "../utils/format";
import { formatToolLabel, renderRiskBadge, renderStateBadge } from "../utils/status";

function formatToolMetadata(metadata: Record<string, unknown> | undefined) {
  if (!metadata) {
    return "暂无";
  }

  const lines: string[] = [];

  if (typeof metadata.sourcePath === "string") {
    lines.push(`来源路径：${metadata.sourcePath}`);
  }
  if (typeof metadata.targetPath === "string") {
    lines.push(`目标路径：${metadata.targetPath}`);
  }
  if (typeof metadata.redactionApplied === "boolean") {
    lines.push(`已脱敏：${metadata.redactionApplied ? "是" : "否"}`);
  }
  if (typeof metadata.resultCount === "number") {
    lines.push(`结果数量：${metadata.resultCount}`);
  }

  return lines.join("\n") || "暂无";
}

export function ToolCallsPage() {
  const { items, detail, loading, error } = useListDetailResource<ToolCallListItemDto, ToolCallDetailDto>({
    loadList: () => listToolCalls({ limit: 20 }),
    loadDetail: getToolCallDetail,
    getItemId: (item) => item.toolCallId,
  });

  const pausedCount = items.filter((item) => item.resultStatus === "paused").length;
  const successCount = items.filter((item) =>
    ["approved", "completed", "success"].includes(item.resultStatus ?? ""))
    .length;
  const maxDurationMs = items.reduce((maxDuration, item) =>
    Math.max(maxDuration, item.durationMs ?? 0), 0);
  const headerDescription = loading
    ? "正在从本地控制台后端加载工具调用。"
    : error
      ? `工具调用数据加载失败：${error}`
      : "按真实调用结果展示工具执行状态与详情。";
  const headerTone = error ? "danger" : loading ? "info" : "success";
  const headerLabel = error ? "请求失败" : loading ? "加载中" : "实时数据";

  return (
    <div className="page-stack">
      <PageHeader
        title="工具调用"
        description={headerDescription}
        eyebrow="执行审计"
        actions={<StatusBadge label={headerLabel} tone={headerTone} />}
      />
      <section className="metric-grid metric-grid--compact">
        <MetricCard label="调用数" value={`${items.length}`} note="默认展示最近 20 条" />
        <MetricCard label="已暂停" value={`${pausedCount}`} note="等待审批或人工确认" />
        <MetricCard label="已完成" value={`${successCount}`} note="已收到结果状态" />
        <MetricCard label="最长耗时" value={formatDuration(maxDurationMs)} note="当前列表最大值" />
      </section>
      <FilterBar chips={mockFilterSets.toolCalls} />
      <section className="split-grid">
        <article className="panel">
          <div className="panel__header">
            <div>
              <h2 className="panel__title">调用台账</h2>
              <p className="panel__subtitle">列表来自真实后端接口，详情默认显示第一条记录。</p>
            </div>
          </div>
          <DataTable
            columns={[
              { key: "tool", label: "工具" },
              { key: "status", label: "状态" },
              { key: "duration", label: "耗时" },
              { key: "risk", label: "风险" },
              { key: "time", label: "开始时间" },
            ]}
            rows={items.map((call) => ({
              id: call.toolCallId,
              tool: (
                <div className="row-stack">
                  <strong>{formatToolLabel(call.toolName)}</strong>
                  <span>{call.resultExcerpt ?? "暂无结果摘要"}</span>
                </div>
              ),
              status: renderStateBadge(call.resultStatus),
              duration: formatDuration(call.durationMs),
              risk: renderRiskBadge(call.riskLevel),
              time: formatTimestamp(call.startedAtMs),
            }))}
          />
        </article>
        <DetailPanel
          title={formatToolLabel(detail?.toolName)}
          subtitle={detail?.toolCallId ?? "等待后端返回调用详情"}
          fields={[
            { label: "参数摘要", value: detail?.paramSummary ?? "暂无" },
            { label: "触发模块", value: detail?.triggeredModules?.join(", ") || "暂无" },
            { label: "错误文本", value: detail?.errorText ?? "暂无" },
            { label: "元数据", value: formatToolMetadata(detail?.metadataJson) },
          ]}
        />
      </section>
    </div>
  );
}
