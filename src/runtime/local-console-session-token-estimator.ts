import { existsSync, readFileSync } from "fs";
import { join } from "path";

import type { EventContext, LlmOutputEvent } from "../types.js";
import { estimateCjkAwareChars, estimateCjkAwareTokensFromChars } from "./local-console-token-estimate.js";
import { resolveRuntimeHomeDir } from "./plugin-runtime-helpers.js";
import type { EstimatedTokenUsage, LocalConsoleTokenUsageEstimator } from "./local-console-token-hook.js";

const DEFAULT_SESSION_STORE_RELATIVE_PATHS = [
  [".openclaw", "docker-state", "agents", "main", "sessions"],
  [".openclaw", "agents", "main", "sessions"],
];

type ReplayMessage =
  | {
      role: "user" | "system";
      content?: unknown;
    }
  | {
      role: "assistant";
      content?: Array<Record<string, unknown>>;
      responseId?: unknown;
    }
  | {
      role: "toolResult" | "custom";
      content?: unknown;
    }
  | {
      role: "bashExecution";
      command?: unknown;
      output?: unknown;
    }
  | {
      role: "branchSummary" | "compactionSummary";
      summary?: unknown;
    };

interface ReplayEntry {
  message: ReplayMessage;
}

interface SessionReplayTokenEstimatorOptions {
  homeDir?: string;
  sessionStorePaths?: string[];
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isReplayMessage(value: unknown): value is ReplayMessage {
  if (!isRecord(value)) {
    return false;
  }

  const role = normalizeString(value.role);
  return [
    "user",
    "system",
    "assistant",
    "toolResult",
    "custom",
    "bashExecution",
    "branchSummary",
    "compactionSummary",
  ].includes(role);
}

function resolveSessionStorePaths(options: SessionReplayTokenEstimatorOptions): string[] {
  if (Array.isArray(options.sessionStorePaths) && options.sessionStorePaths.length > 0) {
    return options.sessionStorePaths;
  }

  const homeDir = options.homeDir ?? resolveRuntimeHomeDir();
  return DEFAULT_SESSION_STORE_RELATIVE_PATHS.map((parts) => join(homeDir, ...parts));
}

function resolveSessionFilePath(sessionId: string, sessionStorePaths: string[]): string | null {
  for (const sessionsDir of sessionStorePaths) {
    const sessionPath = join(sessionsDir, `${sessionId}.jsonl`);
    if (existsSync(sessionPath)) {
      return sessionPath;
    }
  }
  return null;
}

function parseReplayEntries(sessionPath: string): ReplayEntry[] {
  const raw = readFileSync(sessionPath, "utf8");
  const entries: ReplayEntry[] = [];

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    try {
      const parsed = JSON.parse(trimmed) as { type?: unknown; message?: unknown };
      if (normalizeString(parsed.type) !== "message" || !isReplayMessage(parsed.message)) {
        continue;
      }

      entries.push({
        message: parsed.message,
      });
    } catch {
      continue;
    }
  }

  return entries;
}

function extractAssistantTextBlocks(message: ReplayMessage): string[] {
  if (message.role !== "assistant" || !Array.isArray(message.content)) {
    return [];
  }

  return message.content
    .filter((block) => isRecord(block) && block.type === "text" && typeof block.text === "string")
    .map((block) => String(block.text));
}

function estimateReplayMessageTokens(message: ReplayMessage): number {
  let estimatedChars = 0;

  switch (message.role) {
    case "system":
    case "user": {
      if (typeof message.content === "string") {
        estimatedChars = estimateCjkAwareChars(message.content);
      } else if (Array.isArray(message.content)) {
        for (const block of message.content) {
          if (isRecord(block) && block.type === "text" && typeof block.text === "string") {
            estimatedChars += estimateCjkAwareChars(block.text);
          }
        }
      }
      return estimateCjkAwareTokensFromChars(estimatedChars);
    }
    case "assistant": {
      for (const block of message.content ?? []) {
        if (!isRecord(block)) {
          continue;
        }
        if (block.type === "text" && typeof block.text === "string") {
          estimatedChars += estimateCjkAwareChars(block.text);
        } else if (block.type === "thinking" && typeof block.thinking === "string") {
          estimatedChars += estimateCjkAwareChars(block.thinking);
        } else if (block.type === "toolCall") {
          estimatedChars += estimateCjkAwareChars(normalizeString(block.name));
          estimatedChars += estimateCjkAwareChars(JSON.stringify(block.arguments ?? {}));
        }
      }
      return estimateCjkAwareTokensFromChars(estimatedChars);
    }
    case "custom":
    case "toolResult": {
      if (typeof message.content === "string") {
        estimatedChars = estimateCjkAwareChars(message.content);
      } else if (Array.isArray(message.content)) {
        for (const block of message.content) {
          if (!isRecord(block)) {
            continue;
          }
          if (block.type === "text" && typeof block.text === "string") {
            estimatedChars += estimateCjkAwareChars(block.text);
          } else if (block.type === "image") {
            estimatedChars += 4800;
          }
        }
      }
      return estimateCjkAwareTokensFromChars(estimatedChars);
    }
    case "bashExecution": {
      estimatedChars =
        estimateCjkAwareChars(normalizeString(message.command))
        + estimateCjkAwareChars(normalizeString(message.output));
      return estimateCjkAwareTokensFromChars(estimatedChars);
    }
    case "branchSummary":
    case "compactionSummary": {
      estimatedChars = estimateCjkAwareChars(normalizeString(message.summary));
      return estimateCjkAwareTokensFromChars(estimatedChars);
    }
    default:
      return 0;
  }
}

function findAssistantEntryIndex(entries: ReplayEntry[], event: LlmOutputEvent): number {
  const responseId = isRecord(event.lastAssistant) ? normalizeString(event.lastAssistant.responseId) : "";
  if (responseId) {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const message = entries[index]?.message;
      if (message?.role === "assistant" && normalizeString(message.responseId) === responseId) {
        return index;
      }
    }
  }

  const targetTexts = event.assistantTexts.filter((text) => typeof text === "string" && text.length > 0);
  if (targetTexts.length > 0) {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const assistantTexts = extractAssistantTextBlocks(entries[index]?.message);
      if (
        assistantTexts.length === targetTexts.length
        && assistantTexts.every((text, textIndex) => text === targetTexts[textIndex])
      ) {
        return index;
      }
    }
  }

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (entries[index]?.message.role === "assistant") {
      return index;
    }
  }

  return -1;
}

export function createSessionReplayTokenUsageEstimator(
  options: SessionReplayTokenEstimatorOptions = {},
): LocalConsoleTokenUsageEstimator {
  const sessionStorePaths = resolveSessionStorePaths(options);

  return {
    estimate(event: LlmOutputEvent, _ctx: EventContext): EstimatedTokenUsage | null {
      const sessionId = normalizeString(event.sessionId);
      if (!sessionId) {
        return null;
      }

      const sessionPath = resolveSessionFilePath(sessionId, sessionStorePaths);
      if (!sessionPath) {
        return null;
      }

      const entries = parseReplayEntries(sessionPath);
      if (entries.length === 0) {
        return null;
      }

      const assistantEntryIndex = findAssistantEntryIndex(entries, event);
      if (assistantEntryIndex < 0) {
        return null;
      }

      const assistantEntry = entries[assistantEntryIndex];
      const outputTokens = estimateReplayMessageTokens(assistantEntry.message);
      const inputTokens = entries
        .slice(0, assistantEntryIndex)
        .reduce((total, entry) => total + estimateReplayMessageTokens(entry.message), 0);
      const totalTokens = inputTokens + outputTokens;

      if (totalTokens <= 0) {
        return null;
      }

      return {
        inputTokens,
        outputTokens,
        totalTokens,
        payloadJson: {
          estimationMethod: "sessionReplayCjkAwareChars",
          sessionId,
          sessionPath,
          replayedMessageCount: assistantEntryIndex + 1,
        },
      };
    },
  };
}
