const DEFAULT_LOCAL_CONSOLE_WEBVIEW_URL = "http://127.0.0.1:18789/webview";
const LOCAL_CONSOLE_WEBVIEW_NOTE_MARKER = "[^lynx-log]";
const LYNX_GUARDIAN_L4_REPLY_PATTERNS = [
  /Lynx Guardian/i,
  /\bL4\b|L4\s*级|最高(?:等级|级别)?安全(?:拒绝|拦截|级别)?/,
  /拦截|拒绝|已拒绝|安全拒绝|blocked|denied|denial|intercepted/i,
];

export function buildLocalConsoleWebviewUrl(options: {
  host?: string;
  port?: number;
} = {}): string {
  const host = options.host?.trim() || "127.0.0.1";
  const port = Number.isFinite(options.port) && options.port ? Math.trunc(options.port) : 18789;
  return `http://${host}:${port}/webview`;
}

export function buildLocalConsoleWebviewFootnote(options: {
  url?: string;
} = {}): string {
  const url = options.url?.trim() || DEFAULT_LOCAL_CONSOLE_WEBVIEW_URL;
  return [
    "---",
    `${LOCAL_CONSOLE_WEBVIEW_NOTE_MARKER}: 本地日志页面 Webview：<${url}>。这里汇总 Lynx Guardian 记录的审计日志、工具调用、审批和 /lynx-check 结果，可用于追踪本次安全事件。`,
  ].join("\n");
}

export function appendLocalConsoleWebviewFootnote(
  content: string,
  options: { url?: string } = {},
): string {
  const base = content.trimEnd();
  if (!base || base.includes(LOCAL_CONSOLE_WEBVIEW_NOTE_MARKER)) {
    return base;
  }

  return `${base}\n\n${buildLocalConsoleWebviewFootnote(options)}`;
}

export function shouldAppendLocalConsoleWebviewFootnoteForL4Reply(content: string): boolean {
  const text = content.trim();
  if (!text || text.includes(LOCAL_CONSOLE_WEBVIEW_NOTE_MARKER)) {
    return false;
  }

  return LYNX_GUARDIAN_L4_REPLY_PATTERNS.every((pattern) => pattern.test(text));
}

export function appendLocalConsoleWebviewFootnoteForL4Reply(content: string): string {
  return shouldAppendLocalConsoleWebviewFootnoteForL4Reply(content)
    ? appendLocalConsoleWebviewFootnote(content)
    : content.trimEnd();
}
