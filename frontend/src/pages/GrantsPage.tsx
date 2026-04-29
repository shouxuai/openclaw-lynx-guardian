import { startTransition, useEffect, useState, type FormEvent } from "react";
import { Button, Input } from "antd";

import { listGrants, type Grant, type GrantListQuery } from "../api/grants";
import { ModalDialog } from "../components/feedback/ModalDialog";
import { StatusBadge } from "../components/feedback/StatusBadge";
import { PageHeader } from "../components/layout/PageHeader";
import { DataTable } from "../components/tables/DataTable";
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

function buildGrantQuery(filters: GrantFilters): GrantListQuery {
  return {
    q: filters.q.trim() || undefined,
    requesterId: filters.requesterId.trim() || undefined,
  };
}

export function GrantsPage() {
  const [items, setItems] = useState<Grant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draftFilters, setDraftFilters] = useState<GrantFilters>(EMPTY_FILTERS);
  const [appliedQuery, setAppliedQuery] = useState<GrantListQuery>({});
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedGrant, setSelectedGrant] = useState<Grant | null>(null);

  useEffect(() => {
    const abortController = new AbortController();

    async function loadGrants() {
      startTransition(() => {
        setError(null);
        setLoading(true);
      });

      try {
        const nextItems = await listGrants(appliedQuery);
        if (abortController.signal.aborted) {
          return;
        }
        startTransition(() => {
          setItems(nextItems);
          setError(null);
          setLoading(false);
        });
      } catch (loadError) {
        if (abortController.signal.aborted) {
          return;
        }
        startTransition(() => {
          setItems([]);
          setError(loadError instanceof Error ? loadError.message : "Grant 记录加载失败");
          setLoading(false);
        });
      }
    }

    void loadGrants();
    return () => abortController.abort();
  }, [appliedQuery, reloadKey]);

  function retryList(): void {
    setReloadKey((current) => current + 1);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setSelectedGrant(null);
    setAppliedQuery(buildGrantQuery(draftFilters));
  }

  function handleReset(): void {
    setDraftFilters(EMPTY_FILTERS);
    setSelectedGrant(null);
    setAppliedQuery({});
  }

  const activeCount = items.filter((item) => !item.revokedAt).length;
  const revokedCount = items.length - activeCount;
  const statusDescription = error
    ? `Grant 记录加载失败：${error}`
    : loading
      ? "正在加载 allow-current-chain 授权"
      : "展示审批后的 chain-scoped grant、资源范围和撤销原因。";

  return (
    <div className="page-stack">
      <PageHeader
        title="授权 Grant"
        description={statusDescription}
        eyebrow="ALLOW CURRENT CHAIN"
      />

      <section className="summary-card-grid">
        <article className="summary-card">
          <p className="summary-card__label">活跃 Grant</p>
          <strong className="summary-card__value">{formatInteger(activeCount)}</strong>
        </article>
        <article className="summary-card">
          <p className="summary-card__label">已撤销</p>
          <strong className="summary-card__value">{formatInteger(revokedCount)}</strong>
        </article>
      </section>

      <section className="filter-panel">
        <form className="audit-filter-form audit-filter-form--compact" onSubmit={handleSubmit}>
          <label className="filter-field filter-field--search">
            <span>关键词</span>
            <Input
              allowClear
              aria-label="关键词"
              placeholder="搜索授权、审批、链路或工具"
              value={draftFilters.q}
              onChange={(event) => setDraftFilters((current) => ({ ...current, q: event.target.value }))}
            />
          </label>
          <label className="filter-field">
            <span>申请人</span>
            <Input
              allowClear
              aria-label="申请人"
              placeholder="输入用户或 OU ID"
              value={draftFilters.requesterId}
              onChange={(event) => setDraftFilters((current) => ({ ...current, requesterId: event.target.value }))}
            />
          </label>
          <div className="audit-filter-form__actions">
            <Button htmlType="submit" type="primary">应用筛选</Button>
            <Button htmlType="button" onClick={handleReset}>重置条件</Button>
          </div>
        </form>
      </section>

      <section className="table-panel">
        <div className="table-panel__header">
          <div>
            <h2 className="panel__title">授权列表</h2>
            <p className="panel__subtitle">保留授权状态与责任人，资源范围、目标哈希和撤销原因进入详情。</p>
          </div>
        </div>
        <DataTable
          columns={[
            { key: "grant", label: "授权", maxWidth: 300, minWidth: 220, width: 260 },
            { key: "requester", label: "申请人", maxWidth: 200, minWidth: 150, width: 170 },
            { key: "approver", label: "审批人", maxWidth: 200, minWidth: 150, width: 170 },
            { key: "tool", label: "工具", maxWidth: 180, minWidth: 130, width: 150 },
            { key: "status", label: "状态", maxWidth: 140, minWidth: 110, width: 120 },
            { key: "expires", label: "过期时间", maxWidth: 190, minWidth: 150, width: 170 },
            { key: "detail", label: "操作", maxWidth: 140, minWidth: 104, width: 116 },
          ]}
          error={error}
          loading={loading}
          onRetry={retryList}
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
                aria-label={`查看 ${item.grantId} 授权详情`}
                className="btn btn--compact"
                type="button"
                onClick={() => setSelectedGrant(item)}
              >
                详情
              </button>
            ),
          }))}
        />
      </section>

      <ModalDialog
        closeLabel="关闭详情"
        open={Boolean(selectedGrant)}
        title="授权详情"
        subtitle={selectedGrant?.grantId ?? "查看授权的资源范围和撤销上下文。"}
        onClose={() => setSelectedGrant(null)}
      >
        <dl className="detail-panel__grid">
          {[
            { label: "授权 ID", value: selectedGrant?.grantId ?? "暂无" },
            { label: "审批 ID", value: selectedGrant?.approvalId ?? "暂无" },
            { label: "链路", value: selectedGrant?.chainId ?? "暂无" },
            { label: "会话", value: selectedGrant?.sessionKey ?? "暂无" },
            { label: "申请人", value: selectedGrant?.requesterOuId || selectedGrant?.requesterId || "暂无" },
            { label: "审批人", value: selectedGrant?.approverOuId || selectedGrant?.approverId || "暂无" },
            { label: "风险族", value: selectedGrant?.riskFamily ?? "暂无" },
            { label: "工具", value: selectedGrant?.toolName ?? "暂无" },
            { label: "目标类型", value: selectedGrant?.targetKind ?? "暂无" },
            { label: "目标哈希", value: selectedGrant?.targetHash ?? "暂无" },
            { label: "授权范围", value: selectedGrant ? formatScope(selectedGrant.resourceScope) : "暂无" },
            { label: "创建时间", value: formatIsoTime(selectedGrant?.createdAt) },
            { label: "过期时间", value: formatIsoTime(selectedGrant?.expiresAt) },
            { label: "撤销时间", value: formatIsoTime(selectedGrant?.revokedAt) },
            { label: "撤销原因", value: selectedGrant?.revokedReason || "暂无" },
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
