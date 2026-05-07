import { useState, type FormEvent } from "react";
import { Button, Card, Input, Typography } from "antd";

import { listGrants, type Grant, type GrantListQuery } from "../api/grants";
import { ModalDialog } from "../components/feedback/ModalDialog";
import { StatusBadge } from "../components/feedback/StatusBadge";
import { PageHeader } from "../components/layout/PageHeader";
import { DataTable } from "../components/tables/DataTable";
import { TablePagination } from "../components/tables/TablePagination";
import { usePagedListResource } from "../hooks/usePagedListResource";
import { formatInteger } from "../utils/format";

function formatScope(scope: Record<string, unknown>): string {
  const keys = Object.keys(scope);
  if (keys.length === 0) {
    return "未声明范围";
  }
  return keys.map((key) => `${key}:${String(scope[key])}`).join("；");
}

function formatIsoTime(value: string | undefined): string {
  if (!value) {
    return "暂无";
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }
  return new Date(timestamp).toLocaleString("zh-CN");
}

interface GrantFilters {
  q: string;
  requesterId: string;
}

const EMPTY_FILTERS: GrantFilters = {
  q: "",
  requesterId: "",
};

function buildGrantQuery(filters: GrantFilters): Omit<GrantListQuery, "pageNum" | "pageSize"> {
  return {
    q: filters.q.trim() || undefined,
    requesterId: filters.requesterId.trim() || undefined,
  };
}

export function GrantsPage() {
  const [draftFilters, setDraftFilters] = useState<GrantFilters>(EMPTY_FILTERS);
  const [appliedQuery, setAppliedQuery] = useState<Omit<GrantListQuery, "pageNum" | "pageSize">>({});
  const [selectedGrant, setSelectedGrant] = useState<Grant | null>(null);
  const { items, loading, error, paginationProps, resetPaging, retry } = usePagedListResource<
    Grant,
    GrantListQuery
  >({
    loadPage: listGrants,
    onPageBoundaryChange: () => setSelectedGrant(null),
    query: appliedQuery,
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setSelectedGrant(null);
    resetPaging();
    setAppliedQuery(buildGrantQuery(draftFilters));
  }

  function handleReset(): void {
    setDraftFilters(EMPTY_FILTERS);
    setSelectedGrant(null);
    resetPaging();
    setAppliedQuery({});
  }

  const activeCount = items.filter((item) => !item.revokedAt).length;
  const revokedCount = items.length - activeCount;
  const statusDescription = error
    ? `放行记录加载失败：${error}`
    : loading
      ? "正在加载放行记录"
      : undefined;

  return (
    <div className="page-stack">
      <PageHeader
        title="放行记录"
        description={statusDescription}
        eyebrow="审批后的工具放行流水"
      />

      <section className="metric-grid metric-grid--compact metric-grid--narrow">
        <article className="metric-card">
          <p className="metric-card__label">已放行调用</p>
          <strong className="metric-card__value">
            {formatInteger(activeCount)}
          </strong>
          <p className="metric-card__note">命中授权范围</p>
        </article>
        <article className="metric-card">
          <p className="metric-card__label">已撤销/失效</p>
          <strong className="metric-card__value">
            {formatInteger(revokedCount)}
          </strong>
          <p className="metric-card__note">过期、升级或上下文变化</p>
        </article>
      </section>

      <section className="filter-panel">
        <form
          className="audit-filter-form audit-filter-form--compact"
          onSubmit={handleSubmit}
        >
          <label className="filter-field filter-field--search">
            <span>关键词</span>
            <Input
              allowClear
              aria-label="关键词"
              placeholder="搜索放行、审批、链路或工具"
              value={draftFilters.q}
              onChange={(event) =>
                setDraftFilters((current) => ({
                  ...current,
                  q: event.target.value,
                }))
              }
            />
          </label>
          <label className="filter-field">
            <span>申请人</span>
            <Input
              allowClear
              aria-label="申请人"
              placeholder="输入用户或 OU ID"
              value={draftFilters.requesterId}
              onChange={(event) =>
                setDraftFilters((current) => ({
                  ...current,
                  requesterId: event.target.value,
                }))
              }
            />
          </label>
          <div className="audit-filter-form__actions">
            <Button htmlType="submit" type="primary">
              应用筛选
            </Button>
            <Button htmlType="button" onClick={handleReset}>
              重置条件
            </Button>
          </div>
        </form>
      </section>

      <Card className="table-explanation-card" size="small" title="放行记录说明">
        <Typography.Paragraph>
          审批通过后，后续同一链路里的 tool 调用如果命中已授权范围，会作为放行记录出现在这里；换成 exec、换路径或链路结束就不会复用。
        </Typography.Paragraph>
      </Card>

      <section className="table-panel">
        <div className="table-panel__header">
          <h2 className="panel__title">放行记录列表</h2>
        </div>
        <DataTable
          emptyDescription="暂无放行记录"
          columns={[
            {
              key: "grant",
              label: "放行",
              maxWidth: 280,
              minWidth: 200,
              width: 240,
            },
            {
              key: "requester",
              label: "申请人",
              maxWidth: 190,
              minWidth: 140,
              width: 160,
            },
            {
              key: "approver",
              label: "审批人",
              maxWidth: 190,
              minWidth: 140,
              width: 160,
            },
            {
              key: "tool",
              label: "工具",
              maxWidth: 170,
              minWidth: 120,
              width: 140,
            },
            {
              key: "status",
              label: "状态",
              maxWidth: 128,
              minWidth: 100,
              width: 112,
            },
            {
              key: "expires",
              label: "过期时间",
              maxWidth: 180,
              minWidth: 140,
              width: 160,
            },
            {
              key: "detail",
              label: "操作",
              maxWidth: 128,
              minWidth: 96,
              width: 108,
            },
          ]}
          error={error}
          loading={loading}
          onRetry={retry}
          rows={items.map((item) => ({
            id: item.grantId,
            grant: (
              <div className="row-stack">
                <strong>{item.grantId}</strong>
                <span>{item.approvalId}</span>
              </div>
            ),
            requester: item.requesterOuId || item.requesterId || "未知",
            approver: item.approverOuId || item.approverId || "未知",
            tool: item.toolName || "暂无",
            status: (
              <StatusBadge
                label={item.revokedAt ? "已撤销" : "有效"}
                tone={item.revokedAt ? "danger" : "success"}
              />
            ),
            expires: formatIsoTime(item.expiresAt),
            detail: (
              <button
                aria-label={`查看 ${item.grantId} 放行详情`}
                className="btn btn--compact"
                type="button"
                onClick={() => setSelectedGrant(item)}
              >
                详情
              </button>
            ),
          }))}
        />
        <TablePagination {...paginationProps} ariaLabel="放行记录分页" />
      </section>

      <ModalDialog
        closeLabel="关闭详情"
        open={Boolean(selectedGrant)}
        size="wide"
        title="放行详情"
        subtitle={
          selectedGrant?.grantId ?? "查看放行记录的适用范围和撤销上下文。"
        }
        onClose={() => setSelectedGrant(null)}
      >
        {selectedGrant ? (
          <div className="audit-detail-dialog">
            <section className="audit-detail-dialog__hero">
              <div className="audit-detail-dialog__heroText">
                <p className="audit-detail-dialog__eyebrow">放行概览</p>
                <p className="audit-detail-dialog__heroSubtitle">
                  {selectedGrant.grantId} 覆盖 {selectedGrant.toolName || "未知工具"} 的后续授权命中。
                </p>
              </div>
              <div className="audit-detail-dialog__chips" aria-label="放行概览标签">
                <span className="audit-detail-dialog__chip">
                  <span className="audit-detail-dialog__chipLabel">状态</span>
                  <span className="audit-detail-dialog__chipValue">
                    <StatusBadge
                      label={selectedGrant.revokedAt ? "已撤销" : "有效"}
                      tone={selectedGrant.revokedAt ? "danger" : "success"}
                    />
                  </span>
                </span>
                <span className="audit-detail-dialog__chip">
                  <span className="audit-detail-dialog__chipLabel">申请人</span>
                  <span className="audit-detail-dialog__chipValue">
                    {selectedGrant.requesterOuId || selectedGrant.requesterId || "暂无"}
                  </span>
                </span>
                <span className="audit-detail-dialog__chip">
                  <span className="audit-detail-dialog__chipLabel">审批人</span>
                  <span className="audit-detail-dialog__chipValue">
                    {selectedGrant.approverOuId || selectedGrant.approverId || "暂无"}
                  </span>
                </span>
                <span className="audit-detail-dialog__chip">
                  <span className="audit-detail-dialog__chipLabel">工具</span>
                  <span className="audit-detail-dialog__chipValue">{selectedGrant.toolName || "暂无"}</span>
                </span>
                <span className="audit-detail-dialog__chip">
                  <span className="audit-detail-dialog__chipLabel">过期时间</span>
                  <span className="audit-detail-dialog__chipValue">{formatIsoTime(selectedGrant.expiresAt)}</span>
                </span>
              </div>
            </section>

            <section className="audit-detail-dialog__section">
              <div className="panel__header audit-detail-dialog__sectionHeader">
                <div>
                  <h3 className="panel__title">授权上下文</h3>
                  <p className="panel__subtitle">放行记录与审批、链路、请求人和目标之间的绑定关系。</p>
                </div>
              </div>
              <dl className="detail-panel__grid audit-detail-dialog__summary-grid">
                {[
                  { label: "放行 ID", value: selectedGrant.grantId },
                  { label: "审批 ID", value: selectedGrant.approvalId || "暂无" },
                  { label: "链路", value: selectedGrant.chainId || "暂无" },
                  { label: "会话", value: selectedGrant.sessionKey || "暂无" },
                  { label: "渠道", value: selectedGrant.channelProfile || "暂无" },
                  { label: "会话 ID", value: selectedGrant.conversationId || "暂无" },
                  { label: "风险族", value: selectedGrant.riskFamily || "暂无" },
                  { label: "目标类型", value: selectedGrant.targetKind || "暂无" },
                  { label: "目标哈希", value: selectedGrant.targetHash || "暂无" },
                  { label: "创建时间", value: formatIsoTime(selectedGrant.createdAt) },
                  { label: "过期时间", value: formatIsoTime(selectedGrant.expiresAt) },
                  { label: "撤销时间", value: formatIsoTime(selectedGrant.revokedAt) },
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
                  <h3 className="panel__title">放行范围</h3>
                  <p className="panel__subtitle">后续调用命中这些条件时才会复用这条授权。</p>
                </div>
              </div>
              <dl className="detail-panel__grid audit-detail-dialog__summary-grid">
                <div className="detail-panel__field">
                  <dt>范围内容</dt>
                  <dd>{formatScope(selectedGrant.resourceScope)}</dd>
                </div>
                <div className="detail-panel__field">
                  <dt>撤销原因</dt>
                  <dd>{selectedGrant.revokedReason || "暂无"}</dd>
                </div>
              </dl>
            </section>
          </div>
        ) : null}
      </ModalDialog>
    </div>
  );
}
