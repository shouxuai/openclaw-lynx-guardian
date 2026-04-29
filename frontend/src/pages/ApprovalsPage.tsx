import { useState } from "react";
import type { ApprovalDetailDto, ApprovalListItemDto } from "@lynx/local-console-shared";

import { getApprovalDetail, listApprovals, type ApprovalListQuery } from "../api/approvals";
import { mockApprovals } from "../data/mock-console";
import { ModalDialog } from "../components/feedback/ModalDialog";
import { PageHeader } from "../components/layout/PageHeader";
import { DataTable } from "../components/tables/DataTable";
import { TablePagination } from "../components/tables/TablePagination";
import { paginateMockPage, usePagedListResource } from "../hooks/usePagedListResource";
import { formatTimestamp } from "../utils/format";
import { formatQaRecordId } from "../utils/qa-records";
import { renderRiskBadge, renderStateBadge } from "../utils/status";

function formatApprovalScope(approval: ApprovalListItemDto): string {
  const metadata = (approval as ApprovalListItemDto & { metadataJson?: Record<string, unknown> }).metadataJson;
  const grantScope = metadata?.grantScope ?? metadata?.resourceScope ?? metadata?.scope;
  if (!grantScope) {
    return approval.scopeType;
  }
  if (typeof grantScope === "string") {
    return grantScope;
  }
  return JSON.stringify(grantScope);
}

function formatRevokedReason(approval: ApprovalListItemDto): string {
  const metadata = (approval as ApprovalListItemDto & { metadataJson?: Record<string, unknown> }).metadataJson;
  const reason = metadata?.revokedReason ?? metadata?.grantRevokedReason;
  return typeof reason === "string" && reason.trim().length > 0 ? reason : "暂无";
}

function formatJson(value: Record<string, unknown> | undefined): string {
  return value ? JSON.stringify(value, null, 2) : "暂无";
}

function formatList(values: string[] | undefined): string {
  return values && values.length > 0 ? values.join("；") : "暂无";
}

export function ApprovalsPage() {
  const [selectedDetail, setSelectedDetail] = useState<ApprovalDetailDto | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const { items, loading, error, paginationProps } = usePagedListResource<ApprovalListItemDto, ApprovalListQuery>({
    fallbackPage: import.meta.env.DEV
      ? (_query, pageIndex, pageSize) => paginateMockPage(mockApprovals, pageIndex, pageSize)
      : undefined,
    loadPage: listApprovals,
    query: {},
  });

  const pendingCount = items.filter((item) => item.resolution === "pending" || !item.resolution).length;
  const approvedCount = items.filter((item) => item.resolution === "approved" || item.resolution === "completed").length;
  const blockedCount = items.filter((item) => item.resolution === "blocked" || item.resolution === "failed").length;
  const statusDescription = error ? `审批数据加载失败：${error}` : loading ? "正在加载审批队列" : "治理控制台聚合所有待复核与已决策请求。";
  const isDetailDialogOpen = Boolean(selectedDetail || detailError);

  function handleCloseDetail(): void {
    setSelectedDetail(null);
    setDetailError(null);
    setDetailLoadingId(null);
  }

  async function handleOpenDetail(approvalId: string): Promise<void> {
    setDetailLoadingId(approvalId);
    setDetailError(null);
    try {
      const detail = await getApprovalDetail(approvalId);
      setSelectedDetail(detail);
    } catch (loadError) {
      setSelectedDetail(null);
      setDetailError(loadError instanceof Error ? loadError.message : "详情加载失败");
    } finally {
      setDetailLoadingId(null);
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="审批管理"
        description={statusDescription}
        eyebrow="GOVERNANCE CONTROL"
        actions={(
          <button className="btn btn--dark" type="button">批量处理</button>
        )}
      />

      <section className="summary-card-grid">
        <article className="summary-card">
          <p className="summary-card__label">待处理申请数</p>
          <strong className="summary-card__value">{pendingCount}</strong>
        </article>
        <article className="summary-card">
          <p className="summary-card__label">今日已核准</p>
          <strong className="summary-card__value">{approvedCount}</strong>
        </article>
        <article className="summary-card">
          <p className="summary-card__label">风险拦截数</p>
          <strong className="summary-card__value">{blockedCount}</strong>
        </article>
      </section>

      <section className="table-panel">
        <div className="table-panel__header">
          <h2 className="panel__title">活跃审核流</h2>
          <div className="page-header__actions">
            <button className="btn btn--dark" type="button">待审核</button>
            <button className="btn" type="button">历史记录</button>
            <button className="btn" type="button">搜索 ID 或申请人...</button>
          </div>
        </div>
        <DataTable
          columns={[
            { key: "approvalId", label: "审批 ID", maxWidth: 220, minWidth: 170, width: 190 },
            { key: "qaRecord", label: "问答记录", maxWidth: 220, minWidth: 150, width: 180 },
            { key: "requester", label: "申请人", maxWidth: 220, minWidth: 160, width: 180 },
            { key: "risk", label: "风险权重", maxWidth: 150, minWidth: 112, width: 128 },
            { key: "scope", label: "范围类型", maxWidth: 190, minWidth: 140, width: 160 },
            { key: "grantScope", label: "Grant 范围", maxWidth: 260, minWidth: 190, width: 230 },
            { key: "revokedReason", label: "撤销原因", maxWidth: 220, minWidth: 160, width: 190 },
            { key: "summary", label: "请求摘要", maxWidth: 360, minWidth: 260, width: 320 },
            { key: "status", label: "状态", maxWidth: 150, minWidth: 112, width: 128 },
            { key: "action", label: "操作", maxWidth: 140, minWidth: 104, width: 116 },
          ]}
          loading={loading}
          rows={items.map((approval) => ({
            id: approval.approvalId,
            approvalId: approval.approvalId,
            qaRecord: formatQaRecordId(approval.qaRecordId),
            requester: approval.requesterOuId ?? "未知申请人",
            risk: renderRiskBadge(approval.riskLevel),
            scope: approval.scopeType,
            grantScope: formatApprovalScope(approval),
            revokedReason: formatRevokedReason(approval),
            summary: approval.promptExcerpt ?? "暂无审批摘要",
            status: renderStateBadge(approval.resolution ?? "pending"),
            action: (
              <button
                aria-label={`查看 ${approval.approvalId} 审批详情`}
                className="btn btn--compact"
                disabled={detailLoadingId === approval.approvalId}
                type="button"
                onClick={() => void handleOpenDetail(approval.approvalId)}
              >
                {detailLoadingId === approval.approvalId ? "加载中" : "查看详情"}
              </button>
            ),
          }))}
        />
        <TablePagination {...paginationProps} />
      </section>

      <section className="panel">
        <div className="panel__header">
          <h2 className="panel__title">二次确认流机制</h2>
        </div>
        <div className="summary-card-grid">
          {[
            ["1", "发起阶段", "申请人提交高风险请求，系统自动进行规则检测与初始评分。"],
            ["2", "一级审核", "直属负责人或业务管理员根据上下文进行逻辑一致性校验。"],
            ["3", "二次安全校验", "安全合规审计官对特权访问、数据分发等关键操作进行二次锁定。"],
          ].map(([step, title, description]) => (
            <article key={step} className="metric-card">
              <p className="status-badge status-badge--info">{step}</p>
              <h3 className="panel__title">{title}</h3>
              <p className="panel__subtitle">{description}</p>
            </article>
          ))}
        </div>
      </section>

      <ModalDialog
        closeLabel="关闭详情"
        open={isDetailDialogOpen}
        title="审批详情"
        subtitle={
          detailError
            ? `详情加载失败：${detailError}`
            : selectedDetail?.approvalId ?? "查看审批上下文、申请人与授权证据。"
        }
        onClose={handleCloseDetail}
      >
        <dl className="detail-panel__grid">
          {[
            { label: "审批 ID", value: selectedDetail?.approvalId ?? "暂无" },
            { label: "关联问答记录", value: formatQaRecordId(selectedDetail?.qaRecordId) },
            { label: "Pending ID", value: selectedDetail?.pendingId ?? "暂无" },
            { label: "申请人", value: selectedDetail?.requesterOuId ?? "暂无" },
            { label: "审批人候选", value: formatList(selectedDetail?.approverOuIds) },
            { label: "实际审批人", value: selectedDetail?.resolvedApproverOuId ?? "暂无" },
            { label: "模块", value: selectedDetail?.module ?? "暂无" },
            { label: "工具", value: selectedDetail?.toolName ?? "暂无" },
            { label: "范围类型", value: selectedDetail?.scopeType ?? "暂无" },
            { label: "渠道", value: selectedDetail?.channelProfile ?? selectedDetail?.transport ?? "暂无" },
            { label: "会话", value: selectedDetail?.sessionKey ?? "暂无" },
            { label: "Run ID", value: selectedDetail?.runId ?? "暂无" },
            { label: "Conversation", value: selectedDetail?.conversationId ?? "暂无" },
            { label: "请求指纹", value: selectedDetail?.requestFingerprintHash ?? "暂无" },
            { label: "申请时间", value: selectedDetail ? formatTimestamp(selectedDetail.requestedAtMs) : "暂无" },
            { label: "过期时间", value: selectedDetail ? formatTimestamp(selectedDetail.expiresAtMs) : "暂无" },
            { label: "处理时间", value: selectedDetail?.resolvedAtMs ? formatTimestamp(selectedDetail.resolvedAtMs) : "暂无" },
            {
              label: "Audit Summary",
              value: <pre className="code-panel">{formatJson(selectedDetail?.auditSummaryJson)}</pre>,
            },
            {
              label: "Metadata",
              value: <pre className="code-panel">{formatJson(selectedDetail?.metadataJson)}</pre>,
            },
          ].map((field) => (
            <div key={field.label} className="detail-panel__field">
              <dt>{field.label}</dt>
              <dd>{field.value}</dd>
            </div>
          ))}
        </dl>
      </ModalDialog>
    </div>
  );
}
