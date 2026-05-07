/**
 * Skill Hash — SHA-256 fingerprint computation for Skill integrity verification.
 *
 * Uses Node built-in `crypto` module, no external dependencies.
 */

import { createHash } from "crypto";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

export const SKILL_HASH_ALGORITHM = "sha256";

/**
 * Compute SHA-256 hash of a single file.
 */
export function computeFileHash(filePath: string): string {
  const content = readFileSync(filePath);
  return createHash(SKILL_HASH_ALGORITHM).update(content).digest("hex");
}

/**
 * Recursively collect all file paths under a directory, sorted for determinism.
 */
function collectFiles(dirPath: string, basePath: string): string[] {
  const files: string[] = [];
  const entries = readdirSync(dirPath);

  for (const entry of entries) {
    // Skip hidden files/dirs and node_modules
    if (entry.startsWith(".") || entry === "node_modules") continue;

    const fullPath = join(dirPath, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      files.push(...collectFiles(fullPath, basePath));
    } else if (stat.isFile()) {
      files.push(relative(basePath, fullPath));
    }
  }

  return files.sort();
}

/**
 * Compute SHA-256 hash of an entire Skill directory.
 * Reads all files recursively, sorts by relative path, concatenates content, then hashes.
 */
export function computeSkillHash(skillPath: string): string {
  const relativePaths = collectFiles(skillPath, skillPath);
  const hash = createHash(SKILL_HASH_ALGORITHM);

  for (const relPath of relativePaths) {
    const fullPath = join(skillPath, relPath);
    const content = readFileSync(fullPath);
    // Include the relative path in the hash to detect renames
    hash.update(relPath);
    hash.update(content);
  }

  return hash.digest("hex");
}

/**
 * Verify Skill integrity by comparing current hash against expected hash.
 */
export function verifySkillIntegrity(
  skillPath: string,
  expectedHash: string,
): { valid: boolean; currentHash: string } {
  const currentHash = computeSkillHash(skillPath);
  return {
    valid: currentHash === expectedHash,
    currentHash,
  };
}
