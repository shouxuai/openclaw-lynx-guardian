import { startTransition, useEffect, useMemo, useState, type FormEvent } from "react";
import type {
  AuditEventListItemDto,
  QaChainNodeDto,
  QaRecordDetailDto,
  QaRecordListItemDto,
} from "@lynx/local-console-shared";
import { Button, Input, Select } from "antd";

import { getQaRecordDetail, listQaRecords, type QaRecordListQuery } from "../api/qa-records";
import { ModalDialog } from "../components/feedback/ModalDialog";
import { SideDrawer } from "../components/feedback/SideDrawer";
import { StatusBadge } from "../components/feedback/StatusBadge";
import { PageHeader } from "../components/layout/PageHeader";
import { DataTable } from "../components/tables/DataTable";
import { TablePagination } from "../components/tables/TablePagination";
import { usePagedListResource } from "../hooks/usePagedListResource";
import { formatDuration, formatInteger, formatTimestamp } from "../utils/format";
import { renderActionBadge, renderRiskBadge, renderStateBadge } from "../utils/status";

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

const LOCAL_CONSOLE_CHARS_PER_TOKEN_ESTIMATE = 4;
const NON_LATIN_RE = /[\u2E80-\u9FFF\uA000-\uA4FF\uAC00-\uD7AF\uF900-\uFAFF\u{20000}-\u{2FA1F}]/gu;
const CJK_SURROGATE_HIGH_RE = /[\uD840-\uD87E][\uDC00-\uDFFF]/g;

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

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function firstPositiveNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed = asNumber(value);
    if (parsed !== undefined && parsed > 0) {
      return parsed;
    }
  }
  return undefined;
}

function asSourceType(value: unknown): "actual" | "estimated" | "unavailable" | undefined {
  return value === "actual" || value === "estimated" || value === "unavailable" ? value : undefined;
}

function countCodePoints(text: string, nonLatinCount: number): number {
  if (nonLatinCount === 0) {
    return text.length;
  }

  const cjkSurrogates = (text.match(CJK_SURROGATE_HIGH_RE) ?? []).length;
  return text.length - cjkSurrogates;
}

function estimateCjkAwareChars(text: string): number {
  if (text.length === 0) {
    return 0;
  }

  const nonLatinCount = (text.match(NON_LATIN_RE) ?? []).length;
  const codePointLength = countCodePoints(text, nonLatinCount);

  return codePointLength + nonLatinCount * (LOCAL_CONSOLE_CHARS_PER_TOKEN_ESTIMATE - 1);
}

function estimateCjkAwareTokensFromText(values: Array<string | undefined>): number {
  const text = values
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .join("\n");
  return Math.ceil(Math.max(0, estimateCjkAwareChars(text)) / LOCAL_CONSOLE_CHARS_PER_TOKEN_ESTIMATE);
}

function estimateQaTokenUsage(record: QaRecordListItemDto | null, detail: QaRecordDetailDto | null): number {
  const prompt = detail?.userPromptExcerpt ?? record?.userPromptExcerpt;
  const finalAnswer = detail?.finalAnswerExcerpt ?? record?.finalAnswerExcerpt;
  const nodeSummaries = detail?.chainNodes
    .filter((node) => node.type === "userPrompt" || node.type === "finalAnswer")
    .map((node) => node.summary)
    ?? [];
  const directTexts = [prompt, finalAnswer];
  const estimate = estimateCjkAwareTokensFromText(directTexts.some(Boolean) ? directTexts : nodeSummaries);
  return Math.max(estimate, 1);
}

function resolveTokenDisplay(record: QaRecordListItemDto | null, detail: QaRecordDetailDto | null = null): string {
  const actualTotal = firstPositiveNumber(detail?.totalTokens, record?.totalTokens);
  if (actualTotal !== undefined && actualTotal > 0) {
    return `${formatInteger(actualTotal)} Token`;
  }

  const tokenNodes = detail?.chainNodes.filter((node) => node.type === "tokenUsage") ?? [];
  const buckets = tokenNodes.reduce(
    (current, node) => {
      const sourceType = asSourceType(node.detailJson?.sourceType ?? node.status);
      const totalTokens = asNumber(node.detailJson?.totalTokens ?? node.summary);
      if (!totalTokens || totalTokens <= 0) {
        return current;
      }
      if (sourceType === "actual") {
        current.actual += totalTokens;
        return current;
      }
      if (sourceType === "estimated") {
        current.estimated += totalTokens;
      }
      return current;
    },
    { actual: 0, estimated: 0 },
  );

  if (buckets.actual > 0) {
    return `${formatInteger(buckets.actual)} Token`;
  }
  if (buckets.estimated > 0) {
    return `约 ${formatInteger(buckets.estimated)} Token`;
  }
  return `约 ${formatInteger(estimateQaTokenUsage(record, detail))} Token`;
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
    return "正在加载完整问答链路。";
  }
  return "按一次问答组织工具调用、审批、安全信号和最终回复。";
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
  const [auditEventsOpen, setAuditEventsOpen] = useState(false);

  useEffect(() => {
    if (!selectedRecordId) {
      setDetail(null);
      setSelectedNodeId(null);
      setDetailError(null);
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
    () => items.find((item) => item.qaRecordId === selectedRecordId) ?? null,
    [items, selectedRecordId],
  );
  const selectedNode = useMemo(
    () => detail?.chainNodes.find((node) => node.nodeId === selectedNodeId) ?? null,
    [detail, selectedNodeId],
  );
  const totalToolCalls = detail?.relatedToolCalls.length ?? selectedRecord?.toolCallCount ?? 0;
  const totalApprovals = detail?.relatedApprovals.length ?? selectedRecord?.approvalCount ?? 0;
  const totalSignals = (detail?.relatedEvents.length ?? 0) + (detail?.relatedDetections.length ?? selectedRecord?.detectionCount ?? 0);
  const selectedTokenDisplay = resolveTokenDisplay(selectedRecord, detail);
  const headerDescription = resolveHeaderDescription(loading, error, detailError);
  const headerTone = error || detailError ? "danger" : loading ? "info" : "success";
  const headerLabel = error || detailError ? "请求失败" : loading ? "加载中" : "实时数据";

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    resetPaging();
    setSelectedRecordId(null);
    setSelectedNodeId(null);
    setDetail(null);
    setAuditEventsOpen(false);
    setAppliedQuery(buildQaRecordQuery(draftFilters));
  }

  function handleReset(): void {
    setDraftFilters(EMPTY_FILTERS);
    resetPaging();
    setSelectedRecordId(null);
    setSelectedNodeId(null);
    setDetail(null);
    setAuditEventsOpen(false);
    setAppliedQuery({});
  }

  function handleSelectRecord(recordId: string): void {
    setSelectedRecordId(recordId);
    setChainExpanded(false);
    setSelectedNodeId(null);
    setAuditEventsOpen(false);
  }

  function handleCloseDetail(): void {
    setSelectedRecordId(null);
    setDetail(null);
    setDetailError(null);
    setSelectedNodeId(null);
    setChainExpanded(false);
    setAuditEventsOpen(false);
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="问答记录"
        description={headerDescription}
        eyebrow="QA RECORDS"
        actions={<StatusBadge label={headerLabel} tone={headerTone} />}
      />

      <section className="metric-grid metric-grid--compact">
        <article className="metric-card">
          <p className="metric-card__label">当前页问答</p>
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
          <label className="filter-field filter-field--search">
            <span>关键词</span>
            <Input
              allowClear
              aria-label="关键词"
              placeholder="搜索请求、回复、会话或问答 ID"
              value={draftFilters.q}
              onChange={(event) => setDraftFilters((current) => ({ ...current, q: event.target.value }))}
            />
          </label>
          <div className="audit-filter-form__actions">
            <Button htmlType="submit" type="primary">应用筛选</Button>
            <Button htmlType="button" onClick={handleReset}>重置条件</Button>
          </div>
        </form>
      </section>

      <article className="panel qa-list-panel">
        <div className="panel__header">
          <div>
            <h2 className="panel__title">问答列表</h2>
            <p className="panel__subtitle">点击任意一行查看工具链路、审批和关联审计事件。</p>
          </div>
        </div>
        <DataTable
          columns={[
            { key: "qaId", label: "问答 ID", maxWidth: 220, minWidth: 170, width: 188 },
            { key: "prompt", label: "用户输入", maxWidth: 420, minWidth: 280, width: 340 },
            { key: "status", label: "状态", maxWidth: 112, minWidth: 92, width: 100 },
            { key: "risk", label: "风险", maxWidth: 118, minWidth: 96, width: 106 },
            { key: "toolCalls", label: "工具调用", maxWidth: 132, minWidth: 104, width: 116 },
          ]}
          emptyDescription="暂无问答记录"
          error={error}
          loading={loading}
          loadingLabel="正在加载问答记录列表"
          onRetry={retry}
          onRowClick={(row) => handleSelectRecord(row.id)}
          rows={items.map((record) => ({
            id: record.qaRecordId,
            qaId: (
              <div className="row-stack">
                <strong>{record.qaRecordId}</strong>
                <span>{formatTimestamp(record.startedAtMs)}</span>
              </div>
            ),
            prompt: record.userPromptExcerpt || "暂无输入",
            status: renderStateBadge(record.status),
            risk: renderRiskBadge(record.riskLevel),
            toolCalls: `${formatInteger(record.toolCallCount)} 次`,
          }))}
          selectedRowId={selectedRecordId ?? undefined}
        />
        <TablePagination {...paginationProps} />
      </article>

      <SideDrawer
        closeLabel="关闭详情"
        open={Boolean(selectedRecordId)}
        title="问答详情"
        subtitle={selectedRecord ? `${selectedRecord.sessionKey ?? "暂无会话"} · ${formatTimestamp(selectedRecord.startedAtMs)}` : selectedRecordId ?? "等待选择问答记录"}
        onClose={handleCloseDetail}
      >
        <div className="qa-record-summary">
          <article>
            <span>用户问题</span>
            <strong>{detail?.userPromptExcerpt ?? selectedRecord?.userPromptExcerpt ?? "暂无"}</strong>
          </article>
          <article>
            <span>最终答复</span>
            <strong>{detail?.finalAnswerExcerpt ?? selectedRecord?.finalAnswerExcerpt ?? (detailError ? "详情加载失败" : "正在加载")}</strong>
          </article>
          <article>
            <span>状态 / 风险 / Token</span>
            <div className="qa-record-summary__badges">
              {renderStateBadge(detail?.status ?? selectedRecord?.status)}
              {renderRiskBadge(detail?.riskLevel ?? selectedRecord?.riskLevel)}
              <span className="status-badge status-badge--info">{selectedTokenDisplay}</span>
            </div>
          </article>
          <article>
            <span>关联审计事件</span>
            <div className="qa-record-summary__action">
              <strong>{formatInteger(detail?.relatedEvents.length ?? 0)} 条</strong>
              <button
                className="btn btn--compact"
                disabled={!detail || detail.relatedEvents.length === 0}
                type="button"
                onClick={() => setAuditEventsOpen(true)}
              >
                查看关联审计事件
              </button>
            </div>
          </article>
        </div>

        <button
          className="btn"
          disabled={!detail}
          type="button"
          onClick={() => setChainExpanded((value) => !value)}
        >
          {chainExpanded ? "收起执行链路" : "展开执行链路"}
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

        {selectedNode ? (
          <section className="detail-panel qa-node-detail" data-testid="qa-node-detail">
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
      </SideDrawer>

      <ModalDialog
        closeLabel="关闭审计事件"
        open={auditEventsOpen}
        title="关联审计事件"
        subtitle={selectedRecord?.qaRecordId ?? "查看当前问答关联的安全审计事件。"}
        onClose={() => setAuditEventsOpen(false)}
      >
        <DataTable
          columns={[
            { key: "time", label: "时间", maxWidth: 160, minWidth: 126, width: 140 },
            { key: "event", label: "事件", maxWidth: 280, minWidth: 190, width: 240 },
            { key: "risk", label: "风险", maxWidth: 120, minWidth: 92, width: 104 },
            { key: "action", label: "处置", maxWidth: 128, minWidth: 100, width: 112 },
            { key: "summary", label: "摘要", maxWidth: 360, minWidth: 220, width: 300 },
          ]}
          emptyDescription="暂无关联审计事件"
          rows={(detail?.relatedEvents ?? []).map((event: AuditEventListItemDto) => ({
            id: event.eventId,
            time: formatTimestamp(event.occurredAtMs),
            event: (
              <div className="row-stack">
                <strong>{event.eventId}</strong>
                <span>{event.title}</span>
              </div>
            ),
            risk: renderRiskBadge(event.riskLevel),
            action: renderActionBadge(event.enforcementAction),
            summary: event.summary ?? event.contentExcerpt ?? "暂无",
          }))}
        />
      </ModalDialog>
    </div>
  );
}
