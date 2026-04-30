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
import { ModalDialog } from "../components/feedback/ModalDialog";
import { PageHeader } from "../components/layout/PageHeader";
import { DataTable } from "../components/tables/DataTable";
import { formatInteger } from "../utils/format";

const PRESET_LABELS = {
  deny_all: "不允许访问",
  read_only: "只允许读",
  no_modify: "不允许修改",
  no_delete: "不允许删除",
} as const satisfies Record<ProtectedResource["preset"], string>;

const SCOPE_LABELS = {
  input: "输入提示词",
  tool: "工具调用",
  script: "脚本命令",
  output: "输出内容",
} as const satisfies Record<PolicyRule["scope"], string>;

const PATTERN_TYPE_LABELS = {
  literal: "整段文本",
  regex: "正则整段匹配",
} as const satisfies Record<PolicyRule["patternType"], string>;

const EMPTY_OVERVIEW: PolicyOverview = {
  currentVersion: 0,
  protectedResources: [],
  rules: [],
};

type RuleKind = PolicyRule["kind"];
type PolicyDialog =
  | { family: "resource"; mode: "create" | "edit"; resource?: ProtectedResource }
  | { family: RuleKind; mode: "create" | "edit"; rule?: PolicyRule }
  | null;

function formatPreset(value: ProtectedResource["preset"]): string {
  return PRESET_LABELS[value] ?? value;
}

function formatScope(value: PolicyRule["scope"]): string {
  return SCOPE_LABELS[value] ?? value;
}

function formatPatternType(value: PolicyRule["patternType"]): string {
  return PATTERN_TYPE_LABELS[value] ?? value;
}

function ruleKindLabel(kind: PolicyRule["kind"]): string {
  return kind === "blacklist" ? "黑名单" : "白名单";
}

function dialogTitle(dialog: NonNullable<PolicyDialog>): string {
  const prefix = dialog.mode === "edit" ? "修改" : "添加";
  return dialog.family === "resource" ? `${prefix}目录防护` : `${prefix}${ruleKindLabel(dialog.family)}`;
}

export function PoliciesPage() {
  const [overview, setOverview] = useState<PolicyOverview>(EMPTY_OVERVIEW);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<PolicyDialog>(null);
  const [resourcePath, setResourcePath] = useState("");
  const [resourcePreset, setResourcePreset] = useState<ProtectedResource["preset"]>("read_only");
  const [ruleScope, setRuleScope] = useState<PolicyRule["scope"]>("input");
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
    () => overview.protectedResources.filter((resource) => resource.enabled),
    [overview.protectedResources],
  );
  const blacklistRules = useMemo(
    () => overview.rules.filter((rule) => rule.enabled && rule.kind === "blacklist"),
    [overview.rules],
  );
  const allowlistRules = useMemo(
    () => overview.rules.filter((rule) => rule.enabled && rule.kind === "allowlist"),
    [overview.rules],
  );

  function closeDialog(): void {
    if (!submitting) {
      setDialog(null);
    }
  }

  function openResourceDialog(resource?: ProtectedResource): void {
    setResourcePath(resource?.path ?? "");
    setResourcePreset(resource?.preset ?? "read_only");
    setDialog({
      family: "resource",
      mode: resource ? "edit" : "create",
      resource,
    });
  }

  function openRuleDialog(kind: RuleKind, rule?: PolicyRule): void {
    setRuleScope(rule?.scope ?? "input");
    setPatternType(rule?.patternType ?? "literal");
    setPattern(rule?.pattern ?? "");
    setDialog({
      family: kind,
      mode: rule ? "edit" : "create",
      rule,
    });
  }

  async function handleCreateResource(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const path = resourcePath.trim();
    if (!path) {
      return;
    }
    const existingResource = dialog?.family === "resource" ? dialog.resource : undefined;
    setSubmitting(true);
    setError(null);
    try {
      const created = await createProtectedResource({
        resourceId: existingResource?.resourceId,
        path,
        preset: resourcePreset,
        enabled: existingResource?.enabled ?? true,
        actorId: "local-user",
        changeSummary: existingResource ? `update protected resource ${path}` : `add protected resource ${path}`,
      });
      setOverview((current) => ({
        ...current,
        currentVersion: Math.max(current.currentVersion, created.version),
        protectedResources: [created, ...current.protectedResources.filter((item) => item.resourceId !== created.resourceId)],
      }));
      setResourcePath("");
      setDialog(null);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "目录防护保存失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreateRule(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!dialog || dialog.family === "resource") {
      return;
    }
    const kind = dialog.family;
    const existingRule = dialog.rule;
    const rulePattern = pattern.trim();
    if (!rulePattern) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const created = await createPolicyRule({
        ruleId: existingRule?.ruleId,
        kind,
        scope: ruleScope,
        patternType,
        pattern: rulePattern,
        riskDelta: kind === "blacklist" ? 70 : -15,
        enabled: existingRule?.enabled ?? true,
        actorId: "local-user",
        changeSummary: existingRule ? `update ${kind} full-text rule ${rulePattern}` : `add ${kind} full-text rule ${rulePattern}`,
      });
      setOverview((current) => ({
        ...current,
        currentVersion: Math.max(current.currentVersion, created.version),
        rules: [created, ...current.rules.filter((item) => item.ruleId !== created.ruleId)],
      }));
      setPattern("");
      setDialog(null);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : `${ruleKindLabel(kind)}保存失败`);
    } finally {
      setSubmitting(false);
    }
  }

  const statusText = error
    ? `策略配置加载失败：${error}`
    : loading
      ? "正在加载 Go 控制面策略"
      : "目录防护按疑似访问路径触发；黑名单和白名单按完整提示词或命令文本匹配，白名单不能覆盖 L4 硬拒绝。";

  return (
    <div className="page-stack">
      <PageHeader
        title="策略配置"
        description={statusText}
        eyebrow="POLICY CONTROL PLANE"
      />

      <section className="metric-grid metric-grid--compact policy-metrics">
        <article className="metric-card">
          <p className="metric-card__label">目录防护</p>
          <strong className="metric-card__value">{formatInteger(enabledResources.length)}</strong>
          <p className="metric-card__note">疑似路径访问触发</p>
        </article>
        <article className="metric-card">
          <p className="metric-card__label">黑名单</p>
          <strong className="metric-card__value">{formatInteger(blacklistRules.length)}</strong>
          <p className="metric-card__note">完整文本命中</p>
        </article>
        <article className="metric-card">
          <p className="metric-card__label">白名单</p>
          <strong className="metric-card__value">{formatInteger(allowlistRules.length)}</strong>
          <p className="metric-card__note">低风险降噪</p>
        </article>
        <article className="metric-card">
          <p className="metric-card__label">总数</p>
          <strong className="metric-card__value">{formatInteger(enabledResources.length + blacklistRules.length + allowlistRules.length)}</strong>
          <p className="metric-card__note">策略版本 {formatInteger(overview.currentVersion)}</p>
        </article>
      </section>

      {dialog?.family === "resource" ? (
        <ModalDialog
          closeLabel={`关闭${dialogTitle(dialog)}`}
          open
          title={dialogTitle(dialog)}
          subtitle="目录防护按疑似访问路径触发，不包含执行禁用项。"
          onClose={closeDialog}
        >
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
              <Button onClick={closeDialog}>取消</Button>
              <Button htmlType="submit" loading={submitting} type="primary">保存目录防护</Button>
            </div>
          </form>
        </ModalDialog>
      ) : null}

      {dialog?.family === "blacklist" || dialog?.family === "allowlist" ? (
        <ModalDialog
          closeLabel={`关闭${dialogTitle(dialog)}`}
          open
          title={dialogTitle(dialog)}
          subtitle={`${ruleKindLabel(dialog.family)}按完整提示词或命令文本匹配，白名单不能覆盖 L4 硬拒绝。`}
          onClose={closeDialog}
        >
          <form className="audit-filter-form audit-filter-form--compact" onSubmit={(event) => void handleCreateRule(event)}>
            <label className="filter-field">
              <span>作用域</span>
              <select
                aria-label={`${ruleKindLabel(dialog.family)}作用域`}
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
                aria-label={`${ruleKindLabel(dialog.family)}匹配方式`}
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
                aria-label={`${ruleKindLabel(dialog.family)}匹配内容`}
                placeholder={dialog.family === "blacklist" ? "完整高风险提示词或命令" : "完整低风险提示词或命令"}
                value={pattern}
                onChange={(event) => setPattern(event.target.value)}
              />
            </label>
            <div className="audit-filter-form__actions">
              <Button onClick={closeDialog}>取消</Button>
              <Button htmlType="submit" loading={submitting} type="primary">{`保存${ruleKindLabel(dialog.family)}`}</Button>
            </div>
          </form>
        </ModalDialog>
      ) : null}

      <section className="table-panel">
        <div className="table-panel__header">
          <div>
            <h2 className="panel__title">目录防护</h2>
            <p className="panel__subtitle">只要工具调用疑似访问受保护目录，就生成路径证据并交给 Go 控制面裁决；权限预设不包含执行禁用项。</p>
          </div>
          <Button type="primary" onClick={() => openResourceDialog()}>添加目录防护</Button>
        </div>
        <DataTable
          columns={[
            { key: "path", label: "目录路径" },
            { key: "preset", label: "权限预设" },
            { key: "version", label: "策略版本" },
            { key: "enabled", label: "状态" },
            { key: "action", label: "操作" },
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
            action: (
              <Button
                aria-label={`修改目录防护 ${resource.path}`}
                type="link"
                onClick={() => openResourceDialog(resource)}
              >
                修改
              </Button>
            ),
          }))}
        />
      </section>

      <section className="split-grid split-grid--equal">
        <PolicyRuleTable
          title="黑名单"
          subtitle="命中完整提示词或命令文本后提高风险评分；不依赖目录疑似访问匹配。"
          buttonLabel="添加黑名单"
          rules={blacklistRules}
          loading={loading}
          error={error}
          onCreate={() => openRuleDialog("blacklist")}
          onEdit={(rule) => openRuleDialog("blacklist", rule)}
          onRetry={() => void loadOverview()}
        />
        <PolicyRuleTable
          title="白名单"
          subtitle="只用于低风险降噪，按完整文本匹配，不能覆盖 L4 硬拒绝、目录防护或脚本外传证据。"
          buttonLabel="添加白名单"
          rules={allowlistRules}
          loading={loading}
          error={error}
          onCreate={() => openRuleDialog("allowlist")}
          onEdit={(rule) => openRuleDialog("allowlist", rule)}
          onRetry={() => void loadOverview()}
        />
      </section>
    </div>
  );
}

function PolicyRuleTable({
  buttonLabel,
  error,
  loading,
  onCreate,
  onEdit,
  onRetry,
  rules,
  subtitle,
  title,
}: {
  buttonLabel: string;
  error: string | null;
  loading: boolean;
  onCreate: () => void;
  onEdit: (rule: PolicyRule) => void;
  onRetry: () => void;
  rules: PolicyRule[];
  subtitle: string;
  title: string;
}) {
  return (
    <article className="table-panel">
      <div className="table-panel__header">
        <div>
          <h2 className="panel__title">{title}</h2>
          <p className="panel__subtitle">{subtitle}</p>
        </div>
        <Button type="primary" onClick={onCreate}>{buttonLabel}</Button>
      </div>
      <DataTable
        columns={[
          { key: "scope", label: "作用域" },
          { key: "patternType", label: "匹配方式" },
          { key: "pattern", label: "完整匹配内容" },
          { key: "riskDelta", label: "风险调整" },
          { key: "version", label: "策略版本" },
          { key: "action", label: "操作" },
        ]}
        error={error}
        loading={loading}
        onRetry={onRetry}
        rows={rules.map((rule) => ({
          id: rule.ruleId,
          scope: formatScope(rule.scope),
          patternType: formatPatternType(rule.patternType),
          pattern: rule.pattern,
          riskDelta: rule.riskDelta >= 0 ? `+${formatInteger(rule.riskDelta)}` : formatInteger(rule.riskDelta),
          version: `策略版本 ${formatInteger(rule.version)}`,
          action: (
            <Button
              aria-label={`修改${title} ${rule.pattern}`}
              type="link"
              onClick={() => onEdit(rule)}
            >
              修改
            </Button>
          ),
        }))}
      />
    </article>
  );
}
