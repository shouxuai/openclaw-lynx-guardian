import { createHash } from "crypto";
import { lstatSync, readFileSync, realpathSync } from "fs";
import type { SafeScriptReadInput, SafeScriptReadResult } from "./types.js";

export function readScriptForPreflight(input: SafeScriptReadInput): SafeScriptReadResult {
  try {
    const stats = lstatSync(input.scriptPath);
    if (!stats.isFile()) {
      return { readStatus: "skipped", readReason: "not a regular file" };
    }
    if (stats.size > input.maxBytes) {
      return { readStatus: "skipped", readReason: `size ${stats.size} exceeds ${input.maxBytes}` };
    }

    const bytes = readFileSync(input.scriptPath);
    return {
      readStatus: "read",
      content: bytes.toString("utf8"),
      realPath: realpathSync(input.scriptPath),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      sizeBytes: stats.size,
      mtimeMs: Math.trunc(stats.mtimeMs),
    };
  } catch (error) {
    return {
      readStatus: "error",
      readReason: error instanceof Error ? error.message : String(error),
    };
  }
}
