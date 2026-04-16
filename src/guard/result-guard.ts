import { guardOutput, type GuardDecision } from "./safety-guard.js";
import { SensitiveDataBlocker } from "./sensitive.js";
import { createReplacementMessage, extractMessageText } from "../runtime/plugin-runtime-helpers.js";

export type OutputEnforcementMode = "warn" | "redact" | "block";

export interface ResultGuardOptions {
  trustedManagedLynxCheckPersistence?: boolean;
  trustedManagedLynxCheckOutput?: boolean;
  enforcementMode?: OutputEnforcementMode;
}

export interface ResultGuardDecision {
  block: boolean;
  message: any;
  warning?: string;
}

export interface TextGuardDecision {
  changed: boolean;
  content: string;
  warning?: string;
}

interface DirectProtectedResultPattern {
  label: string;
  regex: RegExp;
}

const DIRECT_PROTECTED_RESULT_PATTERNS: DirectProtectedResultPattern[] = [
  { label: "unix_passwd_entry", regex: /(^|\n)root:[^:\n]*:\d+:\d+:/i },
  { label: "private_key", regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
];

const redactableOutputModules = new Set([
  "M5:secrets_in_output",
  "M5:pii_in_output",
]);

const sensitiveDataBlocker = new SensitiveDataBlocker();

function resolveOutputEnforcementMode(options?: ResultGuardOptions): OutputEnforcementMode {
  return options?.enforcementMode ?? "block";
}

function detectDirectProtectedResults(text: string): string[] {
  return DIRECT_PROTECTED_RESULT_PATTERNS
    .filter(({ regex }) => regex.test(text))
    .map(({ label }) => label);
}

function formatDiagnosticReason(guardDecision: GuardDecision): string {
  const description = guardDecision.riskAssessment.description?.trim();
  if (description && !/output_safe|杈撳嚭瀹夊叏/i.test(description)) {
    return description;
  }
  const modules = guardDecision.riskAssessment.modules;
  return modules.length > 0 ? modules.join(",") : "protected_output";
}

function buildDiagnosticMessage(args: {
  subject: string;
  enforcementMode: OutputEnforcementMode;
  modules: string[];
  level: string;
  score: number;
  reason: string;
  toolName?: string;
}): string {
  const parts = [
    `[Lynx Guardian] ${args.subject} intercepted by security guard`,
    `mode=${args.enforcementMode}`,
  ];
  if (args.toolName) {
    parts.push(`tool=${args.toolName}`);
  }
  parts.push(`modules=${args.modules.join(",") || "none"}`);
  parts.push(`level=${args.level}`);
  parts.push(`score=${args.score}`);
  parts.push(`reason=${args.reason}`);
  return parts.join(" | ");
}

function canLocallyRedact(guardDecision: GuardDecision): boolean {
  const modules = guardDecision.riskAssessment.modules;
  return modules.length > 0 && modules.every((moduleId) => redactableOutputModules.has(moduleId));
}

function applyEnforcementToText(
  text: string,
  guardDecision: GuardDecision,
  subject: string,
  options?: ResultGuardOptions,
  extra?: {
    toolName?: string;
  },
): TextGuardDecision {
  const enforcementMode = resolveOutputEnforcementMode(options);
  const diagnostic = buildDiagnosticMessage({
    subject,
    enforcementMode,
    modules: guardDecision.riskAssessment.modules,
    level: guardDecision.riskAssessment.level,
    score: guardDecision.riskAssessment.score,
    reason: formatDiagnosticReason(guardDecision),
    toolName: extra?.toolName,
  });

  if (enforcementMode === "warn") {
    return {
      changed: false,
      content: text,
      warning: diagnostic,
    };
  }

  if (enforcementMode === "redact" && canLocallyRedact(guardDecision)) {
    const redaction = sensitiveDataBlocker.redactSensitiveData(text, {
      includePersonalFinancial: true,
    });
    if (redaction.changed) {
      return {
        changed: true,
        content: redaction.text,
        warning: diagnostic,
      };
    }
  }

  return {
    changed: true,
    content: diagnostic,
    warning: diagnostic,
  };
}

function applyDirectResultEnforcement(
  text: string,
  directMatches: string[],
  subject: string,
  options?: ResultGuardOptions,
  extra?: {
    toolName?: string;
  },
): TextGuardDecision {
  const enforcementMode = resolveOutputEnforcementMode(options);
  const diagnostic = buildDiagnosticMessage({
    subject,
    enforcementMode,
    modules: directMatches.map((match) => `direct:${match}`),
    level: "L4",
    score: 10,
    reason: `direct_protected_result(${directMatches.join(",")})`,
    toolName: extra?.toolName,
  });

  if (enforcementMode === "warn") {
    return {
      changed: false,
      content: text,
      warning: diagnostic,
    };
  }

  return {
    changed: true,
    content: diagnostic,
    warning: diagnostic,
  };
}

export function guardOutputText(
  text: string,
  sessionKey?: string,
  options?: ResultGuardOptions,
  extra?: {
    subject?: string;
    toolName?: string;
  },
): TextGuardDecision {
  if (!text) {
    return {
      changed: false,
      content: text,
    };
  }

  const decision = guardOutput(text, sessionKey, options);
  if (!decision.block) {
    return {
      changed: false,
      content: text,
      warning: decision.warning,
    };
  }

  return applyEnforcementToText(
    text,
    decision,
    extra?.subject ?? "assistant output",
    options,
    { toolName: extra?.toolName },
  );
}

export function guardToolResultPersistence(
  toolName: string | undefined,
  message: any,
  options?: ResultGuardOptions,
): ResultGuardDecision {
  if (options?.trustedManagedLynxCheckPersistence === true) {
    return { block: false, message };
  }

  const text = extractMessageText(message);
  if (!text) {
    return { block: false, message };
  }

  const directMatches = detectDirectProtectedResults(text);
  if (directMatches.length > 0) {
    const enforcement = applyDirectResultEnforcement(
      text,
      directMatches,
      "tool result",
      options,
      { toolName: toolName ?? "tool" },
    );
    return {
      block: enforcement.changed,
      message: enforcement.changed ? createReplacementMessage(message, enforcement.content) : message,
      warning: enforcement.warning,
    };
  }

  const enforcement = guardOutputText(text, undefined, options, {
    subject: "tool result",
    toolName: toolName ?? "tool",
  });

  return {
    block: enforcement.changed,
    message: enforcement.changed ? createReplacementMessage(message, enforcement.content) : message,
    warning: enforcement.warning,
  };
}

export function guardAssistantPersistence(
  message: any,
  options?: ResultGuardOptions,
): ResultGuardDecision {
  if (options?.trustedManagedLynxCheckPersistence === true) {
    return { block: false, message };
  }

  const text = extractMessageText(message);
  if (!text) {
    return { block: false, message };
  }

  const enforcement = guardOutputText(text, undefined, options, {
    subject: "assistant output",
  });

  return {
    block: enforcement.changed,
    message: enforcement.changed ? createReplacementMessage(message, enforcement.content) : message,
    warning: enforcement.warning,
  };
}
