/**
 * Skill Guard — Core module for Skill security detection.
 *
 * Implements 4 key capabilities:
 * 1. Installation-time auto-detection (before_tool_call interception)
 * 2. Malicious Skill download blocking (blacklist matching)
 * 3. Same-name impersonation detection (hash-based authenticity)
 * 4. One-click risk cleanup (batch quarantine/removal)
 *
 * Follows existing patterns: pure pattern matching (like blacklist.ts),
 * 4-level risk assessment, fail-safe design.
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, renameSync, rmSync } from "fs";
import { join, basename, resolve, normalize } from "path";
import { homedir } from "os";
import { SKILL_HASH_ALGORITHM, computeSkillHash, computeFileHash } from "./skill-hash.js";
import { LYNX_RESOURCE_CONFIG } from "../runtime/resource-config.js";
import { GoControlPlaneClient } from "../api/go-control-plane.js";

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


// ── Types ────────────────────────────────────────────────────────────

export type SkillRiskLevel = "safe" | "warning" | "critical" | "malicious";

export interface SkillInstallAttempt {
  /** The Skill name being installed */
  skillName: string;
  /** The source of the install (cli, file_copy, git_clone, file_write) */
  installMethod: "cli" | "file_copy" | "git_clone" | "file_write";
  /** The full command or path that triggered detection */
  rawCommand: string;
  /** Skill path if available */
  skillPath?: string;
}

export interface SkillRiskAssessment {
  level: SkillRiskLevel;
  reasons: string[];
  skillName: string;
  /** Whether to block the operation */
  block: boolean;
  /** Human-readable message */
  message: string;
}

export interface SkillIntegrityResult {
  skillName: string;
  path: string;
  valid: boolean;
  currentHash: string;
  expectedHash?: string;
  reason?: string;
}

export interface SkillInventoryRecord {
  skillId: string;
  name: string;
  source: string;
  installPath: string;
  manifestPath: string;
  hashAlgorithm: typeof SKILL_HASH_ALGORITHM;
  baselineHash: string;
  currentHash: string;
  trustState: "trusted" | "first_seen" | "hash_mismatch" | "unreadable";
  lastSeenAt: string;
  metadata?: Record<string, unknown>;
}

interface SkillInventoryControlPlaneConfig {
  baseUrl: string;
  getToken?: () => string;
  logger?: Pick<Console, "warn"> & Partial<Pick<Console, "debug">>;
  fetchImpl?: typeof fetch;
}

// ── Blacklist Cache (local + remote merge with TTL) ─────────────────

interface BlacklistCache {
  entries: MaliciousSkillEntry[];
  lastFetched: number;
}

const BLACKLIST_TTL_MS = 60 * 60 * 1000; // 1 hour
let blacklistCache: BlacklistCache | null = null;
let inventoryControlPlaneConfig: SkillInventoryControlPlaneConfig | null = null;

function getBlacklistDiskPath(): string {
  return join(homedir(), LYNX_RESOURCE_CONFIG.CACHE_DIR, "skill-blacklist-cache.json");
}

export function configureSkillInventoryControlPlane(config?: SkillInventoryControlPlaneConfig | null): void {
  inventoryControlPlaneConfig = config?.baseUrl ? config : null;
}

/**
 * Get merged blacklist (local static + remote cached).
 * Remote blacklist is fetched with 1-hour TTL and persisted to disk.
 */
export async function getBlacklist(
  fetchRemote?: () => Promise<MaliciousSkillEntry[] | null>,
): Promise<MaliciousSkillEntry[]> {
  // Always include local blacklist
  const local = [...MALICIOUS_SKILL_BLACKLIST];

  // Check in-memory cache
  if (blacklistCache && Date.now() - blacklistCache.lastFetched < BLACKLIST_TTL_MS) {
    return [...local, ...blacklistCache.entries];
  }

  // Try loading from disk cache
  const diskPath = getBlacklistDiskPath();
  try {
    if (existsSync(diskPath)) {
      const raw = JSON.parse(readFileSync(diskPath, "utf-8"));
      if (raw.lastFetched && Date.now() - raw.lastFetched < BLACKLIST_TTL_MS) {
        blacklistCache = {
          entries: (raw.entries || []).map((e: any) => ({
            ...e,
            namePattern: e.namePattern ? new RegExp(e.namePattern) : undefined,
          })),
          lastFetched: raw.lastFetched,
        };
        return [...local, ...blacklistCache.entries];
      }
    }
  } catch {
    // Disk cache corrupted, continue to fetch
  }

  // Fetch remote if provided
  if (fetchRemote) {
    try {
      const remote = await fetchRemote();
      if (remote && remote.length > 0) {
        blacklistCache = { entries: remote, lastFetched: Date.now() };
        // Persist to disk
        try {
          const cacheDir = join(homedir(), LYNX_RESOURCE_CONFIG.CACHE_DIR);
          if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
          writeFileSync(diskPath, JSON.stringify({
            entries: remote.map((e) => ({
              ...e,
              namePattern: e.namePattern?.source,
            })),
            lastFetched: Date.now(),
          }), "utf-8");
        } catch {
          // Best-effort persistence
        }
        return [...local, ...remote];
      }
    } catch {
      // Remote fetch failed, use local only
    }
  }

  return local;
}

// ── Installation Detection ──────────────────────────────────────────

const SKILLS_DIR_PATTERN = /[~$](?:HOME)?[/\\]?\.openclaw[/\\]skills[/\\]/;
const SKILLS_DIR_EXPANDED = join(homedir(), ".openclaw", "skills");

/**
 * Detect if a tool call is installing a Skill.
 * Returns the install attempt info or null if not a Skill install.
 */
export function detectSkillInstall(
  toolName: string,
  params: Record<string, any>,
): SkillInstallAttempt | null {
  if (toolName === "exec") {
    const command = (params?.command ?? "") as string;
    if (!command) return null;

    // CLI install: openclaw plugins install <name>
    const cliMatch = command.match(
      /\bopenclaw\s+(?:plugins?\s+)?install\s+([^\s;&|]+)/i,
    );
    if (cliMatch) {
      return {
        skillName: cliMatch[1],
        installMethod: "cli",
        rawCommand: command,
      };
    }

    // File copy: cp/rsync to ~/.openclaw/skills/
    const copyMatch = command.match(
      /\b(?:cp|rsync)\b.*\s((?:~|\$HOME)?\/?\.openclaw\/skills\/([^\s;&|]+))/i,
    );
    if (copyMatch) {
      return {
        skillName: basename(copyMatch[2] || copyMatch[1]),
        installMethod: "file_copy",
        rawCommand: command,
        skillPath: copyMatch[1],
      };
    }

    // Also check for expanded home path in cp/rsync
    if (/\b(?:cp|rsync)\b/.test(command) && command.includes(SKILLS_DIR_EXPANDED)) {
      const afterSkills = command.split(SKILLS_DIR_EXPANDED)[1];
      if (afterSkills) {
        const name = afterSkills.split(/[\s/\\;&|]/)[0] || afterSkills.trim();
        if (name) {
          return {
            skillName: name,
            installMethod: "file_copy",
            rawCommand: command,
            skillPath: join(SKILLS_DIR_EXPANDED, name),
          };
        }
      }
    }

    // Git clone: git clone ... ~/.openclaw/skills/
    const gitMatch = command.match(
      /\bgit\s+clone\b.*\s((?:~|\$HOME)?\/?\.openclaw\/skills\/([^\s;&|]*))/i,
    );
    if (gitMatch) {
      const name = gitMatch[2] || extractRepoName(command);
      return {
        skillName: name,
        installMethod: "git_clone",
        rawCommand: command,
        skillPath: gitMatch[1],
      };
    }

    // Git clone with expanded path
    if (/\bgit\s+clone\b/.test(command) && command.includes(SKILLS_DIR_EXPANDED)) {
      const afterSkills = command.split(SKILLS_DIR_EXPANDED)[1];
      const name = afterSkills?.split(/[\s/\\;&|]/)[0] || extractRepoName(command);
      return {
        skillName: name,
        installMethod: "git_clone",
        rawCommand: command,
        skillPath: join(SKILLS_DIR_EXPANDED, name),
      };
    }

    return null;
  }

  // File write/edit: writing to ~/.openclaw/skills/
  if (toolName === "write" || toolName === "edit") {
    const rawPath = (params?.file_path ?? params?.path ?? "") as string;
    if (!rawPath) return null;

    let normalizedPath = rawPath;
    if (normalizedPath.startsWith("~/")) {
      normalizedPath = normalizedPath.replace("~", homedir());
    }
    normalizedPath = normalize(resolve(normalizedPath));

    const normalizedSkillsDir = normalize(resolve(SKILLS_DIR_EXPANDED));
    if (normalizedPath.startsWith(normalizedSkillsDir)) {
      const relative = normalizedPath.slice(normalizedSkillsDir.length + 1);
      const skillName = relative.split(/[/\\]/)[0];
      if (skillName) {
        return {
          skillName,
          installMethod: "file_write",
          rawCommand: `${toolName} ${rawPath}`,
          skillPath: join(normalizedSkillsDir, skillName),
        };
      }
    }

    return null;
  }

  return null;
}

/**
 * Extract repository name from a git clone URL.
 */
function extractRepoName(command: string): string {
  const urlMatch = command.match(/(?:https?:\/\/[^\s]+|git@[^\s]+)/);
  if (urlMatch) {
    const url = urlMatch[0];
    const parts = url.replace(/\.git\s*$/, "").split("/");
    return parts[parts.length - 1] || "unknown";
  }
  return "unknown";
}

// ── Blacklist Matching ──────────────────────────────────────────────

/**
 * Check if a Skill name/hash matches the malicious blacklist.
 */
export function checkMaliciousSkillBlacklist(
  name: string,
  blacklist: MaliciousSkillEntry[],
  hash?: string,
): { matched: boolean; entry?: MaliciousSkillEntry } {
  const lowerName = name.toLowerCase();

  for (const entry of blacklist) {
    // Exact name match
    if (entry.name && entry.name.toLowerCase() === lowerName) {
      return { matched: true, entry };
    }
    // Regex name match
    if (entry.namePattern && entry.namePattern.test(name)) {
      return { matched: true, entry };
    }
    // Hash match
    if (entry.hash && hash && entry.hash === hash) {
      return { matched: true, entry };
    }
  }

  return { matched: false };
}

// ── Authenticity Check ──────────────────────────────────────────────

/**
 * Check if a Skill is authentic by comparing against the trusted registry.
 * Trust-On-First-Use: if no entry exists, the Skill is new (not impersonation).
 */
export function checkSkillAuthenticity(
  name: string,
  hash: string,
  registry?: TrustedSkillEntry[],
): { authentic: boolean; reason?: string } {
  const trusted = registry ?? TRUSTED_SKILL_REGISTRY;
  const entry = trusted.find((e) => e.name === name);

  if (!entry) {
    // No trusted entry — new Skill, not impersonation
    return { authentic: true };
  }

  if (!entry.hash || entry.hash === "") {
    // Hash not yet computed (e.g., first startup) — trust for now
    return { authentic: true };
  }

  if (entry.hash === hash) {
    return { authentic: true };
  }

  return {
    authentic: false,
    reason: `Skill "${name}" hash mismatch: expected ${entry.hash.slice(0, 12)}..., got ${hash.slice(0, 12)}... (potential impersonation or tampering)`,
  };
}

// ── Content Scanning ────────────────────────────────────────────────

/**
 * Scan a Skill's SKILL.md for malicious content patterns.
 */
export function scanSkillContent(
  skillPath: string,
): { safe: boolean; findings: Array<{ pattern: string; severity: string }> } {
  const findings: Array<{ pattern: string; severity: string }> = [];
  const skillMdPath = join(skillPath, "SKILL.md");

  // Check SKILL.md if it exists
  let content = "";
  if (existsSync(skillMdPath)) {
    content = readFileSync(skillMdPath, "utf-8");
  }

  // Also scan other files in the skill root
  try {
    const files = readdirSync(skillPath);
    for (const file of files) {
      if (file === "SKILL.md") continue;
      const filePath = join(skillPath, file);
      if (statSync(filePath).isFile() && filePath.endsWith(".md")) {
        content += "\n" + readFileSync(filePath, "utf-8");
      }
    }
  } catch {
    // Continue with what we have
  }

  if (!content) return { safe: true, findings: [] };

  for (const { pattern, reason, severity } of MALICIOUS_SKILL_CONTENT_PATTERNS) {
    if (pattern.test(content)) {
      findings.push({ pattern: reason, severity });
    }
  }

  return {
    safe: findings.length === 0,
    findings,
  };
}

// ── Comprehensive Risk Assessment ───────────────────────────────────

/**
 * Assess the risk of a Skill installation attempt.
 * Combines blacklist matching, content scanning, and integrity verification.
 */
export async function assessSkillRisk(
  attempt: SkillInstallAttempt,
  fetchRemoteBlacklist?: () => Promise<MaliciousSkillEntry[] | null>,
): Promise<SkillRiskAssessment> {
  const reasons: string[] = [];
  let level: SkillRiskLevel = "safe";

  // 1. Check blacklist
  const blacklist = await getBlacklist(fetchRemoteBlacklist);
  const { matched, entry } = checkMaliciousSkillBlacklist(attempt.skillName, blacklist);

  if (matched && entry) {
    if (entry.severity === "critical") {
      level = "malicious";
      reasons.push(`黑名单命中: ${entry.reason}`);
    } else {
      level = "warning";
      reasons.push(`黑名单警告: ${entry.reason}`);
    }
  }

  // 2. Check content (if Skill path exists)
  if (attempt.skillPath && existsSync(attempt.skillPath)) {
    const { safe, findings } = scanSkillContent(attempt.skillPath);
    if (!safe) {
      const criticalFindings = findings.filter((f) => f.severity === "critical");
      if (criticalFindings.length > 0) {
        level = level === "malicious" ? "malicious" : "critical";
        reasons.push(
          ...criticalFindings.map((f) => `恶意内容: ${f.pattern}`),
        );
      } else {
        level = level === "safe" ? "warning" : level;
        reasons.push(
          ...findings.map((f) => `可疑内容: ${f.pattern}`),
        );
      }
    }

    // 3. Check authenticity (hash comparison)
    try {
      const hash = computeSkillHash(attempt.skillPath);
      const { authentic, reason } = checkSkillAuthenticity(attempt.skillName, hash);
      if (!authentic) {
        level = level === "safe" || level === "warning" ? "critical" : level;
        reasons.push(reason!);
      }
    } catch {
      // Hash computation failed — not a blocking error
    }
  }

  const block = level === "malicious" || level === "critical";
  const message = buildRiskMessage(attempt, level, reasons);

  return { level, reasons, skillName: attempt.skillName, block, message };
}

function buildRiskMessage(
  attempt: SkillInstallAttempt,
  level: SkillRiskLevel,
  reasons: string[],
): string {
  const methodLabels: Record<string, string> = {
    cli: "CLI安装",
    file_copy: "文件复制安装",
    git_clone: "Git克隆安装",
    file_write: "文件写入",
  };

  const method = methodLabels[attempt.installMethod] ?? attempt.installMethod;

  if (level === "safe") {
    return `Skill安装检测 (${method}): ${attempt.skillName} — 安全`;
  }

  const prefix = level === "malicious"
    ? "🛡️ 恶意Skill拦截"
    : level === "critical"
      ? "⚠️ 高风险Skill拦截"
      : "⚠️ Skill安装警告";

  return `[Lynx Guardian] ${prefix} (${method}): ${attempt.skillName}\n${reasons.map((r) => `  - ${r}`).join("\n")}`;
}

// ── Startup Integrity Verification ──────────────────────────────────

/**
 * Verify all installed Skills at startup.
 * Returns integrity results for each Skill.
 */
export function verifyAllInstalledSkills(
  registry?: TrustedSkillEntry[],
): SkillIntegrityResult[] {
  const skillsDir = join(homedir(), ".openclaw", "skills");
  if (!existsSync(skillsDir)) return [];

  const results: SkillIntegrityResult[] = [];
  const trusted = registry ?? TRUSTED_SKILL_REGISTRY;

  try {
    const entries = readdirSync(skillsDir);

    for (const entry of entries) {
      const skillPath = join(skillsDir, entry);
      if (!statSync(skillPath).isDirectory()) continue;

      try {
        const currentHash = computeSkillHash(skillPath);
        const trustedEntry = trusted.find((t) => t.name === entry);

        if (!trustedEntry || !trustedEntry.hash || trustedEntry.hash === "") {
          // New Skill or no baseline hash — record for TOFU
          results.push({
            skillName: entry,
            path: skillPath,
            valid: true,
            currentHash,
            reason: "No baseline hash (first seen)",
          });
        } else if (trustedEntry.hash === currentHash) {
          results.push({
            skillName: entry,
            path: skillPath,
            valid: true,
            currentHash,
            expectedHash: trustedEntry.hash,
          });
        } else {
          results.push({
            skillName: entry,
            path: skillPath,
            valid: false,
            currentHash,
            expectedHash: trustedEntry.hash,
            reason: `Hash mismatch: expected ${trustedEntry.hash.slice(0, 12)}..., got ${currentHash.slice(0, 12)}...`,
          });
        }
      } catch (err: any) {
        results.push({
          skillName: entry,
          path: skillPath,
          valid: false,
          currentHash: "",
          reason: `Hash computation failed: ${err.message}`,
        });
      }
    }
  } catch {
    // Skills directory not readable
  }

  publishSkillInventory(results);
  return results;
}

function publishSkillInventory(results: SkillIntegrityResult[]): void {
  if (!inventoryControlPlaneConfig || results.length === 0) {
    return;
  }
  const items = results.map(skillResultToInventoryRecord);
  let client: GoControlPlaneClient;
  try {
    client = new GoControlPlaneClient(inventoryControlPlaneConfig);
  } catch (error) {
    inventoryControlPlaneConfig.logger?.warn?.(
      `[lynx-guardian] Skill inventory sync skipped: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  void client.syncSkillInventory({ items }).then(() => {
    inventoryControlPlaneConfig?.logger?.debug?.(
      `[lynx-guardian] Skill inventory sync queued ${items.length} item(s).`,
    );
  }).catch((error) => {
    inventoryControlPlaneConfig?.logger?.warn?.(
      `[lynx-guardian] Skill inventory sync failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
}

function skillResultToInventoryRecord(result: SkillIntegrityResult): SkillInventoryRecord {
  const manifestPath = join(result.path, "SKILL.md");
  const trustState: SkillInventoryRecord["trustState"] = result.valid
    ? result.expectedHash ? "trusted" : "first_seen"
    : result.currentHash ? "hash_mismatch" : "unreadable";
  return {
    skillId: result.skillName,
    name: result.skillName,
    source: "local",
    installPath: result.path,
    manifestPath: existsSync(manifestPath) ? manifestPath : "",
    hashAlgorithm: SKILL_HASH_ALGORITHM,
    baselineHash: result.expectedHash ?? "",
    currentHash: result.currentHash,
    trustState,
    lastSeenAt: new Date().toISOString(),
    metadata: {
      reason: result.reason,
      valid: result.valid,
    },
  };
}

/**
 * Quick synchronous check: is this Skill name on the local blacklist?
 * Used for fast pre-filtering before async full assessment.
 */
export function quickBlacklistCheck(
  skillName: string,
): { blocked: boolean; reason?: string } {
  const { matched, entry } = checkMaliciousSkillBlacklist(
    skillName,
    MALICIOUS_SKILL_BLACKLIST,
  );

  if (matched && entry?.severity === "critical") {
    return { blocked: true, reason: entry.reason };
  }

  return { blocked: false };
}


/**
 * Skill Cleanup — Quarantine, removal, and restoration of flagged Skills.
 *
 * Design: Quarantine first, delete second. Always preserves original
 * files in ~/.openclaw/lynx/quarantine/ for forensic review.
 */


// ── Paths ────────────────────────────────────────────────────────────

function getQuarantineDir(): string {
  return join(homedir(), LYNX_RESOURCE_CONFIG.CACHE_DIR, "quarantine");
}

function getToolsLogPath(): string {
  return join(homedir(), LYNX_RESOURCE_CONFIG.CACHE_DIR, "TOOLS.md");
}

function getSkillsDir(): string {
  return join(homedir(), ".openclaw", "skills");
}

// ── Quarantine Info ──────────────────────────────────────────────────

export interface QuarantineInfo {
  skillName: string;
  originalPath: string;
  reason: string;
  timestamp: string;
  quarantinePath: string;
}

export interface CleanupAction {
  action: "quarantine" | "remove" | "restore";
  skillName: string;
  reason: string;
  timestamp: string;
  path: string;
}

// ── Core Functions ───────────────────────────────────────────────────

/**
 * Move a Skill to quarantine instead of deleting it.
 * Creates ~/.openclaw/lynx/quarantine/{name}_{timestamp}/ with metadata.
 */
export function quarantineSkill(skillPath: string, reason: string): QuarantineInfo {
  const skillName = basename(skillPath);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const quarantineDir = getQuarantineDir();
  const targetDir = join(quarantineDir, `${skillName}_${timestamp}`);

  if (!existsSync(quarantineDir)) {
    mkdirSync(quarantineDir, { recursive: true });
  }

  // Move skill to quarantine
  renameSync(skillPath, targetDir);

  // Write quarantine metadata
  const info: QuarantineInfo = {
    skillName,
    originalPath: skillPath,
    reason,
    timestamp: new Date().toISOString(),
    quarantinePath: targetDir,
  };

  writeFileSync(
    join(targetDir, "quarantine-info.json"),
    JSON.stringify(info, null, 2),
    "utf-8",
  );

  logCleanupAction({
    action: "quarantine",
    skillName,
    reason,
    timestamp: info.timestamp,
    path: targetDir,
  });

  return info;
}

/**
 * Remove a Skill: quarantine first (backup), then delete from skills directory.
 */
export function removeSkill(skillPath: string, reason: string): QuarantineInfo {
  // Quarantine first as backup
  const info = quarantineSkill(skillPath, reason);

  logCleanupAction({
    action: "remove",
    skillName: info.skillName,
    reason,
    timestamp: new Date().toISOString(),
    path: info.quarantinePath,
  });

  return info;
}

/**
 * Update openclaw.json to remove a plugin registration.
 */
export function updateOpenClawConfig(skillName: string): boolean {
  const configPath = join(homedir(), ".openclaw", "openclaw.json");

  try {
    if (!existsSync(configPath)) return false;

    const raw = readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw);

    // Remove from plugins array if present
    if (Array.isArray(config.plugins)) {
      const idx = config.plugins.findIndex(
        (p: any) => p === skillName || p?.name === skillName || p?.id === skillName,
      );
      if (idx >= 0) {
        config.plugins.splice(idx, 1);
        writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
        return true;
      }
    }

    // Remove from skills object if present
    if (config.skills && config.skills[skillName]) {
      delete config.skills[skillName];
      writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
      return true;
    }

    return false;
  } catch {
    return false;
  }
}
/**
 * Log cleanup action to .lynx/TOOLS.md (same format as existing logs).
 */
export function logCleanupAction(action: CleanupAction): void {
  const logPath = getToolsLogPath();
  const logDir = join(homedir(), LYNX_RESOURCE_CONFIG.CACHE_DIR);

  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }

  const entry = `\n## [${action.timestamp}] Skill ${action.action}: ${action.skillName}\n- Reason: ${action.reason}\n- Path: ${action.path}\n`;

  try {
    const existing = existsSync(logPath) ? readFileSync(logPath, "utf-8") : "# Lynx Guardian - Cleanup Log\n";
    writeFileSync(logPath, existing + entry, "utf-8");
  } catch {
    // Best-effort logging
  }
}

/**
 * Batch cleanup: quarantine or remove multiple flagged Skills.
 */
export function cleanupFlaggedSkills(
  flagged: Array<{ path: string; reason: string }>,
  action: "quarantine" | "remove",
): QuarantineInfo[] {
  const results: QuarantineInfo[] = [];

  for (const { path, reason } of flagged) {
    try {
      if (!existsSync(path)) continue;

      const info = action === "remove"
        ? removeSkill(path, reason)
        : quarantineSkill(path, reason);
      results.push(info);
    } catch {
      // Continue with remaining skills on individual failure
    }
  }

  return results;
}

/**
 * List all quarantined Skills.
 */
export function listQuarantined(): QuarantineInfo[] {
  const quarantineDir = getQuarantineDir();
  if (!existsSync(quarantineDir)) return [];

  const results: QuarantineInfo[] = [];
  const entries = readdirSync(quarantineDir);

  for (const entry of entries) {
    const entryPath = join(quarantineDir, entry);
    if (!statSync(entryPath).isDirectory()) continue;

    const infoPath = join(entryPath, "quarantine-info.json");
    if (!existsSync(infoPath)) continue;

    try {
      const info = JSON.parse(readFileSync(infoPath, "utf-8")) as QuarantineInfo;
      results.push(info);
    } catch {
      // Skip corrupted entries
    }
  }

  return results;
}

/**
 * Restore a quarantined Skill back to its original location.
 */
export function restoreFromQuarantine(skillName: string): boolean {
  const quarantined = listQuarantined();

  // Find the most recent quarantine entry for this skill
  const entries = quarantined
    .filter((q) => q.skillName === skillName)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  if (entries.length === 0) return false;

  const entry = entries[0];
  const skillsDir = getSkillsDir();
  const targetPath = join(skillsDir, skillName);

  try {
    // Remove quarantine-info.json before restoring
    const infoPath = join(entry.quarantinePath, "quarantine-info.json");
    if (existsSync(infoPath)) {
      rmSync(infoPath);
    }

    // Move back to skills directory
    if (!existsSync(skillsDir)) {
      mkdirSync(skillsDir, { recursive: true });
    }
    renameSync(entry.quarantinePath, targetPath);

    logCleanupAction({
      action: "restore",
      skillName,
      reason: `Restored from quarantine (originally: ${entry.reason})`,
      timestamp: new Date().toISOString(),
      path: targetPath,
    });

    return true;
  } catch {
    return false;
  }
}
