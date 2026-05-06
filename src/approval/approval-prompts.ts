import { appendLocalConsoleWebviewFootnote } from "../console/runtime.js";
import { normalizeString } from "../runtime/plugin-runtime-helpers.js";

export {
  compactApprovalText,
  compactNativeApprovalDescription,
  NATIVE_APPROVAL_DESCRIPTION_MAX_LENGTH,
} from "./native-approval-description.js";

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
  return text;
}

export function buildFeishuNativeToolApprovalReplyPrompt(params: {
  approvalId: string;
  module: string;
  riskLevel: string;
  toolName: string;
  timeoutMs: number;
}): string {
  const prompt = [
    `[Lynx Guardian] ${params.toolName} 已进入原生审批窗口。`,
    `模块: ${params.module}`,
    `风险: ${params.riskLevel}`,
    "请在系统审批窗口中批准或拒绝；Lynx 仅记录风险上下文，不再发送额外审批命令。",
    `审批上下文: ${params.approvalId}`,
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
