import { getLynxCheckRunReportPath, getLynxCheckRunResultPath } from "./lynx-check-run-store.js";

export interface BuildLynxCheckExecutionPromptOptions {
  requestId: string;
  source: "manual" | "scheduled";
  preferredTargetKind: "current" | "recent";
  skillPath: string;
  auditSkillPath: string;
  discoverySkillPath: string;
}

export function buildLynxCheckExecutionPrompt(
  options: BuildLynxCheckExecutionPromptOptions,
): string {
  const reportPath = getLynxCheckRunReportPath(options.requestId);
  const resultPath = getLynxCheckRunResultPath(options.requestId);

  return [
    "[系统指令] Managed Lynx Guardian /lynx-check run. Execution Dispatch Mode.",
    `requestId: ${options.requestId}`,
    `source: ${options.source}`,
    `preferredTargetKind: ${options.preferredTargetKind}`,
    `skillEntry: ${options.skillPath}`,
    "You must route execution through lynx-guardian-check-orchestrator and treat it as the primary orchestrator entrypoint.",
    "Legacy references to lynx-guardian-daily-lynx-check still follow the same contract.",
    `Use the exact audit skill file at ${options.auditSkillPath}.`,
    `Use the exact discovery skill file at ${options.discoverySkillPath}.`,
    "Dispatch the audit work to SX-security-audit.",
    "Dispatch the discovery work to SX-openclaw-discovery.",
    "Do not scan for alternate skill locations with exec, find, ls, or glob patterns.",
    `Assemble one markdown report and write it to ${reportPath}.`,
    "Attempt to send that report as a new message using the current channel binding / shared message sender semantics when available.",
    "Do not tell the user to inspect local files or report paths.",
    "If you send a message yourself, send the full report body in chat.",
    `After the send attempt, write ${resultPath} with requestId, status, sendAttempted, sendSucceeded, transport, reportPath, errorMessage, and completedAtMs.`,
    "status must be one of: not_started, running, completed, failed.",
    "Do not claim the report was sent unless the send actually succeeded.",
    "If sending fails, record the failure honestly so the plugin can fallback-deliver the stored report.",
  ].join("\n");
}

export function buildLynxCheckFallbackFailureNotice(requestId: string): string {
  return [
    "Lynx Guardian /lynx-check 已完成执行，但报告未能由技能直接送达。",
    `requestId: ${requestId}`,
    "插件已尝试在当前会话补发完整结果；如果这条消息仍不是完整报告，请直接重新发送 /lynx-check 以再次回传。",
  ].join("\n");
}
