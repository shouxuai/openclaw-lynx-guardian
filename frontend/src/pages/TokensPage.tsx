import { startTransition, useEffect, useState } from "react";
import type {
  TokenSummaryDto,
  TokenTrendDto,
  TokenUsageListItemDto,
} from "@lynx/local-console-shared";

import { getTokenSummary, getTokenTrend, getTokenUsage } from "../api/tokens";
import { DistributionCard } from "../components/cards/DistributionCard";
import { MetricCard } from "../components/cards/MetricCard";
import { TrendCard } from "../components/cards/TrendCard";
import { FilterBar } from "../components/filters/FilterBar";
import { PageHeader } from "../components/layout/PageHeader";
import { DataTable } from "../components/tables/DataTable";
import { mockFilterSets } from "../data/mock-console";
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
          setSummary(EMPTY_TOKEN_SUMMARY);
          setTrend(EMPTY_TOKEN_TREND);
          setUsageItems([]);
          setError(message);
          setLoading(false);
        });
      }
    }

    void loadTokenData();
    return () => {
      abortController.abort();
    };
  }, []);

  const headerDescription = loading
    ? "正在从本地控制台后端加载实时令牌用量。"
    : error
      ? `实时令牌用量不可用：${error}`
      : "展示来自本地控制台后端的实时令牌用量。";
  const totalTokensNote = error
    ? "实时接口不可用"
    : summary.estimatedCount > 0
      ? "包含估算回填记录"
      : "提供方用量记录";
  const estimatedRowsNote = loading
    ? "正在加载实时统计"
    : error
      ? "暂无实时记录"
      : "当前已存储回填记录";
  const usagePanelSubtitle = error
    ? "令牌后端暂不可用。"
    : loading
      ? "正在加载最新记录。"
      : `展示最近 ${usageItems.length} 条实时记录。`;

  return (
    <div className="page-stack">
      <PageHeader
        title="令牌"
        description={headerDescription}
        eyebrow="用量审计"
      />
      <section className="metric-grid">
        <MetricCard label="总令牌" value={formatInteger(summary.totalTokens)} note={totalTokensNote} />
        <MetricCard label="输入令牌" value={formatInteger(summary.inputTokens)} note="提示侧" />
        <MetricCard label="输出令牌" value={formatInteger(summary.outputTokens)} note="生成侧" />
        <MetricCard label="缓存读取" value={formatInteger(summary.cacheReadTokens)} note="复用收益" />
        <MetricCard label="缓存写入" value={formatInteger(summary.cacheWriteTokens)} note="预热成本" />
        <MetricCard label="估算行" value={formatInteger(summary.estimatedCount)} note={estimatedRowsNote} />
      </section>
      <FilterBar chips={mockFilterSets.tokens} />
      <section className="split-grid split-grid--equal">
        <DistributionCard
          title="令牌构成"
          subtitle="输入 / 输出 / 缓存拆分"
          items={[
            { label: "输入", value: summary.inputTokens },
            { label: "输出", value: summary.outputTokens },
            { label: "缓存读", value: summary.cacheReadTokens },
            { label: "缓存写", value: summary.cacheWriteTokens },
          ]}
        />
        <TrendCard
          title="用量趋势"
          subtitle="按时间桶聚合，无需外部图表"
          points={trend.points.map((point) => ({
            label: formatTimestamp(point.bucketStartMs),
            value: point.totalTokens,
          }))}
        />
      </section>
      <article className="panel">
        <div className="panel__header">
          <div>
            <h2 className="panel__title">用量记录</h2>
            <p className="panel__subtitle">{usagePanelSubtitle}</p>
          </div>
        </div>
        <DataTable
          columns={[
            { key: "session", label: "会话" },
            { key: "model", label: "模型" },
            { key: "total", label: "总量" },
            { key: "estimated", label: "类型" },
            { key: "time", label: "发生时间" },
          ]}
          rows={usageItems.map((item) => ({
            id: item.usageEventId,
            session: item.sessionKey ?? "无",
            model: `${item.provider} / ${item.model}`,
            total: formatInteger(item.totalTokens),
            estimated: renderStateBadge(item.isEstimated ? "estimated" : "actual"),
            time: formatTimestamp(item.occurredAtMs),
          }))}
        />
      </article>
    </div>
  );
}
