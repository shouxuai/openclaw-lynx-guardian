export type LynxReportChannel = "webchat" | "feishu" | "generic";

interface BuildLynxCheckPromptInput {
  requestId: string;
  reportMarkdown: string;
  channel: LynxReportChannel;
}

function buildSharedInstructions(input: BuildLynxCheckPromptInput): string[] {
  return [
    `[系统指令] 这是一次由 Lynx Guardian 预计算完成的 /lynx-check。requestId=${input.requestId}`,
    "请直接使用中文回复完整审计报告，不要让用户查看文件路径，不要提及 report.md、result.json 或本地工件。",
    "不要调度 lynx-guardian-check-orchestrator，不要要求再次授权，不要输出 BLOCKED、Approve with、allow-once、allow-always。",
    "你的任务是理解下面这份预计算审计报告，并以自然、专业、完整的中文直接回复给用户。",
    "如果某个章节证据不足，也必须保留该章节，并明确写出“未能采集”或“需要进一步复核”，不要省略章节。",
  ];
}

function buildChannelInstructions(channel: LynxReportChannel): string[] {
  if (channel === "feishu") {
    return [
      "输出渠道偏向 Feishu：首屏先给出总体评级、最高优先级风险和立即整改动作，然后继续完整展开 Markdown 正文。",
      "适合转发阅读，但不要把完整报告压缩成短摘要。",
    ];
  }

  if (channel === "webchat") {
    return [
      "输出渠道偏向 WebChat：保持 Markdown 标题、分段和表格可读性，适合连续滚动阅读。",
    ];
  }

  return [
    "输出渠道未知：优先保证 Markdown 结构完整、章节齐全、结论明确。",
  ];
}

export function buildManualLynxCheckPrompt(input: BuildLynxCheckPromptInput): string {
  return [
    ...buildSharedInstructions(input),
    "这是手动触发的 /lynx-check：可以直接面向当前用户回复，避免解释内部执行过程。",
    ...buildChannelInstructions(input.channel),
    "",
    input.reportMarkdown,
  ].join("\n");
}

export function buildScheduledLynxCheckPrompt(input: BuildLynxCheckPromptInput): string {
  return [
    ...buildSharedInstructions(input),
    "这是定时触发的 /lynx-check：优先保证报告完整性、章节完整性和行动建议完整性，不要退化成执行状态简讯。",
    "如果没有新的高危发现，也要输出完整报告，而不是只回复“正常”或“已完成”。",
    ...buildChannelInstructions(input.channel),
    "",
    input.reportMarkdown,
  ].join("\n");
}

export function buildLynxCheckFallbackFailureNotice(requestId: string): string {
  return [
    "Lynx Guardian /lynx-check 已完成预计算，但报告未能通过预期链路成功送达。",
    `requestId: ${requestId}`,
    "插件会继续优先补发完整中文审计报告；如果这条消息仍不是完整报告，请直接重新发送 /lynx-check 触发回传。",
  ].join("\n");
}
