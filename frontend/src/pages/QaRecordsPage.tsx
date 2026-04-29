import { startTransition, useEffect, useMemo, useState, type FormEvent } from "react";
import type {
  QaChainNodeDto,
  QaRecordDetailDto,
  QaRecordListItemDto,
} from "@lynx/local-console-shared";
import { Button, Empty, Input, Select, Spin } from "antd";

import { getQaRecordDetail, listQaRecords, type QaRecordListQuery } from "../api/qa-records";
import { StatusBadge } from "../components/feedback/StatusBadge";
import { PageHeader } from "../components/layout/PageHeader";
import { TablePagination } from "../components/tables/TablePagination";
import { usePagedListResource } from "../hooks/usePagedListResource";
import { formatDuration, formatInteger, formatTimestamp } from "../utils/format";
import { renderRiskBadge, renderStateBadge } from "../utils/status";

const NODE_TYPE_LABELS: Record<QaChainNodeDto["type"], string> = {
  userPrompt: "输入",
  agentStep: "Agent 步骤",
  toolCall: "工具调用",
  terminal: "工具调用",
  approval: "审批",
  detection: "检测",
  auditEvent: "审计事件",
  tokenUsage: "Token",
  finalAnswer: "答复",
};

interface QaRecordFilters {
  q: string;
  riskLevel: string;
  status: string;
}

const EMPTY_FILTERS: QaRecordFilters = {
  q: "",
  riskLevel: "",
  status: "",
};

const STATUS_OPTIONS = [
  { label: "已完成", value: "completed" },
  { label: "运行中", value: "running" },
  { label: "失败", value: "failed" },
];

const RISK_OPTIONS = [
  { label: "L0 基础", value: "L0" },
  { label: "L1 关注", value: "L1" },
  { label: "L2 中危", value: "L2" },
  { label: "L3 高危", value: "L3" },
  { label: "L4 严重", value: "L4" },
];

function buildQaRecordQuery(filters: QaRecordFilters): Omit<QaRecordListQuery, "pageNum" | "pageSize"> {
  return {
    q: filters.q.trim() || undefined,
    riskLevel: filters.riskLevel ? [filters.riskLevel as NonNullable<QaRecordListQuery["riskLevel"]>[number]] : undefined,
    status: filters.status || undefined,
  };
}

function valueAsText(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function getNodeDetailText(node: QaChainNodeDto | null, key: string): string | undefined {
  return valueAsText(node?.detailJson?.[key]);
}

function renderCodeBlock(value: string | undefined, fallback = "暂无") {
  return <pre className="code-panel">{value && value.trim().length > 0 ? value : fallback}</pre>;
}

function summarizeRecord(record: QaRecordListItemDto): string {
  return record.userPromptExcerpt || record.finalAnswerExcerpt || record.qaRecordId;
}

function resolveHeaderDescription(
  loading: boolean,
  error: string | null,
  detailError: string | null,
): string {
  if (error) {
    return `问答记录加载失败：${error}`;
  }
  if (detailError) {
    return `问答详情加载失败：${detailError}`;
  }
  if (loading) {
    return "正在加载完整问答周期。";
  }
  return "按用户提示词组织工具调用、审批、安全信号和最终回复。";
}

function buildNodeFields(node: QaChainNodeDto | null) {
  if (!node) {
    return [
      { label: "节点", value: "等待选择工具链节点" },
    ];
  }

  if (node.type === "terminal") {
    const command = getNodeDetailText(node, "command");
    return [
      { label: "节点类型", value: NODE_TYPE_LABELS[node.type] },
      { label: "执行命令", value: command ?? "历史记录未保存命令明细" },
      { label: "工作目录", value: getNodeDetailText(node, "cwd") ?? "暂无" },
      { label: "状态", value: node.status ?? "暂无" },
      { label: "退出码", value: getNodeDetailText(node, "exitCode") ?? "暂无" },
      { label: "耗时", value: getNodeDetailText(node, "durationMs") ?? formatDuration(node.completedAtMs ? node.completedAtMs - node.occurredAtMs : undefined) },
      { label: "标准输出", value: renderCodeBlock(getNodeDetailText(node, "stdout") ?? getNodeDetailText(node, "result")) },
      { label: "标准错误", value: renderCodeBlock(getNodeDetailText(node, "stderr")) },
    ];
  }

  return [
    { label: "节点类型", value: NODE_TYPE_LABELS[node.type] },
    { label: "标题", value: node.title },
    { label: "摘要", value: node.summary ?? "暂无" },
    { label: "状态", value: node.status ?? "暂无" },
    { label: "发生时间", value: formatTimestamp(node.occurredAtMs) },
  ];
}

export function QaRecordsPage() {
  const [draftFilters, setDraftFilters] = useState<QaRecordFilters>(EMPTY_FILTERS);
  const [appliedQuery, setAppliedQuery] = useState<Omit<QaRecordListQuery, "pageNum" | "pageSize">>({});
  const { items, loading, error, paginationProps, resetPaging, retry } = usePagedListResource<
    QaRecordListItemDto,
    QaRecordListQuery
  >({
    loadPage: listQaRecords,
    query: appliedQuery,
  });
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [detail, setDetail] = useState<QaRecordDetailDto | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [chainExpanded, setChainExpanded] = useState(false);

  useEffect(() => {
    if (selectedRecordId || items.length === 0) {
      return;
    }

    setSelectedRecordId(items[0].qaRecordId);
  }, [items, selectedRecordId]);

  useEffect(() => {
    if (!selectedRecordId) {
      setDetail(null);
      setSelectedNodeId(null);
      return;
    }

    let active = true;
    const recordId = selectedRecordId;

    async function loadDetail() {
      try {
        const nextDetail = await getQaRecordDetail(recordId);
        if (!active) {
          return;
        }

        startTransition(() => {
          setDetail(nextDetail);
          setDetailError(null);
          setSelectedNodeId(null);
        });
      } catch (loadError) {
        if (!active) {
          return;
        }

        startTransition(() => {
          setDetail(null);
          setSelectedNodeId(null);
          setDetailError(loadError instanceof Error ? loadError.message : "详情加载失败");
        });
      }
    }

    void loadDetail();

    return () => {
      active = false;
    };
  }, [selectedRecordId]);

  const selectedRecord = useMemo(
    () => items.find((item) => item.qaRecordId === selectedRecordId) ?? items[0] ?? null,
    [items, selectedRecordId],
  );
  const selectedNode = useMemo(
    () => detail?.chainNodes.find((node) => node.nodeId === selectedNodeId) ?? null,
    [detail, selectedNodeId],
  );
  const totalToolCalls = detail?.relatedToolCalls.length ?? selectedRecord?.toolCallCount ?? 0;
  const totalApprovals = detail?.relatedApprovals.length ?? selectedRecord?.approvalCount ?? 0;
  const totalSignals = (detail?.relatedEvents.length ?? 0) + (detail?.relatedDetections.length ?? selectedRecord?.detectionCount ?? 0);
  const headerDescription = resolveHeaderDescription(loading, error, detailError);
  const headerTone = error || detailError ? "danger" : loading ? "info" : "success";
  const headerLabel = error || detailError ? "请求失败" : loading ? "加载中" : "实时数据";

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    resetPaging();
    setAppliedQuery(buildQaRecordQuery(draftFilters));
  }

  function handleReset(): void {
    setDraftFilters(EMPTY_FILTERS);
    resetPaging();
    setAppliedQuery({});
  }

  function handleSelectRecord(recordId: string): void {
    setSelectedRecordId(recordId);
    setChainExpanded(false);
    setSelectedNodeId(null);
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="问答记录"
        description={headerDescription}
        eyebrow="完整交互周期"
        actions={<StatusBadge label={headerLabel} tone={headerTone} />}
      />

      <section className="metric-grid metric-grid--compact">
        <article className="metric-card">
          <p className="metric-card__label">当前页记录</p>
          <strong className="metric-card__value">{formatInteger(items.length)}</strong>
          <p className="metric-card__note">按开始时间倒序</p>
        </article>
        <article className="metric-card">
          <p className="metric-card__label">工具次数</p>
          <strong className="metric-card__value">{formatInteger(totalToolCalls)}</strong>
          <p className="metric-card__note">当前选中问答</p>
        </article>
        <article className="metric-card">
          <p className="metric-card__label">审批请求</p>
          <strong className="metric-card__value">{formatInteger(totalApprovals)}</strong>
          <p className="metric-card__note">当前选中问答</p>
        </article>
        <article className="metric-card">
          <p className="metric-card__label">安全信号</p>
          <strong className="metric-card__value">{formatInteger(totalSignals)}</strong>
          <p className="metric-card__note">检测与审计事件</p>
        </article>
      </section>

      <section className="filter-panel">
        <form className="audit-filter-form audit-filter-form--compact" onSubmit={handleSubmit}>
          <label className="filter-field filter-field--search">
            <span>关键词</span>
            <Input
              allowClear
              aria-label="关键词"
              placeholder="搜索问题、回答、会话或记录 ID"
              value={draftFilters.q}
              onChange={(event) => setDraftFilters((current) => ({ ...current, q: event.target.value }))}
            />
          </label>
          <label className="filter-field">
            <span>状态</span>
            <Select
              allowClear
              aria-label="状态"
              options={STATUS_OPTIONS}
              placeholder="全部状态"
              value={draftFilters.status || undefined}
              onChange={(value) => setDraftFilters((current) => ({ ...current, status: value ?? "" }))}
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
          <div className="audit-filter-form__actions">
            <Button htmlType="submit" type="primary">应用筛选</Button>
            <Button htmlType="button" onClick={handleReset}>重置条件</Button>
          </div>
        </form>
      </section>

      <section className="split-grid">
        <article className="panel">
          <div className="panel__header">
            <div>
              <h2 className="panel__title">问答列表</h2>
              <p className="panel__subtitle">选择一条记录查看完整工具链。</p>
            </div>
          </div>
          <div className="list-stack list-stack--stable">
            {loading && items.length === 0 ? (
              <div className="list-state" role="status">
                <Spin size="small" />
                <span>正在加载问答记录</span>
              </div>
            ) : null}
            {error && items.length === 0 ? (
              <div className="list-state list-state--error">
                <strong>列表加载失败</strong>
                <span>{error}</span>
                <button className="btn btn--compact" type="button" onClick={retry}>
                  重试
                </button>
              </div>
            ) : null}
            {items.map((record) => (
              <button
                className="list-item"
                key={record.qaRecordId}
                type="button"
                onClick={() => handleSelectRecord(record.qaRecordId)}
              >
                <strong>{record.qaRecordId}</strong>
                <span>{summarizeRecord(record)}</span>
                <span className="small-note">
                  {formatTimestamp(record.startedAtMs)} · {record.sessionKey ?? "暂无会话"}
                </span>
              </button>
            ))}
            {!loading && !error && items.length === 0 ? (
              <Empty
                className="list-state list-state--empty"
                description="暂无问答记录"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            ) : null}
          </div>
          <TablePagination {...paginationProps} />
        </article>

        <article className="panel">
          <div className="panel__header">
            <div>
              <h2 className="panel__title">{selectedRecord ? "问答详情" : "暂无详情"}</h2>
              <p className="panel__subtitle">
                {selectedRecord ? `${selectedRecord.sessionKey ?? "暂无会话"} · ${formatTimestamp(selectedRecord.startedAtMs)}` : "等待选择问答记录"}
              </p>
            </div>
          </div>

          <div className="qa-record-summary">
            <article>
              <span>用户问题</span>
              <strong>{detail?.userPromptExcerpt ?? selectedRecord?.userPromptExcerpt ?? "暂无"}</strong>
            </article>
            <article>
              <span>最终答复</span>
              <strong>{detail?.finalAnswerExcerpt ?? selectedRecord?.finalAnswerExcerpt ?? "暂无"}</strong>
            </article>
            <article>
              <span>状态 / 风险 / Token</span>
              <div className="qa-record-summary__badges">
                {renderStateBadge(detail?.status ?? selectedRecord?.status)}
                {renderRiskBadge(detail?.riskLevel ?? selectedRecord?.riskLevel)}
                <span className="status-badge status-badge--info">{formatInteger(detail?.totalTokens ?? selectedRecord?.totalTokens ?? 0)} Token</span>
              </div>
            </article>
          </div>

          <button
            className="btn"
            disabled={!detail}
            type="button"
            onClick={() => setChainExpanded((value) => !value)}
          >
            {chainExpanded ? "收起工具链" : "展开工具链"}
          </button>

          {chainExpanded ? (
            <div className="qa-detail-flow" data-testid="qa-detail-flow">
              {detail?.chainNodes.map((node) => (
                <button
                  className="qa-flow-node"
                  key={node.nodeId}
                  type="button"
                  aria-label={`${node.title} ${node.summary ?? ""}`}
                  onClick={() => setSelectedNodeId(node.nodeId)}
                >
                  <span className="qa-flow-node__type">{NODE_TYPE_LABELS[node.type]}</span>
                  <strong>{node.title}</strong>
                  <span>{node.type === "terminal" ? (node.status ?? "命令执行记录") : (node.summary ?? "暂无摘要")}</span>
                  <small>{formatTimestamp(node.occurredAtMs)}</small>
                </button>
              ))}
            </div>
          ) : null}
        </article>
      </section>

      {selectedNode ? (
        <section className="panel detail-panel" data-testid="qa-node-detail">
          <div className="panel__header">
            <div>
              <h2 className="panel__title">{selectedNode.title}</h2>
              <p className="panel__subtitle">{`${NODE_TYPE_LABELS[selectedNode.type]} · ${formatTimestamp(selectedNode.occurredAtMs)}`}</p>
            </div>
          </div>
          <dl className="detail-panel__grid">
            {buildNodeFields(selectedNode).map((field) => (
              <div key={field.label} className="detail-panel__field">
                <dt>{field.label}</dt>
                <dd>{field.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
    </div>
  );
}
