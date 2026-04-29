import { describe, expect, it } from "vitest";

import {
  appendLocalConsoleWebviewFootnote,
  appendLocalConsoleWebviewFootnoteForL4Reply,
  buildLocalConsoleWebviewFootnote,
  buildLocalConsoleWebviewUrl,
  shouldAppendLocalConsoleWebviewFootnoteForL4Reply,
} from "../src/runtime/local-console-webview-note.js";

describe("local console webview note", () => {
  it("builds the local gateway webview URL", () => {
    expect(buildLocalConsoleWebviewUrl()).toBe("http://127.0.0.1:18789/webview");
  });

  it("appends a separated footnote-style local log note", () => {
    const text = appendLocalConsoleWebviewFootnote("主体消息");

    expect(text).toBe([
      "主体消息",
      "",
      "---",
      "[^lynx-log]: 本地日志页面 Webview：<http://127.0.0.1:18789/webview>。这里汇总 Lynx Guardian 记录的审计日志、工具调用、审批和 /lynx-check 结果，可用于追踪本次安全事件。",
    ].join("\n"));
  });

  it("does not duplicate an existing footnote", () => {
    const withNote = `主体消息\n\n${buildLocalConsoleWebviewFootnote()}`;

    expect(appendLocalConsoleWebviewFootnote(withNote)).toBe(withNote);
  });

  it("recognizes Lynx Guardian L4 denial replies that need the footnote", () => {
    const denial = "**已拒绝** — Lynx Guardian L4 级拦截。";

    expect(shouldAppendLocalConsoleWebviewFootnoteForL4Reply(denial)).toBe(true);
    expect(shouldAppendLocalConsoleWebviewFootnoteForL4Reply("普通 L4 说明文本")).toBe(false);
  });

  it("appends the footnote to Lynx Guardian L4 denial replies", () => {
    const denial = "**已拒绝** — Lynx Guardian L4 级拦截。";
    const text = appendLocalConsoleWebviewFootnoteForL4Reply(denial);

    expect(text).toContain(denial);
    expect(text).toContain("\n---\n");
    expect(text).toContain("[^lynx-log]");
  });
});
