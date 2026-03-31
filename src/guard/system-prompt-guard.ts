/**
 * System Prompt Protection Module (M2)
 *
 * Prevents leakage of internal configuration, system prompts, SOUL.md,
 * IDENTITY.md, USER.md, SKILL.md, and other core files.
 */

export interface PromptLeakResult {
  isLeak: boolean;
  severity: "none" | "low" | "medium" | "high";
  protectedFiles: string[];
}

const PROTECTED_FILE_NAMES = [
  "SOUL.md",
  "IDENTITY.md",
  "USER.md",
  "SKILL.md",
  "AGENTS.md",
  "TOOLS.md",
  "SHIELD.md",
  "MEMORY.md",
  "openclaw.json",
  "workspace-state.json",
  "openclaw.plugin.json",
];

const PROTECTED_FILE_PATTERNS: RegExp[] = PROTECTED_FILE_NAMES.map(
  (name) => new RegExp(name.replace(/\./g, "\\."), "gi"),
);

const PROTECTED_PATH_PATTERNS: RegExp[] = [
  /(?:^|[\\/])memory[\\/]/i,
];

const SENSITIVE_CONTENT_MARKERS = [
  /---\s*\nname:\s/m,                       // YAML frontmatter from SKILL.md
  /核心使命与防御架构/,
  /纵深防御理念/,
  /致命三角.*防御检查/,
  /行为异常检测/,
  /5\s*级风险评估框架/,
  /风险等级.*L[0-4]/,
  /共享\s*Agent\s*指令/i,
  /工具定义|工具访问/i,
  /安全策略|安全边界/i,
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

  const leakedFiles: string[] = [];
  let markerHits = 0;

  // Check for protected file name references with surrounding content indicating dump
  for (let i = 0; i < PROTECTED_FILE_NAMES.length; i++) {
    const pattern = PROTECTED_FILE_PATTERNS[i];
    pattern.lastIndex = 0;
    if (pattern.test(output)) {
      // Only flag if it looks like the content is being dumped, not just mentioned
      const dumpIndicators = [
        new RegExp(`(?:content|内容|原文).*${PROTECTED_FILE_NAMES[i].replace(/\./g, "\\.")}`, "i"),
        new RegExp(`${PROTECTED_FILE_NAMES[i].replace(/\./g, "\\.")}.*(?:says|内容|包含|如下|content)`, "i"),
      ];
      for (const indicator of dumpIndicators) {
        if (indicator.test(output)) {
          leakedFiles.push(PROTECTED_FILE_NAMES[i]);
          break;
        }
      }
    }
  }

  for (const pattern of PROTECTED_PATH_PATTERNS) {
    if (pattern.test(output)) {
      const dumpIndicators = [
        /(?:content|contents|内容|原文|如下|dump)/i,
        /(?:列出|展示|打印|显示|read|show|print|dump)/i,
      ];
      if (dumpIndicators.some((indicator) => indicator.test(output))) {
        leakedFiles.push("memory/");
      }
    }
  }

  // Check for internal marker content in output
  for (const marker of SENSITIVE_CONTENT_MARKERS) {
    if (marker.test(output)) {
      markerHits++;
    }
  }

  // Determine severity
  if (leakedFiles.length > 0 || markerHits >= 3) {
    return {
      isLeak: true,
      severity: "high",
      protectedFiles: leakedFiles,
    };
  }

  if (markerHits >= 1) {
    return {
      isLeak: true,
      severity: "medium",
      protectedFiles: leakedFiles,
    };
  }

  return { isLeak: false, severity: "none", protectedFiles: [] };
}
