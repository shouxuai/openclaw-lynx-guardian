import { startTransition, useEffect, useState } from "react";
import type { ApprovalListItemDto } from "@lynx/local-console-shared";

import { listApprovals } from "../api/approvals";
import { mockApprovals } from "../data/mock-console";
import { PageHeader } from "../components/layout/PageHeader";
import { DataTable } from "../components/tables/DataTable";
import { formatTimestamp } from "../utils/format";
import { renderRiskBadge, renderStateBadge } from "../utils/status";

export function ApprovalsPage() {
  const [items, setItems] = useState<ApprovalListItemDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadApprovals() {
      try {
        const response = await listApprovals({ limit: 20 });
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
          setItems(import.meta.env.DEV ? mockApprovals : []);
          setError(import.meta.env.DEV ? null : loadError instanceof Error ? loadError.message : "请求失败");
          setLoading(false);
        });
      }
    }

    void loadApprovals();
    return () => {
      active = false;
    };
  }, []);

  const pendingCount = items.filter((item) => item.resolution === "pending" || !item.resolution).length;
  const approvedCount = items.filter((item) => item.resolution === "approved" || item.resolution === "completed").length;
  const blockedCount = items.filter((item) => item.resolution === "blocked" || item.resolution === "failed").length;
  const statusDescription = error ? `审批数据加载失败：${error}` : loading ? "正在加载审批队列" : "治理控制台聚合所有待复核与已决策请求。";

  return (
    <div className="page-stack">
      <PageHeader
        title="审批管理"
        description={statusDescription}
        eyebrow="GOVERNANCE CONTROL"
        actions={(
          <>
            <button className="btn" type="button">导出报告</button>
            <button className="btn btn--dark" type="button">批量处理</button>
          </>
        )}
      />

      <section className="summary-card-grid">
        <article className="summary-card">
          <p className="summary-card__label">待处理申请数</p>
          <strong className="summary-card__value">{pendingCount}</strong>
        </article>
        <article className="summary-card">
          <p className="summary-card__label">今日已核准</p>
          <strong className="summary-card__value">{approvedCount}</strong>
        </article>
        <article className="summary-card">
          <p className="summary-card__label">风险拦截数</p>
          <strong className="summary-card__value">{blockedCount}</strong>
        </article>
      </section>

      <section className="table-panel">
        <div className="table-panel__header">
          <h2 className="panel__title">活跃审核流</h2>
          <div className="page-header__actions">
            <button className="btn btn--dark" type="button">待审核</button>
            <button className="btn" type="button">历史记录</button>
            <button className="btn" type="button">搜索 ID 或申请人...</button>
          </div>
        </div>
        <DataTable
          columns={[
            { key: "approvalId", label: "审批 ID" },
            { key: "requester", label: "申请人" },
            { key: "risk", label: "风险权重" },
            { key: "scope", label: "范围类型" },
            { key: "summary", label: "请求摘要" },
            { key: "status", label: "状态" },
            { key: "action", label: "操作" },
          ]}
          rows={items.map((approval) => ({
            id: approval.approvalId,
            approvalId: approval.approvalId,
            requester: approval.requesterOuId ?? "未知申请人",
            risk: renderRiskBadge(approval.riskLevel),
            scope: approval.scopeType,
            summary: approval.promptExcerpt ?? "暂无审批摘要",
            status: renderStateBadge(approval.resolution ?? "pending"),
            action: <a className="inline-link" href={`/approvals#${approval.approvalId}`}>查看详情</a>,
          }))}
        />
        <div className="table-panel__footer">
          <span>显示 1-{items.length} 条，共 {items.length || pendingCount} 条待审核申请</span>
          <span>1 · 2 · 3</span>
        </div>
      </section>

      <section className="panel">
        <div className="panel__header">
          <h2 className="panel__title">二次确认流机制</h2>
        </div>
        <div className="summary-card-grid">
          {[
            ["1", "发起阶段", "申请人提交高风险请求，系统自动进行规则检测与初始评分。"],
            ["2", "一级审核", "直属负责人或业务管理员根据上下文进行逻辑一致性校验。"],
            ["3", "二次安全校验", "安全合规审计官对特权访问、数据分发等关键操作进行二次锁定。"],
          ].map(([step, title, description]) => (
            <article key={step} className="metric-card">
              <p className="status-badge status-badge--info">{step}</p>
              <h3 className="panel__title">{title}</h3>
              <p className="panel__subtitle">{description}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
