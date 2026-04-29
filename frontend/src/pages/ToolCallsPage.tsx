import { useMemo, useState, type FormEvent } from "react";
import type { ToolCallDetailDto, ToolCallListItemDto } from "@lynx/local-console-shared";
import { Button, Input, Select } from "antd";

import { getToolCallDetail, listToolCalls, type ToolCallListQuery } from "../api/tool-calls";
import { mockToolCalls } from "../data/mock-console";
import { ModalDialog } from "../components/feedback/ModalDialog";
import { PageHeader } from "../components/layout/PageHeader";
import { DataTable } from "../components/tables/DataTable";
import { TablePagination } from "../components/tables/TablePagination";
import { paginateMockPage, usePagedListResource } from "../hooks/usePagedListResource";
import { formatDuration, formatInteger, formatTimestamp } from "../utils/format";
import { formatQaRecordId } from "../utils/qa-records";
import { formatToolLabel, renderStateBadge } from "../utils/status";

interface ToolCallFilters {
  q: string;
  resultStatus: string;
  toolName: string;
}

const EMPTY_FILTERS: ToolCallFilters = {
  q: "",
  resultStatus: "",
  toolName: "",
};

const RESULT_STATUS_OPTIONS = [
  { label: "成功", value: "success" },
  { label: "已完成", value: "completed" },
  { label: "失败", value: "failed" },
  { label: "已阻断", value: "blocked" },
  { label: "待处理", value: "pending" },
];

function buildToolCallQuery(filters: ToolCallFilters): Omit<ToolCallListQuery, "pageNum" | "pageSize"> {
  return {
    q: filters.q.trim() || undefined,
    toolName: filters.toolName.trim() || undefined,
    resultStatus: filters.resultStatus || undefined,
  };
}

function readToolMetadata(call: ToolCallListItemDto): Record<string, unknown> {
  const value = (call as ToolCallListItemDto & { metadataJson?: Record<string, unknown> }).metadataJson;
  return value ?? {};
}

function formatToolDecision(call: ToolCallListItemDto): string {
  const metadata = readToolMetadata(call);
  const decisionId = metadata.decisionId ?? (call as ToolCallListItemDto & { decisionId?: string }).decisionId;
  const grantId = metadata.grantId ?? (call as ToolCallListItemDto & { grantId?: string }).grantId;

  return [
    decisionId ? `decision:${String(decisionId)}` : undefined,
    grantId ? `grant:${String(grantId)}` : undefined,
    call.approvalId ? `approval:${call.approvalId}` : undefined,
  ].filter(Boolean).join("；") || "暂无";
}

function formatToolSignals(call: ToolCallListItemDto): string {
  const metadata = readToolMetadata(call);
  const taint = metadata.taintSummary ?? metadata.taintLabels ?? metadata.taint;
  const exfiltration = metadata.exfiltrationSignal ?? metadata.exfiltration ?? metadata.externalTarget;

  return [
    taint ? `taint:${JSON.stringify(taint)}` : undefined,
    exfiltration ? `exfil:${String(exfiltration)}` : undefined,
  ].filter(Boolean).join("；") || "暂无";
}

function formatDetailJson(value: Record<string, unknown> | undefined): string {
  return value ? JSON.stringify(value, null, 2) : "暂无";
}

function formatList(values: string[] | undefined): string {
  return values && values.length > 0 ? values.join("；") : "暂无";
}

export function ToolCallsPage() {
  const [draftFilters, setDraftFilters] = useState<ToolCallFilters>(EMPTY_FILTERS);
  const [appliedQuery, setAppliedQuery] = useState<Omit<ToolCallListQuery, "pageNum" | "pageSize">>({});
  const [selectedDetail, setSelectedDetail] = useState<ToolCallDetailDto | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const { items, loading, error, paginationProps, resetPaging, retry } = usePagedListResource<ToolCallListItemDto, ToolCallListQuery>({
    fallbackPage: import.meta.env.DEV
      ? (_query, pageIndex, pageSize) => paginateMockPage(mockToolCalls, pageIndex, pageSize)
      : undefined,
    loadPage: listToolCalls,
    query: appliedQuery,
  });

  const successCount = items.filter((item) => ["success", "completed", "approved"].includes(item.resultStatus ?? "")).length;
  const abnormalCount = items.filter((item) => ["failed", "blocked"].includes(item.resultStatus ?? "")).length;
  const successRate = items.length === 0 ? "0%" : `${((successCount / items.length) * 100).toFixed(1)}%`;
  const maxDuration = items.reduce((current, item) => Math.max(current, item.durationMs ?? 0), 0);
  const toolCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      counts.set(item.toolName, (counts.get(item.toolName) ?? 0) + 1);
    }

    return [...counts.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 3);
  }, [items]);
  const statusText = error ? `工具调用数据加载失败：${error}` : loading ? "正在加载调用流水" : "详细审计记录基于 tool_calls 协议层追踪";
  const isDetailDialogOpen = Boolean(selectedDetail || detailError);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    resetPaging();
    setAppliedQuery(buildToolCallQuery(draftFilters));
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
  }

  async function handleOpenDetail(toolCallId: string): Promise<void> {
    setDetailLoadingId(toolCallId);
    setDetailError(null);
    try {
      const detail = await getToolCallDetail(toolCallId);
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
        title="工具调用"
        description={statusText}
        eyebrow="TOOL CALLS MONITOR"
      />

      <section className="metric-grid metric-grid--compact">
        <article className="metric-card">
          <p className="metric-card__label">总调用次数</p>
          <strong className="metric-card__value">{formatInteger(items.length)}</strong>
          <p className="metric-card__note">当前筛选窗口</p>
        </article>
        <article className="metric-card">
          <p className="metric-card__label">平均成功率</p>
          <strong className="metric-card__value">{successRate}</strong>
          <p className="metric-card__note">SUCCESS / COMPLETED</p>
        </article>
        <article className="metric-card">
          <p className="metric-card__label">平均耗时 (P50)</p>
          <strong className="metric-card__value">{formatDuration(maxDuration)}</strong>
          <p className="metric-card__note">当前列表最大耗时</p>
        </article>
        <article className="metric-card">
          <p className="metric-card__label">异常调用数</p>
          <strong className="metric-card__value">{formatInteger(abnormalCount)}</strong>
          <p className="metric-card__note">ERROR / DENY</p>
        </article>
      </section>

      <section className="filter-panel">
        <form className="audit-filter-form audit-filter-form--compact" onSubmit={handleSubmit}>
          <label className="filter-field filter-field--search">
            <span>关键词</span>
            <Input
              allowClear
              aria-label="关键词"
              placeholder="搜索调用 ID、问答记录、结果摘要"
              value={draftFilters.q}
              onChange={(event) => setDraftFilters((current) => ({ ...current, q: event.target.value }))}
            />
          </label>
          <label className="filter-field">
            <span>工具名称</span>
            <Input
              allowClear
              aria-label="工具名称"
              placeholder="例如 exec / read_file"
              value={draftFilters.toolName}
              onChange={(event) => setDraftFilters((current) => ({ ...current, toolName: event.target.value }))}
            />
          </label>
          <label className="filter-field">
            <span>状态</span>
            <Select
              allowClear
              aria-label="状态"
              options={RESULT_STATUS_OPTIONS}
              placeholder="全部状态"
              value={draftFilters.resultStatus || undefined}
              onChange={(value) => setDraftFilters((current) => ({ ...current, resultStatus: value ?? "" }))}
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
            <h2 className="panel__title">实时调用流水</h2>
            <p className="panel__subtitle">表格保留定位和结果判断字段，决策、授权和外传信号进入详情。</p>
          </div>
        </div>
        <DataTable
          columns={[
            { key: "call", label: "调用" },
            { key: "tool", label: "工具名称" },
            { key: "status", label: "状态" },
            { key: "duration", label: "耗时" },
            { key: "summary", label: "结果摘要" },
            { key: "time", label: "调用时间" },
            { key: "detail", label: "详情" },
          ]}
          error={error}
          loading={loading}
          onRetry={retry}
          rows={items.map((call) => ({
            id: call.toolCallId,
            call: (
              <div className="row-stack">
                <strong>{call.toolCallId}</strong>
                <span>{formatQaRecordId(call.qaRecordId)}</span>
              </div>
            ),
            tool: <strong>{formatToolLabel(call.toolName)}</strong>,
            status: renderStateBadge(call.resultStatus),
            duration: formatDuration(call.durationMs),
            summary: call.resultExcerpt ?? "暂无结果摘要",
            time: formatTimestamp(call.startedAtMs),
            detail: (
              <button
                aria-label={`查看 ${call.toolCallId} JSON 详情`}
                className="btn btn--compact"
                disabled={detailLoadingId === call.toolCallId}
                type="button"
                onClick={() => void handleOpenDetail(call.toolCallId)}
              >
                {detailLoadingId === call.toolCallId ? "加载中" : "查看 JSON"}
              </button>
            ),
          }))}
        />
        <TablePagination {...paginationProps} />
      </section>

      <section className="split-grid split-grid--equal">
        <article className="panel">
          <div className="panel__header">
            <div>
              <h2 className="panel__title">高频调用工具</h2>
              <p className="panel__subtitle">MOST USED CAPABILITIES</p>
            </div>
          </div>
          <div className="list-stack">
            {toolCounts.map(([toolName, count]) => (
              <div key={toolName} className="list-item">
                <strong>{formatToolLabel(toolName)}</strong>
                <span className="small-note">{formatInteger(count)} calls</span>
              </div>
            ))}
          </div>
        </article>

        <article className="panel">
          <div className="panel__header">
            <div>
              <h2 className="panel__title">当前筛选概览</h2>
              <p className="panel__subtitle">基于当前页工具调用结果计算。</p>
            </div>
          </div>
          <div className="list-stack">
            <div className="list-item">
              <span>成功调用</span>
              <strong>{formatInteger(successCount)}</strong>
            </div>
            <div className="list-item">
              <span>异常调用</span>
              <strong>{formatInteger(abnormalCount)}</strong>
            </div>
            <div className="list-item">
              <span>最大耗时</span>
              <strong>{formatDuration(maxDuration)}</strong>
            </div>
          </div>
        </article>
      </section>

      <ModalDialog
        closeLabel="关闭详情"
        open={isDetailDialogOpen}
        title="工具调用详情"
        subtitle={
          detailError
            ? `详情加载失败：${detailError}`
            : selectedDetail?.toolCallId ?? "查看工具调用参数、结果和控制面元数据。"
        }
        onClose={handleCloseDetail}
      >
        <dl className="detail-panel__grid">
          {[
            { label: "工具", value: selectedDetail ? formatToolLabel(selectedDetail.toolName) : "暂无" },
            { label: "关联问答记录", value: formatQaRecordId(selectedDetail?.qaRecordId) },
            { label: "状态", value: selectedDetail?.resultStatus ?? "暂无" },
            { label: "会话", value: selectedDetail?.sessionKey ?? "暂无" },
            { label: "Run ID", value: selectedDetail?.runId ?? "暂无" },
            { label: "审批 ID", value: selectedDetail?.approvalId ?? "暂无" },
            { label: "开始时间", value: selectedDetail ? formatTimestamp(selectedDetail.startedAtMs) : "暂无" },
            { label: "结束时间", value: selectedDetail?.finishedAtMs ? formatTimestamp(selectedDetail.finishedAtMs) : "暂无" },
            { label: "耗时", value: formatDuration(selectedDetail?.durationMs) },
            { label: "参数摘要", value: selectedDetail?.paramSummary ?? "暂无" },
            { label: "参数哈希", value: selectedDetail?.paramHash ?? "暂无" },
            { label: "触发模块", value: formatList(selectedDetail?.triggeredModules) },
            { label: "决策 / Grant", value: selectedDetail ? formatToolDecision(selectedDetail) : "暂无" },
            { label: "Taint / 外传", value: selectedDetail ? formatToolSignals(selectedDetail) : "暂无" },
            { label: "错误信息", value: selectedDetail?.errorText ?? "暂无" },
            { label: "结果摘要", value: selectedDetail?.resultExcerpt ?? "暂无" },
            {
              label: "Metadata",
              value: <pre className="code-panel">{formatDetailJson(selectedDetail?.metadataJson)}</pre>,
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
