import { useState, type FormEvent } from "react";
import { Button, Card, Input, Typography } from "antd";

import {
  listChains,
  type ChainListQuery,
  type ChainSummary,
} from "../api/chains";
import { ModalDialog } from "../components/feedback/ModalDialog";
import { PageHeader } from "../components/layout/PageHeader";
import { DataTable } from "../components/tables/DataTable";
import { TablePagination } from "../components/tables/TablePagination";
import { usePagedListResource } from "../hooks/usePagedListResource";
import { formatInteger } from "../utils/format";

interface ChainFilters {
  channelProfile: string;
  q: string;
}

const EMPTY_FILTERS: ChainFilters = {
  channelProfile: "",
  q: "",
};

function buildChainQuery(filters: ChainFilters): Omit<ChainListQuery, "pageNum" | "pageSize"> {
  return {
    q: filters.q.trim() || undefined,
    channelProfile: filters.channelProfile.trim() || undefined,
  };
}

function joinSignals(values: string[]): string {
  return values.length > 0 ? values.join("；") : "暂无";
}

function formatPromptMeta(
  prompt: ChainSummary["coveredPrompts"][number],
): string {
  return (
    [prompt.riskLevel, prompt.status, prompt.runId]
      .filter(Boolean)
      .join(" · ") || "暂无元数据"
  );
}

function formatPromptPreview(
  prompts: ChainSummary["coveredPrompts"],
): string {
  if (prompts.length === 0) {
    return "覆盖的输入词：暂无";
  }
  const preview = prompts
    .slice(0, 2)
    .map((prompt) => prompt.userPromptExcerpt)
    .filter(Boolean)
    .join("；");
  const suffix =
    prompts.length > 2 ? ` 等 ${formatInteger(prompts.length)} 条` : "";
  return `覆盖的输入词：${preview}${suffix}`;
}

export function ChainsPage() {
  const [draftFilters, setDraftFilters] = useState<ChainFilters>(EMPTY_FILTERS);
  const [appliedQuery, setAppliedQuery] = useState<Omit<ChainListQuery, "pageNum" | "pageSize">>({});
  const [selectedChain, setSelectedChain] = useState<ChainSummary | null>(null);
  const { items, loading, error, paginationProps, resetPaging, retry, total } = usePagedListResource<
    ChainSummary,
    ChainListQuery
  >({
    loadPage: listChains,
    onPageBoundaryChange: () => setSelectedChain(null),
    query: appliedQuery,
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setSelectedChain(null);
    resetPaging();
    setAppliedQuery(buildChainQuery(draftFilters));
  }

  function handleReset(): void {
    setDraftFilters(EMPTY_FILTERS);
    setSelectedChain(null);
    resetPaging();
    setAppliedQuery({});
  }

  const statusDescription = error
    ? `链路记录加载失败：${error}`
    : loading
      ? "正在加载多轮链路"
      : undefined;

  return (
    <div className="page-stack">
      <PageHeader
        title="多轮链路"
        description={statusDescription}
        eyebrow="链路诊断"
      />

      <section className="metric-grid metric-grid--compact metric-grid--narrow">
        <article className="metric-card">
          <p className="metric-card__label">链路数量</p>
          <strong className="metric-card__value">
            {formatInteger(total)}
          </strong>
          <p className="metric-card__note">匹配当前筛选条件</p>
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
              placeholder="搜索链路、会话、工具或审批"
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
            <span>渠道</span>
            <Input
              allowClear
              aria-label="渠道"
              placeholder="例如 webchat / feishu"
              value={draftFilters.channelProfile}
              onChange={(event) =>
                setDraftFilters((current) => ({
                  ...current,
                  channelProfile: event.target.value,
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

      <Card className="table-explanation-card" size="small" title="多轮链路说明">
        <Typography.Paragraph>
          多轮链路统计一段任务区间里多次有关联的输入、判断、工具调用、审批和放行，用来回答哪些对话被当成同一个风险上下文一起看。
        </Typography.Paragraph>
        <Typography.Paragraph>
          示例：用户先要求读取配置，随后改成读取同一路径，再触发审批或放行；这些有关联判断会进入同一条多轮链路。taint、放行记录与审批证据进入详情。
        </Typography.Paragraph>
      </Card>

      <section className="table-panel">
        <div className="table-panel__header">
          <h2 className="panel__title">链路列表</h2>
        </div>
        <DataTable
          columns={[
            {
              key: "chain",
              label: "链路",
              maxWidth: 300,
              minWidth: 220,
              width: 260,
            },
            {
              key: "signals",
              label: "风险线索",
              maxWidth: 320,
              minWidth: 220,
              width: 280,
            },
            {
              key: "tools",
              label: "工具",
              maxWidth: 220,
              minWidth: 160,
              width: 190,
            },
            {
              key: "review",
              label: "人工动作",
              maxWidth: 220,
              minWidth: 160,
              width: 190,
            },
            {
              key: "detail",
              label: "操作",
              maxWidth: 140,
              minWidth: 104,
              width: 116,
            },
          ]}
          error={error}
          loading={loading}
          onRetry={retry}
          rows={items.map((item) => ({
            id: item.chainId,
            chain: (
              <div className="row-stack">
                <strong>{item.chainId}</strong>
                <span>{item.sessionKey}</span>
                <span className="chain-prompt-preview">
                  {formatPromptPreview(item.coveredPrompts)}
                </span>
              </div>
            ),
            signals: joinSignals([
              ...item.recentSensitive,
              ...item.recentIdentity,
              ...item.recentEvasions,
            ]),
            tools: joinSignals(item.recentTools),
            review:
              [
                item.pendingApproval ? "待审批" : undefined,
                item.activeGrantId ? "有放行" : undefined,
                item.recentDenials.length > 0 ? "近期拒绝" : undefined,
              ]
                .filter(Boolean)
                .join("；") || "暂无",
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
        <TablePagination {...paginationProps} ariaLabel="链路列表分页" />
      </section>

      <ModalDialog
        closeLabel="关闭详情"
        open={Boolean(selectedChain)}
        size="wide"
        title="链路详情"
        subtitle={selectedChain?.chainId ?? "查看链路中的完整上下文信号。"}
        onClose={() => setSelectedChain(null)}
      >
        {selectedChain ? (
          <div className="audit-detail-dialog">
            <section className="audit-detail-dialog__hero">
              <div className="audit-detail-dialog__heroText">
                <p className="audit-detail-dialog__eyebrow">链路概览</p>
                <p className="audit-detail-dialog__heroSubtitle">
                  {formatPromptPreview(selectedChain.coveredPrompts)}
                </p>
              </div>
              <div className="audit-detail-dialog__chips" aria-label="链路概览标签">
                <span className="audit-detail-dialog__chip">
                  <span className="audit-detail-dialog__chipLabel">链路</span>
                  <span className="audit-detail-dialog__chipValue">{selectedChain.chainId}</span>
                </span>
                <span className="audit-detail-dialog__chip">
                  <span className="audit-detail-dialog__chipLabel">会话</span>
                  <span className="audit-detail-dialog__chipValue">{selectedChain.sessionKey || "暂无"}</span>
                </span>
                <span className="audit-detail-dialog__chip">
                  <span className="audit-detail-dialog__chipLabel">覆盖输入</span>
                  <span className="audit-detail-dialog__chipValue">{formatInteger(selectedChain.promptCount)}</span>
                </span>
                <span className="audit-detail-dialog__chip">
                  <span className="audit-detail-dialog__chipLabel">当前放行</span>
                  <span className="audit-detail-dialog__chipValue">{selectedChain.activeGrantId || "暂无"}</span>
                </span>
                <span className="audit-detail-dialog__chip">
                  <span className="audit-detail-dialog__chipLabel">待审批</span>
                  <span className="audit-detail-dialog__chipValue">{selectedChain.pendingApproval || "暂无"}</span>
                </span>
              </div>
            </section>

            <section className="audit-detail-dialog__section">
              <div className="panel__header audit-detail-dialog__sectionHeader">
                <div>
                  <h3 className="panel__title">链路信号</h3>
                  <p className="panel__subtitle">同一上下文内累计的身份、敏感目标、审批和工具调用信号。</p>
                </div>
              </div>
              <dl className="detail-panel__grid audit-detail-dialog__summary-grid">
                {[
                  { label: "身份信号", value: joinSignals(selectedChain.recentIdentity) },
                  { label: "敏感请求", value: joinSignals(selectedChain.recentSensitive) },
                  { label: "近期拒绝", value: joinSignals(selectedChain.recentDenials) },
                  { label: "近期审批", value: joinSignals(selectedChain.recentApprovals) },
                  { label: "工具", value: joinSignals(selectedChain.recentTools) },
                  { label: "Taint 读取", value: joinSignals(selectedChain.recentTaintReads) },
                  { label: "规避信号", value: joinSignals(selectedChain.recentEvasions) },
                  { label: "会话键", value: selectedChain.sessionKey || "暂无" },
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
                  <h3 className="panel__title">覆盖输入词</h3>
                  <p className="panel__subtitle">这条链路实际覆盖到的问答输入片段。</p>
                </div>
              </div>
              {selectedChain.coveredPrompts.length > 0 ? (
                <ol className="prompt-coverage-list">
                  {selectedChain.coveredPrompts.map((prompt) => (
                    <li
                      className="prompt-coverage-list__item"
                      key={`${prompt.qaRecordId}-${prompt.startedAtMs ?? 0}`}
                    >
                      <p className="prompt-coverage-list__text">
                        {prompt.userPromptExcerpt}
                      </p>
                      <span className="prompt-coverage-list__meta">
                        {formatPromptMeta(prompt)}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="muted-text">暂无覆盖输入词</p>
              )}
            </section>
          </div>
        ) : null}
      </ModalDialog>
    </div>
  );
}
