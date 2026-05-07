import { SensitiveDataBlocker } from "./sensitive-patterns.js";
import { createReplacementMessage, extractMessageText } from "../runtime/plugin-runtime-helpers.js";

export type OutputEnforcementMode = "warn" | "redact" | "block";
export type OutputSink =
  | "llm_output"
  | "agent_end"
  | "before_message_write"
  | "tool_result_persist"
  | "message_sending";

export interface ResultGuardOptions {
  sink?: OutputSink;
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

export interface LocalOutputRiskAssessment {
  level: string;
  score: number;
  modules: string[];
  description?: string;
}

export interface LocalOutputGuardDecision {
  block: boolean;
  warning?: string;
  riskAssessment: LocalOutputRiskAssessment;
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
const CORE_PROMPT_FILE_PATTERN = /\b(?:SOUL|IDENTITY|USER|AGENTS|TOOLS|SHIELD|MEMORY|SKILL)\.md\b/i;
const RAW_PROMPT_LEAK_PATTERN =
  /\b(?:raw|verbatim|full|complete|dump|secret|hidden|content\s+(?:says|follows)|exact\s+text|paste\s+the\s+contents?|internal\s+tool\s+boundaries)\b/i;
const METADATA_ONLY_PROMPT_PATTERN =
  /\b(?:summary|overview|metadata|description|version|current\s+path|guidance|摘要|概述)\b/i;
const OPENCLAW_MEMORY_SESSION_PATTERN =
  /(?:\.openclaw[\\/]memory[\\/]|\.openclaw[\\/]agents[\\/][^\\/]+[\\/]sessions[\\/]|openclaw-memory|"scope"\s*:\s*"openclaw-memory")/i;

function resolveOutputEnforcementMode(options?: ResultGuardOptions): OutputEnforcementMode {
  return options?.enforcementMode ?? "block";
}

function detectDirectProtectedResults(text: string): string[] {
  return DIRECT_PROTECTED_RESULT_PATTERNS
    .filter(({ regex }) => regex.test(text))
    .map(({ label }) => label);
}

function formatDiagnosticReason(guardDecision: LocalOutputGuardDecision): string {
  const description = guardDecision.riskAssessment.description?.trim();
  if (description && !/output_safe|输出安全/i.test(description)) {
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

function canLocallyRedact(guardDecision: LocalOutputGuardDecision): boolean {
  const modules = guardDecision.riskAssessment.modules;
  return modules.length > 0 && modules.every((moduleId) => redactableOutputModules.has(moduleId));
}

function applyEnforcementToText(
  text: string,
  guardDecision: LocalOutputGuardDecision,
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

function applyHighConfidenceRedactions(
  text: string,
  subject: string,
  options?: ResultGuardOptions,
  extra?: {
    toolName?: string;
  },
): TextGuardDecision | undefined {
  const redaction = sensitiveDataBlocker.redactSensitiveData(text, {
    includePersonalFinancial: true,
  });
  if (!redaction.changed) {
    return undefined;
  }

  const modules = Array.from(new Set(redaction.matches.map((match) =>
    match.type === "cn_resident_id" || match.type === "bank_card"
      ? "M5:pii_in_output"
      : "M5:secrets_in_output",
  )));
  const diagnostic = buildDiagnosticMessage({
    subject,
    enforcementMode: resolveOutputEnforcementMode(options),
    modules,
    level: "L3",
    score: 6,
    reason: modules.join(","),
    toolName: extra?.toolName,
  });

  return {
    changed: true,
    content: redaction.text,
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

  const directMatches = detectDirectProtectedResults(text);
  if (directMatches.length > 0) {
    return applyDirectResultEnforcement(
      text,
      directMatches,
      extra?.subject ?? "assistant output",
      options,
      { toolName: extra?.toolName },
    );
  }

  const localRedaction = applyHighConfidenceRedactions(
    text,
    extra?.subject ?? "assistant output",
    options,
    { toolName: extra?.toolName },
  );
  if (localRedaction) {
    return localRedaction;
  }

  const decision = evaluateLocalOutputProtection(text, sessionKey, options);
  return enforceGuardDecisionText(
    text,
    decision,
    options,
    extra,
  );
}

export function enforceGuardDecisionText(
  text: string,
  decision: Pick<LocalOutputGuardDecision, "block" | "warning" | "riskAssessment">,
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

function evaluateLocalOutputProtection(
  text: string,
  sessionKey?: string,
  options?: ResultGuardOptions,
): LocalOutputGuardDecision {
  void sessionKey;
  void options;

  if (OPENCLAW_MEMORY_SESSION_PATTERN.test(text)) {
    return {
      block: true,
      warning: "L4 OpenClaw memory or session content leak",
      riskAssessment: {
        level: "L4",
        score: 9,
        modules: ["M2:memory_session_privacy"],
        description: "OpenClaw memory or session content appears in persisted output",
      },
    };
  }

  if (CORE_PROMPT_FILE_PATTERN.test(text)) {
    const label = protectedPromptLabel(text);
    if (RAW_PROMPT_LEAK_PATTERN.test(text) && !METADATA_ONLY_PROMPT_PATTERN.test(text)) {
      return {
        block: true,
        warning: `L3 system prompt leak(${label})`,
        riskAssessment: {
          level: "L3",
          score: 7,
          modules: ["M2:system_prompt_leak"],
          description: `系统提示泄露(${label})`,
        },
      };
    }

    return {
      block: false,
      warning: `L2 系统提示泄露(${label})`,
      riskAssessment: {
        level: "L2",
        score: 3,
        modules: ["M2:system_prompt_leak"],
        description: `系统提示泄露(${label})`,
      },
    };
  }

  return {
    block: false,
    riskAssessment: {
      level: "L0",
      score: 0,
      modules: [],
      description: "output_safe",
    },
  };
}

function protectedPromptLabel(text: string): string {
  const match = CORE_PROMPT_FILE_PATTERN.exec(text);
  return match?.[0] ?? "protected_file";
}

export function guardToolResultPersistence(
  toolName: string | undefined,
  message: any,
  options?: ResultGuardOptions,
): ResultGuardDecision {
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

  const localRedaction = applyHighConfidenceRedactions(
    text,
    "tool result",
    options,
    { toolName: toolName ?? "tool" },
  );
  if (localRedaction) {
    return {
      block: true,
      message: createReplacementMessage(message, localRedaction.content),
      warning: localRedaction.warning,
    };
  }

  if (options?.trustedManagedLynxCheckPersistence === true) {
    return { block: false, message };
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
  const text = extractMessageText(message);
  if (!text) {
    return { block: false, message };
  }

  const directMatches = detectDirectProtectedResults(text);
  if (directMatches.length > 0) {
    const enforcement = applyDirectResultEnforcement(
      text,
      directMatches,
      "assistant output",
      options,
    );
    return {
      block: enforcement.changed,
      message: enforcement.changed ? createReplacementMessage(message, enforcement.content) : message,
      warning: enforcement.warning,
    };
  }

  const localRedaction = applyHighConfidenceRedactions(
    text,
    "assistant output",
    options,
  );
  if (localRedaction) {
    return {
      block: true,
      message: createReplacementMessage(message, localRedaction.content),
      warning: localRedaction.warning,
    };
  }

  if (options?.trustedManagedLynxCheckPersistence === true) {
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
