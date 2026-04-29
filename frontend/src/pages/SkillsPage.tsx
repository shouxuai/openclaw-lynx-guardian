import { startTransition, useEffect, useMemo, useState } from "react";

import { listSkills, type SkillDetail } from "../api/skills";
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

export function SkillsPage() {
  const [items, setItems] = useState<SkillDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const abortController = new AbortController();

    async function loadSkills() {
      try {
        const response = await listSkills();
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
  }, []);

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

      <section className="table-panel">
        <DataTable
          columns={[
            { key: "skill", label: "Skill", maxWidth: 240, minWidth: 170, width: 200 },
            { key: "source", label: "来源", maxWidth: 150, minWidth: 110, width: 130 },
            { key: "trust", label: "信任状态", maxWidth: 160, minWidth: 120, width: 140 },
            { key: "baseline", label: "Baseline Hash", maxWidth: 220, minWidth: 160, width: 190 },
            { key: "current", label: "Current Hash", maxWidth: 220, minWidth: 160, width: 190 },
            { key: "findings", label: "Findings", maxWidth: 260, minWidth: 190, width: 230 },
            { key: "lastSeen", label: "最后发现", maxWidth: 210, minWidth: 160, width: 180 },
            { key: "path", label: "安装路径", maxWidth: 320, minWidth: 230, width: 280 },
          ]}
          loading={loading}
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
            baseline: item.baselineHash || "暂无",
            current: item.currentHash || "暂无",
            findings: formatFindingRules(item),
            lastSeen: item.lastSeenAt || "暂无",
            path: item.installPath,
          }))}
        />
      </section>
    </div>
  );
}
