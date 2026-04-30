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
