import { startTransition, useEffect, useMemo, useState, type FormEvent } from "react";
import { Button, Input, Select } from "antd";

import { listSkills, type SkillDetail, type SkillListQuery } from "../api/skills";
import { ModalDialog } from "../components/feedback/ModalDialog";
import { StatusBadge } from "../components/feedback/StatusBadge";
import { PageHeader } from "../components/layout/PageHeader";
import { DataTable } from "../components/tables/DataTable";
import { formatInteger } from "../utils/format";

function trustTone(value: string): "neutral" | "info" | "warning" | "danger" | "success" {
  if (value === "trusted" || value === "ok") {
    return "success";
  }
  if (value === "hash_mismatch" || value === "blocked") {
    return "danger";
  }
  if (value === "unknown" || value === "missing_manifest" || value === "first_seen") {
    return "warning";
  }
  return "neutral";
}

function formatTrustState(value: string): string {
  const labels: Record<string, string> = {
    trusted: "可信",
    ok: "可信",
    hash_mismatch: "哈希不一致",
    missing_manifest: "缺少清单",
    first_seen: "首次发现",
    unknown: "未知来源",
  };
  return labels[value] ?? value;
}

function formatFindingRules(item: SkillDetail): string {
  if (item.findings.length === 0) {
    return "暂无";
  }
  return item.findings.map((finding) => finding.ruleId).join("；");
}

interface SkillFilters {
  q: string;
  source: string;
  trustState: string;
}

const EMPTY_FILTERS: SkillFilters = {
  q: "",
  source: "",
  trustState: "",
};

const TRUST_OPTIONS = [
  { label: "可信", value: "trusted" },
  { label: "哈希不一致", value: "hash_mismatch" },
  { label: "首次发现", value: "first_seen" },
  { label: "缺少清单", value: "missing_manifest" },
  { label: "未知来源", value: "unknown" },
];

function buildSkillQuery(filters: SkillFilters): SkillListQuery {
  return {
    q: filters.q.trim() || undefined,
    trustState: filters.trustState || undefined,
    source: filters.source.trim() || undefined,
  };
}

export function SkillsPage() {
  const [items, setItems] = useState<SkillDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draftFilters, setDraftFilters] = useState<SkillFilters>(EMPTY_FILTERS);
  const [appliedQuery, setAppliedQuery] = useState<SkillListQuery>({});
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedSkill, setSelectedSkill] = useState<SkillDetail | null>(null);

  useEffect(() => {
    const abortController = new AbortController();

    async function loadSkills() {
      startTransition(() => {
        setError(null);
        setLoading(true);
      });

      try {
        const response = await listSkills(appliedQuery);
        if (abortController.signal.aborted) {
          return;
        }
        startTransition(() => {
          setItems(response.items);
          setError(null);
          setLoading(false);
        });
      } catch (loadError) {
        if (abortController.signal.aborted) {
          return;
        }
        startTransition(() => {
          setItems([]);
          setError(loadError instanceof Error ? loadError.message : "Skill inventory 加载失败");
          setLoading(false);
        });
      }
    }

    void loadSkills();
    return () => abortController.abort();
  }, [appliedQuery, reloadKey]);

  function retryList(): void {
    setReloadKey((current) => current + 1);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setSelectedSkill(null);
    setAppliedQuery(buildSkillQuery(draftFilters));
  }

  function handleReset(): void {
    setDraftFilters(EMPTY_FILTERS);
    setSelectedSkill(null);
    setAppliedQuery({});
  }

  const summary = useMemo(() => {
    const findingCount = items.reduce((total, item) => total + item.findings.length, 0);
    const mismatchCount = items.filter((item) => item.trustState === "hash_mismatch").length;
    return { findingCount, mismatchCount };
  }, [items]);

  const statusDescription = error
    ? `Skill inventory 加载失败：${error}`
    : loading
      ? "正在加载 Skill inventory"
      : "展示已安装 Skill、哈希基线、当前哈希、信任状态和供应链发现项。";

  return (
    <div className="page-stack">
      <PageHeader
        title="Skill 供应链"
        description={statusDescription}
        eyebrow="SKILL INVENTORY"
      />

      <section className="summary-card-grid">
        <article className="summary-card">
          <p className="summary-card__label">已安装 Skill</p>
          <strong className="summary-card__value">{formatInteger(items.length)}</strong>
        </article>
        <article className="summary-card">
          <p className="summary-card__label">哈希不一致</p>
          <strong className="summary-card__value">{formatInteger(summary.mismatchCount)}</strong>
        </article>
        <article className="summary-card">
          <p className="summary-card__label">发现项</p>
          <strong className="summary-card__value">{formatInteger(summary.findingCount)}</strong>
        </article>
      </section>

      <section className="filter-panel">
        <form className="audit-filter-form audit-filter-form--compact" onSubmit={handleSubmit}>
          <label className="filter-field">
            <span>信任状态</span>
            <Select
              allowClear
              aria-label="信任状态"
              options={TRUST_OPTIONS}
              placeholder="全部状态"
              value={draftFilters.trustState || undefined}
              onChange={(value) => setDraftFilters((current) => ({ ...current, trustState: value ?? "" }))}
            />
          </label>
          <label className="filter-field filter-field--search">
            <span>关键词</span>
            <Input
              allowClear
              aria-label="关键词"
              placeholder="搜索 Skill 名称、ID 或发现项"
              value={draftFilters.q}
              onChange={(event) => setDraftFilters((current) => ({ ...current, q: event.target.value }))}
            />
          </label>
          <label className="filter-field">
            <span>来源</span>
            <Input
              allowClear
              aria-label="来源"
              placeholder="例如 local / builtin"
              value={draftFilters.source}
              onChange={(event) => setDraftFilters((current) => ({ ...current, source: event.target.value }))}
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
            <h2 className="panel__title">Skill 列表</h2>
            <p className="panel__subtitle">表格聚焦信任状态和发现项，哈希与安装路径进入详情。</p>
          </div>
        </div>
        <DataTable
          columns={[
            { key: "skill", label: "Skill", maxWidth: 240, minWidth: 170, width: 200 },
            { key: "source", label: "来源", maxWidth: 150, minWidth: 110, width: 130 },
            { key: "trust", label: "信任状态", maxWidth: 160, minWidth: 120, width: 140 },
            { key: "findings", label: "发现项", maxWidth: 260, minWidth: 190, width: 230 },
            { key: "lastSeen", label: "最后发现", maxWidth: 210, minWidth: 160, width: 180 },
            { key: "detail", label: "操作", maxWidth: 140, minWidth: 104, width: 116 },
          ]}
          error={error}
          loading={loading}
          onRetry={retryList}
          rows={items.map((item) => ({
            id: item.skillId,
            skill: (
              <div className="row-stack">
                <strong>{item.name}</strong>
                <code>{item.skillId}</code>
              </div>
            ),
            source: item.source,
            trust: <StatusBadge label={formatTrustState(item.trustState)} tone={trustTone(item.trustState)} />,
            findings: formatFindingRules(item),
            lastSeen: item.lastSeenAt || "暂无",
            detail: (
              <button
                aria-label={`查看 ${item.skillId} Skill 详情`}
                className="btn btn--compact"
                type="button"
                onClick={() => setSelectedSkill(item)}
              >
                详情
              </button>
            ),
          }))}
        />
      </section>

      <ModalDialog
        closeLabel="关闭详情"
        open={Boolean(selectedSkill)}
        title="Skill 详情"
        subtitle={selectedSkill?.name ?? "查看 Skill 哈希、路径和供应链发现项。"}
        onClose={() => setSelectedSkill(null)}
      >
        <dl className="detail-panel__grid">
          {[
            { label: "Skill ID", value: selectedSkill?.skillId ?? "暂无" },
            { label: "名称", value: selectedSkill?.name ?? "暂无" },
            { label: "来源", value: selectedSkill?.source ?? "暂无" },
            { label: "信任状态", value: selectedSkill ? <StatusBadge label={formatTrustState(selectedSkill.trustState)} tone={trustTone(selectedSkill.trustState)} /> : "暂无" },
            { label: "算法", value: selectedSkill?.hashAlgorithm ?? "暂无" },
            { label: "Baseline Hash", value: selectedSkill?.baselineHash || "暂无" },
            { label: "Current Hash", value: selectedSkill?.currentHash || "暂无" },
            { label: "安装路径", value: selectedSkill?.installPath ?? "暂无" },
            { label: "清单路径", value: selectedSkill?.manifestPath ?? "暂无" },
            { label: "发现项", value: selectedSkill ? formatFindingRules(selectedSkill) : "暂无" },
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
