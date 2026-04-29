import { describe, expect, it } from "vitest";

import {
  buildManualLynxCheckPrompt,
  buildScheduledLynxCheckPrompt,
} from "../src/lynx-check/prompt.js";

describe("lynx-check prompt", () => {
  const reportMarkdown = [
    "# 🛡️ OpenClaw 全方位安全审计报告",
    "",
    "## 一、执行摘要",
    "- ok",
    "",
    "## 八、优先级整改建议",
    "1. fix",
    "",
    "---",
    "[^lynx-log]: 本地日志页面 Webview：<http://127.0.0.1:18789/webview>。这里汇总 Lynx Guardian 记录的审计日志、工具调用、审批和 /lynx-check 结果，可用于追踪本次安全事件。",
  ].join("\n");

  it("tells manual /lynx-check replies to preserve the local log webview footnote", () => {
    const prompt = buildManualLynxCheckPrompt({
      requestId: "manual-prompt",
      reportMarkdown,
      channel: "webchat",
    });

    expect(prompt).toContain("`[^lynx-log]` 本地日志 Webview 脚注");
    expect(prompt).toContain("必须原样保留在最终回复的最后");
    expect(prompt.endsWith(reportMarkdown)).toBe(true);
  });

  it("tells scheduled /lynx-check replies to preserve the local log webview footnote", () => {
    const prompt = buildScheduledLynxCheckPrompt({
      requestId: "scheduled-prompt",
      reportMarkdown,
      channel: "feishu",
    });

    expect(prompt).toContain("`[^lynx-log]` 本地日志 Webview 脚注");
    expect(prompt).toContain("不要改写成正文、列表、emoji 提示");
    expect(prompt.endsWith(reportMarkdown)).toBe(true);
  });
});
