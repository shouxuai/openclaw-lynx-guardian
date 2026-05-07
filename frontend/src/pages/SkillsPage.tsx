import { useMemo, useState, type FormEvent } from "react";
import { Button, Input, Select } from "antd";

import {
  listSkills,
  type SkillDetail,
  type SkillFinding,
  type SkillListQuery,
  type SkillListResponse,
  type SkillSourceBreakdownItem,
} from "../api/skills";
import { MetricCard } from "../components/cards/MetricCard";
import { ModalDialog } from "../components/feedback/ModalDialog";
import { StatusBadge } from "../components/feedback/StatusBadge";
import { PageHeader } from "../components/layout/PageHeader";
import { DataTable } from "../components/tables/DataTable";
import { TablePagination } from "../components/tables/TablePagination";
import { usePagedListResource } from "../hooks/usePagedListResource";
import { formatInteger } from "../utils/format";

function trustTone(value: string): "neutral" | "info" | "warning" | "danger" | "success" {
  if (value === "trusted" || value === "ok") {
    return "success";
  }
  if (value === "hash_mismatch" || value === "blocked") {
    return "danger";
  }
  if (value === "unknown" || value === "missing_manifest" || value === "first_seen" || value === "unreadable") {
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
    unreadable: "无法读取",
    unknown: "未知来源",
  };
  return labels[value] ?? value;
}

const FINDING_RULE_LABELS: Record<string, string> = {
  hash_mismatch: "当前哈希与基线不一致",
  "hash.changed": "哈希发生变化",
  missing_manifest: "缺少 SKILL.md 清单",
  skill_file_changed_after_baseline: "基线后文件发生变化",
  suspicious_install_source: "安装来源可疑",
  writeable_protected_skill_path: "受保护路径可写",
};

function isHighSeverityFinding(finding: SkillFinding): boolean {
  return ["critical", "error", "high"].includes(finding.severity.toLowerCase());
}

function findingSummaryTone(item: SkillDetail): "ok" | "warning" | "danger" {
  if (item.findings.length === 0) {
    return "ok";
  }
  return item.findings.some(isHighSeverityFinding) ? "danger" : "warning";
}

function formatFindingRule(ruleId: string): string {
  return FINDING_RULE_LABELS[ruleId] ?? ruleId;
}

function formatFindingSummary(item: SkillDetail): string {
  if (item.findings.length === 0) {
    return "无";
  }
  return item.findings.some(isHighSeverityFinding)
    ? `${formatInteger(item.findings.length)} 项风险`
    : `${formatInteger(item.findings.length)} 项提示`;
}

function formatFindingDetails(item: SkillDetail): string {
  if (item.findings.length === 0) {
    return "暂无风险提示";
  }
  return item.findings
    .map((finding) => `${formatFindingRule(finding.ruleId)}（${finding.ruleId}）`)
    .join("；");
}

interface InventoryChannelView {
  kind: "native" | "other";
  kindLabel: string;
  detailLabel: string;
  sourceKind: string;
  tone: "neutral" | "info";
}

const SOURCE_KIND_OPTIONS = [
  { label: "原生内置", value: "openclaw-bundled" },
  { label: "插件扩展", value: "openclaw-extension" },
  { label: "原生扩展", value: "openclaw-extra" },
  { label: "原生托管", value: "openclaw-managed" },
  { label: "用户 .openclaw", value: "local" },
] as const;

const TRUST_OPTIONS = [
  { label: "可信", value: "trusted" },
  { label: "哈希不一致", value: "hash_mismatch" },
  { label: "首次发现", value: "first_seen" },
  { label: "缺少清单", value: "missing_manifest" },
  { label: "未知来源", value: "unknown" },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isNativeSourceKind(value: string): boolean {
  return value === "openclaw-bundled" || value === "openclaw-managed" || value === "openclaw-extra";
}

function formatSourceKind(value: string): string {
  const known = SOURCE_KIND_OPTIONS.find((option) => option.value === value);
  if (known) {
    return known.label;
  }
  const labels: Record<string, string> = {
    "agents-skills-personal": "个人 .agents",
    bundled: "插件仓库",
    unknown: "未知来源",
  };
  return labels[value] ?? (value || "未知来源");
}

function sourceKindFromItem(item: SkillDetail): string {
  const metadata = isRecord(item.metadata) ? item.metadata : {};
  const channel = isRecord(metadata.inventoryChannel) ? metadata.inventoryChannel : {};
  return readString(channel.sourceKind) || item.source || "unknown";
}

function resolveInventoryChannel(item: SkillDetail): InventoryChannelView {
  const metadata = isRecord(item.metadata) ? item.metadata : {};
  const channel = isRecord(metadata.inventoryChannel) ? metadata.inventoryChannel : {};
  const sourceKind = sourceKindFromItem(item);
  const metadataKind = readString(channel.kind);
  const kind = metadataKind === "native" || isNativeSourceKind(sourceKind) ? "native" : "other";
  return {
    kind,
    kindLabel: kind === "native" ? "OpenClaw 原生" : "其他渠道",
    detailLabel: formatSourceKind(sourceKind),
    sourceKind,
    tone: kind === "native" ? "info" : "neutral",
  };
}

interface SkillFilters {
  q: string;
  sourceKind: string;
  trustState: string;
}

const EMPTY_FILTERS: SkillFilters = {
  q: "",
  sourceKind: "",
  trustState: "",
};

function buildSkillQuery(filters: SkillFilters): Omit<SkillListQuery, "pageNum" | "pageSize"> {
  return {
    q: filters.q.trim() || undefined,
    trustState: filters.trustState || undefined,
    sourceKind: filters.sourceKind || undefined,
  };
}

interface DisplaySourceBreakdownItem {
  label: string;
  sourceKind: string;
  count: number;
}

function summarizeCurrentPageSources(items: SkillDetail[]): SkillSourceBreakdownItem[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const sourceKind = sourceKindFromItem(item);
    counts.set(sourceKind, (counts.get(sourceKind) ?? 0) + 1);
  }
  return Array.from(counts, ([sourceKind, count]) => ({ sourceKind, count }));
}

function buildDisplaySourceBreakdown(
  sourceBreakdown: SkillSourceBreakdownItem[],
  items: SkillDetail[],
): DisplaySourceBreakdownItem[] {
  const source = sourceBreakdown.length > 0 ? sourceBreakdown : summarizeCurrentPageSources(items);
  const counts = new Map<string, number>();
  for (const item of source) {
    counts.set(item.sourceKind, item.count);
  }

  const knownKinds = new Set<string>(SOURCE_KIND_OPTIONS.map((option) => option.value));
  const known = SOURCE_KIND_OPTIONS.map((option) => ({
    ...option,
    sourceKind: option.value,
    count: counts.get(option.value) ?? 0,
  }));
  const extra = Array.from(counts, ([sourceKind, count]) => ({ sourceKind, label: formatSourceKind(sourceKind), count }))
    .filter((item) => !knownKinds.has(item.sourceKind) && item.count > 0)
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, "zh-Hans-CN"));

  return [...known, ...extra];
}

export function SkillsPage() {
  const [draftFilters, setDraftFilters] = useState<SkillFilters>(EMPTY_FILTERS);
  const [appliedQuery, setAppliedQuery] = useState<Omit<SkillListQuery, "pageNum" | "pageSize">>(
    () => buildSkillQuery(EMPTY_FILTERS),
  );
  const [sourceBreakdown, setSourceBreakdown] = useState<SkillSourceBreakdownItem[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<SkillDetail | null>(null);

  async function loadSkillsPage(query: SkillListQuery): Promise<SkillListResponse> {
    const response = await listSkills(query);
    setSourceBreakdown(response.sourceBreakdown ?? []);
    return response;
  }

  const {
    items,
    loading,
    error,
    paginationProps,
    resetPaging,
    retry,
    total,
  } = usePagedListResource<SkillDetail, SkillListQuery>({
    loadPage: loadSkillsPage,
    onPageBoundaryChange: () => setSelectedSkill(null),
    query: appliedQuery,
  });

  function applyFilters(filters: SkillFilters): void {
    setSelectedSkill(null);
    resetPaging();
    setAppliedQuery(buildSkillQuery(filters));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    applyFilters(draftFilters);
  }

  function handleReset(): void {
    setDraftFilters(EMPTY_FILTERS);
    applyFilters(EMPTY_FILTERS);
  }

  function handleSourceKindFilter(sourceKind: string): void {
    const nextFilters = {
      ...draftFilters,
      sourceKind: draftFilters.sourceKind === sourceKind ? "" : sourceKind,
    };
    setDraftFilters(nextFilters);
    applyFilters(nextFilters);
  }

  const displaySourceBreakdown = useMemo(
    () => buildDisplaySourceBreakdown(sourceBreakdown, items),
    [items, sourceBreakdown],
  );

  const summary = useMemo(() => {
    const findingCount = items.reduce((current, item) => current + item.findings.length, 0);
    const mismatchCount = items.filter((item) => item.trustState === "hash_mismatch").length;
    const sourceTotal = displaySourceBreakdown.reduce((current, item) => current + item.count, 0);
    const nativeCount = displaySourceBreakdown
      .filter((item) => isNativeSourceKind(item.sourceKind))
      .reduce((current, item) => current + item.count, 0);

    return {
      findingCount,
      mismatchCount,
      nativeCount,
      otherCount: Math.max(0, sourceTotal - nativeCount),
    };
  }, [displaySourceBreakdown, items]);

  const statusDescription = error
    ? `Skill inventory 加载失败：${error}`
    : loading
      ? "正在加载 Skill inventory"
      : "展示已安装 Skill、哈希基线、当前哈希、信任状态和供应链风险提示。";
  const headerTone = error ? "danger" : loading ? "info" : "success";
  const headerLabel = error ? "请求失败" : loading ? "加载中" : "实时数据";

  return (
    <div className="page-stack">
      <PageHeader
        title="Skill 供应链"
        description={statusDescription}
        eyebrow="SKILL INVENTORY"
        actions={<StatusBadge label={headerLabel} tone={headerTone} />}
      />

      <section className="metric-grid metric-grid--compact">
        <MetricCard
          label="匹配 Skill"
          value={formatInteger(total)}
          note={`分页显示，每页 ${formatInteger(paginationProps.pageSize)} 条`}
        />
        <MetricCard
          label="OpenClaw 原生"
          value={formatInteger(summary.nativeCount)}
          note="内置 / 托管 / 原生扩展"
        />
        <MetricCard
          label="其他渠道"
          value={formatInteger(summary.otherCount)}
          note="插件扩展 / 用户目录"
        />
        <MetricCard
          label="本页问题"
          value={`${formatInteger(summary.mismatchCount)} / ${formatInteger(summary.findingCount)}`}
          note="哈希异常 / 风险提示"
        />
      </section>

      <section className="filter-panel skills-source-panel" aria-label="Skill 来源分布">
        <div>
          <h2 className="panel__title">来源分布</h2>
          <p className="panel__subtitle">按来源类型筛选；计数保留完整 inventory 分布，不受当前来源按钮收窄。</p>
        </div>
        <div className="skills-source-panel__chips">
          <button
            aria-label="筛选 全部来源"
            className={`skills-source-chip skills-source-chip--all${draftFilters.sourceKind ? "" : " skills-source-chip--active"}`}
            type="button"
            onClick={() => {
              const nextFilters = { ...draftFilters, sourceKind: "" };
              setDraftFilters(nextFilters);
              applyFilters(nextFilters);
            }}
          >
            全部来源
            <strong>{formatInteger(displaySourceBreakdown.reduce((current, item) => current + item.count, 0))}</strong>
          </button>
          {displaySourceBreakdown.map((source) => (
            <button
              key={source.sourceKind}
              aria-label={`筛选 ${source.label}`}
              className={`skills-source-chip${draftFilters.sourceKind === source.sourceKind ? " skills-source-chip--active" : ""}`}
              type="button"
              onClick={() => handleSourceKindFilter(source.sourceKind)}
            >
              {source.label}
              <strong>{formatInteger(source.count)}</strong>
            </button>
          ))}
        </div>
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
              placeholder="搜索 Skill 名称、ID、来源或路径"
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

      <section className="table-panel">
        <div className="table-panel__header">
          <div>
            <h2 className="panel__title">Skill 列表</h2>
            <p className="panel__subtitle">列表只显示风险提示数量，哈希、安装路径和具体规则进入详情。</p>
          </div>
        </div>
        <DataTable
          columns={[
            { key: "skill", label: "Skill", maxWidth: 240, minWidth: 170, width: 200 },
            { key: "source", label: "来源", maxWidth: 150, minWidth: 110, width: 130 },
            { key: "trust", label: "信任状态", maxWidth: 160, minWidth: 120, width: 140 },
            { key: "findings", label: "风险摘要", maxWidth: 132, minWidth: 96, width: 112 },
            { key: "lastSeen", label: "最后发现", maxWidth: 210, minWidth: 160, width: 180 },
            { key: "detail", label: "操作", maxWidth: 140, minWidth: 104, width: 116 },
          ]}
          error={error}
          loading={loading}
          onRetry={retry}
          rows={items.map((item) => {
            const channel = resolveInventoryChannel(item);
            return {
              id: item.skillId,
              skill: (
                <div className="row-stack">
                  <strong>{item.name}</strong>
                  <code>{item.skillId}</code>
                </div>
              ),
              source: (
                <div className="skills-source-cell">
                  <span className={`skills-source-cell__channel skills-source-cell__channel--${channel.kind}`}>
                    {channel.kindLabel}
                  </span>
                  <span className="skills-source-cell__detail">{channel.detailLabel}</span>
                </div>
              ),
              trust: <StatusBadge label={formatTrustState(item.trustState)} tone={trustTone(item.trustState)} />,
              findings: (
                <span
                  className={`skills-finding-summary skills-finding-summary--${findingSummaryTone(item)}`}
                  title={formatFindingDetails(item)}
                >
                  {formatFindingSummary(item)}
                </span>
              ),
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
            };
          })}
        />
        <TablePagination {...paginationProps} ariaLabel="Skill 列表分页" />
      </section>

      <ModalDialog
        closeLabel="关闭详情"
        open={Boolean(selectedSkill)}
        size="wide"
        title="Skill 详情"
        subtitle={selectedSkill?.name ?? "查看 Skill 哈希、路径和供应链风险提示。"}
        onClose={() => setSelectedSkill(null)}
      >
        {selectedSkill ? (
          <div className="audit-detail-dialog">
            <section className="audit-detail-dialog__hero">
              <div className="audit-detail-dialog__heroText">
                <p className="audit-detail-dialog__eyebrow">Skill 概览</p>
                <p className="audit-detail-dialog__heroSubtitle">
                  {selectedSkill.name} 的安装来源、哈希基线与供应链风险提示。
                </p>
              </div>
              <div className="audit-detail-dialog__chips" aria-label="Skill 概览标签">
                <span className="audit-detail-dialog__chip">
                  <span className="audit-detail-dialog__chipLabel">信任状态</span>
                  <span className="audit-detail-dialog__chipValue">
                    <StatusBadge label={formatTrustState(selectedSkill.trustState)} tone={trustTone(selectedSkill.trustState)} />
                  </span>
                </span>
                <span className="audit-detail-dialog__chip">
                  <span className="audit-detail-dialog__chipLabel">渠道</span>
                  <span className="audit-detail-dialog__chipValue">{resolveInventoryChannel(selectedSkill).kindLabel}</span>
                </span>
                <span className="audit-detail-dialog__chip">
                  <span className="audit-detail-dialog__chipLabel">来源</span>
                  <span className="audit-detail-dialog__chipValue">{resolveInventoryChannel(selectedSkill).detailLabel}</span>
                </span>
                <span className="audit-detail-dialog__chip">
                  <span className="audit-detail-dialog__chipLabel">提示数</span>
                  <span className="audit-detail-dialog__chipValue">{formatInteger(selectedSkill.findings.length)}</span>
                </span>
              </div>
            </section>

            <section className="audit-detail-dialog__section">
              <div className="panel__header audit-detail-dialog__sectionHeader">
                <div>
                  <h3 className="panel__title">供应链状态</h3>
                  <p className="panel__subtitle">Skill 身份、来源与哈希基线状态。</p>
                </div>
              </div>
              <dl className="detail-panel__grid audit-detail-dialog__summary-grid">
                {[
                  { label: "Skill ID", value: selectedSkill.skillId },
                  { label: "名称", value: selectedSkill.name },
                  { label: "原始来源", value: selectedSkill.source || "暂无" },
                  { label: "来源类型", value: resolveInventoryChannel(selectedSkill).detailLabel },
                  { label: "算法", value: selectedSkill.hashAlgorithm || "暂无" },
                  { label: "Baseline Hash", value: selectedSkill.baselineHash || "暂无" },
                  { label: "Current Hash", value: selectedSkill.currentHash || "暂无" },
                  { label: "最后发现", value: selectedSkill.lastSeenAt || "暂无" },
                ].map((field) => (
                  <div key={field.label} className="detail-panel__field">
                    <dt>{field.label}</dt>
                    <dd>{field.value}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section className="audit-detail-dialog__section">
              <div className="panel__header audit-detail-dialog__sectionHeader">
                <div>
                  <h3 className="panel__title">安装位置</h3>
                  <p className="panel__subtitle">本地 inventory 记录到的安装目录与清单文件。</p>
                </div>
              </div>
              <dl className="detail-panel__grid audit-detail-dialog__summary-grid">
                <div className="detail-panel__field">
                  <dt>安装路径</dt>
                  <dd>{selectedSkill.installPath || "暂无"}</dd>
                </div>
                <div className="detail-panel__field">
                  <dt>清单路径</dt>
                  <dd>{selectedSkill.manifestPath || "暂无"}</dd>
                </div>
              </dl>
            </section>

            <section className="audit-detail-dialog__section">
              <div className="panel__header audit-detail-dialog__sectionHeader">
                <div>
                  <h3 className="panel__title">风险提示</h3>
                  <p className="panel__subtitle">具体规则保留在详情中，列表只展示压缩摘要。</p>
                </div>
              </div>
              <p className="muted-text">{formatFindingDetails(selectedSkill)}</p>
            </section>
          </div>
        ) : null}
      </ModalDialog>
    </div>
  );
}
