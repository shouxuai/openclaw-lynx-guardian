/**
 * System Prompt Protection Module (M2)
 *
 * Prevents leakage of Lynx-owned prompt assets, plugin internals,
 * and internal defense copy in model output.
 */

export interface PromptLeakResult {
  isLeak: boolean;
  severity: "none" | "low" | "medium" | "high";
  protectedFiles: string[];
}

const SOFT_PROTECTED_FILE_NAMES = [
  "SOUL.md",
  "IDENTITY.md",
  "USER.md",
  "AGENTS.md",
  "TOOLS.md",
  "SHIELD.md",
  "MEMORY.md",
  "openclaw.json",
  "workspace-state.json",
  "openclaw.plugin.json",
];

const SOFT_PROTECTED_FILE_PATTERNS: RegExp[] = SOFT_PROTECTED_FILE_NAMES.map(
  (name) => new RegExp(name.replace(/\./g, "\\."), "gi"),
);

const DUMP_CONTEXT_PATTERNS: RegExp[] = [
  /(?:content|contents|内容|原文|如下|dump)/i,
  /(?:列出|展示|打印|显示|read|show|print|dump)/i,
];

const SUMMARY_CONTEXT_PATTERNS: RegExp[] = [
  /(?:摘要|概述|总结|概括|大意|概览|主要讲|主要是|大概是|简述)/i,
  /\b(?:summary|summari[sz](?:e|ed|es|ing)|overview|roughly|mainly|high-level)\b/i,
  /(?:不展开原文|不贴正文|不展示具体文件内容|不贴出原文)/i,
  /\bwithout\s+(?:quoting|showing)\s+(?:the\s+)?(?:full\s+)?contents?\b/i,
];

const CONCRETE_CONTENT_PATTERNS: RegExp[] = [
  /(?:内容如下|原文如下|全文如下|贴出原文|贴出正文)/i,
  /\b(?:content|contents?)\s+(?:follows|below|says)\b/i,
  /\b(?:full|verbatim)\s+contents?\b/i,
  /```[\s\S]+?```/m,
  /\{\s*"[^"]+"\s*:/,
  /"role"\s*:\s*"(?:system|user|assistant|tool)"/i,
];

const LYNX_OWNED_RESOURCE_PATTERNS: { pattern: RegExp; label: string }[] = [
  {
    label: "Lynx skill files",
    pattern: /(?:^|[\\/])\.openclaw[\\/]skills[\\/](?:lynx-guardian-[^\\/\s"'`;)]*|openclaw-plugin-dev-workflow)(?:[\\/]|$)/i,
  },
  {
    label: "Lynx skill files",
    pattern: /(?:^|[^A-Za-z0-9_])skills[\\/](?:lynx-guardian-[^\\/\s"'`;)]*|openclaw-plugin-dev-workflow)(?:[\\/]|$)/i,
  },
  {
    label: "Lynx plugin files",
    pattern: /(?:^|[\\/])(?:app|\.openclaw)[\\/]extensions[\\/]openclaw-lynx-guardian(?:[\\/]|$)/i,
  },
];

const LYNX_INTERNAL_CONTENT_MARKERS = [
  /核心使命与防御架构/,
  /纵深防御理念/,
  /致命三角.*防御检查/,
  /行为异常检测/,
  /5\s*级风险评估框架/,
  /风险等级.*L[0-4]/,
  /共享\s*Agent\s*指令/i,
  /CRITICAL_EXEC|WARNING_EXEC|SAFE_EXEC/,   // blacklist internals
  /SECRET_PATTERNS/,
  /MALICIOUS_PATTERNS/,
  /checkExecBlacklist|checkPathBlacklist/,
];

/**
 * Check if an output contains leaked system prompt / protected file content.
 * This is applied to agent output to prevent accidental or manipulated leaks.
 */
export function detectSystemPromptLeak(output: string): PromptLeakResult {
  if (!output || output.length < 20) {
    return { isLeak: false, severity: "none", protectedFiles: [] };
  }

  const softProtectedDumpFiles: string[] = [];
  const softProtectedSummaryFiles: string[] = [];
  const lynxOwnedDumpFiles: string[] = [];
  const lynxOwnedSummaryFiles: string[] = [];
  let markerHits = 0;
  const hasSummaryContext = SUMMARY_CONTEXT_PATTERNS.some((pattern) => pattern.test(output));
  const hasConcreteContent = CONCRETE_CONTENT_PATTERNS.some((pattern) => pattern.test(output));

  // Check for lower-priority protected file references with surrounding dump context.
  for (let i = 0; i < SOFT_PROTECTED_FILE_NAMES.length; i++) {
    const pattern = SOFT_PROTECTED_FILE_PATTERNS[i];
    pattern.lastIndex = 0;
    if (pattern.test(output)) {
      const dumpIndicators = [
        new RegExp(`(?:content|内容|原文).*${SOFT_PROTECTED_FILE_NAMES[i].replace(/\./g, "\\.")}`, "i"),
        new RegExp(`${SOFT_PROTECTED_FILE_NAMES[i].replace(/\./g, "\\.")}.*(?:says|内容|包含|如下|content)`, "i"),
      ];
      const fileName = SOFT_PROTECTED_FILE_NAMES[i];
      if (hasSummaryContext) {
        softProtectedSummaryFiles.push(fileName);
      }
      if (dumpIndicators.some((indicator) => indicator.test(output))) {
        softProtectedDumpFiles.push(fileName);
      }
    }
  }

  for (const { pattern, label } of LYNX_OWNED_RESOURCE_PATTERNS) {
    if (!pattern.test(output)) {
      continue;
    }
    if (hasSummaryContext) {
      lynxOwnedSummaryFiles.push(label);
    }
    if (DUMP_CONTEXT_PATTERNS.some((indicator) => indicator.test(output))) {
      lynxOwnedDumpFiles.push(label);
    }
  }

  // Check for internal protection copy in output. Plain YAML frontmatter is intentionally ignored.
  for (const marker of LYNX_INTERNAL_CONTENT_MARKERS) {
    if (marker.test(output)) {
      markerHits++;
    }
  }

  const dumpProtectedFiles = Array.from(new Set([...lynxOwnedDumpFiles, ...softProtectedDumpFiles]));
  const summaryProtectedFiles = Array.from(new Set([...lynxOwnedSummaryFiles, ...softProtectedSummaryFiles]));
  const concreteDumpDetected = hasConcreteContent || markerHits >= 2;

  if (lynxOwnedDumpFiles.length > 0 && concreteDumpDetected) {
    return {
      isLeak: true,
      severity: "high",
      protectedFiles: dumpProtectedFiles,
    };
  }

  if ((softProtectedDumpFiles.length > 0 && concreteDumpDetected) || markerHits >= 3) {
    return {
      isLeak: true,
      severity: "medium",
      protectedFiles: dumpProtectedFiles.length > 0 ? dumpProtectedFiles : ["Lynx internal text"],
    };
  }

  if (summaryProtectedFiles.length > 0 || markerHits >= 1) {
    return {
      isLeak: true,
      severity: "low",
      protectedFiles: summaryProtectedFiles.length > 0 ? summaryProtectedFiles : ["Lynx internal text"],
    };
  }

  return { isLeak: false, severity: "none", protectedFiles: [] };
}
