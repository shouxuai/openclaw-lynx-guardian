import { startTransition, useEffect, useState } from "react";

import { listChains, type ChainSummary } from "../api/chains";
import { PageHeader } from "../components/layout/PageHeader";
import { DataTable } from "../components/tables/DataTable";
import { formatInteger } from "../utils/format";

function joinSignals(values: string[]): string {
  return values.length > 0 ? values.join("；") : "暂无";
}

export function ChainsPage() {
  const [items, setItems] = useState<ChainSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const abortController = new AbortController();

    async function loadChains() {
      try {
        const nextItems = await listChains();
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
          setError(loadError instanceof Error ? loadError.message : "链路记录加载失败");
          setLoading(false);
        });
      }
    }

    void loadChains();
    return () => abortController.abort();
  }, []);

  const statusDescription = error
    ? `链路记录加载失败：${error}`
    : loading
      ? "正在加载多轮链路"
      : "展示会话链路中的身份、敏感请求、工具、taint 和审批上下文。";

  return (
    <div className="page-stack">
      <PageHeader
        title="多轮链路"
        description={statusDescription}
        eyebrow="CHAIN STATE"
      />

      <section className="summary-card-grid">
        <article className="summary-card">
          <p className="summary-card__label">链路数量</p>
          <strong className="summary-card__value">{formatInteger(items.length)}</strong>
          <p className="summary-card__unit">来自 Go chain summary</p>
        </article>
      </section>

      <section className="table-panel">
        <DataTable
          columns={[
            { key: "chain", label: "Chain ID", maxWidth: 240, minWidth: 170, width: 200 },
            { key: "session", label: "会话", maxWidth: 220, minWidth: 160, width: 190 },
            { key: "identity", label: "身份信号", maxWidth: 260, minWidth: 190, width: 230 },
            { key: "sensitive", label: "敏感请求", maxWidth: 260, minWidth: 190, width: 230 },
            { key: "tools", label: "工具", maxWidth: 220, minWidth: 160, width: 190 },
            { key: "taint", label: "Taint", maxWidth: 240, minWidth: 170, width: 210 },
            { key: "grant", label: "Active Grant", maxWidth: 220, minWidth: 160, width: 190 },
            { key: "approval", label: "Pending Approval", maxWidth: 220, minWidth: 160, width: 190 },
          ]}
          rows={items.map((item) => ({
            id: item.chainId,
            chain: item.chainId,
            session: item.sessionKey,
            identity: joinSignals(item.recentIdentity),
            sensitive: joinSignals(item.recentSensitive),
            tools: joinSignals(item.recentTools),
            taint: joinSignals(item.recentTaintReads),
            grant: item.activeGrantId || "暂无",
            approval: item.pendingApproval || "暂无",
          }))}
        />
      </section>
    </div>
  );
}
