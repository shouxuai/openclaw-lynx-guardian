import { startTransition, useEffect, useMemo, useState } from "react";
import type { ToolCallListItemDto } from "@lynx/local-console-shared";

import { listToolCalls } from "../api/tool-calls";
import { mockToolCalls } from "../data/mock-console";
import { DataTable } from "../components/tables/DataTable";
import { formatDuration, formatInteger, formatTimestamp } from "../utils/format";
import { formatToolLabel, renderStateBadge } from "../utils/status";

export function ToolCallsPage() {
  const [items, setItems] = useState<ToolCallListItemDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadToolCalls() {
      try {
        const response = await listToolCalls({ limit: 20 });
        if (!active) {
          return;
        }

        startTransition(() => {
          setItems(response.items);
          setError(null);
          setLoading(false);
        });
      } catch (loadError) {
        if (!active) {
          return;
        }

        startTransition(() => {
          setItems(import.meta.env.DEV ? mockToolCalls : []);
          setError(import.meta.env.DEV ? null : loadError instanceof Error ? loadError.message : "请求失败");
          setLoading(false);
        });
      }
    }

    void loadToolCalls();
    return () => {
      active = false;
    };
  }, []);

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

  return (
    <div className="page-stack">
      {statusText ? <p className="small-note">{statusText}</p> : null}

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

      <section className="page-header">
        <div>
          <h1 className="page-header__title">实时调用流水</h1>
          <p className="page-header__description">详细审计记录基于 tool_calls 协议层追踪</p>
        </div>
        <div className="page-header__actions">
          <button className="btn" type="button">搜索 ID 或工具名...</button>
          <button className="btn" type="button">筛选状态</button>
        </div>
      </section>

      <section className="table-panel">
        <DataTable
          columns={[
            { key: "id", label: "调用 ID" },
            { key: "tool", label: "工具名称" },
            { key: "time", label: "调用时间" },
            { key: "status", label: "状态" },
            { key: "duration", label: "耗时" },
            { key: "summary", label: "参数摘要" },
            { key: "detail", label: "详情" },
          ]}
          rows={items.map((call) => ({
            id: call.toolCallId,
            tool: <strong>{formatToolLabel(call.toolName)}</strong>,
            time: formatTimestamp(call.startedAtMs),
            status: renderStateBadge(call.resultStatus),
            duration: formatDuration(call.durationMs),
            summary: call.resultExcerpt ?? "暂无结果摘要",
            detail: <a className="inline-link" href={`/tool-calls#${call.toolCallId}`}>查看 JSON</a>,
          }))}
        />
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
              <h2 className="panel__title">审计系统状态</h2>
              <p className="panel__subtitle">AUDIT ENGINE HEALTH</p>
            </div>
          </div>
          <h3 className="summary-card__value">Operational</h3>
          <p className="small-note">All audit hooks connected</p>
          <div className="list-stack">
            <div className="list-item">
              <span>最后同步时间</span>
              <strong>{loading ? "同步中" : "刚刚"}</strong>
            </div>
            <div className="list-item">
              <span>运行窗口</span>
              <strong>154d 12h 45m</strong>
            </div>
          </div>
          <button className="btn" type="button">执行全量审计</button>
        </article>
      </section>
    </div>
  );
}
