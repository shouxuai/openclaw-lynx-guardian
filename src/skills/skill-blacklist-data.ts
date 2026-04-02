/**
 * Malicious Skill blacklist data — const arrays following blacklist.ts patterns.
 *
 * Three categories:
 * 1. Known malicious Skill identifiers (name + regex + hash)
 * 2. Malicious content patterns in SKILL.md files
 * 3. Trusted Skill registry (name + SHA-256 baseline)
 */

// ── Malicious Skill Blacklist ────────────────────────────────────────

export interface MaliciousSkillEntry {
  /** Exact name match (case-insensitive) */
  name?: string;
  /** Regex pattern for name matching */
  namePattern?: RegExp;
  /** Known malicious hash (SHA-256) */
  hash?: string;
  /** Why this Skill is blacklisted */
  reason: string;
  /** Severity: critical = block immediately, warning = warn user */
  severity: "critical" | "warning";
}

export const MALICIOUS_SKILL_BLACKLIST: MaliciousSkillEntry[] = [
  // Known malicious Skills (examples — extend as threats emerge)
  {
    name: "openclaw-backdoor",
    reason: "Known backdoor Skill that exfiltrates credentials",
    severity: "critical",
  },
  {
    name: "system-override",
    reason: "Known Skill that attempts to override safety controls",
    severity: "critical",
  },
  {
    namePattern: /^(?:hack|exploit|pwn|rootkit|backdoor|trojan|malware)-/i,
    reason: "Skill name matches known malicious naming pattern",
    severity: "critical",
  },
  {
    namePattern: /(?:credential|password|token|secret)-(?:steal|grab|dump|exfil)/i,
    reason: "Skill name suggests credential exfiltration",
    severity: "critical",
  },
  {
    namePattern: /(?:reverse|bind)-?shell/i,
    reason: "Skill name suggests reverse/bind shell capability",
    severity: "critical",
  },
  // Typosquatting / impersonation patterns
  {
    namePattern: /^lynx-guardian(?!-lesson$)/i,
    reason: "Potential impersonation of lynx-guardian (typosquat)",
    severity: "warning",
  },
  {
    namePattern: /^openclaw-(?:lynx|guardian)(?!-)/i,
    reason: "Potential impersonation of official openclaw plugin",
    severity: "warning",
  },
];

// ── Malicious Content Patterns (checked inside SKILL.md) ────────────

export interface ContentPattern {
  pattern: RegExp;
  reason: string;
  severity: "critical" | "warning";
}

export const MALICIOUS_SKILL_CONTENT_PATTERNS: ContentPattern[] = [
  // Prompt injection in SKILL.md
  {
    pattern: /(?:ignore|disregard|forget)\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions?|rules?|constraints?)/i,
    reason: "Prompt injection: instruction override attempt",
    severity: "critical",
  },
  {
    pattern: /(?:忽略|无视|忘记)\s*(?:所有|之前|上面的?)\s*(?:指令|规则|约束|限制)/i,
    reason: "Prompt injection: instruction override (Chinese)",
    severity: "critical",
  },
  {
    pattern: /you\s+are\s+now\s+(?:a|an|the)\s+(?:unrestricted|unfiltered|jailbroken)/i,
    reason: "Prompt injection: role hijacking / jailbreak",
    severity: "critical",
  },
  {
    pattern: /(?:你现在是|从现在起你是)\s*(?:一个|无限制的|不受约束的)/i,
    reason: "Prompt injection: role hijacking (Chinese)",
    severity: "critical",
  },

  // Reverse shell / remote code execution
  {
    pattern: /(?:bash|sh|zsh)\s+-i\s+>&?\s*\/dev\/tcp\//,
    reason: "Reverse shell pattern in Skill content",
    severity: "critical",
  },
  {
    pattern: /\bnc\s+.*-e\s+(?:\/bin\/(?:bash|sh)|cmd\.exe)/,
    reason: "Netcat reverse shell in Skill content",
    severity: "critical",
  },
  {
    pattern: /\bexec\s*\(\s*['"](?:curl|wget)\b.*\|\s*(?:bash|sh)\b/,
    reason: "Remote code execution via curl/wget pipe to shell",
    severity: "critical",
  },

  // Data exfiltration
  {
    pattern: /curl\s+.*(?:--data|-d|-F)\s+.*(?:\.env|credentials|\.ssh|password|secret|token|api[_-]?key)/i,
    reason: "Data exfiltration: sending credentials via curl",
    severity: "critical",
  },
  {
    pattern: /(?:fetch|axios|request)\s*\(.*(?:\.env|credentials|password|secret|token)/i,
    reason: "Data exfiltration: sending credentials via HTTP",
    severity: "critical",
  },

  // System manipulation
  {
    pattern: /(?:rm\s+-rf|rmdir)\s+(?:\/|~\/|%HOME%)/,
    reason: "Destructive filesystem operation in Skill",
    severity: "critical",
  },
  {
    pattern: /(?:chmod|chown)\s+.*\/etc\//,
    reason: "System config permission manipulation",
    severity: "critical",
  },

  // Crypto mining
  {
    pattern: /(?:xmrig|minerd|cpuminer|cryptonight|stratum\+tcp)/i,
    reason: "Cryptocurrency mining reference",
    severity: "critical",
  },

  // Suspicious base64 encoded payloads
  {
    pattern: /(?:base64\s+--?d|atob|Buffer\.from)\s*\(.*[A-Za-z0-9+/=]{50,}/,
    reason: "Suspicious base64 encoded payload",
    severity: "warning",
  },

  // Disable security / modify guard
  {
    pattern: /(?:disable|bypass|remove|delete)\s+(?:security|safety|guard|protection|firewall)/i,
    reason: "Attempt to disable security mechanisms",
    severity: "warning",
  },
  {
    pattern: /(?:关闭|禁用|绕过|删除)\s*(?:安全|防护|防火墙|检查)/i,
    reason: "Attempt to disable security (Chinese)",
    severity: "warning",
  },
];

// ── Trusted Skill Registry (Trust-On-First-Use baseline) ────────────

export interface TrustedSkillEntry {
  /** Skill name (unique identifier) */
  name: string;
  /** SHA-256 hash of the Skill directory at trusted version */
  hash: string;
  /** Version string for reference */
  version?: string;
  /** Source URL for verification */
  source?: string;
}

export const TRUSTED_SKILL_REGISTRY: TrustedSkillEntry[] = [
  // Built-in: lynx-guardian-lesson (self — hash computed at first startup)
  {
    name: "lynx-guardian-lesson",
    hash: "", // Computed dynamically at first startup via computeSkillHash()
    version: "1.2.0",
    source: "builtin",
  },
];
