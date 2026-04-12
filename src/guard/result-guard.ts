import { guardOutput } from "./safety-guard.js";
import { createReplacementMessage, extractMessageText } from "../runtime/plugin-runtime-helpers.js";

const PROTECTED_RESULT_PATTERNS: RegExp[] = [
  /(^|\n)root:[^:\n]*:\d+:\d+:/i,
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  /\baws_access_key_id\b/i,
  /\bgithub_pat_[a-zA-Z0-9_]{20,}\b/,
  /\bSOUL\.md\b|\bTOOLS\.md\b|\bSHIELD\.md\b/i,
];

function containsProtectedResult(text: string): boolean {
  return PROTECTED_RESULT_PATTERNS.some((pattern) => pattern.test(text));
}

export function guardToolResultPersistence(
  toolName: string | undefined,
  message: any,
  context?: {
    trustedManagedLynxCheckPersistence?: boolean;
  },
): {
  block: boolean;
  message: any;
} {
  if (context?.trustedManagedLynxCheckPersistence === true) {
    return { block: false, message };
  }

  const text = extractMessageText(message);
  if (!text) {
    return { block: false, message };
  }

  if (!containsProtectedResult(text) && !guardOutput(text, undefined, context).block) {
    return { block: false, message };
  }

  return {
    block: true,
    message: createReplacementMessage(
      message,
      `[Lynx Guardian] tool result replaced by security guard: ${toolName ?? "tool"} returned protected content`,
    ),
  };
}

export function guardAssistantPersistence(
  message: any,
  context?: {
    trustedManagedLynxCheckPersistence?: boolean;
  },
): {
  block: boolean;
  message: any;
} {
  if (context?.trustedManagedLynxCheckPersistence === true) {
    return { block: false, message };
  }

  const text = extractMessageText(message);
  if (!text) {
    return { block: false, message };
  }

  const decision = guardOutput(text, undefined, context);
  if (!decision.block) {
    return { block: false, message };
  }

  return {
    block: true,
    message: createReplacementMessage(
      message,
      "[Lynx Guardian] assistant output replaced by security guard: protected result leakage detected",
    ),
  };
}
