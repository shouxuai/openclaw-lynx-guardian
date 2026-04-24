export const LOCAL_CONSOLE_INGEST_SCHEMA_VERSION = "lynx-console.ingest.v1";
export const LOCAL_CONSOLE_QUERY_API_VERSION = "v1";
export const LOCAL_CONSOLE_API_BASE_PATH = "/lynx";
export const RISK_LEVELS = ["L0", "L1", "L2", "L3", "L4"];
export const ENFORCEMENT_ACTIONS = [
    "allow",
    "warn",
    "block",
    "redact",
    "requireApproval",
    "logOnly",
];
export const INGEST_ITEM_KINDS = [
    "sessionUpsert",
    "auditEvent",
    "toolCallUpsert",
    "approvalUpsert",
    "lynxCheckUpsert",
    "tokenUsage",
];
export const INGEST_SOURCE_KINDS = [
    "plugin_hook",
    "system_task",
    "sidecar",
];
export const INGEST_DIRECTIONS = ["input", "output", "internal"];
export const APPROVAL_SCOPE_TYPES = [
    "singleTool",
    "workflow",
    "timeWindow",
];
export const LYNX_CHECK_SOURCES = ["manual", "scheduled"];
export const LYNX_CHECK_TRIGGERS = [
    "lynx_command",
    "scheduled_lynx_check",
];
export const LYNX_CHECK_TARGET_KINDS = ["current", "recent"];
export const LYNX_CHECK_STATUSES = [
    "pending",
    "running",
    "completed",
    "failed",
    "not_started",
];
export const TOKEN_TREND_BUCKETS = ["hour", "day"];
