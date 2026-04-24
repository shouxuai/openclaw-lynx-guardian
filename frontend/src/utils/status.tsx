import { StatusBadge } from "../components/feedback/StatusBadge";

const ACTION_LABELS: Record<string, string> = {
  allow: "放行",
  warn: "告警",
  redact: "脱敏",
  requireApproval: "需审批",
  block: "阻断",
  logOnly: "仅记录",
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
};

const CHANNEL_LABELS: Record<string, string> = {
  feishu: "飞书",
  webchat: "网页会话",
  recent: "最近活跃",
  "recent-active": "最近活跃目标",
  current: "当前会话",
  direct: "直达",
  scheduled_lynx_check: "定时巡检",
  lynx_command: "手动指令",
};

const TOOL_LABELS: Record<string, string> = {
  move_files: "批量移动文件",
  read_file: "读取文件",
  search_logs: "检索日志",
};

const EVENT_CATEGORY_LABELS: Record<string, string> = {
  execution_control: "执行控制",
  pii_redaction: "隐私脱敏",
  prompt_injection: "提示注入",
  lynx_check: "巡检审计",
};

const HOOK_LABELS: Record<string, string> = {
  before_tool_call: "工具调用前",
  before_message_write: "消息写入前",
  message_received: "消息接收",
  message_sending: "消息发送",
};

export function formatActionLabel(value: string | undefined) {
  if (!value) {
    return "未知";
  }

  return ACTION_LABELS[value] ?? value;
}

export function formatStateLabel(value: string | undefined) {
  if (!value) {
    return "未知";
  }

  return STATE_LABELS[value] ?? value;
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

  return EVENT_CATEGORY_LABELS[value] ?? value;
}

export function formatHookLabel(value: string | undefined) {
  if (!value) {
    return "暂无";
  }

  return HOOK_LABELS[value] ?? value;
}

export function formatToolLabel(value: string | undefined) {
  if (!value) {
    return "未知工具";
  }

  return TOOL_LABELS[value] ?? value;
}

export function renderRiskBadge(value: string | undefined) {
  const tone = value === "L4"
    ? "danger"
    : value === "L3"
      ? "warning"
      : value === "L2"
        ? "info"
        : "neutral";

  return <StatusBadge label={value ?? "L0"} tone={tone} />;
}

export function renderActionBadge(value: string | undefined) {
  const tone = value === "block"
    ? "danger"
    : value === "redact" || value === "requireApproval"
      ? "warning"
      : value === "allow"
        ? "success"
        : "neutral";

  return <StatusBadge label={formatActionLabel(value)} tone={tone} />;
}

export function renderStateBadge(value: string | undefined) {
  const tone = value === "approved" || value === "completed" || value === "success"
    ? "success"
    : value === "pending" || value === "running" || value === "paused"
      ? "warning"
      : value === "failed" || value === "blocked"
        ? "danger"
        : "neutral";

  return <StatusBadge label={formatStateLabel(value)} tone={tone} />;
}
