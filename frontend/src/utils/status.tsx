import { StatusBadge, type StatusBadgeProps } from "../components/feedback/StatusBadge";

const ACTION_LABELS: Record<string, string> = {
  allow: "放行",
  warn: "告警",
  redact: "脱敏",
  require_approval: "审批",
  requireApproval: "审批",
  block: "阻断",
  deny: "拒绝",
  log_only: "记录",
  logOnly: "记录",
};

const ACTION_TEXT_LABELS: Record<string, string> = {
  allow: "记录日志并放行",
  warn: "标记复核",
  redact: "敏感字段脱敏",
  require_approval: "等待人工审批",
  requireApproval: "等待人工审批",
  block: "阻断请求",
  deny: "拒绝请求",
  log_only: "仅记录",
  logOnly: "仅记录",
};

const POLICY_DECISION_LABELS: Record<string, string> = {
  allow: "允许",
  allow_with_logging: "允许并记录",
  confirm: "人工确认",
  deliver_report: "投递报告",
  require_approval: "需要审批",
  requireApproval: "需要审批",
  redact_sensitive_fields: "敏感字段脱敏",
  require_human_review: "人工复核",
  warn_and_continue: "告警继续",
};

const STATE_LABELS: Record<string, string> = {
  approved: "已批准",
  completed: "已完成",
  success: "成功",
  pending: "待处理",
  running: "运行中",
  paused: "已暂停",
  failed: "失败",
  blocked: "已阻断",
  estimated: "估算",
  actual: "实际",
  unavailable: "不可用",
};

const CHANNEL_LABELS: Record<string, string> = {
  feishu: "飞书",
  webchat: "网页会话",
  recent: "最近活跃",
  "recent-active": "最近活跃目标",
  current: "当前会话",
  direct: "直达",
  scheduled_lynx_check: "定时任务",
  lynx_command: "手动触发",
};

const TOOL_LABELS: Record<string, string> = {
  move_files: "move_files",
  read_file: "read_file",
  search_logs: "search_logs",
  web_search: "web_search",
  python_interpreter: "python_interpreter",
  sql_query_executor: "sql_query_executor",
};

const EVENT_CATEGORY_LABELS: Record<string, string> = {
  agent: "Agent 事件",
  execution_control: "执行控制",
  input: "输入检查",
  lynx_check: "检查任务",
  pii_redaction: "敏感数据",
  prompt_injection: "提示注入",
  tool: "工具事件",
};

const HOOK_LABELS: Record<string, string> = {
  before_agent_start: "Agent 启动前",
  before_tool_call: "工具调用前",
  before_message_write: "消息写入前",
  message_received: "消息接收",
  message_sending: "消息发送",
};

function humanizeIdentifier(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function resolveActionTone(value: string | undefined): StatusBadgeProps["tone"] {
  if (value === "block" || value === "deny") {
    return "danger";
  }
  if (value === "redact" || value === "requireApproval" || value === "require_approval" || value === "warn") {
    return "warning";
  }
  if (value === "allow" || value === "log_only") {
    return "success";
  }
  return "neutral";
}

export function getDecisionTone(input: {
  block?: boolean;
  riskLevel?: "L0" | "L1" | "L2" | "L3" | "L4";
  action?: string;
  enforcementAction?: string;
  eventSeverity?: "info" | "warn" | "error" | "critical";
  requiresApproval?: boolean;
  degraded?: boolean;
}): "default" | "processing" | "warning" | "error" {
  const action = input.action;
  const enforcementAction = input.enforcementAction;

  if (
    input.block
    || input.eventSeverity === "critical"
    || input.riskLevel === "L4"
    || action === "deny"
    || enforcementAction === "deny"
  ) {
    return "error";
  }

  if (input.eventSeverity === "error" || action === "block" || enforcementAction === "block") {
    return "error";
  }

  if (
    input.eventSeverity === "warn"
    || input.riskLevel === "L2"
    || input.riskLevel === "L3"
    || input.requiresApproval
    || input.degraded
    || action === "require_approval"
    || action === "requireApproval"
    || action === "redact"
    || action === "warn"
    || enforcementAction === "require_approval"
    || enforcementAction === "requireApproval"
    || enforcementAction === "redact"
    || enforcementAction === "warn"
  ) {
    return "warning";
  }

  if (input.riskLevel === "L1" || action === "log_only" || enforcementAction === "logOnly" || enforcementAction === "log_only") {
    return "processing";
  }

  return "default";
}

function resolvePolicyTone(
  policyDecision: string | undefined,
  fallbackAction: string | undefined,
): StatusBadgeProps["tone"] {
  const value = `${policyDecision ?? ""} ${fallbackAction ?? ""}`.toLowerCase();

  if (/\b(block|deny|denied|reject|rejected|refuse|refused)\b/.test(value)) {
    return "danger";
  }
  if (/\b(confirm|approval|review|require|warn|warning)\b/.test(value)) {
    return "warning";
  }
  if (/\b(redact|mask|sanitize|sensitive)\b/.test(value)) {
    return "info";
  }
  if (/\b(allow|pass|deliver|log)\b/.test(value)) {
    return "success";
  }

  return resolveActionTone(fallbackAction);
}

export function formatActionLabel(value: string | undefined) {
  if (!value) {
    return "未知";
  }

  return ACTION_LABELS[value] ?? humanizeIdentifier(value);
}

export function formatActionText(value: string | undefined) {
  if (!value) {
    return "暂无动作";
  }

  return ACTION_TEXT_LABELS[value] ?? humanizeIdentifier(value);
}

export function formatPolicyDecisionLabel(value: string | undefined, fallbackAction?: string) {
  if (value) {
    return POLICY_DECISION_LABELS[value] ?? humanizeIdentifier(value);
  }

  return formatActionLabel(fallbackAction);
}

export function formatStateLabel(value: string | undefined) {
  if (!value) {
    return "未知";
  }

  return STATE_LABELS[value] ?? humanizeIdentifier(value);
}

export function formatDomainLabel(value: string | undefined) {
  if (!value) {
    return "暂无";
  }

  return CHANNEL_LABELS[value] ?? value;
}

export function formatChannelLabel(value: string | undefined) {
  return formatDomainLabel(value);
}

export function formatEventCategoryLabel(value: string | undefined) {
  if (!value) {
    return "未分类";
  }

  return EVENT_CATEGORY_LABELS[value] ?? humanizeIdentifier(value);
}

export function formatHookLabel(value: string | undefined) {
  if (!value) {
    return "暂无";
  }

  return HOOK_LABELS[value] ?? humanizeIdentifier(value);
}

export function formatToolLabel(value: string | undefined) {
  if (!value) {
    return "unknown_tool";
  }

  return TOOL_LABELS[value] ?? value;
}

export function renderRiskBadge(value: string | undefined) {
  const labels: Record<string, string> = {
    L0: "L0 基础",
    L1: "L1 关注",
    L2: "L2 中危",
    L3: "L3 高危",
    L4: "L4 严重",
  };
  const tone = value === "L4"
    ? "danger"
    : value === "L3" || value === "L2"
      ? "warning"
      : value === "L0"
        ? "success"
        : "info";

  return <StatusBadge label={labels[value ?? "L0"] ?? value ?? "L0 基础"} tone={tone} />;
}

export function renderActionBadge(value: string | undefined) {
  return <StatusBadge label={formatActionLabel(value)} tone={resolveActionTone(value)} />;
}

export function renderPolicyDecisionBadge(
  policyDecision: string | undefined,
  fallbackAction?: string,
) {
  return (
    <StatusBadge
      label={formatPolicyDecisionLabel(policyDecision, fallbackAction)}
      tone={resolvePolicyTone(policyDecision, fallbackAction)}
    />
  );
}

export function renderStateBadge(value: string | undefined) {
  const tone = value === "approved" || value === "completed" || value === "success"
    ? "success"
    : value === "pending" || value === "running" || value === "paused"
      ? "info"
      : value === "failed" || value === "blocked"
        ? "danger"
        : "neutral";

  return <StatusBadge label={formatStateLabel(value)} tone={tone} />;
}
