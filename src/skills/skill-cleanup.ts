/**
 * Skill Cleanup — Quarantine, removal, and restoration of flagged Skills.
 *
 * Design: Quarantine first, delete second. Always preserves original
 * files in ~/.openclaw/lynx/quarantine/ for forensic review.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, readdirSync, statSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";
import { CONFIG } from "../config.js";

// ── Paths ────────────────────────────────────────────────────────────

function getQuarantineDir(): string {
  return join(homedir(), CONFIG.CACHE_DIR, "quarantine");
}

function getToolsLogPath(): string {
  return join(homedir(), CONFIG.CACHE_DIR, "TOOLS.md");
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
  const logDir = join(homedir(), CONFIG.CACHE_DIR);

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
