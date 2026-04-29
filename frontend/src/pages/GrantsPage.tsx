import { startTransition, useEffect, useState } from "react";

import { listGrants, type Grant } from "../api/grants";
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

export function GrantsPage() {
  const [items, setItems] = useState<Grant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const abortController = new AbortController();

    async function loadGrants() {
      try {
        const nextItems = await listGrants();
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
  }, []);

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

      <section className="table-panel">
        <DataTable
          columns={[
            { key: "grant", label: "Grant ID", maxWidth: 230, minWidth: 170, width: 200 },
            { key: "approval", label: "审批 ID", maxWidth: 220, minWidth: 160, width: 190 },
            { key: "scope", label: "授权范围", maxWidth: 320, minWidth: 230, width: 280 },
            { key: "requester", label: "申请人", maxWidth: 200, minWidth: 150, width: 170 },
            { key: "approver", label: "审批人", maxWidth: 200, minWidth: 150, width: 170 },
            { key: "created", label: "创建时间", maxWidth: 190, minWidth: 150, width: 170 },
            { key: "expires", label: "过期时间", maxWidth: 190, minWidth: 150, width: 170 },
            { key: "status", label: "状态", maxWidth: 140, minWidth: 110, width: 120 },
            { key: "revoked", label: "撤销原因", maxWidth: 260, minWidth: 190, width: 230 },
          ]}
          loading={loading}
          rows={items.map((item) => ({
            id: item.grantId,
            grant: item.grantId,
            approval: item.approvalId,
            scope: formatScope(item.resourceScope),
            requester: item.requesterOuId || item.requesterId || "未知",
            approver: item.approverOuId || item.approverId || "未知",
            created: formatIsoTime(item.createdAt),
            expires: formatIsoTime(item.expiresAt),
            status: (
              <StatusBadge
                label={item.revokedAt ? "已撤销" : "有效"}
                tone={item.revokedAt ? "danger" : "success"}
              />
            ),
            revoked: item.revokedReason || "暂无",
          }))}
        />
      </section>
    </div>
  );
}
