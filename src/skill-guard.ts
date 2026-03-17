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

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "fs";
import { join, basename, resolve, normalize } from "path";
import { homedir } from "os";
import { computeSkillHash, computeFileHash } from "./skill-hash.js";
import {
  MALICIOUS_SKILL_BLACKLIST,
  MALICIOUS_SKILL_CONTENT_PATTERNS,
  TRUSTED_SKILL_REGISTRY,
  type MaliciousSkillEntry,
  type TrustedSkillEntry,
} from "./skill-blacklist-data.js";
import { CONFIG } from "./config.js";

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

// ── Blacklist Cache (local + remote merge with TTL) ─────────────────

interface BlacklistCache {
  entries: MaliciousSkillEntry[];
  lastFetched: number;
}

const BLACKLIST_TTL_MS = 60 * 60 * 1000; // 1 hour
let blacklistCache: BlacklistCache | null = null;

function getBlacklistDiskPath(): string {
  return join(homedir(), CONFIG.CACHE_DIR, "skill-blacklist-cache.json");
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
          const cacheDir = join(homedir(), CONFIG.CACHE_DIR);
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

  return results;
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
