import type { ApprovalDetailDto, ApprovalListItemDto, RiskLevel } from "@lynx/local-console-shared";

import { getApprovalDetail, listApprovals } from "../api/approvals";
import { MetricCard } from "../components/cards/MetricCard";
import { DetailPanel } from "../components/detail/DetailPanel";
import { StatusBadge } from "../components/feedback/StatusBadge";
import { FilterBar } from "../components/filters/FilterBar";
import { PageHeader } from "../components/layout/PageHeader";
import { DataTable } from "../components/tables/DataTable";
import { filterPresets } from "../data/filter-presets";
import { useListDetailResource } from "../hooks/useListDetailResource";
import { formatTimestamp } from "../utils/format";
import { formatChannelLabel, renderRiskBadge, renderStateBadge } from "../utils/status";

const RISK_ORDER: Record<RiskLevel, number> = {
  L0: 0,
  L1: 1,
  L2: 2,
  L3: 3,
  L4: 4,
};

export function ApprovalsPage() {
  const { items, detail, loading, error } = useListDetailResource<ApprovalListItemDto, ApprovalDetailDto>({
    loadList: () => listApprovals({ limit: 20 }),
    loadDetail: getApprovalDetail,
    getItemId: (item) => item.approvalId,
  });

  const pendingCount = items.filter((item) => item.resolution === "pending").length;
  const resolvedCount = items.filter((item) => item.resolution && item.resolution !== "pending").length;
  const scopeCount = new Set(items.map((item) => item.scopeType)).size;
  const highestRisk = items.reduce<RiskLevel>(
    (currentHighest, item) => {
      if (!item.riskLevel) {
        return currentHighest;
      }
      return RISK_ORDER[item.riskLevel] > RISK_ORDER[currentHighest] ? item.riskLevel : currentHighest;
    },
    "L0",
  );
  const headerDescription = loading
    ? "正在从本地控制台后端加载审批链路。"
    : error
      ? `审批数据加载失败：${error}`
      : "展示真实审批队列与默认详情记录。";
  const headerTone = error ? "danger" : loading ? "info" : "success";
  const headerLabel = error ? "请求失败" : loading ? "加载中" : "实时数据";

  return (
    <div className="page-stack">
      <PageHeader
        title="审批"
        description={headerDescription}
        eyebrow="审批链路"
        actions={<StatusBadge label={headerLabel} tone={headerTone} />}
      />
      <section className="metric-grid metric-grid--compact">
        <MetricCard label="待处理" value={`${pendingCount}`} note="等待审批人确认" />
        <MetricCard label="已处理" value={`${resolvedCount}`} note="已收到审批结果" />
        <MetricCard label="审批范围" value={`${scopeCount}`} note="去重后的 scopeType 数量" />
        <MetricCard label="最高风险" value={highestRisk} note="来自当前列表的最高等级" />
      </section>
      <FilterBar chips={filterPresets.approvals} />
      <section className="split-grid">
        <article className="panel">
          <div className="panel__header">
            <div>
              <h2 className="panel__title">审批队列</h2>
              <p className="panel__subtitle">列表来自真实审批接口，默认展示最近 20 条记录。</p>
            </div>
          </div>
          <DataTable
            columns={[
              { key: "requester", label: "申请人" },
              { key: "module", label: "模块" },
              { key: "risk", label: "风险" },
              { key: "resolution", label: "结果" },
              { key: "requested", label: "申请时间" },
            ]}
            rows={items.map((approval) => ({
              id: approval.approvalId,
              requester: approval.requesterOuId ?? "未知",
              module: approval.module,
              risk: renderRiskBadge(approval.riskLevel),
              resolution: renderStateBadge(approval.resolution),
              requested: formatTimestamp(approval.requestedAtMs),
            }))}
          />
        </article>
        <DetailPanel
          title={detail?.promptExcerpt ?? "暂无审批详情"}
          subtitle={detail?.approvalId ?? "等待后端返回审批详情"}
          fields={[
            {
              label: "渠道",
              value: detail
                ? `${formatChannelLabel(detail.channelProfile)} · ${detail.channelId ?? "暂无"}`
                : "暂无",
            },
            { label: "审批人", value: detail?.approverOuIds?.join(", ") || "暂无" },
            { label: "处理人", value: detail?.resolvedApproverOuId ?? "待处理" },
            { label: "指纹", value: detail?.requestFingerprintHash ?? "暂无" },
          ]}
        />
      </section>
    </div>
  );
}
