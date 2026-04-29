import { startTransition, useEffect, useState, type FormEvent } from "react";
import type { SessionDetailDto, SessionListItemDto } from "@lynx/local-console-shared";
import { Button, Input, Select } from "antd";

import { getSessionDetail, listSessions, type SessionListQuery } from "../api/sessions";
import { MetricCard } from "../components/cards/MetricCard";
import { DetailPanel } from "../components/detail/DetailPanel";
import { StatusBadge } from "../components/feedback/StatusBadge";
import { PageHeader } from "../components/layout/PageHeader";
import { DataTable } from "../components/tables/DataTable";
import { TablePagination } from "../components/tables/TablePagination";
import { usePagedListResource } from "../hooks/usePagedListResource";
import { formatInteger, formatTimestamp } from "../utils/format";
import { formatDomainLabel, renderRiskBadge } from "../utils/status";

function formatTokenSummary(summary: SessionDetailDto["tokenSummary"] | undefined) {
  if (!summary) {
    return "暂无";
  }

  return [
    `总量：${formatInteger(summary.totalTokens ?? 0)}`,
    `输入：${formatInteger(summary.inputTokens ?? 0)}`,
    `输出：${formatInteger(summary.outputTokens ?? 0)}`,
  ].join("\n");
}

interface SessionFilters {
  channelProfile: string;
  isGroup: string;
  q: string;
  requesterOuId: string;
}

const EMPTY_FILTERS: SessionFilters = {
  channelProfile: "",
  isGroup: "",
  q: "",
  requesterOuId: "",
};

const GROUP_OPTIONS = [
  { label: "群聊", value: "true" },
  { label: "单聊", value: "false" },
];

function buildSessionQuery(filters: SessionFilters): Omit<SessionListQuery, "pageNum" | "pageSize"> {
  return {
    q: filters.q.trim() || undefined,
    requesterOuId: filters.requesterOuId.trim() || undefined,
    channelProfile: filters.channelProfile.trim() || undefined,
    isGroup: filters.isGroup ? filters.isGroup === "true" : undefined,
  };
}

export function SessionsPage() {
  const [draftFilters, setDraftFilters] = useState<SessionFilters>(EMPTY_FILTERS);
  const [appliedQuery, setAppliedQuery] = useState<Omit<SessionListQuery, "pageNum" | "pageSize">>({});
  const [selectedSessionKey, setSelectedSessionKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionDetailDto | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const { items, loading, error, paginationProps, resetPaging, retry } = usePagedListResource<SessionListItemDto, SessionListQuery>({
    loadPage: listSessions,
    onPageBoundaryChange: () => setSelectedSessionKey(null),
    query: appliedQuery,
  });

  useEffect(() => {
    const firstSession = items[0];
    if (!firstSession) {
      setSelectedSessionKey(null);
      setDetail(null);
      setDetailError(null);
      return;
    }

    if (!selectedSessionKey || !items.some((item) => item.sessionKey === selectedSessionKey)) {
      setSelectedSessionKey(firstSession.sessionKey);
    }
  }, [items, selectedSessionKey]);

  useEffect(() => {
    if (!selectedSessionKey) {
      return;
    }

    let active = true;
    const sessionKey = selectedSessionKey;

    async function loadDetail() {
      try {
        const nextDetail = await getSessionDetail(sessionKey);
        if (!active) {
          return;
        }

        startTransition(() => {
          setDetail(nextDetail);
          setDetailError(null);
        });
      } catch (loadError) {
        if (!active) {
          return;
        }

        startTransition(() => {
          setDetail(null);
          setDetailError(loadError instanceof Error ? loadError.message : "请求失败");
        });
      }
    }

    void loadDetail();

    return () => {
      active = false;
    };
  }, [selectedSessionKey]);

  const activeCount = items.filter((item) => !item.endedAtMs).length;
  const groupCount = items.filter((item) => item.isGroup).length;
  const highRiskCount = items.filter((item) => (item.highRiskEventCount ?? 0) > 0).length;
  const headerDescription = loading
    ? "正在从本地控制台后端加载会话索引。"
    : error
      ? `会话数据加载失败：${error}`
      : detailError
        ? `会话详情加载失败：${detailError}`
      : "展示真实会话列表与默认详情快照。";
  const headerTone = error || detailError ? "danger" : loading ? "info" : "success";
  const headerLabel = error || detailError ? "请求失败" : loading ? "加载中" : "实时数据";

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setSelectedSessionKey(null);
    resetPaging();
    setAppliedQuery(buildSessionQuery(draftFilters));
  }

  function handleReset(): void {
    setDraftFilters(EMPTY_FILTERS);
    setSelectedSessionKey(null);
    resetPaging();
    setAppliedQuery({});
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="会话"
        description={headerDescription}
        eyebrow="会话索引"
        actions={<StatusBadge label={headerLabel} tone={headerTone} />}
      />
      <section className="metric-grid metric-grid--compact">
        <MetricCard label="总会话" value={`${items.length}`} note="默认展示最近 20 条" />
        <MetricCard label="活跃会话" value={`${activeCount}`} note="尚未结束的会话" />
        <MetricCard label="群聊会话" value={`${groupCount}`} note="按 isGroup 聚合" />
        <MetricCard label="高风险会话" value={`${highRiskCount}`} note="包含高风险事件的会话" />
      </section>
      <section className="filter-panel">
        <form className="audit-filter-form audit-filter-form--compact" onSubmit={handleSubmit}>
          <label className="filter-field filter-field--search">
            <span>关键词</span>
            <Input
              allowClear
              aria-label="关键词"
              placeholder="搜索会话、渠道、请求人"
              value={draftFilters.q}
              onChange={(event) => setDraftFilters((current) => ({ ...current, q: event.target.value }))}
            />
          </label>
          <label className="filter-field">
            <span>请求人</span>
            <Input
              allowClear
              aria-label="请求人"
              placeholder="输入请求人 OU ID"
              value={draftFilters.requesterOuId}
              onChange={(event) => setDraftFilters((current) => ({ ...current, requesterOuId: event.target.value }))}
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
          <label className="filter-field">
            <span>会话类型</span>
            <Select
              allowClear
              aria-label="会话类型"
              options={GROUP_OPTIONS}
              placeholder="全部类型"
              value={draftFilters.isGroup || undefined}
              onChange={(value) => setDraftFilters((current) => ({ ...current, isGroup: value ?? "" }))}
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
              <h2 className="panel__title">会话台账</h2>
              <p className="panel__subtitle">列表与详情都来自真实会话查询接口。</p>
            </div>
          </div>
          <DataTable
            columns={[
              { key: "session", label: "会话" },
              { key: "profile", label: "渠道" },
              { key: "events", label: "事件数" },
              { key: "risk", label: "风险" },
              { key: "lastSeen", label: "最近活动" },
            ]}
            error={error}
            loading={loading}
            onRetry={retry}
            rows={items.map((session) => ({
              id: session.sessionKey,
              session: session.sessionKey,
              profile: formatDomainLabel(session.channelProfile),
              events: formatInteger(session.eventCount ?? 0),
                risk: renderRiskBadge((session.highRiskEventCount ?? 0) > 0 ? "L3" : "L1"),
                lastSeen: formatTimestamp(session.lastSeenAtMs),
            }))}
            onRowClick={(row) => setSelectedSessionKey(row.id)}
            selectedRowId={selectedSessionKey ?? undefined}
          />
          <TablePagination {...paginationProps} />
        </article>
        <DetailPanel
          title={detail?.sessionKey ?? "暂无会话"}
          subtitle={
            detail
              ? `${formatDomainLabel(detail.channelProfile)} · ${detail.requesterOuId ?? "暂无请求人"}`
              : "等待后端返回会话详情"
          }
          fields={[
            { label: "最近事件", value: formatInteger(detail?.recentEvents.length ?? 0) },
            { label: "最近工具调用", value: formatInteger(detail?.recentToolCalls.length ?? 0) },
            { label: "最近审批", value: formatInteger(detail?.recentApprovals.length ?? 0) },
            { label: "令牌摘要", value: formatTokenSummary(detail?.tokenSummary) },
          ]}
        />
      </section>
    </div>
  );
}
