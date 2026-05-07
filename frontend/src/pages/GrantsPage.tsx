import { startTransition, useEffect, useState, type FormEvent } from "react";
import { Button, Input } from "antd";

import { listGrants, type Grant, type GrantListQuery } from "../api/grants";
import { ModalDialog } from "../components/feedback/ModalDialog";
import { StatusBadge } from "../components/feedback/StatusBadge";
import { PageHeader } from "../components/layout/PageHeader";
import { DataTable } from "../components/tables/DataTable";
import { formatInteger } from "../utils/format";

function formatScope(scope: Record<string, unknown>): string {
  const keys = Object.keys(scope);
  if (keys.length === 0) {
    return "未声明范围";
  }
  return keys.map((key) => `${key}:${String(scope[key])}`).join("；");
}

function formatIsoTime(value: string | undefined): string {
  if (!value) {
    return "暂无";
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }
  return new Date(timestamp).toLocaleString("zh-CN");
}

interface GrantFilters {
  q: string;
  requesterId: string;
}

const EMPTY_FILTERS: GrantFilters = {
  q: "",
  requesterId: "",
};

function buildGrantQuery(filters: GrantFilters): GrantListQuery {
  return {
    q: filters.q.trim() || undefined,
    requesterId: filters.requesterId.trim() || undefined,
  };
}

export function GrantsPage() {
  const [items, setItems] = useState<Grant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draftFilters, setDraftFilters] = useState<GrantFilters>(EMPTY_FILTERS);
  const [appliedQuery, setAppliedQuery] = useState<GrantListQuery>({});
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedGrant, setSelectedGrant] = useState<Grant | null>(null);

  useEffect(() => {
    const abortController = new AbortController();

    async function loadGrants() {
      startTransition(() => {
        setError(null);
        setLoading(true);
      });

      try {
        const nextItems = await listGrants(appliedQuery);
        if (abortController.signal.aborted) {
          return;
        }
        startTransition(() => {
          setItems(nextItems);
          setError(null);
          setLoading(false);
        });
      } catch (loadError) {
        if (abortController.signal.aborted) {
          return;
        }
        startTransition(() => {
          setItems([]);
          setError(
            loadError instanceof Error
              ? loadError.message
              : "放行记录加载失败",
          );
          setLoading(false);
        });
      }
    }

    void loadGrants();
    return () => abortController.abort();
  }, [appliedQuery, reloadKey]);

  function retryList(): void {
    setReloadKey((current) => current + 1);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setSelectedGrant(null);
    setAppliedQuery(buildGrantQuery(draftFilters));
  }

  function handleReset(): void {
    setDraftFilters(EMPTY_FILTERS);
    setSelectedGrant(null);
    setAppliedQuery({});
  }

  const activeCount = items.filter((item) => !item.revokedAt).length;
  const revokedCount = items.length - activeCount;
  const showEmptyExplanation = !loading && !error && items.length === 0;
  const statusDescription = error
    ? `放行记录加载失败：${error}`
    : loading
      ? "正在加载放行记录"
      : "审批通过后，记录后续同一链路里命中已授权范围并被默认放行的 tool 调用。";

  return (
    <div className="page-stack">
      <PageHeader
        title="放行记录"
        description={statusDescription}
        eyebrow="审批后的工具放行流水"
      />

      <section className="metric-grid metric-grid--compact metric-grid--narrow">
        <article className="metric-card">
          <p className="metric-card__label">已放行调用</p>
          <strong className="metric-card__value">
            {formatInteger(activeCount)}
          </strong>
          <p className="metric-card__note">命中授权范围</p>
        </article>
        <article className="metric-card">
          <p className="metric-card__label">已撤销/失效</p>
          <strong className="metric-card__value">
            {formatInteger(revokedCount)}
          </strong>
          <p className="metric-card__note">过期、升级或上下文变化</p>
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
              placeholder="搜索放行、审批、链路或工具"
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
            <span>申请人</span>
            <Input
              allowClear
              aria-label="申请人"
              placeholder="输入用户或 OU ID"
              value={draftFilters.requesterId}
              onChange={(event) =>
                setDraftFilters((current) => ({
                  ...current,
                  requesterId: event.target.value,
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

      <section className="table-panel">
        <div className="table-panel__header">
          <div>
            <h2 className="panel__title">放行记录列表</h2>
            <p className="panel__subtitle">
              这里记录审批后被默认放行的后续 tool 调用；审批请求和处理记录请到审批管理查看。
            </p>
          </div>
        </div>
        {showEmptyExplanation ? (
          <div className="empty-explanation">
            <strong>暂无放行记录</strong>
            <p>
              审批通过后，后续同一链路里的 tool 调用如果命中已授权范围，会作为放行记录出现在这里。
            </p>
            <p>
              示例：审批 APR-102 通过 read 工具后，后续 read 同一路径会记录为已放行；换成 exec、换路径或链路结束就不会复用。
            </p>
          </div>
        ) : null}
        <DataTable
          emptyDescription="暂无放行记录"
          columns={[
            {
              key: "grant",
              label: "放行",
              maxWidth: 300,
              minWidth: 220,
              width: 260,
            },
            {
              key: "requester",
              label: "申请人",
              maxWidth: 200,
              minWidth: 150,
              width: 170,
            },
            {
              key: "approver",
              label: "审批人",
              maxWidth: 200,
              minWidth: 150,
              width: 170,
            },
            {
              key: "tool",
              label: "工具",
              maxWidth: 180,
              minWidth: 130,
              width: 150,
            },
            {
              key: "status",
              label: "状态",
              maxWidth: 140,
              minWidth: 110,
              width: 120,
            },
            {
              key: "expires",
              label: "过期时间",
              maxWidth: 190,
              minWidth: 150,
              width: 170,
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
          onRetry={retryList}
          rows={items.map((item) => ({
            id: item.grantId,
            grant: (
              <div className="row-stack">
                <strong>{item.grantId}</strong>
                <span>{item.approvalId}</span>
              </div>
            ),
            requester: item.requesterOuId || item.requesterId || "未知",
            approver: item.approverOuId || item.approverId || "未知",
            tool: item.toolName || "暂无",
            status: (
              <StatusBadge
                label={item.revokedAt ? "已撤销" : "有效"}
                tone={item.revokedAt ? "danger" : "success"}
              />
            ),
            expires: formatIsoTime(item.expiresAt),
            detail: (
              <button
                aria-label={`查看 ${item.grantId} 放行详情`}
                className="btn btn--compact"
                type="button"
                onClick={() => setSelectedGrant(item)}
              >
                详情
              </button>
            ),
          }))}
        />
      </section>

      <ModalDialog
        closeLabel="关闭详情"
        open={Boolean(selectedGrant)}
        title="放行详情"
        subtitle={
          selectedGrant?.grantId ?? "查看放行记录的适用范围和撤销上下文。"
        }
        onClose={() => setSelectedGrant(null)}
      >
        <dl className="detail-panel__grid">
          {[
            { label: "放行 ID", value: selectedGrant?.grantId ?? "暂无" },
            { label: "审批 ID", value: selectedGrant?.approvalId ?? "暂无" },
            { label: "链路", value: selectedGrant?.chainId ?? "暂无" },
            { label: "会话", value: selectedGrant?.sessionKey ?? "暂无" },
            {
              label: "申请人",
              value:
                selectedGrant?.requesterOuId ||
                selectedGrant?.requesterId ||
                "暂无",
            },
            {
              label: "审批人",
              value:
                selectedGrant?.approverOuId ||
                selectedGrant?.approverId ||
                "暂无",
            },
            { label: "风险族", value: selectedGrant?.riskFamily ?? "暂无" },
            { label: "工具", value: selectedGrant?.toolName ?? "暂无" },
            { label: "目标类型", value: selectedGrant?.targetKind ?? "暂无" },
            { label: "目标哈希", value: selectedGrant?.targetHash ?? "暂无" },
            {
              label: "放行范围",
              value: selectedGrant
                ? formatScope(selectedGrant.resourceScope)
                : "暂无",
            },
            {
              label: "创建时间",
              value: formatIsoTime(selectedGrant?.createdAt),
            },
            {
              label: "过期时间",
              value: formatIsoTime(selectedGrant?.expiresAt),
            },
            {
              label: "撤销时间",
              value: formatIsoTime(selectedGrant?.revokedAt),
            },
            {
              label: "撤销原因",
              value: selectedGrant?.revokedReason || "暂无",
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
