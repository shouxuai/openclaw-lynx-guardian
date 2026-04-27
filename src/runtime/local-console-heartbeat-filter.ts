import type {
  AuditEventItem,
  IngestItemV1,
  SessionUpsertItem,
  TokenUsageItem,
  ToolCallUpsertItem,
} from "../../shared/src/ingest.js";

const SECURITY_ENFORCEMENT_ACTIONS = new Set(["block", "redact", "requireApproval"]);
const SECURITY_POLICY_DECISIONS = new Set(["deny", "confirm", "block", "requireApproval"]);
const ROUTINE_HEARTBEAT_PROMPT = "read heartbeat.md if it exists";
const ROUTINE_HEARTBEAT_REPLY = "heartbeat_ok";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim().toLowerCase();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).toLowerCase();
  }
  return "";
}

function stringifyValue(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function readNestedText(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => readNestedText(entry)).filter(Boolean).join(" ");
  }
  if (isRecord(value)) {
    return Object.values(value).map((entry) => readNestedText(entry)).filter(Boolean).join(" ");
  }
  return "";
}

function isHeartbeatReadPath(text: string): boolean {
  const normalized = normalizeText(text).replace(/\\/g, "/");
  return normalized.includes("heartbeat.md") && (
    normalized.includes("/workspace/")
    || normalized.includes("/.openclaw/")
    || normalized.includes("/home/node/.openclaw/")
    || normalized.includes("/app/")
  );
}

function isRoutineHeartbeatText(value: unknown): boolean {
  const text = normalizeText(readNestedText(value));
  if (!text) {
    return false;
  }

  if (text === ROUTINE_HEARTBEAT_REPLY) {
    return true;
  }
  if (text.startsWith(ROUTINE_HEARTBEAT_PROMPT) && text.includes("workspace context")) {
    return true;
  }
  if (text.includes(ROUTINE_HEARTBEAT_PROMPT) && text.includes("reply heartbeat_ok")) {
    return true;
  }
  if (text.includes("# heartbeat.md template") && text.includes("skip heartbeat api calls")) {
    return true;
  }
  if (text.includes("enoent") && isHeartbeatReadPath(text)) {
    return true;
  }
  return false;
}

function isHeartbeatReadTool(toolName: unknown, payload: unknown): boolean {
  if (normalizeText(toolName) !== "read") {
    return false;
  }
  return isHeartbeatReadPath(stringifyValue(payload));
}

function hasSecuritySignal(item: IngestItemV1): boolean {
  if (item.kind === "approvalUpsert" || item.kind === "lynxCheckUpsert") {
    return true;
  }

  if (item.kind === "auditEvent") {
    const data = item.data;
    return Boolean(
      data.riskLevel
      || data.riskScore !== undefined
      || data.primaryModule
      || data.modules?.length
      || SECURITY_ENFORCEMENT_ACTIONS.has(data.enforcementAction)
      || (data.policyDecision && SECURITY_POLICY_DECISIONS.has(data.policyDecision)),
    );
  }

  if (item.kind === "toolCallUpsert") {
    const data = item.data;
    return Boolean(
      data.riskLevel
      || data.riskScore !== undefined
      || data.triggeredModules?.length
      || SECURITY_ENFORCEMENT_ACTIONS.has(data.enforcementAction),
    );
  }

  return false;
}

function isHeartbeatSession(item: SessionUpsertItem): boolean {
  return [
    item.data.channelProfile,
    item.data.channelId,
    item.data.accountId,
    item.data.conversationId,
    item.data.metadataJson,
  ].some((value) => normalizeText(readNestedText(value)) === "heartbeat");
}

function isRoutineHeartbeatAuditItem(item: AuditEventItem, heartbeatToolCallIds: Set<string>): boolean {
  const data = item.data;
  if (hasSecuritySignal(item)) {
    return false;
  }

  if (data.toolCallId && heartbeatToolCallIds.has(data.toolCallId)) {
    return true;
  }
  if (isRoutineHeartbeatText(data.contentExcerpt) || isRoutineHeartbeatText(data.payloadJson)) {
    return true;
  }
  if (data.hookName === "before_tool_call" || data.hookName === "after_tool_call" || data.hookName === "tool_result_persist") {
    return isHeartbeatReadTool(
      isRecord(data.payloadJson) ? data.payloadJson.toolName : undefined,
      data.payloadJson,
    );
  }
  return false;
}

function isRoutineHeartbeatToolCallItem(item: ToolCallUpsertItem): boolean {
  if (hasSecuritySignal(item)) {
    return false;
  }
  return isHeartbeatReadTool(item.data.toolName, [
    item.data.paramSummary,
    item.data.resultExcerpt,
    item.data.errorText,
    item.data.metadataJson,
  ]);
}

function isRoutineHeartbeatTokenUsageItem(item: TokenUsageItem): boolean {
  return isRoutineHeartbeatText(item.data.payloadJson);
}

function resolveHeartbeatToolCallIds(items: IngestItemV1[]): Set<string> {
  const ids = new Set<string>();
  for (const item of items) {
    if (item.kind === "toolCallUpsert" && isRoutineHeartbeatToolCallItem(item)) {
      ids.add(item.data.toolCallId);
    }
  }
  return ids;
}

function isRoutineHeartbeatItem(item: IngestItemV1, heartbeatToolCallIds: Set<string>): boolean {
  switch (item.kind) {
    case "auditEvent":
      return isRoutineHeartbeatAuditItem(item, heartbeatToolCallIds);
    case "toolCallUpsert":
      return isRoutineHeartbeatToolCallItem(item);
    case "sessionUpsert":
      return isHeartbeatSession(item);
    case "tokenUsage":
      return isRoutineHeartbeatTokenUsageItem(item);
    default:
      return false;
  }
}

export function filterRoutineHeartbeatIngestItems(items: IngestItemV1[]): IngestItemV1[] {
  const heartbeatToolCallIds = resolveHeartbeatToolCallIds(items);
  const retained = items.filter((item) => !isRoutineHeartbeatItem(item, heartbeatToolCallIds));
  const hasNonSessionItem = retained.some((item) => item.kind !== "sessionUpsert");

  return hasNonSessionItem ? retained : [];
}

function hasHeartbeatContext(ctx: unknown): boolean {
  if (!isRecord(ctx)) {
    return false;
  }

  return [
    ctx.messageProvider,
    ctx.trigger,
    ctx.channelId,
    ctx.channel,
    ctx.provider,
    ctx.surface,
  ].some((value) => normalizeText(value) === "heartbeat");
}

export function shouldSkipRoutineHeartbeatProbe(hookName: string, payload: unknown, ctx: unknown): boolean {
  const normalizedHook = normalizeText(hookName);
  if (hasHeartbeatContext(ctx) && (
    normalizedHook === "llm_output"
    || isRoutineHeartbeatText(payload)
    || isHeartbeatReadTool(isRecord(payload) ? payload.toolName : undefined, payload)
  )) {
    return true;
  }

  if (normalizedHook === "after_tool_call" || normalizedHook === "tool_result_persist") {
    return isHeartbeatReadTool(isRecord(payload) ? payload.toolName : undefined, payload);
  }

  return false;
}
