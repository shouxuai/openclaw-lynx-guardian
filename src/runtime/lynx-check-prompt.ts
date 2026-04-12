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
    "你的角色不是重新执行审计，而是把下面已经得到的审计结果整理成最终发给用户的中文 Markdown 报告。",
    "不要调度 lynx-guardian-check-orchestrator，不要重新分派旧技能，不要要求再次授权，不要输出 BLOCKED、Approve with、allow-once、allow-always。",
    "不要把回复写成执行状态、权限申请、调度过程、运行日志或内部实现说明；重点要把风险、影响、证据、优先级和整改动作说清楚。",
    "如果某个章节证据不足，也必须保留该章节，并明确写出“未能采集”或“需要进一步复核”，不要省略章节。",
    "报告需要详细、自然、专业、可转发，适合 OpenClaw 用户在聊天会话里直接阅读，而不是只看一个短摘要。",
  ];
}

function buildChannelInstructions(channel: LynxReportChannel): string[] {
  if (channel === "feishu") {
    return [
      "输出渠道偏向 Feishu：首屏先用 3 个短段落交代总体评级、最高优先级风险、立即整改动作，然后继续完整展开 Markdown 正文。",
      "首屏速览要利于转发和快速决策，但不要牺牲报告正文，不要把完整报告压缩成短摘要。",
    ];
  }

  if (channel === "webchat") {
    return [
      "输出渠道偏向 WebChat：保持 Markdown 标题、分段、列表和表格清晰，适合聊天窗口连续滚动阅读。",
      "开头仍然要先给总体结论，但不要只给一句话结论后就结束。",
    ];
  }

  return [
    "输出渠道未知：优先保证 Markdown 结构完整、章节齐全、重点风险明确，并保持长文阅读体验。",
  ];
}

export function buildManualLynxCheckPrompt(input: BuildLynxCheckPromptInput): string {
  return [
    ...buildSharedInstructions(input),
    "这是手动触发的 /lynx-check：可以直接面向当前用户回复，避免解释内部执行过程。",
    "把这次回复当成用户正在等待的正式审计报告，而不是后台任务说明。",
    ...buildChannelInstructions(input.channel),
    "",
    input.reportMarkdown,
  ].join("\n");
}

export function buildScheduledLynxCheckPrompt(input: BuildLynxCheckPromptInput): string {
  return [
    ...buildSharedInstructions(input),
    "这是定时触发的 /lynx-check：重点是把完整报告发给用户，不是回报任务状态，也不要退化成执行状态简讯。",
    "如果没有新的高危发现，也要输出完整报告，说明当前态势、残留风险、复核点和整改建议，而不是只回复“正常”或“已完成”。",
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
