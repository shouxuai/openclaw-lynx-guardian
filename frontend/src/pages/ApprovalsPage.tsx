import { useState, type FormEvent } from "react";
import type { ApprovalDetailDto, ApprovalListItemDto, RiskLevel } from "@lynx/local-console-shared";
import { Button, Card, Input, Select, Typography } from "antd";

import {
  getApprovalDetail,
  listApprovals,
  resolveApproval,
  type ApprovalListQuery,
  type ApprovalResolveBody,
} from "../api/approvals";
import { mockApprovals } from "../data/mock-console";
import { ModalDialog } from "../components/feedback/ModalDialog";
import { PageHeader } from "../components/layout/PageHeader";
import { DataTable } from "../components/tables/DataTable";
import { TablePagination } from "../components/tables/TablePagination";
import { paginateMockPage, usePagedListResource } from "../hooks/usePagedListResource";
import { formatTimestamp } from "../utils/format";
import { formatQaRecordId } from "../utils/qa-records";
import { renderRiskBadge, renderStateBadge } from "../utils/status";

interface ApprovalFilters {
  q: string;
  requesterOuId: string;
  resolution: string;
  riskLevel: string;
}

const EMPTY_FILTERS: ApprovalFilters = {
  q: "",
  requesterOuId: "",
  resolution: "",
  riskLevel: "",
};

const RESOLUTION_OPTIONS = [
  { label: "待处理", value: "pending" },
  { label: "已批准", value: "approved" },
  { label: "已完成", value: "completed" },
  { label: "已阻断", value: "blocked" },
  { label: "失败", value: "failed" },
];

const RISK_OPTIONS: Array<{ label: string; value: RiskLevel }> = [
  { label: "L0 基础", value: "L0" },
  { label: "L1 关注", value: "L1" },
  { label: "L2 中危", value: "L2" },
  { label: "L3 高危", value: "L3" },
  { label: "L4 严重", value: "L4" },
];

const APPROVAL_MODULE_LABELS: Record<string, string> = {
  M2: "受保护资源访问",
  M3: "高风险代理/权限操作",
  "M2:protected_file_access": "访问受保护文件",
  protected_file_access: "访问受保护文件",
  approval_bypass: "绕过审批意图",
  concealed_execution: "隐藏执行意图",
  output_sensitive_data: "输出敏感信息",
  plugin_integrity: "插件完整性风险",
};

function isUnresolvedApproval(approval: ApprovalListItemDto): boolean {
  return approval.resolution === "pending" || !approval.resolution;
}

function isExpiredApproval(approval: ApprovalListItemDto, nowMs = Date.now()): boolean {
  return isUnresolvedApproval(approval) && approval.expiresAtMs <= nowMs;
}

function resolveApprovalState(approval: ApprovalListItemDto): string {
  return isExpiredApproval(approval) ? "expired" : approval.resolution ?? "pending";
}

function formatApprovalRiskLevel(riskLevel: RiskLevel): string {
  return RISK_OPTIONS.find((option) => option.value === riskLevel)?.label ?? riskLevel;
}

function formatApprovalModule(module: string): string {
  return APPROVAL_MODULE_LABELS[module] ?? module;
}

function formatApprovalModuleWithCode(module: string): string {
  const label = formatApprovalModule(module);
  return label === module ? module : `${label}（${module}）`;
}

function formatApprovalInterceptReason(approval: ApprovalListItemDto): string {
  if (approval.riskLevel === "L4") {
    return `${formatApprovalRiskLevel(approval.riskLevel)} 硬拒绝：${formatApprovalModule(approval.module)}，不能在本地审批放行。`;
  }

  return `${formatApprovalModule(approval.module)}，需要审批确认后才可继续。`;
}

function buildApprovalQuery(filters: ApprovalFilters): Omit<ApprovalListQuery, "pageNum" | "pageSize"> {
  return {
    q: filters.q.trim() || undefined,
    resolution: filters.resolution || undefined,
    requesterOuId: filters.requesterOuId.trim() || undefined,
    riskLevel: filters.riskLevel ? [filters.riskLevel as RiskLevel] : undefined,
  };
}

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

function metadataString(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function metadataRecord(metadata: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  const value = metadata?.[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function buildApprovalResolveBody(detail: ApprovalDetailDto): ApprovalResolveBody {
  const metadata = detail.metadataJson;
  const approverOuId = detail.approverOuIds?.[0] ?? detail.resolvedApproverOuId ?? "";
  const chainId = metadataString(metadata, "chainId") ?? detail.runId ?? detail.sessionKey ?? detail.approvalId;
  const requesterId = metadataString(metadata, "requesterId") ?? detail.requesterOuId ?? "";
  const targetHash = metadataString(metadata, "targetHash") ?? detail.requestFingerprintHash ?? detail.approvalId;
  const resourceScope =
    metadataRecord(metadata, "resourceScope")
    ?? metadataRecord(metadata, "grantScope")
    ?? metadataRecord(metadata, "scope")
    ?? {};

  return {
    approvalId: detail.approvalId,
    resolution: "allow-current-chain",
    chainId,
    sessionKey: detail.sessionKey ?? "",
    channelProfile: detail.channelProfile ?? detail.transport ?? "",
    channelId: detail.channelId ?? "",
    conversationId: detail.conversationId ?? "",
    requesterId,
    requesterOuId: detail.requesterOuId ?? "",
    approverId: metadataString(metadata, "approverId") ?? approverOuId,
    approverOuId,
    riskFamily: detail.module,
    riskLevel: detail.riskLevel,
    toolName: detail.toolName ?? "",
    targetKind: metadataString(metadata, "targetKind") ?? "tool",
    targetHash,
    resourceScope,
  };
}

export function ApprovalsPage() {
  const [draftFilters, setDraftFilters] = useState<ApprovalFilters>(EMPTY_FILTERS);
  const [appliedQuery, setAppliedQuery] = useState<Omit<ApprovalListQuery, "pageNum" | "pageSize">>({});
  const [selectedDetail, setSelectedDetail] = useState<ApprovalDetailDto | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [resolveLoading, setResolveLoading] = useState(false);
  const [resolveMessage, setResolveMessage] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const { items, loading, error, paginationProps, resetPaging, retry } = usePagedListResource<ApprovalListItemDto, ApprovalListQuery>({
    fallbackPage: import.meta.env.DEV
      ? (_query, pageIndex, pageSize) => paginateMockPage(mockApprovals, pageIndex, pageSize)
      : undefined,
    loadPage: listApprovals,
    query: appliedQuery,
  });

  const pendingCount = items.filter((item) => isUnresolvedApproval(item) && !isExpiredApproval(item)).length;
  const expiredCount = items.filter((item) => isExpiredApproval(item)).length;
  const resolvedCount = items.filter((item) => !isUnresolvedApproval(item)).length;
  const statusDescription = error
    ? `审批数据加载失败：${error}`
    : loading
      ? "正在加载审批队列"
      : undefined;
  const isDetailDialogOpen = Boolean(selectedDetail || detailError);
  const detailIsExpired = selectedDetail ? isExpiredApproval(selectedDetail) : false;
  const detailIsUnresolved = selectedDetail ? isUnresolvedApproval(selectedDetail) : false;
  const detailCanResolve = Boolean(selectedDetail && detailIsUnresolved && !detailIsExpired && selectedDetail.riskLevel !== "L4");

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    resetPaging();
    setAppliedQuery(buildApprovalQuery(draftFilters));
  }

  function handleReset(): void {
    setDraftFilters(EMPTY_FILTERS);
    resetPaging();
    setAppliedQuery({});
  }

  function handleCloseDetail(): void {
    setSelectedDetail(null);
    setDetailError(null);
    setDetailLoadingId(null);
    setResolveLoading(false);
    setResolveMessage(null);
    setResolveError(null);
  }

  async function handleOpenDetail(approvalId: string): Promise<void> {
    setDetailLoadingId(approvalId);
    setDetailError(null);
    setResolveMessage(null);
    setResolveError(null);
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

  async function handleResolveApproval(): Promise<void> {
    if (!selectedDetail || !detailCanResolve) {
      return;
    }

    setResolveLoading(true);
    setResolveMessage(null);
    setResolveError(null);
    try {
      await resolveApproval(selectedDetail.approvalId, buildApprovalResolveBody(selectedDetail));
      setSelectedDetail((current) => current
        ? {
            ...current,
            resolution: "approved",
            resolvedAtMs: current.resolvedAtMs ?? Date.now(),
            resolvedApproverOuId: current.resolvedApproverOuId ?? current.approverOuIds?.[0],
          }
        : current);
      setResolveMessage("审批已批准");
      retry();
    } catch (approveError) {
      setResolveError(approveError instanceof Error ? approveError.message : "审批处理失败");
    } finally {
      setResolveLoading(false);
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="审批管理"
        description={statusDescription}
        eyebrow="GOVERNANCE CONTROL"
      />

      <section className="metric-grid metric-grid--three">
        <article className="metric-card">
          <p className="metric-card__label">待处理申请</p>
          <strong className="metric-card__value">{pendingCount}</strong>
        </article>
        <article className="metric-card">
          <p className="metric-card__label">已过期未处理</p>
          <strong className="metric-card__value">{expiredCount}</strong>
        </article>
        <article className="metric-card">
          <p className="metric-card__label">已处理申请</p>
          <strong className="metric-card__value">{resolvedCount}</strong>
        </article>
      </section>

      <section className="filter-panel">
        <form className="audit-filter-form audit-filter-form--compact" onSubmit={handleSubmit}>
          <label className="filter-field">
            <span>处理状态</span>
            <Select
              allowClear
              aria-label="处理状态"
              options={RESOLUTION_OPTIONS}
              placeholder="全部状态"
              value={draftFilters.resolution || undefined}
              onChange={(value) => setDraftFilters((current) => ({ ...current, resolution: value ?? "" }))}
            />
          </label>
          <label className="filter-field">
            <span>风险等级</span>
            <Select
              allowClear
              aria-label="风险等级"
              options={RISK_OPTIONS}
              placeholder="全部级别"
              value={draftFilters.riskLevel || undefined}
              onChange={(value) => setDraftFilters((current) => ({ ...current, riskLevel: value ?? "" }))}
            />
          </label>
          <label className="filter-field filter-field--search">
            <span>关键词</span>
            <Input
              allowClear
              aria-label="关键词"
              placeholder="搜索审批 ID、请求摘要、模块"
              value={draftFilters.q}
              onChange={(event) => setDraftFilters((current) => ({ ...current, q: event.target.value }))}
            />
          </label>
          <label className="filter-field">
            <span>申请人</span>
            <Input
              allowClear
              aria-label="申请人"
              placeholder="输入申请人 OU ID"
              value={draftFilters.requesterOuId}
              onChange={(event) => setDraftFilters((current) => ({ ...current, requesterOuId: event.target.value }))}
            />
          </label>
          <div className="audit-filter-form__actions">
            <Button htmlType="submit" type="primary">应用筛选</Button>
            <Button htmlType="button" onClick={handleReset}>重置条件</Button>
          </div>
        </form>
      </section>

      <Card className="table-explanation-card" size="small" title="审批记录说明">
        <Typography.Paragraph>
          OpenClaw 原生审批窗口之外的审批请求会进入这里。列表先展示拦截理由、申请人和状态；授权上下文、审批证据和处理动作进入详情。
        </Typography.Paragraph>
      </Card>

      <section className="table-panel">
        <div className="table-panel__header">
          <h2 className="panel__title">活跃审核流</h2>
        </div>
        <DataTable
          columns={[
            { key: "approval", label: "审批", maxWidth: 240, minWidth: 176, width: 206 },
            { key: "reason", label: "拦截理由", maxWidth: 360, minWidth: 260, width: 306 },
            { key: "requester", label: "申请人", maxWidth: 170, minWidth: 126, width: 142 },
            { key: "risk", label: "风险", maxWidth: 122, minWidth: 92, width: 104 },
            { key: "status", label: "状态", maxWidth: 122, minWidth: 92, width: 104 },
            { key: "requested", label: "申请时间", maxWidth: 160, minWidth: 126, width: 142 },
            { key: "action", label: "操作", maxWidth: 124, minWidth: 98, width: 108 },
          ]}
          error={error}
          loading={loading}
          onRetry={retry}
          rows={items.map((approval) => ({
            id: approval.approvalId,
            approval: (
              <div className="row-stack">
                <strong>{approval.approvalId}</strong>
                <span>{formatQaRecordId(approval.qaRecordId)}</span>
              </div>
            ),
            reason: (
              <div className="row-stack table-reason-cell">
                <strong>{formatApprovalInterceptReason(approval)}</strong>
                <span>{approval.promptExcerpt ?? "暂无审批摘要"}</span>
              </div>
            ),
            requester: approval.requesterOuId ?? "未知申请人",
            risk: renderRiskBadge(approval.riskLevel),
            status: renderStateBadge(resolveApprovalState(approval)),
            requested: formatTimestamp(approval.requestedAtMs),
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
        size="wide"
        title="审批详情"
        subtitle={
          detailError
            ? `详情加载失败：${detailError}`
            : selectedDetail?.approvalId ?? "查看审批上下文、申请人与授权证据。"
        }
        onClose={handleCloseDetail}
      >
        {selectedDetail ? (
          <div className="audit-detail-dialog">
            <section className="audit-detail-dialog__hero">
              <div className="audit-detail-dialog__heroText">
                <p className="audit-detail-dialog__eyebrow">审批概览</p>
                <p className="audit-detail-dialog__heroSubtitle">{formatApprovalInterceptReason(selectedDetail)}</p>
              </div>
              <div className="audit-detail-dialog__chips" aria-label="审批概览标签">
                <span className="audit-detail-dialog__chip">
                  <span className="audit-detail-dialog__chipLabel">风险等级</span>
                  <span className="audit-detail-dialog__chipValue">{renderRiskBadge(selectedDetail.riskLevel)}</span>
                </span>
                <span className="audit-detail-dialog__chip">
                  <span className="audit-detail-dialog__chipLabel">处理状态</span>
                  <span className="audit-detail-dialog__chipValue">{renderStateBadge(resolveApprovalState(selectedDetail))}</span>
                </span>
                <span className="audit-detail-dialog__chip">
                  <span className="audit-detail-dialog__chipLabel">申请人</span>
                  <span className="audit-detail-dialog__chipValue">{selectedDetail.requesterOuId ?? "暂无"}</span>
                </span>
                <span className="audit-detail-dialog__chip">
                  <span className="audit-detail-dialog__chipLabel">工具</span>
                  <span className="audit-detail-dialog__chipValue">{selectedDetail.toolName ?? "暂无"}</span>
                </span>
                <span className="audit-detail-dialog__chip">
                  <span className="audit-detail-dialog__chipLabel">关联问答</span>
                  <span className="audit-detail-dialog__chipValue">{formatQaRecordId(selectedDetail.qaRecordId)}</span>
                </span>
                <span className="audit-detail-dialog__chip">
                  <span className="audit-detail-dialog__chipLabel">过期时间</span>
                  <span className="audit-detail-dialog__chipValue">{formatTimestamp(selectedDetail.expiresAtMs)}</span>
                </span>
              </div>
              <section className="approval-action-panel">
                {selectedDetail.riskLevel === "L4" ? (
                  <p className="approval-action-panel__message approval-action-panel__message--warning">
                    L4 是硬拒绝，不能在本地审批放行。
                  </p>
                ) : detailIsExpired ? (
                  <p className="approval-action-panel__message approval-action-panel__message--warning">
                    这条审批已经过期，请回到 OpenClaw 原生审批窗口重新发起。
                  </p>
                ) : detailCanResolve ? (
                  <Button
                    loading={resolveLoading}
                    type="primary"
                    onClick={() => void handleResolveApproval()}
                  >
                    批准本次
                  </Button>
                ) : null}
                {resolveMessage ? <p className="approval-action-panel__message">{resolveMessage}</p> : null}
                {resolveError ? (
                  <p className="approval-action-panel__message approval-action-panel__message--danger">{resolveError}</p>
                ) : null}
              </section>
            </section>

            <section className="audit-detail-dialog__section">
              <div className="panel__header audit-detail-dialog__sectionHeader">
                <div>
                  <h2 className="panel__title">基础信息</h2>
                  <p className="panel__subtitle">审批对象、申请人、候选审批人和时间上下文。</p>
                </div>
              </div>
              <dl className="detail-panel__grid audit-detail-dialog__summary-grid">
                {[
                  { label: "审批 ID", value: selectedDetail.approvalId },
                  { label: "关联问答记录", value: formatQaRecordId(selectedDetail.qaRecordId) },
                  { label: "Pending ID", value: selectedDetail.pendingId ?? "暂无" },
                  { label: "申请人", value: selectedDetail.requesterOuId ?? "暂无" },
                  { label: "审批人候选", value: formatList(selectedDetail.approverOuIds) },
                  { label: "实际审批人", value: selectedDetail.resolvedApproverOuId ?? "暂无" },
                  { label: "模块", value: formatApprovalModuleWithCode(selectedDetail.module) },
                  { label: "工具", value: selectedDetail.toolName ?? "暂无" },
                  { label: "渠道", value: selectedDetail.channelProfile ?? selectedDetail.transport ?? "暂无" },
                  { label: "会话", value: selectedDetail.sessionKey ?? "暂无" },
                  { label: "Run ID", value: selectedDetail.runId ?? "暂无" },
                  { label: "Conversation", value: selectedDetail.conversationId ?? "暂无" },
                  { label: "请求指纹", value: selectedDetail.requestFingerprintHash ?? "暂无" },
                  { label: "申请时间", value: formatTimestamp(selectedDetail.requestedAtMs) },
                  { label: "过期时间", value: formatTimestamp(selectedDetail.expiresAtMs) },
                  { label: "处理时间", value: selectedDetail.resolvedAtMs ? formatTimestamp(selectedDetail.resolvedAtMs) : "暂无" },
                ].map((field) => (
                  <div key={field.label} className="detail-panel__field">
                    <dt>{field.label}</dt>
                    <dd>{field.value}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section className="audit-detail-dialog__section">
              <div className="panel__header audit-detail-dialog__sectionHeader">
                <div>
                  <h2 className="panel__title">授权上下文</h2>
                  <p className="panel__subtitle">审批通过后可能产生的授权范围，以及撤销相关信息。</p>
                </div>
              </div>
              <dl className="detail-panel__grid audit-detail-dialog__summary-grid">
                {[
                  { label: "范围类型", value: selectedDetail.scopeType },
                  { label: "授权范围", value: formatApprovalScope(selectedDetail) },
                  { label: "撤销原因", value: formatRevokedReason(selectedDetail) },
                ].map((field) => (
                  <div key={field.label} className="detail-panel__field">
                    <dt>{field.label}</dt>
                    <dd>{field.value}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section className="audit-detail-dialog__section">
              <div className="panel__header audit-detail-dialog__sectionHeader">
                <div>
                  <h2 className="panel__title">审批证据</h2>
                  <p className="panel__subtitle">后端记录的审计摘要和元数据。</p>
                </div>
              </div>
              <div className="audit-detail-dialog__evidence-grid">
                <section className="detail-panel__field">
                  <dt>Audit Summary</dt>
                  <dd><pre className="code-panel audit-detail-dialog__json">{formatJson(selectedDetail.auditSummaryJson)}</pre></dd>
                </section>
                <section className="detail-panel__field">
                  <dt>Metadata</dt>
                  <dd><pre className="code-panel audit-detail-dialog__json">{formatJson(selectedDetail.metadataJson)}</pre></dd>
                </section>
              </div>
            </section>
          </div>
        ) : detailError ? (
          <div className="audit-detail-dialog">
            <section className="audit-detail-dialog__section">
              <p className="approval-action-panel__message approval-action-panel__message--danger">
                {detailError}
              </p>
            </section>
          </div>
        ) : null}
      </ModalDialog>
    </div>
  );
}
