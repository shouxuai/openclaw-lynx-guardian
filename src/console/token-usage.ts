import { createHash } from "crypto";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

import type { AuditEventItem, IngestItemV1, TokenUsageItem } from "../../shared/src/ingest.js";
import type { EventContext, LlmOutputEvent, Logger } from "../types.js";
import { resolveRuntimeHomeDir } from "../runtime/plugin-runtime-helpers.js";
import { filterRoutineHeartbeatIngestItems } from "./runtime.js";
import type { LocalConsoleIngestClient } from "./ingest-client.js";

export const LOCAL_CONSOLE_CHARS_PER_TOKEN_ESTIMATE = 4;

const NON_LATIN_RE = /[\u2E80-\u9FFF\uA000-\uA4FF\uAC00-\uD7AF\uF900-\uFAFF\u{20000}-\u{2FA1F}]/gu;
const CJK_SURROGATE_HIGH_RE = /[\uD840-\uD87E][\uDC00-\uDFFF]/g;

function countCodePoints(text: string, nonLatinCount: number): number {
  if (nonLatinCount === 0) {
    return text.length;
  }

  const cjkSurrogates = (text.match(CJK_SURROGATE_HIGH_RE) ?? []).length;
  return text.length - cjkSurrogates;
}

export function estimateCjkAwareChars(text: string): number {
  if (text.length === 0) {
    return 0;
  }

  const nonLatinCount = (text.match(NON_LATIN_RE) ?? []).length;
  const codePointLength = countCodePoints(text, nonLatinCount);

  return codePointLength + nonLatinCount * (LOCAL_CONSOLE_CHARS_PER_TOKEN_ESTIMATE - 1);
}

export function estimateCjkAwareTokensFromChars(chars: number): number {
  return Math.ceil(Math.max(0, chars) / LOCAL_CONSOLE_CHARS_PER_TOKEN_ESTIMATE);
}

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

// ---- token-usage.ts ----
export interface EstimatedTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens: number;
  estimateMethod?: string;
  payloadJson?: Record<string, unknown>;
}

export interface LocalConsoleTokenUsageEstimator {
  estimate(event: LlmOutputEvent, ctx: EventContext): EstimatedTokenUsage | null;
}

interface LocalConsoleTokenHookOptions {
  client: Pick<LocalConsoleIngestClient, "enqueueMany">;
  logger: Pick<Logger, "warn" | "error">;
  estimator?: LocalConsoleTokenUsageEstimator;
}

interface NormalizedUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  total?: number;
}

export interface LocalConsoleTokenHook {
  handle(event: LlmOutputEvent, ctx: EventContext): void;
}

function normalizeOccurredAtMs(): number {
  return Date.now();
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeTokenCount(value: unknown): number | undefined {
  const normalized = readFiniteNumber(value);
  if (normalized === undefined) {
    return undefined;
  }

  return Math.max(0, Math.trunc(normalized));
}

function truncateText(value: unknown, maxLength = 320): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) {
    return undefined;
  }

  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}...`;
}

function buildStableId(prefix: string, parts: Array<string | number | undefined>): string {
  const raw = parts
    .filter((part) => part !== undefined && part !== "")
    .map((part) => String(part))
    .join("|");
  const digest = createHash("sha1").update(raw || prefix).digest("hex").slice(0, 20);
  return `${prefix}:${digest}`;
}

function cleanRecord(value: Record<string, unknown>): Record<string, unknown> | undefined {
  const entries = Object.entries(value).filter(([, entryValue]) => entryValue !== undefined);
  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries);
}

function normalizeUsageRecord(raw: Record<string, unknown> | undefined): NormalizedUsage | undefined {
  if (!raw) {
    return undefined;
  }

  const inputTokenDetails = isRecord(raw.input_tokens_details) ? raw.input_tokens_details : undefined;
  const promptTokenDetails = isRecord(raw.prompt_tokens_details) ? raw.prompt_tokens_details : undefined;

  const cacheRead = normalizeTokenCount(
    raw.cacheRead
      ?? raw.cache_read
      ?? raw.cache_read_input_tokens
      ?? raw.cached_tokens
      ?? inputTokenDetails?.cached_tokens
      ?? promptTokenDetails?.cached_tokens,
  );

  const rawInputValue =
    raw.input ?? raw.inputTokens ?? raw.input_tokens ?? raw.promptTokens ?? raw.prompt_tokens;
  const usesOpenAiPromptTotals =
    raw.cached_tokens !== undefined
    || inputTokenDetails?.cached_tokens !== undefined
    || promptTokenDetails?.cached_tokens !== undefined;
  const normalizedRawInput = readFiniteNumber(rawInputValue);
  const adjustedInput =
    normalizedRawInput !== undefined && usesOpenAiPromptTotals && cacheRead !== undefined
      ? normalizedRawInput - cacheRead
      : normalizedRawInput;
  const input =
    adjustedInput !== undefined ? normalizeTokenCount(adjustedInput < 0 ? 0 : adjustedInput) : undefined;

  const output = normalizeTokenCount(
    raw.output ?? raw.outputTokens ?? raw.output_tokens ?? raw.completionTokens ?? raw.completion_tokens,
  );
  const cacheWrite = normalizeTokenCount(
    raw.cacheWrite ?? raw.cache_write ?? raw.cache_creation_input_tokens,
  );
  const total = normalizeTokenCount(raw.total ?? raw.totalTokens ?? raw.total_tokens);

  if (
    input === undefined
    && output === undefined
    && cacheRead === undefined
    && cacheWrite === undefined
    && total === undefined
  ) {
    return undefined;
  }

  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    total,
  };
}

function pickUsageValue(primary: number | undefined, fallback: number | undefined): number | undefined {
  if (typeof primary === "number" && primary > 0) {
    return primary;
  }
  if (typeof fallback === "number" && fallback > 0) {
    return fallback;
  }
  return primary ?? fallback;
}

function resolveUsageRecord(event: LlmOutputEvent): NormalizedUsage | undefined {
  const eventUsage = normalizeUsageRecord(isRecord(event.usage) ? event.usage : undefined);
  const lastAssistant = isRecord(event.lastAssistant) ? event.lastAssistant : undefined;
  const lastAssistantUsage = normalizeUsageRecord(
    isRecord(lastAssistant?.usage) ? lastAssistant.usage : undefined,
  );

  const merged: NormalizedUsage = {
    input: pickUsageValue(eventUsage?.input, lastAssistantUsage?.input),
    output: pickUsageValue(eventUsage?.output, lastAssistantUsage?.output),
    cacheRead: pickUsageValue(eventUsage?.cacheRead, lastAssistantUsage?.cacheRead),
    cacheWrite: pickUsageValue(eventUsage?.cacheWrite, lastAssistantUsage?.cacheWrite),
    total: pickUsageValue(eventUsage?.total, lastAssistantUsage?.total),
  };

  if (
    merged.input === undefined
    && merged.output === undefined
    && merged.cacheRead === undefined
    && merged.cacheWrite === undefined
    && merged.total === undefined
  ) {
    return undefined;
  }

  return merged;
}

function buildEstimatedTokenUsageItem(
  event: LlmOutputEvent,
  ctx: EventContext,
  estimatedUsage: EstimatedTokenUsage,
): TokenUsageItem | null {
  if (estimatedUsage.totalTokens <= 0) {
    return null;
  }

  const occurredAtMs = normalizeOccurredAtMs();
  const usageEventId = buildStableId("token-usage", [
    event.runId,
    event.model,
    occurredAtMs,
    estimatedUsage.totalTokens,
    event.assistantTexts.join("|"),
    "estimated",
  ]);

  return {
    kind: "tokenUsage",
    itemId: usageEventId,
    occurredAtMs,
    data: {
      usageEventId,
      sessionKey: typeof ctx.sessionKey === "string" ? ctx.sessionKey : undefined,
      runId: event.runId,
      agentId: typeof ctx.agentId === "string" ? ctx.agentId : undefined,
      provider: event.provider,
      model: event.model,
      sourceType: "estimated",
      inputTokens: estimatedUsage.inputTokens,
      outputTokens: estimatedUsage.outputTokens,
      cacheReadTokens: estimatedUsage.cacheReadTokens,
      cacheWriteTokens: estimatedUsage.cacheWriteTokens,
      totalTokens: estimatedUsage.totalTokens,
      assistantTextCount: event.assistantTexts.length,
      isEstimated: true,
      payloadJson: cleanRecord({
        estimateMethod: estimatedUsage.estimateMethod,
        ...(estimatedUsage.payloadJson ?? {}),
        sessionId: event.sessionId,
        lastAssistant: event.lastAssistant,
      }),
    },
  };
}

function buildTokenUsageItem(
  event: LlmOutputEvent,
  ctx: EventContext,
  estimator?: LocalConsoleTokenUsageEstimator,
): TokenUsageItem | null {
  const usage = resolveUsageRecord(event);
  const inputTokens = usage?.input;
  const outputTokens = usage?.output;
  const cacheReadTokens = usage?.cacheRead;
  const cacheWriteTokens = usage?.cacheWrite;
  const derivedTotal = (inputTokens ?? 0)
    + (outputTokens ?? 0)
    + (cacheReadTokens ?? 0)
    + (cacheWriteTokens ?? 0);
  const totalTokens =
    usage?.total !== undefined ? Math.max(usage.total, derivedTotal) : derivedTotal;

  if (totalTokens <= 0) {
    const estimatedUsage = estimator?.estimate(event, ctx);
    return estimatedUsage ? buildEstimatedTokenUsageItem(event, ctx, estimatedUsage) : null;
  }

  const occurredAtMs = normalizeOccurredAtMs();
  const usageEventId = buildStableId("token-usage", [
    event.runId,
    event.model,
    occurredAtMs,
    totalTokens,
    event.assistantTexts.join("|"),
  ]);

  return {
    kind: "tokenUsage",
    itemId: usageEventId,
    occurredAtMs,
    data: {
      usageEventId,
      sessionKey: typeof ctx.sessionKey === "string" ? ctx.sessionKey : undefined,
      runId: event.runId,
      agentId: typeof ctx.agentId === "string" ? ctx.agentId : undefined,
      provider: event.provider,
      model: event.model,
      sourceType: "actual",
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      totalTokens,
      assistantTextCount: event.assistantTexts.length,
      isEstimated: false,
      payloadJson: cleanRecord({
        sessionId: event.sessionId,
        lastAssistant: event.lastAssistant,
      }),
    },
  };
}

function buildUnavailableTokenUsageItem(event: LlmOutputEvent, ctx: EventContext): TokenUsageItem | null {
  if (event.assistantTexts.length === 0) {
    return null;
  }

  const occurredAtMs = normalizeOccurredAtMs();
  const usageEventId = buildStableId("token-usage", [
    event.runId,
    event.model,
    occurredAtMs,
    event.assistantTexts.join("|"),
    "unavailable",
  ]);

  return {
    kind: "tokenUsage",
    itemId: usageEventId,
    occurredAtMs,
    data: {
      usageEventId,
      sessionKey: typeof ctx.sessionKey === "string" ? ctx.sessionKey : undefined,
      runId: event.runId,
      agentId: typeof ctx.agentId === "string" ? ctx.agentId : undefined,
      provider: event.provider,
      model: event.model,
      sourceType: "unavailable",
      totalTokens: 0,
      assistantTextCount: event.assistantTexts.length,
      isEstimated: false,
      payloadJson: cleanRecord({
        sessionId: event.sessionId,
        lastAssistant: event.lastAssistant,
        usage: event.usage,
      }),
    },
  };
}

function buildUsageUnavailableAuditItem(event: LlmOutputEvent, ctx: EventContext): AuditEventItem | null {
  if (event.assistantTexts.length === 0) {
    return null;
  }

  const occurredAtMs = normalizeOccurredAtMs();
  const eventId = buildStableId("audit", [
    "llm_output",
    event.runId,
    occurredAtMs,
    event.model,
    "token_usage_unavailable",
  ]);

  return {
    kind: "auditEvent",
    itemId: eventId,
    occurredAtMs,
    data: {
      eventId,
      sessionKey: typeof ctx.sessionKey === "string" ? ctx.sessionKey : undefined,
      runId: event.runId,
      sourceKind: "plugin_hook",
      hookName: "llm_output",
      eventType: "token_usage_unavailable",
      category: "tokens",
      direction: "output",
      enforcementAction: "logOnly",
      title: "LLM output usage unavailable",
      summary: "llm_output fired, but the runtime did not expose usable token usage data.",
      contentExcerpt: truncateText(event.assistantTexts.join("\n")),
      payloadJson: cleanRecord({
        provider: event.provider,
        model: event.model,
        sessionId: event.sessionId,
        usage: event.usage,
      }),
    },
  };
}

function buildTokenHookItems(
  event: LlmOutputEvent,
  ctx: EventContext,
  estimator?: LocalConsoleTokenUsageEstimator,
): IngestItemV1[] {
  const tokenUsageItem = buildTokenUsageItem(event, ctx, estimator);
  if (tokenUsageItem) {
    return [tokenUsageItem];
  }

  const unavailableUsageItem = buildUnavailableTokenUsageItem(event, ctx);
  const auditItem = buildUsageUnavailableAuditItem(event, ctx);
  const items: IngestItemV1[] = [];
  if (unavailableUsageItem) {
    items.push(unavailableUsageItem);
  }
  if (auditItem) {
    items.push(auditItem);
  }
  return items;
}

export function createLocalConsoleTokenHook(options: LocalConsoleTokenHookOptions): LocalConsoleTokenHook {
  const estimator = options.estimator ?? createSessionReplayTokenUsageEstimator();

  return {
    handle(event, ctx) {
      try {
        const items = filterRoutineHeartbeatIngestItems(buildTokenHookItems(event, ctx, estimator));
        if (items.length === 0) {
          return;
        }

        const acceptedCount = options.client.enqueueMany(items);
        if (acceptedCount < items.length) {
          options.logger.warn(
            `[lynx-guardian] local console accepted ${acceptedCount}/${items.length} items for llm_output`,
          );
        }
      } catch (error) {
        options.logger.error(
          `[lynx-guardian] local console token hook failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  };
}
