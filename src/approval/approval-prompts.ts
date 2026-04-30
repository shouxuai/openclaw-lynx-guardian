import { appendLocalConsoleWebviewFootnote } from "../console/runtime.js";
import { normalizeString } from "../runtime/plugin-runtime-helpers.js";

export const NATIVE_APPROVAL_DESCRIPTION_MAX_LENGTH = 256;

export function compactApprovalText(value: string, maxLength: number): string {
  if (maxLength <= 0) {
    return "";
  }

  const normalized = normalizeString(value).replace(/\s+/g, " ");
  if (normalized.length <= maxLength) {
    return normalized;
  }

  if (maxLength === 1) {
    return "…";
  }

  const contentBudget = maxLength - 1;
  let result = "";
  for (const char of normalized) {
    if (result.length + char.length > contentBudget) {
      break;
    }
    result += char;
  }

  return `${result.trimEnd()}…`;
}

export function compactNativeApprovalDescription(
  value: string,
  maxLength: number = NATIVE_APPROVAL_DESCRIPTION_MAX_LENGTH,
): string {
  const withoutLocalConsoleFootnote = normalizeString(value)
    .replace(/\r\n/g, "\n")
    .replace(/\n*\s*---\s*\n\s*\[\^lynx-log\]:[\s\S]*$/i, "")
    .replace(/\[\^lynx-log\]:[^\n]*(?:\n|$)/gi, " ")
    .replace(/https?:\/\/[^\s<>]*\/webview[^\s<>]*/gi, "")
    .replace(/\bwebview\b|\blocal[-\s]?console\b|本地日志页面|控制台/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  return compactApprovalText(withoutLocalConsoleFootnote, maxLength);
}

export function resolveToolApprovalProtectedTargetSummary(
  toolName: string,
  params: Record<string, any> | undefined,
): string {
  const rawPath = normalizeString(params?.file_path ?? params?.path);
  if (rawPath) {
    return rawPath.replace(/\s+/g, " ");
  }

  const command = normalizeString(params?.command);
  if (command) {
    return command.replace(/\s+/g, " ");
  }

  return buildApprovalParamSummary(toolName, params ?? {}).replace(/\s+/g, " ");
}

export function extractApproveCommand(text: string): {
  approvalId: string;
  allowDecision?: string;
  denyDecision?: string;
} | null {
  const match = normalizeString(text).match(
    /\/approve\s+([a-z0-9-]+)\s+([a-z-]+(?:\|[a-z-]+)*)/i,
  );
  if (!match) {
    return null;
  }

  const approvalId = match[1];
  const allowedDecisions = match[2]
    .split("|")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  return {
    approvalId,
    allowDecision: allowedDecisions.find((value) => value === "allow-once")
      ?? allowedDecisions.find((value) => value.startsWith("allow-")),
    denyDecision: allowedDecisions.find((value) => value === "deny"),
  };
}

export function appendFeishuNativeApprovalGuidance(text: string): string {
  if (
    text.includes("请在 Feishu 会话回复或webchat中进行审批")
    || text.includes("请直接在当前飞书会话回复")
  ) {
    return text;
  }

  const approveCommand = extractApproveCommand(text);
  if (!approveCommand) {
    return text;
  }

  const lines = [
    text.trimEnd(),
    "",
    "飞书审批提示：",
    "请在 Feishu 会话回复或webchat中进行审批。",
    approveCommand.allowDecision
      ? `如在 Feishu 审批，请回复 \`/approve ${approveCommand.approvalId} ${approveCommand.allowDecision}\`。`
      : "",
    approveCommand.denyDecision
      ? `如需拒绝，回复 \`/approve ${approveCommand.approvalId} ${approveCommand.denyDecision}\`。`
      : "",
    "如在 webchat 审批，可直接在审批窗口中批准或拒绝。",
    "不要再使用 `/lynx-approve`。",
  ].filter(Boolean);

  return appendLocalConsoleWebviewFootnote(lines.join("\n"));
}

export function buildFeishuNativeToolApprovalReplyPrompt(params: {
  approvalId: string;
  module: string;
  riskLevel: string;
  toolName: string;
  timeoutMs: number;
  confirmationPhrase: string;
}): string {
  const timeoutSeconds = Math.max(1, Math.round(params.timeoutMs / 1000));
  const prompt = [
    `[Lynx Guardian] ${params.toolName} 已进入原生审批窗口。`,
    `模块: ${params.module}`,
    `风险: ${params.riskLevel}`,
    `请在 ${timeoutSeconds}s 内在 Feishu 会话回复或webchat中进行审批：`,
    `/approve ${params.approvalId} allow-once`,
    `/approve ${params.approvalId} deny`,
    `如果你之前习惯回复“${params.confirmationPhrase}”，本次请直接回复上面的 /approve 命令，或在 webchat 中完成审批。`,
    "如使用 Feishu，请直接回复上面的 /approve 命令。",
  ].join("\n");

  return params.riskLevel === "L3"
    ? appendLocalConsoleWebviewFootnote(prompt)
    : prompt;
}

function buildApprovalParamSummary(toolName: string, params: Record<string, any>): string {
  if (toolName === "exec") {
    return String(params?.command ?? "").slice(0, 120);
  }
  return String(params?.path ?? params?.file_path ?? JSON.stringify(params)).slice(0, 120);
}
