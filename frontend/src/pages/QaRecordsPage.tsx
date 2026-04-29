import { startTransition, useEffect, useMemo, useState } from "react";
import type {
  QaChainNodeDto,
  QaRecordDetailDto,
  QaRecordListItemDto,
} from "@lynx/local-console-shared";

import { getQaRecordDetail, listQaRecords, type QaRecordListQuery } from "../api/qa-records";
import { DetailPanel } from "../components/detail/DetailPanel";
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
      { label: "标准输出", value: getNodeDetailText(node, "stdout") ?? getNodeDetailText(node, "result") ?? "暂无" },
      { label: "标准错误", value: getNodeDetailText(node, "stderr") ?? "暂无" },
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
  const { items, loading, error, paginationProps } = usePagedListResource<
    QaRecordListItemDto,
    QaRecordListQuery
  >({
    loadPage: listQaRecords,
    query: {},
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

      <section className="split-grid">
        <article className="panel">
          <div className="panel__header">
            <div>
              <h2 className="panel__title">问答列表</h2>
              <p className="panel__subtitle">选择一条记录查看完整工具链。</p>
            </div>
          </div>
          <div className="list-stack">
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
            {items.length === 0 ? <p className="small-note">暂无问答记录。</p> : null}
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

          <dl className="detail-panel__grid">
            {[
              { label: "用户问题", value: detail?.userPromptExcerpt ?? selectedRecord?.userPromptExcerpt ?? "暂无" },
              { label: "答复摘要", value: detail?.finalAnswerExcerpt ?? selectedRecord?.finalAnswerExcerpt ?? "暂无" },
              { label: "状态", value: renderStateBadge(detail?.status ?? selectedRecord?.status) },
              { label: "风险", value: renderRiskBadge(detail?.riskLevel ?? selectedRecord?.riskLevel) },
              { label: "Token", value: formatInteger(detail?.totalTokens ?? selectedRecord?.totalTokens ?? 0) },
            ].map((field) => (
              <div key={field.label} className="detail-panel__field">
                <dt>{field.label}</dt>
                <dd>{field.value}</dd>
              </div>
            ))}
          </dl>

          <button
            className="btn"
            disabled={!detail}
            type="button"
            onClick={() => setChainExpanded((value) => !value)}
          >
            {chainExpanded ? "收起工具链" : "展开工具链"}
          </button>

          {chainExpanded ? (
            <div className="list-stack">
              {detail?.chainNodes.map((node) => (
                <button
                  className="list-item"
                  key={node.nodeId}
                  type="button"
                  aria-label={`${node.title} ${node.summary ?? ""}`}
                  onClick={() => setSelectedNodeId(node.nodeId)}
                >
                  <strong>{node.title}</strong>
                  <span>{NODE_TYPE_LABELS[node.type]}</span>
                  <span className="small-note">{formatTimestamp(node.occurredAtMs)}</span>
                </button>
              ))}
            </div>
          ) : null}
        </article>
      </section>

      <DetailPanel
        title={selectedNode?.title ?? "工具链节点详情"}
        subtitle={selectedNode ? `${NODE_TYPE_LABELS[selectedNode.type]} · ${formatTimestamp(selectedNode.occurredAtMs)}` : "点击工具链节点查看具体执行内容。"}
        fields={buildNodeFields(selectedNode)}
      />
    </div>
  );
}
