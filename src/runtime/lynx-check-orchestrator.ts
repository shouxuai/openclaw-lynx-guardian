export interface BuildLynxCheckExecutionPromptOptions {
  requestId: string;
  source: "manual" | "scheduled";
  preferredTargetKind: "current" | "recent";
  skillPath: string;
}

export function buildLynxCheckExecutionPrompt(
  options: BuildLynxCheckExecutionPromptOptions,
): string {
  const reportPath = `.openclaw/lynx/check-runs/${options.requestId}.report.md`;
  const resultPath = `.openclaw/lynx/check-runs/${options.requestId}.result.json`;

  return [
    "[系统指令] Managed Lynx Guardian /lynx-check run. Execution Dispatch Mode.",
    `requestId: ${options.requestId}`,
    `source: ${options.source}`,
    `preferredTargetKind: ${options.preferredTargetKind}`,
    `skillEntry: ${options.skillPath}`,
    "You must route execution through lynx-guardian-daily-lynx-check and treat it as the orchestrator entrypoint.",
    "Dispatch the audit work to SX-security-audit.",
    "Dispatch the discovery work to SX-openclaw-discovery.",
    `Assemble one markdown report and write it to ${reportPath}.`,
    "Attempt to send that report as a new message using the current channel binding / shared message sender semantics when available.",
    `After the send attempt, write ${resultPath} with requestId, status, sendAttempted, sendSucceeded, transport, reportPath, errorMessage, and completedAtMs.`,
    "Do not claim the report was sent unless the send actually succeeded.",
    "If sending fails, record the failure honestly so the plugin can fallback-deliver the stored report.",
  ].join("\n");
}

export function buildLynxCheckFallbackFailureNotice(requestId: string): string {
  return [
    "Lynx Guardian /lynx-check 已完成执行，但报告未能由技能直接送达。",
    `requestId: ${requestId}`,
    "插件已尝试补发；若仍未看到完整报告，请检查 .openclaw/lynx/check-runs 下的结果文件。",
  ].join("\n");
}
