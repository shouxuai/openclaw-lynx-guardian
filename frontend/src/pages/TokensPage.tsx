import { startTransition, useEffect, useMemo, useState } from "react";
import type {
  TokenSummaryDto,
  TokenTrendDto,
  TokenUsageListItemDto,
} from "@lynx/local-console-shared";

import { getTokenSummary, getTokenTrend, getTokenUsage } from "../api/tokens";
import { DataTable } from "../components/tables/DataTable";
import { mockTokenSummary, mockTokenTrend, mockTokenUsage } from "../data/mock-console";
import { formatInteger, formatTimestamp } from "../utils/format";
import { renderStateBadge } from "../utils/status";

const EMPTY_TOKEN_SUMMARY: TokenSummaryDto = {
  totalTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  estimatedCount: 0,
  topModels: [],
};

const EMPTY_TOKEN_TREND: TokenTrendDto = {
  bucket: "hour",
  points: [],
};

function percent(value: number, total: number): number {
  if (total === 0) {
    return 0;
  }

  return Math.round((value / total) * 100);
}

function formatRatio(input: number, output: number): string {
  if (output === 0) {
    return input === 0 ? "0:0" : "∞:1";
  }

  return `${(input / output).toFixed(2)}:1`;
}

export function TokensPage() {
  const [summary, setSummary] = useState<TokenSummaryDto>(EMPTY_TOKEN_SUMMARY);
  const [trend, setTrend] = useState<TokenTrendDto>(EMPTY_TOKEN_TREND);
  const [usageItems, setUsageItems] = useState<TokenUsageListItemDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const abortController = new AbortController();

    async function loadTokenData() {
      try {
        const [nextSummary, nextUsage, nextTrend] = await Promise.all([
          getTokenSummary(),
          getTokenUsage(20),
          getTokenTrend("hour"),
        ]);
        if (abortController.signal.aborted) {
          return;
        }

        startTransition(() => {
          setSummary(nextSummary);
          setTrend(nextTrend);
          setUsageItems(nextUsage.items);
          setError(null);
          setLoading(false);
        });
      } catch (loadError) {
        if (abortController.signal.aborted) {
          return;
        }

        const message = loadError instanceof Error ? loadError.message : "未知错误";
        startTransition(() => {
          setSummary(import.meta.env.DEV ? mockTokenSummary : EMPTY_TOKEN_SUMMARY);
          setTrend(import.meta.env.DEV ? mockTokenTrend : EMPTY_TOKEN_TREND);
          setUsageItems(import.meta.env.DEV ? mockTokenUsage : []);
          setError(import.meta.env.DEV ? null : message);
          setLoading(false);
        });
      }
    }

    void loadTokenData();
    return () => {
      abortController.abort();
    };
  }, []);

  const totalTransferTokens = summary.inputTokens + summary.outputTokens;
  const inputPercent = percent(summary.inputTokens, totalTransferTokens);
  const outputPercent = percent(summary.outputTokens, totalTransferTokens);
  const trendLabels = useMemo(() => {
    if (trend.points.length > 0) {
      return trend.points.slice(-7).map((point) => formatTimestamp(point.bucketStartMs).split(" ")[0]);
    }

    return ["10/21", "10/22", "10/23", "10/24", "10/25", "10/26", "今日"];
  }, [trend.points]);
  const loadStatus = error ? `实时数据不可用：${error}` : loading ? "正在刷新中" : "实时刷新中";

  return (
    <div className="page-stack">
      <section className="token-hero">
        <div>
          <h1 className="token-hero__title">Token 统计报表</h1>
          <p className="token-hero__subtitle">实时量化模型消耗与基础设施负载</p>
        </div>
        <div className="page-header__actions">
          <button className="btn" type="button">过去 24 小时</button>
          <button className="btn btn--dark" type="button">导出报告</button>
        </div>
      </section>

      <section className="summary-card-grid">
        <article className="summary-card">
          <p className="summary-card__label">今日消耗总数</p>
          <strong className="summary-card__value">
            {formatInteger(summary.totalTokens)}
            <span className="summary-card__unit">Tokens</span>
          </strong>
          <p className="summary-card__delta">↗ +12.5% 较昨日</p>
        </article>

        <article className="summary-card ratio-card">
          <div className="ratio-list">
            <p className="summary-card__label">输入/输出比例</p>
            <div className="ratio-row">
              <div className="ratio-row__meta">
                <span>输入 (Input)</span>
                <strong>{inputPercent}%</strong>
              </div>
              <div className="ratio-track">
                <div className="ratio-fill" style={{ width: `${inputPercent}%` }} />
              </div>
            </div>
            <div className="ratio-row">
              <div className="ratio-row__meta">
                <span>输出 (Output)</span>
                <strong>{outputPercent}%</strong>
              </div>
              <div className="ratio-track">
                <div className="ratio-fill ratio-fill--dark" style={{ width: `${outputPercent}%` }} />
              </div>
            </div>
          </div>
          <div className="ratio-ring">
            <strong>{formatRatio(summary.inputTokens, summary.outputTokens)}</strong>
          </div>
        </article>

        <article className="summary-card">
          <p className="summary-card__label">模型平均负载 (LATENCY)</p>
          <strong className="summary-card__value">
            342ms
          </strong>
          <p className="summary-card__unit">P95 延迟指标</p>
          <div className="latency-bars" aria-hidden="true">
            <span style={{ height: "32px" }} />
            <span style={{ height: "44px" }} />
            <span />
            <span style={{ height: "48px" }} />
            <span style={{ height: "28px" }} />
          </div>
          <p className="summary-card__delta">● 系统状态: 稳定</p>
        </article>
      </section>

      <section className="panel trend-panel">
        <div className="panel__header">
          <h2 className="panel__title">7 日消耗趋势分析</h2>
          <div className="trend-panel__legend">
            <span><i className="legend-swatch legend-swatch--blue" />GPT-4o</span>
            <span><i className="legend-swatch legend-swatch--black" />Claude 3.5</span>
          </div>
        </div>
        <div className="chart-empty-grid">
          <div className="chart-empty-grid__axis">
            {trendLabels.map((label, index) => (
              <span key={`${label}-${index}`}>{label}</span>
            ))}
          </div>
        </div>
      </section>

      <section className="table-panel token-table">
        <div className="table-panel__header">
          <h2 className="panel__title">实时审计数据流</h2>
          <span className="small-note">{loadStatus} · · ·</span>
        </div>
        <DataTable
          columns={[
            { key: "session", label: "会话 ID" },
            { key: "model", label: "模型名称" },
            { key: "io", label: "输入 / 输出" },
            { key: "total", label: "总词元" },
            { key: "type", label: "类型" },
            { key: "time", label: "触发时间" },
          ]}
          rows={usageItems.map((item) => ({
            id: item.usageEventId,
            session: item.sessionKey ?? "未知会话",
            model: (
              <div className="row-stack">
                <span className={item.model.toLowerCase().includes("claude") ? "model-pill model-pill--dark" : "model-pill"}>
                  {item.model}
                </span>
                <span>{item.provider} / {item.model}</span>
              </div>
            ),
            io: `${formatInteger(item.inputTokens)} → ${formatInteger(item.outputTokens)}`,
            total: <strong>{formatInteger(item.totalTokens)}</strong>,
            type: renderStateBadge(item.isEstimated ? "estimated" : "actual"),
            time: formatTimestamp(item.occurredAtMs),
          }))}
        />
        <div className="table-panel__footer">
          <span />
          <a className="inline-link" href="/events">查看所有审计条目</a>
          <span />
        </div>
      </section>
    </div>
  );
}
