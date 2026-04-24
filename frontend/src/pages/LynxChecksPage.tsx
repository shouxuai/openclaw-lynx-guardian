import type { LynxCheckDetailDto, LynxCheckListItemDto } from "@lynx/local-console-shared";

import { getLynxCheckDetail, listLynxChecks } from "../api/lynx-checks";
import { MetricCard } from "../components/cards/MetricCard";
import { DetailPanel } from "../components/detail/DetailPanel";
import { StatusBadge } from "../components/feedback/StatusBadge";
import { FilterBar } from "../components/filters/FilterBar";
import { PageHeader } from "../components/layout/PageHeader";
import { DataTable } from "../components/tables/DataTable";
import { filterPresets } from "../data/filter-presets";
import { useListDetailResource } from "../hooks/useListDetailResource";
import { formatTimestamp } from "../utils/format";
import { formatDomainLabel, formatStateLabel, renderStateBadge } from "../utils/status";

function formatDeliveryAttempts(deliveryAttempts: Array<Record<string, unknown>> | undefined) {
  if (!deliveryAttempts?.length) {
    return "暂无";
  }

  return deliveryAttempts.map((attempt) => {
    const attemptIndex = typeof attempt.attempt === "number" ? attempt.attempt : "?";
    const target = typeof attempt.target === "string" ? formatDomainLabel(attempt.target) : "暂无";
    const status = typeof attempt.status === "string" ? formatStateLabel(attempt.status) : "未知";
    return `第${attemptIndex} 次：${target}，${status}`;
  }).join("\n");
}

export function LynxChecksPage() {
  const { items, detail, loading, error } = useListDetailResource<LynxCheckListItemDto, LynxCheckDetailDto>({
    loadList: () => listLynxChecks({ limit: 20 }),
    loadDetail: getLynxCheckDetail,
    getItemId: (item) => item.requestId,
  });

  const completedCount = items.filter((item) => item.status === "completed").length;
  const runningCount = items.filter((item) => item.status === "running").length;
  const attemptedCount = items.filter((item) => item.sendAttempted).length;
  const successCount = items.filter((item) => item.sendSucceeded).length;
  const successRate = attemptedCount === 0 ? "0%" : `${Math.round((successCount / attemptedCount) * 100)}%`;
  const headerDescription = loading
    ? "正在从本地控制台后端加载巡检记录。"
    : error
      ? `巡检数据加载失败：${error}`
      : "展示真实巡检任务状态与投递结果。";
  const headerTone = error ? "danger" : loading ? "info" : "success";
  const headerLabel = error ? "请求失败" : loading ? "加载中" : "实时数据";

  return (
    <div className="page-stack">
      <PageHeader
        title="巡检"
        description={headerDescription}
        eyebrow="巡检记录"
        actions={<StatusBadge label={headerLabel} tone={headerTone} />}
      />
      <section className="metric-grid metric-grid--compact">
        <MetricCard label="已完成" value={`${completedCount}`} note="状态为 completed 的任务" />
        <MetricCard label="运行中" value={`${runningCount}`} note="仍在执行或等待中的任务" />
        <MetricCard label="投递成功率" value={successRate} note="按已尝试投递的任务计算" />
        <MetricCard
          label="当前目标"
          value={detail ? formatDomainLabel(detail.preferredTargetKind) : "暂无"}
          note="默认详情记录的目标类型"
        />
      </section>
      <FilterBar chips={filterPresets.lynxChecks} />
      <section className="split-grid">
        <article className="panel">
          <div className="panel__header">
            <div>
              <h2 className="panel__title">巡检队列</h2>
              <p className="panel__subtitle">列表来自真实巡检接口，详情默认显示第一条记录。</p>
            </div>
          </div>
          <DataTable
            columns={[
              { key: "request", label: "请求" },
              { key: "trigger", label: "触发方式" },
              { key: "status", label: "状态" },
              { key: "provider", label: "渠道" },
              { key: "created", label: "创建时间" },
            ]}
            rows={items.map((item) => ({
              id: item.requestId,
              request: item.requestId,
              trigger: formatDomainLabel(item.trigger),
              status: renderStateBadge(item.status),
              provider: formatDomainLabel(item.messageProvider),
              created: formatTimestamp(item.createdAtMs),
            }))}
          />
        </article>
        <DetailPanel
          title={detail?.requestId ?? "暂无巡检记录"}
          subtitle={detail?.reportPath ?? "等待后端返回巡检详情"}
          fields={[
            { label: "目标类型", value: formatDomainLabel(detail?.preferredTargetKind) },
            { label: "会话", value: detail?.sessionKey ?? "暂无" },
            { label: "投递通道", value: formatDomainLabel(detail?.transport) },
            { label: "投递尝试", value: formatDeliveryAttempts(detail?.deliveryAttemptsJson) },
          ]}
        />
      </section>
    </div>
  );
}
