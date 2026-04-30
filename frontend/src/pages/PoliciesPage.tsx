import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Button, Input } from "antd";

import {
  createPolicyRule,
  createProtectedResource,
  getPolicyOverview,
  type PolicyOverview,
  type PolicyRule,
  type ProtectedResource,
} from "../api/policies";
import { PageHeader } from "../components/layout/PageHeader";
import { DataTable } from "../components/tables/DataTable";
import { formatInteger } from "../utils/format";

const PRESET_LABELS = {
  deny_all: "不允许访问",
  read_only: "只允许读",
  no_modify: "不允许修改",
  no_delete: "不允许删除",
} as const satisfies Record<ProtectedResource["preset"], string>;

const RULE_KIND_LABELS = {
  blacklist: "黑名单",
  allowlist: "白名单",
} as const satisfies Record<PolicyRule["kind"], string>;

const SCOPE_LABELS = {
  input: "输入",
  tool: "工具",
  script: "脚本",
  output: "输出",
} as const satisfies Record<PolicyRule["scope"], string>;

const PATTERN_TYPE_LABELS = {
  literal: "字面量",
  regex: "正则",
} as const satisfies Record<PolicyRule["patternType"], string>;

const EMPTY_OVERVIEW: PolicyOverview = {
  currentVersion: 0,
  protectedResources: [],
  rules: [],
};

function formatPreset(value: ProtectedResource["preset"]): string {
  return PRESET_LABELS[value] ?? value;
}

function formatRuleKind(value: PolicyRule["kind"]): string {
  return RULE_KIND_LABELS[value] ?? value;
}

function formatScope(value: PolicyRule["scope"]): string {
  return SCOPE_LABELS[value] ?? value;
}

function formatPatternType(value: PolicyRule["patternType"]): string {
  return PATTERN_TYPE_LABELS[value] ?? value;
}

export function PoliciesPage() {
  const [overview, setOverview] = useState<PolicyOverview>(EMPTY_OVERVIEW);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resourcePath, setResourcePath] = useState("");
  const [resourcePreset, setResourcePreset] = useState<ProtectedResource["preset"]>("read_only");
  const [ruleKind, setRuleKind] = useState<PolicyRule["kind"]>("blacklist");
  const [ruleScope, setRuleScope] = useState<PolicyRule["scope"]>("script");
  const [patternType, setPatternType] = useState<PolicyRule["patternType"]>("literal");
  const [pattern, setPattern] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function loadOverview(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      setOverview(await getPolicyOverview());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "策略配置加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadOverview();
  }, []);

  const enabledResources = useMemo(
    () => overview.protectedResources.filter((resource) => resource.enabled).length,
    [overview.protectedResources],
  );
  const enabledRules = useMemo(
    () => overview.rules.filter((rule) => rule.enabled).length,
    [overview.rules],
  );

  async function handleCreateResource(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const path = resourcePath.trim();
    if (!path) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const created = await createProtectedResource({
        path,
        preset: resourcePreset,
        enabled: true,
        actorId: "local-user",
        changeSummary: `add protected resource ${path}`,
      });
      setOverview((current) => ({
        ...current,
        currentVersion: Math.max(current.currentVersion, created.version),
        protectedResources: [created, ...current.protectedResources.filter((item) => item.resourceId !== created.resourceId)],
      }));
      setResourcePath("");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "受保护目录创建失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreateRule(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const rulePattern = pattern.trim();
    if (!rulePattern) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const created = await createPolicyRule({
        kind: ruleKind,
        scope: ruleScope,
        patternType,
        pattern: rulePattern,
        riskDelta: ruleKind === "blacklist" ? 70 : -15,
        enabled: true,
        actorId: "local-user",
        changeSummary: `add ${ruleKind} rule ${rulePattern}`,
      });
      setOverview((current) => ({
        ...current,
        currentVersion: Math.max(current.currentVersion, created.version),
        rules: [created, ...current.rules.filter((item) => item.ruleId !== created.ruleId)],
      }));
      setPattern("");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "黑白名单规则创建失败");
    } finally {
      setSubmitting(false);
    }
  }

  const statusText = error
    ? `策略配置加载失败：${error}`
    : loading
      ? "正在加载 Go 控制面策略"
      : "管理 Go 控制面的受保护目录和低权限黑白名单规则。";

  return (
    <div className="page-stack">
      <PageHeader
        title="策略配置"
        description={statusText}
        eyebrow="POLICY CONTROL PLANE"
      />

      <section className="summary-card-grid">
        <article className="summary-card">
          <p className="summary-card__label">策略版本</p>
          <strong className="summary-card__value">{formatInteger(overview.currentVersion)}</strong>
          <p className="summary-card__unit">Go policy version</p>
        </article>
        <article className="summary-card">
          <p className="summary-card__label">目录数</p>
          <strong className="summary-card__value">{formatInteger(enabledResources)}</strong>
          <p className="summary-card__unit">enabled resources</p>
        </article>
        <article className="summary-card">
          <p className="summary-card__label">规则数</p>
          <strong className="summary-card__value">{formatInteger(enabledRules)}</strong>
          <p className="summary-card__unit">low privilege rules</p>
        </article>
      </section>

      <section className="filter-panel">
        <form className="audit-filter-form audit-filter-form--compact" onSubmit={(event) => void handleCreateResource(event)}>
          <label className="filter-field filter-field--search">
            <span>目录路径</span>
            <Input
              allowClear
              aria-label="目录路径"
              placeholder="C:\\Users\\alice\\Secrets"
              value={resourcePath}
              onChange={(event) => setResourcePath(event.target.value)}
            />
          </label>
          <label className="filter-field">
            <span>权限预设</span>
            <select
              aria-label="权限预设"
              value={resourcePreset}
              onChange={(event) => setResourcePreset(event.target.value as ProtectedResource["preset"])}
            >
              {Object.entries(PRESET_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <div className="audit-filter-form__actions">
            <Button htmlType="submit" loading={submitting} type="primary">添加目录</Button>
          </div>
        </form>
      </section>

      <section className="filter-panel">
        <form className="audit-filter-form audit-filter-form--compact" onSubmit={(event) => void handleCreateRule(event)}>
          <label className="filter-field">
            <span>规则类型</span>
            <select
              aria-label="规则类型"
              value={ruleKind}
              onChange={(event) => setRuleKind(event.target.value as PolicyRule["kind"])}
            >
              {Object.entries(RULE_KIND_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            <span>作用域</span>
            <select
              aria-label="作用域"
              value={ruleScope}
              onChange={(event) => setRuleScope(event.target.value as PolicyRule["scope"])}
            >
              {Object.entries(SCOPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            <span>匹配方式</span>
            <select
              aria-label="匹配方式"
              value={patternType}
              onChange={(event) => setPatternType(event.target.value as PolicyRule["patternType"])}
            >
              {Object.entries(PATTERN_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label className="filter-field filter-field--search">
            <span>匹配内容</span>
            <Input
              allowClear
              aria-label="匹配内容"
              placeholder="Invoke-Expression"
              value={pattern}
              onChange={(event) => setPattern(event.target.value)}
            />
          </label>
          <div className="audit-filter-form__actions">
            <Button htmlType="submit" loading={submitting} type="primary">添加规则</Button>
          </div>
        </form>
      </section>

      <section className="split-grid split-grid--equal">
        <article className="table-panel">
          <div className="table-panel__header">
            <div>
              <h2 className="panel__title">受保护目录</h2>
              <p className="panel__subtitle">权限预设不包含执行禁用项，执行风险由脚本预检处理。</p>
            </div>
          </div>
          <DataTable
            columns={[
              { key: "path", label: "目录路径" },
              { key: "preset", label: "权限预设" },
              { key: "version", label: "策略版本" },
              { key: "enabled", label: "状态" },
            ]}
            error={error}
            loading={loading}
            onRetry={() => void loadOverview()}
            rows={overview.protectedResources.map((resource) => ({
              id: resource.resourceId,
              path: resource.path,
              preset: formatPreset(resource.preset),
              version: `策略版本 ${formatInteger(resource.version)}`,
              enabled: resource.enabled ? "启用" : "停用",
            }))}
          />
        </article>

        <article className="table-panel">
          <div className="table-panel__header">
            <div>
              <h2 className="panel__title">黑白名单规则</h2>
              <p className="panel__subtitle">白名单只降低低风险评分，不覆盖 L4 硬拒绝。</p>
            </div>
          </div>
          <DataTable
            columns={[
              { key: "kind", label: "规则类型" },
              { key: "scope", label: "作用域" },
              { key: "patternType", label: "匹配方式" },
              { key: "pattern", label: "匹配内容" },
              { key: "riskDelta", label: "风险调整" },
            ]}
            error={error}
            loading={loading}
            onRetry={() => void loadOverview()}
            rows={overview.rules.map((rule) => ({
              id: rule.ruleId,
              kind: formatRuleKind(rule.kind),
              scope: formatScope(rule.scope),
              patternType: formatPatternType(rule.patternType),
              pattern: rule.pattern,
              riskDelta: rule.riskDelta >= 0 ? `+${formatInteger(rule.riskDelta)}` : formatInteger(rule.riskDelta),
            }))}
          />
        </article>
      </section>
    </div>
  );
}
