import { startTransition, useEffect, useState, type FormEvent } from "react";
import { Button, Input } from "antd";

import { listChains, type ChainListQuery, type ChainSummary } from "../api/chains";
import { ModalDialog } from "../components/feedback/ModalDialog";
import { PageHeader } from "../components/layout/PageHeader";
import { DataTable } from "../components/tables/DataTable";
import { formatInteger } from "../utils/format";

interface ChainFilters {
  channelProfile: string;
  q: string;
}

const EMPTY_FILTERS: ChainFilters = {
  channelProfile: "",
  q: "",
};

function buildChainQuery(filters: ChainFilters): ChainListQuery {
  return {
    q: filters.q.trim() || undefined,
    channelProfile: filters.channelProfile.trim() || undefined,
  };
}

function joinSignals(values: string[]): string {
  return values.length > 0 ? values.join("；") : "暂无";
}

export function ChainsPage() {
  const [items, setItems] = useState<ChainSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draftFilters, setDraftFilters] = useState<ChainFilters>(EMPTY_FILTERS);
  const [appliedQuery, setAppliedQuery] = useState<ChainListQuery>({});
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedChain, setSelectedChain] = useState<ChainSummary | null>(null);

  useEffect(() => {
    const abortController = new AbortController();

    async function loadChains() {
      startTransition(() => {
        setError(null);
        setLoading(true);
      });

      try {
        const nextItems = await listChains(appliedQuery);
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
  }, [appliedQuery, reloadKey]);

  function retryList(): void {
    setReloadKey((current) => current + 1);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setSelectedChain(null);
    setAppliedQuery(buildChainQuery(draftFilters));
  }

  function handleReset(): void {
    setDraftFilters(EMPTY_FILTERS);
    setSelectedChain(null);
    setAppliedQuery({});
  }

  const statusDescription = error
    ? `链路记录加载失败：${error}`
    : loading
      ? "正在加载多轮链路"
      : "高级诊断视图，用于查看会话链路中的身份、敏感请求、工具、taint 和审批上下文。";

  return (
    <div className="page-stack">
      <PageHeader
        title="多轮链路"
        description={statusDescription}
        eyebrow="链路诊断"
      />

      <section className="metric-grid metric-grid--compact">
        <article className="metric-card">
          <p className="metric-card__label">链路数量</p>
          <strong className="metric-card__value">{formatInteger(items.length)}</strong>
          <p className="metric-card__note">来自链路状态摘要</p>
        </article>
      </section>

      <section className="filter-panel">
        <form className="audit-filter-form audit-filter-form--compact" onSubmit={handleSubmit}>
          <label className="filter-field filter-field--search">
            <span>关键词</span>
            <Input
              allowClear
              aria-label="关键词"
              placeholder="搜索链路、会话、工具或审批"
              value={draftFilters.q}
              onChange={(event) => setDraftFilters((current) => ({ ...current, q: event.target.value }))}
            />
          </label>
          <label className="filter-field">
            <span>渠道</span>
            <Input
              allowClear
              aria-label="渠道"
              placeholder="例如 webchat / feishu"
              value={draftFilters.channelProfile}
              onChange={(event) => setDraftFilters((current) => ({ ...current, channelProfile: event.target.value }))}
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
            <h2 className="panel__title">链路列表</h2>
            <p className="panel__subtitle">表格展示可判断走向的摘要，taint、链路授权与审批证据进入详情。</p>
          </div>
        </div>
        <DataTable
          columns={[
            { key: "chain", label: "链路", maxWidth: 300, minWidth: 220, width: 260 },
            { key: "signals", label: "风险线索", maxWidth: 320, minWidth: 220, width: 280 },
            { key: "tools", label: "工具", maxWidth: 220, minWidth: 160, width: 190 },
            { key: "review", label: "人工动作", maxWidth: 220, minWidth: 160, width: 190 },
            { key: "detail", label: "操作", maxWidth: 140, minWidth: 104, width: 116 },
          ]}
          error={error}
          loading={loading}
          onRetry={retryList}
          rows={items.map((item) => ({
            id: item.chainId,
            chain: (
              <div className="row-stack">
                <strong>{item.chainId}</strong>
                <span>{item.sessionKey}</span>
              </div>
            ),
            signals: joinSignals([...item.recentSensitive, ...item.recentIdentity, ...item.recentEvasions]),
            tools: joinSignals(item.recentTools),
            review: [
              item.pendingApproval ? "待审批" : undefined,
              item.activeGrantId ? "有授权" : undefined,
              item.recentDenials.length > 0 ? "近期拒绝" : undefined,
            ].filter(Boolean).join("；") || "暂无",
            detail: (
              <button
                aria-label={`查看 ${item.chainId} 链路详情`}
                className="btn btn--compact"
                type="button"
                onClick={() => setSelectedChain(item)}
              >
                详情
              </button>
            ),
          }))}
        />
      </section>

      <ModalDialog
        closeLabel="关闭详情"
        open={Boolean(selectedChain)}
        title="链路详情"
        subtitle={selectedChain?.chainId ?? "查看链路中的完整上下文信号。"}
        onClose={() => setSelectedChain(null)}
      >
        <dl className="detail-panel__grid">
          {[
            { label: "链路 ID", value: selectedChain?.chainId ?? "暂无" },
            { label: "会话", value: selectedChain?.sessionKey ?? "暂无" },
            { label: "身份信号", value: selectedChain ? joinSignals(selectedChain.recentIdentity) : "暂无" },
            { label: "敏感请求", value: selectedChain ? joinSignals(selectedChain.recentSensitive) : "暂无" },
            { label: "近期拒绝", value: selectedChain ? joinSignals(selectedChain.recentDenials) : "暂无" },
            { label: "近期审批", value: selectedChain ? joinSignals(selectedChain.recentApprovals) : "暂无" },
            { label: "工具", value: selectedChain ? joinSignals(selectedChain.recentTools) : "暂无" },
            { label: "Taint 读取", value: selectedChain ? joinSignals(selectedChain.recentTaintReads) : "暂无" },
            { label: "规避信号", value: selectedChain ? joinSignals(selectedChain.recentEvasions) : "暂无" },
            { label: "当前授权", value: selectedChain?.activeGrantId || "暂无" },
            { label: "待审批", value: selectedChain?.pendingApproval || "暂无" },
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
