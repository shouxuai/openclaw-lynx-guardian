export const LOCAL_CONSOLE_INGEST_SCHEMA_VERSION = "lynx-console.ingest.v1" as const;
export const LOCAL_CONSOLE_QUERY_API_VERSION = "v1" as const;
export const LOCAL_CONSOLE_API_BASE_PATH = "/lynx" as const;

export const RISK_LEVELS = ["L0", "L1", "L2", "L3", "L4"] as const;
export type RiskLevel = typeof RISK_LEVELS[number];

export const ENFORCEMENT_ACTIONS = [
  "allow",
  "warn",
  "block",
  "redact",
  "requireApproval",
  "logOnly",
] as const;
export type EnforcementAction = typeof ENFORCEMENT_ACTIONS[number];

export const INGEST_ITEM_KINDS = [
  "sessionUpsert",
  "auditEvent",
  "toolCallUpsert",
  "approvalUpsert",
  "lynxCheckUpsert",
  "tokenUsage",
] as const;
export type IngestItemKind = typeof INGEST_ITEM_KINDS[number];

export const INGEST_SOURCE_KINDS = [
  "plugin_hook",
  "system_task",
  "sidecar",
] as const;
export type IngestSourceKind = typeof INGEST_SOURCE_KINDS[number];

export const INGEST_DIRECTIONS = ["input", "output", "internal"] as const;
export type IngestDirection = typeof INGEST_DIRECTIONS[number];

export const APPROVAL_SCOPE_TYPES = [
  "singleTool",
  "workflow",
  "timeWindow",
] as const;
export type ApprovalScopeType = typeof APPROVAL_SCOPE_TYPES[number];

export const LYNX_CHECK_SOURCES = ["manual", "scheduled"] as const;
export type LynxCheckSource = typeof LYNX_CHECK_SOURCES[number];

export const LYNX_CHECK_TRIGGERS = [
  "lynx_command",
  "scheduled_lynx_check",
] as const;
export type LynxCheckTrigger = typeof LYNX_CHECK_TRIGGERS[number];

export const LYNX_CHECK_TARGET_KINDS = ["current", "recent"] as const;
export type LynxCheckPreferredTargetKind = typeof LYNX_CHECK_TARGET_KINDS[number];

export const LYNX_CHECK_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
  "not_started",
] as const;
export type LynxCheckStatus = typeof LYNX_CHECK_STATUSES[number];

export const TOKEN_TREND_BUCKETS = ["hour", "day"] as const;
export type TokenTrendBucket = typeof TOKEN_TREND_BUCKETS[number];
