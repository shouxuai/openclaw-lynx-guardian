// src/app.ts
import Fastify from "fastify";

// ../shared/src/enums.js
var LOCAL_CONSOLE_INGEST_SCHEMA_VERSION = "lynx-console.ingest.v1";
var LOCAL_CONSOLE_QUERY_API_VERSION = "v1";
var LOCAL_CONSOLE_API_BASE_PATH = "/lynx";
var RISK_LEVELS = ["L0", "L1", "L2", "L3", "L4"];
var ENFORCEMENT_ACTIONS = [
  "allow",
  "warn",
  "block",
  "redact",
  "requireApproval",
  "logOnly"
];
var INGEST_ITEM_KINDS = [
  "sessionUpsert",
  "auditEvent",
  "toolCallUpsert",
  "approvalUpsert",
  "lynxCheckUpsert",
  "tokenUsage"
];
var INGEST_SOURCE_KINDS = [
  "plugin_hook",
  "system_task",
  "sidecar"
];
var INGEST_DIRECTIONS = ["input", "output", "internal"];
var APPROVAL_SCOPE_TYPES = [
  "singleTool",
  "workflow",
  "timeWindow"
];
var LYNX_CHECK_SOURCES = ["manual", "scheduled"];
var LYNX_CHECK_TRIGGERS = [
  "lynx_command",
  "scheduled_lynx_check"
];
var LYNX_CHECK_TARGET_KINDS = ["current", "recent"];
var LYNX_CHECK_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
  "not_started"
];

// src/config/env.ts
import { existsSync, mkdirSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
var DEFAULT_LOCAL_CONSOLE_PORT = 31789;
var HERE = dirname(fileURLToPath(import.meta.url));
function resolveHomeDirectory() {
  const homeDir = process.env.USERPROFILE || process.env.HOME;
  if (!homeDir) {
    throw new Error("Unable to resolve the current user's home directory.");
  }
  return homeDir;
}
function expandWindowsHomePlaceholder(value) {
  return value.replace(/%USERPROFILE%/gi, resolveHomeDirectory());
}
function readTokenFromFile(tokenPath) {
  if (!existsSync(tokenPath)) {
    return "";
  }
  return readFileSync(tokenPath, "utf8").trim();
}
function readBooleanFlag(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes") {
      return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "no") {
      return false;
    }
  }
  return fallback;
}
function readStringList(value) {
  if (typeof value !== "string") {
    return [];
  }
  return value.split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}
function resolveFrontendDistPath(override, env) {
  if (override) {
    return resolve(override);
  }
  if (env.LYNX_LOCAL_CONSOLE_FRONTEND_DIST_PATH) {
    return resolve(env.LYNX_LOCAL_CONSOLE_FRONTEND_DIST_PATH);
  }
  const candidates = [
    resolve(HERE, "../../frontend/dist"),
    resolve(HERE, "../../../frontend/dist")
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}
function resolveBackendConfig(env = process.env, overrides = {}) {
  const dataDir = resolve(
    overrides.dataDir ?? expandWindowsHomePlaceholder(
      env.LYNX_LOCAL_CONSOLE_DATA_DIR ?? "%USERPROFILE%\\.openclaw\\lynx\\data"
    )
  );
  mkdirSync(dataDir, { recursive: true });
  const tokenPath = resolve(
    overrides.tokenPath ?? env.LYNX_LOCAL_CONSOLE_TOKEN_PATH ?? join(dataDir, "console.token")
  );
  const host = overrides.host ?? env.LYNX_LOCAL_CONSOLE_HOST ?? "127.0.0.1";
  return {
    host,
    listenHost: overrides.listenHost ?? env.LYNX_LOCAL_CONSOLE_LISTEN_HOST ?? host,
    port: overrides.port ?? Number.parseInt(env.LYNX_LOCAL_CONSOLE_PORT ?? String(DEFAULT_LOCAL_CONSOLE_PORT), 10),
    dataDir,
    databasePath: resolve(
      overrides.databasePath ?? env.LYNX_LOCAL_CONSOLE_DB_PATH ?? join(dataDir, "lynx.db")
    ),
    ingestToken: overrides.ingestToken ?? env.LYNX_LOCAL_CONSOLE_TOKEN ?? readTokenFromFile(tokenPath),
    tokenPath,
    frontendDistPath: resolveFrontendDistPath(overrides.frontendDistPath, env),
    tokenUsageEnabled: readBooleanFlag(
      overrides.tokenUsageEnabled ?? env.LYNX_LOCAL_CONSOLE_TOKEN_USAGE_ENABLED,
      false
    ),
    trustedProxyIps: overrides.trustedProxyIps ?? readStringList(env.LYNX_LOCAL_CONSOLE_TRUSTED_PROXY_IPS)
  };
}

// src/db/sqlite.ts
import { mkdirSync as mkdirSync2 } from "fs";
import { dirname as dirname2 } from "path";
import Database from "better-sqlite3";

// src/db/pragmas.ts
function applySqlitePragmas(database) {
  database.pragma("journal_mode = WAL");
  database.pragma("synchronous = NORMAL");
  database.pragma("foreign_keys = OFF");
  database.pragma("busy_timeout = 5000");
}

// src/db/sqlite.ts
function openSqliteDatabase(databasePath) {
  mkdirSync2(dirname2(databasePath), { recursive: true });
  const database = new Database(databasePath);
  applySqlitePragmas(database);
  return database;
}

// src/db/migrate.ts
import { readFileSync as readFileSync2 } from "fs";
var INITIAL_SCHEMA_VERSION = "001_init";
var INITIAL_SCHEMA_SQL = readFileSync2(
  new URL("./migrations/001_init.sql", import.meta.url),
  "utf8"
);
function runMigrations(database) {
  database.exec(INITIAL_SCHEMA_SQL);
  database.prepare(
    `
      INSERT OR IGNORE INTO schema_migrations (version, applied_at)
      VALUES (?, ?)
      `
  ).run(INITIAL_SCHEMA_VERSION, Date.now());
}

// src/middleware/ingest-auth.ts
function requireIngestAuth(expectedToken) {
  return async function ingestAuth(request, reply) {
    if (!expectedToken) {
      await reply.code(503).send({
        ok: false,
        message: "Local console ingest token is not configured."
      });
      return;
    }
    const authorization = request.headers.authorization ?? "";
    if (authorization !== `Bearer ${expectedToken}`) {
      await reply.code(401).send({
        ok: false,
        message: "Unauthorized"
      });
    }
  };
}

// src/middleware/localhost-only.ts
import { existsSync as existsSync2, readFileSync as readFileSync3 } from "fs";
var LOOPBACK_ADDRESSES = /* @__PURE__ */ new Set([
  "127.0.0.1",
  "::1",
  "::ffff:127.0.0.1"
]);
function normalizeAddress(address) {
  const trimmed = address.trim();
  return trimmed.startsWith("::ffff:") ? trimmed.slice("::ffff:".length) : trimmed;
}
function addTrustedAddress(addresses, candidate) {
  const normalized = normalizeAddress(candidate);
  if (!normalized) {
    return;
  }
  addresses.add(normalized);
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalized)) {
    addresses.add(`::ffff:${normalized}`);
  }
}
function parseLinuxRouteGateway(gatewayHex) {
  if (!/^[0-9a-fA-F]{8}$/.test(gatewayHex)) {
    return null;
  }
  const octets = gatewayHex.match(/../g);
  if (!octets || octets.length !== 4) {
    return null;
  }
  return octets.reverse().map((octet) => Number.parseInt(octet, 16)).join(".");
}
function parseLinuxDefaultGatewayAddresses(routeTable) {
  const addresses = /* @__PURE__ */ new Set();
  for (const line of routeTable.split(/\r?\n/).slice(1)) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 3) {
      continue;
    }
    const destination = columns[1];
    const gateway = columns[2];
    if (destination !== "00000000" || gateway === "00000000") {
      continue;
    }
    const parsedGateway = parseLinuxRouteGateway(gateway);
    if (parsedGateway) {
      addresses.add(parsedGateway);
    }
  }
  return [...addresses];
}
function resolveTrustedProxyIps(routeTablePath = "/proc/net/route") {
  if (!existsSync2(routeTablePath)) {
    return [];
  }
  try {
    return parseLinuxDefaultGatewayAddresses(readFileSync3(routeTablePath, "utf8"));
  } catch {
    return [];
  }
}
function buildTrustedAddressSet(trustedProxyIps) {
  const addresses = new Set(LOOPBACK_ADDRESSES);
  for (const proxyIp of trustedProxyIps) {
    addTrustedAddress(addresses, proxyIp);
  }
  return addresses;
}
function createRequireLoopback(options = {}) {
  const trustedAddresses = buildTrustedAddressSet(
    options.trustedProxyIps && options.trustedProxyIps.length > 0 ? options.trustedProxyIps : resolveTrustedProxyIps()
  );
  return async function requireLoopback(request, reply) {
    const candidate = request.ip || request.socket.remoteAddress;
    if (!candidate || trustedAddresses.has(candidate) || trustedAddresses.has(normalizeAddress(candidate))) {
      return;
    }
    await reply.code(403).send({
      ok: false,
      message: "Local console only accepts loopback requests."
    });
  };
}

// ../shared/src/cursor.ts
function encodeCursor(payload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}
function decodeCursor(cursor) {
  if (!cursor) {
    return void 0;
  }
  return JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
}

// src/services/cursor-service.ts
var DEFAULT_LIST_LIMIT = 20;
var MAX_LIST_LIMIT = 100;
function resolveListLimit(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_LIST_LIMIT;
  }
  return Math.max(1, Math.min(MAX_LIST_LIMIT, Math.trunc(value)));
}
function encodeDescendingCursor(sortValue, id) {
  return encodeCursor({
    sortValue,
    id
  });
}
function decodeDescendingCursor(cursor) {
  if (!cursor) {
    return void 0;
  }
  try {
    const parsed = decodeCursor(cursor);
    if (parsed && typeof parsed.sortValue === "number" && Number.isFinite(parsed.sortValue) && typeof parsed.id === "string" && parsed.id.length > 0) {
      return {
        sortValue: Math.trunc(parsed.sortValue),
        id: parsed.id
      };
    }
  } catch {
    return void 0;
  }
  return void 0;
}
function buildCursorPage(rows, limit, mapRow, getCursor) {
  const pageRows = rows.slice(0, limit);
  const lastRow = pageRows[pageRows.length - 1];
  return {
    items: pageRows.map(mapRow),
    nextCursor: rows.length > limit && lastRow ? encodeDescendingCursor(getCursor(lastRow).sortValue, getCursor(lastRow).id) : void 0
  };
}

// src/repositories/query-utils.ts
function appendRangeFilter(filters, parameters, fieldName, fromMs, toMs) {
  if (typeof fromMs === "number" && Number.isFinite(fromMs)) {
    filters.push(`${fieldName} >= ?`);
    parameters.push(Math.trunc(fromMs));
  }
  if (typeof toMs === "number" && Number.isFinite(toMs)) {
    filters.push(`${fieldName} <= ?`);
    parameters.push(Math.trunc(toMs));
  }
}
function appendEqualsFilter(filters, parameters, fieldName, value) {
  if (!value) {
    return;
  }
  filters.push(`${fieldName} = ?`);
  parameters.push(value);
}
function appendBooleanFilter(filters, parameters, fieldName, value) {
  if (typeof value !== "boolean") {
    return;
  }
  filters.push(`${fieldName} = ?`);
  parameters.push(value ? 1 : 0);
}
function appendInFilter(filters, parameters, fieldName, values) {
  if (!values || values.length === 0) {
    return;
  }
  filters.push(`${fieldName} IN (${values.map(() => "?").join(", ")})`);
  parameters.push(...values);
}
function appendDescendingCursorFilter(filters, parameters, sortFieldName, idFieldName, cursor) {
  if (!cursor) {
    return;
  }
  filters.push(`(${sortFieldName} < ? OR (${sortFieldName} = ? AND ${idFieldName} < ?))`);
  parameters.push(cursor.sortValue, cursor.sortValue, cursor.id);
}
function buildWhereClause(filters) {
  return filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
}

// src/repositories/sql-mappers.ts
var ENFORCEMENT_ACTION_TO_DB = {
  allow: "allow",
  warn: "warn",
  block: "block",
  redact: "redact",
  requireApproval: "require_approval",
  logOnly: "log_only"
};
var DB_TO_ENFORCEMENT_ACTION = {
  allow: "allow",
  warn: "warn",
  block: "block",
  redact: "redact",
  require_approval: "requireApproval",
  log_only: "logOnly"
};
var APPROVAL_SCOPE_TO_DB = {
  singleTool: "single_tool",
  workflow: "workflow",
  timeWindow: "time_window"
};
var DB_TO_APPROVAL_SCOPE = {
  single_tool: "singleTool",
  workflow: "workflow",
  time_window: "timeWindow"
};
function toDbEnforcementAction(value) {
  return ENFORCEMENT_ACTION_TO_DB[value];
}
function fromDbEnforcementAction(value) {
  if (!value) {
    return void 0;
  }
  return DB_TO_ENFORCEMENT_ACTION[value];
}
function toDbApprovalScopeType(value) {
  return APPROVAL_SCOPE_TO_DB[value];
}
function fromDbApprovalScopeType(value) {
  if (!value) {
    return void 0;
  }
  return DB_TO_APPROVAL_SCOPE[value];
}
function parseJsonRecord(value) {
  if (!value) {
    return void 0;
  }
  return JSON.parse(value);
}
function parseJsonArray(value) {
  if (!value) {
    return void 0;
  }
  return JSON.parse(value);
}
function fromDbBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }
  return value === 1;
}

// src/repositories/approvals-repository.ts
function mapApprovalListRow(row) {
  return {
    approvalId: row.approval_id,
    pendingId: row.pending_id ?? void 0,
    sessionKey: row.session_key ?? void 0,
    runId: row.run_id ?? void 0,
    transport: row.transport ?? void 0,
    requesterOuId: row.requester_ou_id ?? void 0,
    module: row.module,
    riskLevel: row.risk_level,
    toolName: row.tool_name ?? void 0,
    scopeType: fromDbApprovalScopeType(row.scope_type) ?? "workflow",
    requestedAtMs: row.requested_at,
    expiresAtMs: row.expires_at,
    resolvedAtMs: row.resolved_at ?? void 0,
    resolution: row.resolution ?? void 0,
    promptExcerpt: row.prompt_excerpt ?? void 0
  };
}
var ApprovalsRepository = class {
  constructor(database) {
    this.database = database;
  }
  list(query) {
    const limit = resolveListLimit(query.limit);
    const cursor = decodeDescendingCursor(query.cursor);
    const filters = [];
    const parameters = [];
    appendRangeFilter(filters, parameters, "requested_at", query.fromMs, query.toMs);
    appendEqualsFilter(filters, parameters, "session_key", query.sessionKey);
    appendEqualsFilter(filters, parameters, "run_id", query.runId);
    appendEqualsFilter(filters, parameters, "resolution", query.resolution);
    appendEqualsFilter(filters, parameters, "tool_name", query.toolName);
    appendEqualsFilter(filters, parameters, "module", query.module);
    appendEqualsFilter(filters, parameters, "requester_ou_id", query.requesterOuId);
    appendInFilter(filters, parameters, "risk_level", query.riskLevel);
    appendEqualsFilter(
      filters,
      parameters,
      "scope_type",
      query.scopeType ? toDbApprovalScopeType(query.scopeType) : void 0
    );
    appendDescendingCursorFilter(filters, parameters, "requested_at", "approval_id", cursor);
    const rows = this.database.prepare(
      `
        SELECT
          approval_id,
          pending_id,
          session_key,
          run_id,
          transport,
          requester_ou_id,
          module,
          risk_level,
          tool_name,
          scope_type,
          requested_at,
          expires_at,
          resolved_at,
          resolution,
          prompt_excerpt
        FROM approvals
        ${buildWhereClause(filters)}
        ORDER BY requested_at DESC, approval_id DESC
        LIMIT ?
        `
    ).all(...parameters, limit + 1);
    return buildCursorPage(
      rows,
      limit,
      mapApprovalListRow,
      (row) => ({
        sortValue: row.requested_at,
        id: row.approval_id
      })
    );
  }
  getById(approvalId) {
    const row = this.database.prepare(
      `
        SELECT
          approval_id,
          pending_id,
          session_key,
          run_id,
          transport,
          channel_profile,
          channel_id,
          account_id,
          conversation_id,
          requester_ou_id,
          approver_ou_ids_json,
          resolved_approver_ou_id,
          request_fingerprint_hash,
          module,
          risk_level,
          tool_name,
          scope_type,
          requested_at,
          expires_at,
          resolved_at,
          resolution,
          prompt_excerpt,
          audit_summary_json,
          metadata_json
        FROM approvals
        WHERE approval_id = ?
        `
    ).get(approvalId);
    if (!row) {
      return null;
    }
    return {
      ...mapApprovalListRow(row),
      channelProfile: row.channel_profile ?? void 0,
      channelId: row.channel_id ?? void 0,
      accountId: row.account_id ?? void 0,
      conversationId: row.conversation_id ?? void 0,
      approverOuIds: parseJsonArray(row.approver_ou_ids_json),
      resolvedApproverOuId: row.resolved_approver_ou_id ?? void 0,
      requestFingerprintHash: row.request_fingerprint_hash ?? void 0,
      auditSummaryJson: parseJsonRecord(row.audit_summary_json),
      metadataJson: parseJsonRecord(row.metadata_json)
    };
  }
};

// src/repositories/events-repository.ts
function mapAuditEventListRow(row) {
  return {
    eventId: row.event_id,
    sessionKey: row.session_key ?? void 0,
    runId: row.run_id ?? void 0,
    toolCallId: row.tool_call_id ?? void 0,
    approvalId: row.approval_id ?? void 0,
    requestId: row.request_id ?? void 0,
    sourceKind: row.source_kind,
    hookName: row.hook_name,
    eventType: row.event_type,
    category: row.category,
    subCategory: row.sub_category ?? void 0,
    direction: row.direction ?? void 0,
    primaryModule: row.primary_module ?? void 0,
    riskLevel: row.risk_level ?? void 0,
    riskScore: row.risk_score ?? void 0,
    policyDecision: row.policy_decision ?? void 0,
    enforcementAction: fromDbEnforcementAction(row.enforcement_action) ?? "allow",
    title: row.title,
    summary: row.summary ?? void 0,
    contentExcerpt: row.content_excerpt ?? void 0,
    occurredAtMs: row.occurred_at
  };
}
var EventsRepository = class {
  constructor(database) {
    this.database = database;
  }
  list(query) {
    const limit = resolveListLimit(query.limit);
    const cursor = decodeDescendingCursor(query.cursor);
    const filters = [];
    const parameters = [];
    appendRangeFilter(filters, parameters, "occurred_at", query.fromMs, query.toMs);
    appendEqualsFilter(filters, parameters, "session_key", query.sessionKey);
    appendEqualsFilter(filters, parameters, "run_id", query.runId);
    appendEqualsFilter(filters, parameters, "hook_name", query.hookName);
    appendEqualsFilter(filters, parameters, "event_type", query.eventType);
    appendEqualsFilter(filters, parameters, "category", query.category);
    appendEqualsFilter(filters, parameters, "sub_category", query.subCategory);
    appendEqualsFilter(filters, parameters, "direction", query.direction);
    appendEqualsFilter(filters, parameters, "primary_module", query.primaryModule);
    appendEqualsFilter(filters, parameters, "request_id", query.requestId);
    appendEqualsFilter(filters, parameters, "tool_call_id", query.toolCallId);
    appendEqualsFilter(filters, parameters, "approval_id", query.approvalId);
    appendInFilter(filters, parameters, "risk_level", query.riskLevel);
    appendInFilter(
      filters,
      parameters,
      "enforcement_action",
      query.enforcementAction?.map((value) => toDbEnforcementAction(value))
    );
    appendDescendingCursorFilter(filters, parameters, "occurred_at", "event_id", cursor);
    const rows = this.database.prepare(
      `
        SELECT
          event_id,
          session_key,
          run_id,
          tool_call_id,
          approval_id,
          request_id,
          source_kind,
          hook_name,
          event_type,
          category,
          sub_category,
          direction,
          primary_module,
          risk_level,
          risk_score,
          policy_decision,
          enforcement_action,
          title,
          summary,
          content_excerpt,
          occurred_at
        FROM audit_events
        ${buildWhereClause(filters)}
        ORDER BY occurred_at DESC, event_id DESC
        LIMIT ?
        `
    ).all(...parameters, limit + 1);
    return buildCursorPage(
      rows,
      limit,
      mapAuditEventListRow,
      (row) => ({
        sortValue: row.occurred_at,
        id: row.event_id
      })
    );
  }
  getById(eventId) {
    const row = this.database.prepare(
      `
        SELECT
          event_id,
          session_key,
          run_id,
          tool_call_id,
          approval_id,
          request_id,
          source_kind,
          hook_name,
          event_type,
          category,
          sub_category,
          direction,
          content_kind,
          primary_module,
          modules_json,
          risk_level,
          risk_score,
          policy_decision,
          enforcement_action,
          title,
          summary,
          recommendation,
          content_excerpt,
          content_hash,
          occurred_at,
          ingested_at,
          payload_json
        FROM audit_events
        WHERE event_id = ?
        `
    ).get(eventId);
    if (!row) {
      return null;
    }
    return {
      ...mapAuditEventListRow(row),
      contentKind: row.content_kind ?? void 0,
      modules: parseJsonArray(row.modules_json),
      recommendation: row.recommendation ?? void 0,
      contentHash: row.content_hash ?? void 0,
      ingestedAtMs: row.ingested_at,
      payloadJson: parseJsonRecord(row.payload_json)
    };
  }
};

// src/repositories/tool-calls-repository.ts
function mapToolCallListRow(row) {
  return {
    toolCallId: row.tool_call_id,
    sessionKey: row.session_key ?? void 0,
    runId: row.run_id ?? void 0,
    approvalId: row.approval_id ?? void 0,
    toolName: row.tool_name,
    riskLevel: row.risk_level ?? void 0,
    riskScore: row.risk_score ?? void 0,
    policyDecision: row.policy_decision ?? void 0,
    enforcementAction: fromDbEnforcementAction(row.enforcement_action) ?? "allow",
    startedAtMs: row.started_at,
    finishedAtMs: row.finished_at ?? void 0,
    durationMs: row.duration_ms ?? void 0,
    resultStatus: row.result_status ?? void 0,
    resultExcerpt: row.result_excerpt ?? void 0
  };
}
var ToolCallsRepository = class {
  constructor(database) {
    this.database = database;
  }
  list(query) {
    const limit = resolveListLimit(query.limit);
    const cursor = decodeDescendingCursor(query.cursor);
    const filters = [];
    const parameters = [];
    appendRangeFilter(filters, parameters, "started_at", query.fromMs, query.toMs);
    appendEqualsFilter(filters, parameters, "session_key", query.sessionKey);
    appendEqualsFilter(filters, parameters, "run_id", query.runId);
    appendEqualsFilter(filters, parameters, "tool_name", query.toolName);
    appendEqualsFilter(filters, parameters, "result_status", query.resultStatus);
    appendEqualsFilter(filters, parameters, "approval_id", query.approvalId);
    appendInFilter(filters, parameters, "risk_level", query.riskLevel);
    appendInFilter(
      filters,
      parameters,
      "enforcement_action",
      query.enforcementAction?.map((value) => toDbEnforcementAction(value))
    );
    appendDescendingCursorFilter(filters, parameters, "started_at", "tool_call_id", cursor);
    const rows = this.database.prepare(
      `
        SELECT
          tool_call_id,
          session_key,
          run_id,
          approval_id,
          tool_name,
          risk_level,
          risk_score,
          policy_decision,
          enforcement_action,
          started_at,
          finished_at,
          duration_ms,
          result_status,
          result_excerpt
        FROM tool_calls
        ${buildWhereClause(filters)}
        ORDER BY started_at DESC, tool_call_id DESC
        LIMIT ?
        `
    ).all(...parameters, limit + 1);
    return buildCursorPage(
      rows,
      limit,
      mapToolCallListRow,
      (row) => ({
        sortValue: row.started_at,
        id: row.tool_call_id
      })
    );
  }
  getById(toolCallId) {
    const row = this.database.prepare(
      `
        SELECT
          tool_call_id,
          session_key,
          run_id,
          approval_id,
          tool_name,
          param_summary,
          param_hash,
          triggered_modules_json,
          risk_level,
          risk_score,
          policy_decision,
          enforcement_action,
          started_at,
          finished_at,
          duration_ms,
          result_status,
          result_excerpt,
          error_text,
          metadata_json
        FROM tool_calls
        WHERE tool_call_id = ?
        `
    ).get(toolCallId);
    if (!row) {
      return null;
    }
    return {
      ...mapToolCallListRow(row),
      paramSummary: row.param_summary ?? void 0,
      paramHash: row.param_hash ?? void 0,
      triggeredModules: parseJsonArray(row.triggered_modules_json),
      errorText: row.error_text ?? void 0,
      metadataJson: parseJsonRecord(row.metadata_json)
    };
  }
};

// src/repositories/dashboard-repository.ts
function buildTimeRangeWhere(fieldName, fromMs, toMs) {
  const filters = [];
  const parameters = [];
  if (typeof fromMs === "number" && Number.isFinite(fromMs)) {
    filters.push(`${fieldName} >= ?`);
    parameters.push(Math.trunc(fromMs));
  }
  if (typeof toMs === "number" && Number.isFinite(toMs)) {
    filters.push(`${fieldName} <= ?`);
    parameters.push(Math.trunc(toMs));
  }
  return {
    whereClause: buildWhereClause(filters),
    parameters
  };
}
var DashboardRepository = class {
  constructor(database) {
    this.database = database;
  }
  getOverview(query) {
    const eventsRange = buildTimeRangeWhere("occurred_at", query.fromMs, query.toMs);
    const toolCallsRange = buildTimeRangeWhere("started_at", query.fromMs, query.toMs);
    const approvalsRange = buildTimeRangeWhere("requested_at", query.fromMs, query.toMs);
    const lynxChecksRange = buildTimeRangeWhere("created_at", query.fromMs, query.toMs);
    const tokensRange = buildTimeRangeWhere("occurred_at", query.fromMs, query.toMs);
    const totals = {
      eventCount: this.database.prepare(`SELECT COUNT(*) AS count FROM audit_events ${eventsRange.whereClause}`).get(...eventsRange.parameters).count,
      highRiskEventCount: this.database.prepare(
        `SELECT COUNT(*) AS count FROM audit_events ${eventsRange.whereClause ? `${eventsRange.whereClause} AND` : "WHERE"} risk_level IN ('L3', 'L4')`
      ).get(...eventsRange.parameters).count,
      toolCallCount: this.database.prepare(`SELECT COUNT(*) AS count FROM tool_calls ${toolCallsRange.whereClause}`).get(...toolCallsRange.parameters).count,
      approvalCount: this.database.prepare(`SELECT COUNT(*) AS count FROM approvals ${approvalsRange.whereClause}`).get(...approvalsRange.parameters).count,
      lynxCheckCount: this.database.prepare(`SELECT COUNT(*) AS count FROM lynx_checks ${lynxChecksRange.whereClause}`).get(...lynxChecksRange.parameters).count,
      totalTokens: this.database.prepare(`SELECT COALESCE(SUM(total_tokens), 0) AS total_tokens FROM token_usage ${tokensRange.whereClause}`).get(...tokensRange.parameters).total_tokens
    };
    const riskDistribution = this.database.prepare(
      `
        SELECT risk_level, COUNT(*) AS count
        FROM audit_events
        ${eventsRange.whereClause ? `${eventsRange.whereClause} AND` : "WHERE"} risk_level IS NOT NULL
        GROUP BY risk_level
        ORDER BY risk_level ASC
        `
    ).all(...eventsRange.parameters);
    const enforcementDistribution = this.database.prepare(
      `
        SELECT enforcement_action, COUNT(*) AS count
        FROM audit_events
        ${eventsRange.whereClause}
        GROUP BY enforcement_action
        ORDER BY enforcement_action ASC
        `
    ).all(...eventsRange.parameters);
    const eventTrend = this.database.prepare(
      `
        SELECT
          CAST(occurred_at / 3600000 AS INTEGER) * 3600000 AS bucket_start_ms,
          COUNT(*) AS value
        FROM audit_events
        ${eventsRange.whereClause}
        GROUP BY bucket_start_ms
        ORDER BY bucket_start_ms ASC
        `
    ).all(...eventsRange.parameters);
    const tokenTrend = this.database.prepare(
      `
        SELECT
          CAST(occurred_at / 3600000 AS INTEGER) * 3600000 AS bucket_start_ms,
          COALESCE(SUM(total_tokens), 0) AS value
        FROM token_usage
        ${tokensRange.whereClause}
        GROUP BY bucket_start_ms
        ORDER BY bucket_start_ms ASC
        `
    ).all(...tokensRange.parameters);
    const recentHighRiskEvents = this.database.prepare(
      `
        SELECT
          event_id,
          session_key,
          run_id,
          tool_call_id,
          approval_id,
          request_id,
          source_kind,
          hook_name,
          event_type,
          category,
          sub_category,
          direction,
          primary_module,
          risk_level,
          risk_score,
          policy_decision,
          enforcement_action,
          title,
          summary,
          content_excerpt,
          occurred_at
        FROM audit_events
        ${eventsRange.whereClause ? `${eventsRange.whereClause} AND` : "WHERE"} risk_level IN ('L3', 'L4')
        ORDER BY occurred_at DESC, event_id DESC
        LIMIT 5
        `
    ).all(...eventsRange.parameters).map((row) => mapAuditEventListRow(row));
    const recentToolCalls = this.database.prepare(
      `
        SELECT
          tool_call_id,
          session_key,
          run_id,
          approval_id,
          tool_name,
          risk_level,
          risk_score,
          policy_decision,
          enforcement_action,
          started_at,
          finished_at,
          duration_ms,
          result_status,
          result_excerpt
        FROM tool_calls
        ${toolCallsRange.whereClause}
        ORDER BY started_at DESC, tool_call_id DESC
        LIMIT 5
        `
    ).all(...toolCallsRange.parameters).map((row) => mapToolCallListRow(row));
    const recentApprovals = this.database.prepare(
      `
        SELECT
          approval_id,
          pending_id,
          session_key,
          run_id,
          transport,
          requester_ou_id,
          module,
          risk_level,
          tool_name,
          scope_type,
          requested_at,
          expires_at,
          resolved_at,
          resolution,
          prompt_excerpt
        FROM approvals
        ${approvalsRange.whereClause}
        ORDER BY requested_at DESC, approval_id DESC
        LIMIT 5
        `
    ).all(...approvalsRange.parameters).map((row) => mapApprovalListRow(row));
    return {
      totals,
      riskDistribution: riskDistribution.map((row) => ({
        riskLevel: row.risk_level,
        count: row.count
      })),
      enforcementDistribution: enforcementDistribution.map((row) => ({
        enforcementAction: fromDbEnforcementAction(row.enforcement_action) ?? "allow",
        count: row.count
      })),
      eventTrend: eventTrend.map((row) => ({
        bucketStartMs: row.bucket_start_ms,
        value: row.value
      })),
      tokenTrend: tokenTrend.map((row) => ({
        bucketStartMs: row.bucket_start_ms,
        value: row.value
      })),
      recentHighRiskEvents,
      recentToolCalls,
      recentApprovals
    };
  }
};

// src/repositories/ingest-repository.ts
function toJson(value) {
  return value === void 0 ? null : JSON.stringify(value);
}
function toBooleanInteger(value) {
  return value ? 1 : 0;
}
var IngestRepository = class {
  constructor(database) {
    this.database = database;
  }
  withTransaction(callback) {
    const transaction = this.database.transaction(callback);
    return transaction();
  }
  persistSession(item) {
    const result = this.database.prepare(
      `
        INSERT INTO sessions (
          session_key,
          channel_profile,
          channel_id,
          requester_id,
          requester_ou_id,
          account_id,
          conversation_id,
          thread_id,
          is_group,
          first_seen_at,
          last_seen_at,
          ended_at,
          metadata_json
        ) VALUES (
          @sessionKey,
          @channelProfile,
          @channelId,
          @requesterId,
          @requesterOuId,
          @accountId,
          @conversationId,
          @threadId,
          @isGroup,
          @firstSeenAt,
          @lastSeenAt,
          @endedAt,
          @metadataJson
        )
        ON CONFLICT(session_key) DO UPDATE SET
          channel_profile = COALESCE(sessions.channel_profile, excluded.channel_profile),
          channel_id = COALESCE(sessions.channel_id, excluded.channel_id),
          requester_id = COALESCE(sessions.requester_id, excluded.requester_id),
          requester_ou_id = COALESCE(sessions.requester_ou_id, excluded.requester_ou_id),
          account_id = COALESCE(sessions.account_id, excluded.account_id),
          conversation_id = COALESCE(sessions.conversation_id, excluded.conversation_id),
          thread_id = COALESCE(sessions.thread_id, excluded.thread_id),
          is_group = CASE WHEN sessions.is_group = 1 OR excluded.is_group = 1 THEN 1 ELSE 0 END,
          first_seen_at = MIN(sessions.first_seen_at, excluded.first_seen_at),
          last_seen_at = MAX(sessions.last_seen_at, excluded.last_seen_at),
          ended_at = COALESCE(excluded.ended_at, sessions.ended_at),
          metadata_json = COALESCE(sessions.metadata_json, excluded.metadata_json)
        `
    ).run({
      sessionKey: item.data.sessionKey,
      channelProfile: item.data.channelProfile ?? null,
      channelId: item.data.channelId ?? null,
      requesterId: item.data.requesterId ?? null,
      requesterOuId: item.data.requesterOuId ?? null,
      accountId: item.data.accountId ?? null,
      conversationId: item.data.conversationId ?? null,
      threadId: item.data.threadId == null ? null : String(item.data.threadId),
      isGroup: toBooleanInteger(item.data.isGroup),
      firstSeenAt: item.data.firstSeenAtMs,
      lastSeenAt: item.data.lastSeenAtMs,
      endedAt: item.data.endedAtMs ?? null,
      metadataJson: toJson(item.data.metadataJson)
    });
    return { status: result.changes > 0 ? "persisted" : "duplicate" };
  }
  persistAuditEvent(item, ingestedAtMs) {
    const result = this.database.prepare(
      `
        INSERT OR IGNORE INTO audit_events (
          event_id,
          session_key,
          run_id,
          tool_call_id,
          approval_id,
          request_id,
          source_kind,
          hook_name,
          event_type,
          category,
          sub_category,
          direction,
          content_kind,
          primary_module,
          modules_json,
          risk_level,
          risk_score,
          policy_decision,
          enforcement_action,
          title,
          summary,
          recommendation,
          content_excerpt,
          content_hash,
          occurred_at,
          ingested_at,
          payload_json
        ) VALUES (
          @eventId,
          @sessionKey,
          @runId,
          @toolCallId,
          @approvalId,
          @requestId,
          @sourceKind,
          @hookName,
          @eventType,
          @category,
          @subCategory,
          @direction,
          @contentKind,
          @primaryModule,
          @modulesJson,
          @riskLevel,
          @riskScore,
          @policyDecision,
          @enforcementAction,
          @title,
          @summary,
          @recommendation,
          @contentExcerpt,
          @contentHash,
          @occurredAt,
          @ingestedAt,
          @payloadJson
        )
        `
    ).run({
      eventId: item.data.eventId,
      sessionKey: item.data.sessionKey ?? null,
      runId: item.data.runId ?? null,
      toolCallId: item.data.toolCallId ?? null,
      approvalId: item.data.approvalId ?? null,
      requestId: item.data.requestId ?? null,
      sourceKind: item.data.sourceKind,
      hookName: item.data.hookName,
      eventType: item.data.eventType,
      category: item.data.category,
      subCategory: item.data.subCategory ?? null,
      direction: item.data.direction ?? null,
      contentKind: item.data.contentKind ?? null,
      primaryModule: item.data.primaryModule ?? null,
      modulesJson: toJson(item.data.modules),
      riskLevel: item.data.riskLevel ?? null,
      riskScore: item.data.riskScore ?? null,
      policyDecision: item.data.policyDecision ?? null,
      enforcementAction: toDbEnforcementAction(item.data.enforcementAction),
      title: item.data.title,
      summary: item.data.summary ?? null,
      recommendation: item.data.recommendation ?? null,
      contentExcerpt: item.data.contentExcerpt ?? null,
      contentHash: item.data.contentHash ?? null,
      occurredAt: item.occurredAtMs,
      ingestedAt: ingestedAtMs,
      payloadJson: toJson(item.data.payloadJson)
    });
    return { status: result.changes > 0 ? "persisted" : "duplicate" };
  }
  persistToolCall(item) {
    const result = this.database.prepare(
      `
        INSERT INTO tool_calls (
          tool_call_id,
          session_key,
          run_id,
          approval_id,
          tool_name,
          param_summary,
          param_hash,
          triggered_modules_json,
          risk_level,
          risk_score,
          policy_decision,
          enforcement_action,
          started_at,
          finished_at,
          duration_ms,
          result_status,
          result_excerpt,
          error_text,
          metadata_json
        ) VALUES (
          @toolCallId,
          @sessionKey,
          @runId,
          @approvalId,
          @toolName,
          @paramSummary,
          @paramHash,
          @triggeredModulesJson,
          @riskLevel,
          @riskScore,
          @policyDecision,
          @enforcementAction,
          @startedAt,
          @finishedAt,
          @durationMs,
          @resultStatus,
          @resultExcerpt,
          @errorText,
          @metadataJson
        )
        ON CONFLICT(tool_call_id) DO UPDATE SET
          session_key = COALESCE(tool_calls.session_key, excluded.session_key),
          run_id = COALESCE(tool_calls.run_id, excluded.run_id),
          approval_id = COALESCE(tool_calls.approval_id, excluded.approval_id),
          tool_name = COALESCE(tool_calls.tool_name, excluded.tool_name),
          param_summary = COALESCE(tool_calls.param_summary, excluded.param_summary),
          param_hash = COALESCE(tool_calls.param_hash, excluded.param_hash),
          triggered_modules_json = COALESCE(tool_calls.triggered_modules_json, excluded.triggered_modules_json),
          risk_level = COALESCE(tool_calls.risk_level, excluded.risk_level),
          risk_score = COALESCE(tool_calls.risk_score, excluded.risk_score),
          policy_decision = COALESCE(tool_calls.policy_decision, excluded.policy_decision),
          enforcement_action = COALESCE(excluded.enforcement_action, tool_calls.enforcement_action),
          started_at = MIN(tool_calls.started_at, excluded.started_at),
          finished_at = COALESCE(excluded.finished_at, tool_calls.finished_at),
          duration_ms = COALESCE(excluded.duration_ms, tool_calls.duration_ms),
          result_status = COALESCE(excluded.result_status, tool_calls.result_status),
          result_excerpt = COALESCE(excluded.result_excerpt, tool_calls.result_excerpt),
          error_text = COALESCE(excluded.error_text, tool_calls.error_text),
          metadata_json = COALESCE(tool_calls.metadata_json, excluded.metadata_json)
        `
    ).run({
      toolCallId: item.data.toolCallId,
      sessionKey: item.data.sessionKey ?? null,
      runId: item.data.runId ?? null,
      approvalId: item.data.approvalId ?? null,
      toolName: item.data.toolName,
      paramSummary: item.data.paramSummary ?? null,
      paramHash: item.data.paramHash ?? null,
      triggeredModulesJson: toJson(item.data.triggeredModules),
      riskLevel: item.data.riskLevel ?? null,
      riskScore: item.data.riskScore ?? null,
      policyDecision: item.data.policyDecision ?? null,
      enforcementAction: toDbEnforcementAction(item.data.enforcementAction),
      startedAt: item.data.startedAtMs,
      finishedAt: item.data.finishedAtMs ?? null,
      durationMs: item.data.durationMs ?? null,
      resultStatus: item.data.resultStatus ?? null,
      resultExcerpt: item.data.resultExcerpt ?? null,
      errorText: item.data.errorText ?? null,
      metadataJson: toJson(item.data.metadataJson)
    });
    return { status: result.changes > 0 ? "persisted" : "duplicate" };
  }
  persistApproval(item) {
    const result = this.database.prepare(
      `
        INSERT INTO approvals (
          approval_id,
          pending_id,
          session_key,
          run_id,
          transport,
          channel_profile,
          channel_id,
          account_id,
          conversation_id,
          requester_ou_id,
          approver_ou_ids_json,
          resolved_approver_ou_id,
          request_fingerprint_hash,
          module,
          risk_level,
          tool_name,
          scope_type,
          requested_at,
          expires_at,
          resolved_at,
          resolution,
          prompt_excerpt,
          audit_summary_json,
          metadata_json
        ) VALUES (
          @approvalId,
          @pendingId,
          @sessionKey,
          @runId,
          @transport,
          @channelProfile,
          @channelId,
          @accountId,
          @conversationId,
          @requesterOuId,
          @approverOuIdsJson,
          @resolvedApproverOuId,
          @requestFingerprintHash,
          @module,
          @riskLevel,
          @toolName,
          @scopeType,
          @requestedAt,
          @expiresAt,
          @resolvedAt,
          @resolution,
          @promptExcerpt,
          @auditSummaryJson,
          @metadataJson
        )
        ON CONFLICT(approval_id) DO UPDATE SET
          pending_id = COALESCE(approvals.pending_id, excluded.pending_id),
          session_key = COALESCE(approvals.session_key, excluded.session_key),
          run_id = COALESCE(approvals.run_id, excluded.run_id),
          transport = COALESCE(approvals.transport, excluded.transport),
          channel_profile = COALESCE(approvals.channel_profile, excluded.channel_profile),
          channel_id = COALESCE(approvals.channel_id, excluded.channel_id),
          account_id = COALESCE(approvals.account_id, excluded.account_id),
          conversation_id = COALESCE(approvals.conversation_id, excluded.conversation_id),
          requester_ou_id = COALESCE(approvals.requester_ou_id, excluded.requester_ou_id),
          approver_ou_ids_json = COALESCE(approvals.approver_ou_ids_json, excluded.approver_ou_ids_json),
          resolved_approver_ou_id = COALESCE(excluded.resolved_approver_ou_id, approvals.resolved_approver_ou_id),
          request_fingerprint_hash = COALESCE(approvals.request_fingerprint_hash, excluded.request_fingerprint_hash),
          module = COALESCE(approvals.module, excluded.module),
          risk_level = COALESCE(approvals.risk_level, excluded.risk_level),
          tool_name = COALESCE(approvals.tool_name, excluded.tool_name),
          scope_type = COALESCE(approvals.scope_type, excluded.scope_type),
          requested_at = MIN(approvals.requested_at, excluded.requested_at),
          expires_at = MAX(approvals.expires_at, excluded.expires_at),
          resolved_at = COALESCE(excluded.resolved_at, approvals.resolved_at),
          resolution = COALESCE(excluded.resolution, approvals.resolution),
          prompt_excerpt = COALESCE(excluded.prompt_excerpt, approvals.prompt_excerpt),
          audit_summary_json = COALESCE(approvals.audit_summary_json, excluded.audit_summary_json),
          metadata_json = COALESCE(approvals.metadata_json, excluded.metadata_json)
        `
    ).run({
      approvalId: item.data.approvalId,
      pendingId: item.data.pendingId ?? null,
      sessionKey: item.data.sessionKey ?? null,
      runId: item.data.runId ?? null,
      transport: item.data.transport ?? null,
      channelProfile: item.data.channelProfile ?? null,
      channelId: item.data.channelId ?? null,
      accountId: item.data.accountId ?? null,
      conversationId: item.data.conversationId ?? null,
      requesterOuId: item.data.requesterOuId ?? null,
      approverOuIdsJson: toJson(item.data.approverOuIds),
      resolvedApproverOuId: item.data.resolvedApproverOuId ?? null,
      requestFingerprintHash: item.data.requestFingerprintHash ?? null,
      module: item.data.module,
      riskLevel: item.data.riskLevel,
      toolName: item.data.toolName ?? null,
      scopeType: toDbApprovalScopeType(item.data.scopeType),
      requestedAt: item.data.requestedAtMs,
      expiresAt: item.data.expiresAtMs,
      resolvedAt: item.data.resolvedAtMs ?? null,
      resolution: item.data.resolution ?? null,
      promptExcerpt: item.data.promptExcerpt ?? null,
      auditSummaryJson: toJson(item.data.auditSummaryJson),
      metadataJson: toJson(item.data.metadataJson)
    });
    return { status: result.changes > 0 ? "persisted" : "duplicate" };
  }
  persistLynxCheck(item) {
    const result = this.database.prepare(
      `
        INSERT INTO lynx_checks (
          request_id,
          source,
          trigger,
          preferred_target_kind,
          session_key,
          target_key,
          channel_id,
          message_provider,
          status,
          send_attempted,
          send_succeeded,
          transport,
          report_path,
          error_message,
          delivery_attempts_json,
          created_at,
          completed_at
        ) VALUES (
          @requestId,
          @source,
          @trigger,
          @preferredTargetKind,
          @sessionKey,
          @targetKey,
          @channelId,
          @messageProvider,
          @status,
          @sendAttempted,
          @sendSucceeded,
          @transport,
          @reportPath,
          @errorMessage,
          @deliveryAttemptsJson,
          @createdAt,
          @completedAt
        )
        ON CONFLICT(request_id) DO UPDATE SET
          source = COALESCE(lynx_checks.source, excluded.source),
          trigger = COALESCE(lynx_checks.trigger, excluded.trigger),
          preferred_target_kind = COALESCE(lynx_checks.preferred_target_kind, excluded.preferred_target_kind),
          session_key = COALESCE(lynx_checks.session_key, excluded.session_key),
          target_key = COALESCE(lynx_checks.target_key, excluded.target_key),
          channel_id = COALESCE(lynx_checks.channel_id, excluded.channel_id),
          message_provider = COALESCE(lynx_checks.message_provider, excluded.message_provider),
          status = COALESCE(excluded.status, lynx_checks.status),
          send_attempted = MAX(lynx_checks.send_attempted, excluded.send_attempted),
          send_succeeded = MAX(lynx_checks.send_succeeded, excluded.send_succeeded),
          transport = COALESCE(excluded.transport, lynx_checks.transport),
          report_path = COALESCE(excluded.report_path, lynx_checks.report_path),
          error_message = COALESCE(excluded.error_message, lynx_checks.error_message),
          delivery_attempts_json = COALESCE(excluded.delivery_attempts_json, lynx_checks.delivery_attempts_json),
          created_at = MIN(lynx_checks.created_at, excluded.created_at),
          completed_at = COALESCE(excluded.completed_at, lynx_checks.completed_at)
        `
    ).run({
      requestId: item.data.requestId,
      source: item.data.source,
      trigger: item.data.trigger,
      preferredTargetKind: item.data.preferredTargetKind,
      sessionKey: item.data.sessionKey ?? null,
      targetKey: item.data.targetKey ?? null,
      channelId: item.data.channelId ?? null,
      messageProvider: item.data.messageProvider ?? null,
      status: item.data.status,
      sendAttempted: toBooleanInteger(item.data.sendAttempted),
      sendSucceeded: toBooleanInteger(item.data.sendSucceeded),
      transport: item.data.transport ?? null,
      reportPath: item.data.reportPath ?? null,
      errorMessage: item.data.errorMessage ?? null,
      deliveryAttemptsJson: toJson(item.data.deliveryAttemptsJson),
      createdAt: item.data.createdAtMs,
      completedAt: item.data.completedAtMs ?? null
    });
    return { status: result.changes > 0 ? "persisted" : "duplicate" };
  }
  persistTokenUsage(item, ingestedAtMs) {
    const result = this.database.prepare(
      `
        INSERT OR IGNORE INTO token_usage (
          usage_event_id,
          session_key,
          run_id,
          agent_id,
          provider,
          model,
          input_tokens,
          output_tokens,
          cache_read_tokens,
          cache_write_tokens,
          total_tokens,
          assistant_text_count,
          is_estimated,
          occurred_at,
          ingested_at,
          payload_json
        ) VALUES (
          @usageEventId,
          @sessionKey,
          @runId,
          @agentId,
          @provider,
          @model,
          @inputTokens,
          @outputTokens,
          @cacheReadTokens,
          @cacheWriteTokens,
          @totalTokens,
          @assistantTextCount,
          @isEstimated,
          @occurredAt,
          @ingestedAt,
          @payloadJson
        )
        `
    ).run({
      usageEventId: item.data.usageEventId,
      sessionKey: item.data.sessionKey ?? null,
      runId: item.data.runId ?? null,
      agentId: item.data.agentId ?? null,
      provider: item.data.provider,
      model: item.data.model,
      inputTokens: item.data.inputTokens ?? 0,
      outputTokens: item.data.outputTokens ?? 0,
      cacheReadTokens: item.data.cacheReadTokens ?? 0,
      cacheWriteTokens: item.data.cacheWriteTokens ?? 0,
      totalTokens: item.data.totalTokens,
      assistantTextCount: item.data.assistantTextCount ?? 0,
      isEstimated: toBooleanInteger(item.data.isEstimated),
      occurredAt: item.occurredAtMs,
      ingestedAt: ingestedAtMs,
      payloadJson: toJson(item.data.payloadJson)
    });
    return { status: result.changes > 0 ? "persisted" : "duplicate" };
  }
};

// src/repositories/lynx-checks-repository.ts
function mapLynxCheckListRow(row) {
  return {
    requestId: row.request_id,
    source: row.source,
    trigger: row.trigger,
    preferredTargetKind: row.preferred_target_kind,
    sessionKey: row.session_key ?? void 0,
    targetKey: row.target_key ?? void 0,
    channelId: row.channel_id ?? void 0,
    messageProvider: row.message_provider ?? void 0,
    status: row.status,
    sendAttempted: fromDbBoolean(row.send_attempted),
    sendSucceeded: fromDbBoolean(row.send_succeeded),
    transport: row.transport ?? void 0,
    reportPath: row.report_path ?? void 0,
    errorMessage: row.error_message ?? void 0,
    createdAtMs: row.created_at,
    completedAtMs: row.completed_at ?? void 0
  };
}
var LynxChecksRepository = class {
  constructor(database) {
    this.database = database;
  }
  list(query) {
    const limit = resolveListLimit(query.limit);
    const cursor = decodeDescendingCursor(query.cursor);
    const filters = [];
    const parameters = [];
    appendRangeFilter(filters, parameters, "created_at", query.fromMs, query.toMs);
    appendEqualsFilter(filters, parameters, "session_key", query.sessionKey);
    appendEqualsFilter(filters, parameters, "source", query.source);
    appendEqualsFilter(filters, parameters, "trigger", query.trigger);
    appendEqualsFilter(filters, parameters, "status", query.status);
    appendEqualsFilter(filters, parameters, "message_provider", query.messageProvider);
    appendDescendingCursorFilter(filters, parameters, "created_at", "request_id", cursor);
    const rows = this.database.prepare(
      `
        SELECT
          request_id,
          source,
          trigger,
          preferred_target_kind,
          session_key,
          target_key,
          channel_id,
          message_provider,
          status,
          send_attempted,
          send_succeeded,
          transport,
          report_path,
          error_message,
          created_at,
          completed_at
        FROM lynx_checks
        ${buildWhereClause(filters)}
        ORDER BY created_at DESC, request_id DESC
        LIMIT ?
        `
    ).all(...parameters, limit + 1);
    return buildCursorPage(
      rows,
      limit,
      mapLynxCheckListRow,
      (row) => ({
        sortValue: row.created_at,
        id: row.request_id
      })
    );
  }
  getById(requestId) {
    const row = this.database.prepare(
      `
        SELECT
          request_id,
          source,
          trigger,
          preferred_target_kind,
          session_key,
          target_key,
          channel_id,
          message_provider,
          status,
          send_attempted,
          send_succeeded,
          transport,
          report_path,
          error_message,
          delivery_attempts_json,
          created_at,
          completed_at
        FROM lynx_checks
        WHERE request_id = ?
        `
    ).get(requestId);
    if (!row) {
      return null;
    }
    return {
      ...mapLynxCheckListRow(row),
      deliveryAttemptsJson: parseJsonArray(row.delivery_attempts_json)
    };
  }
};

// src/repositories/sessions-repository.ts
function mapSessionListRow(row) {
  return {
    sessionKey: row.session_key,
    channelProfile: row.channel_profile ?? void 0,
    channelId: row.channel_id ?? void 0,
    requesterId: row.requester_id ?? void 0,
    requesterOuId: row.requester_ou_id ?? void 0,
    accountId: row.account_id ?? void 0,
    conversationId: row.conversation_id ?? void 0,
    threadId: row.thread_id ?? void 0,
    isGroup: row.is_group === 1,
    firstSeenAtMs: row.first_seen_at,
    lastSeenAtMs: row.last_seen_at,
    endedAtMs: row.ended_at ?? void 0,
    eventCount: row.event_count,
    highRiskEventCount: row.high_risk_event_count,
    toolCallCount: row.tool_call_count
  };
}
var SessionsRepository = class _SessionsRepository {
  constructor(database) {
    this.database = database;
  }
  static COUNTS_SQL = `
    SELECT
      s.session_key,
      s.channel_profile,
      s.channel_id,
      s.requester_id,
      s.requester_ou_id,
      s.account_id,
      s.conversation_id,
      s.thread_id,
      s.is_group,
      s.first_seen_at,
      s.last_seen_at,
      s.ended_at,
      s.metadata_json,
      COALESCE(ec.event_count, 0) AS event_count,
      COALESCE(ec.high_risk_event_count, 0) AS high_risk_event_count,
      COALESCE(tc.tool_call_count, 0) AS tool_call_count
    FROM sessions s
    LEFT JOIN (
      SELECT
        session_key,
        COUNT(*) AS event_count,
        SUM(CASE WHEN risk_level IN ('L3', 'L4') THEN 1 ELSE 0 END) AS high_risk_event_count
      FROM audit_events
      GROUP BY session_key
    ) ec ON ec.session_key = s.session_key
    LEFT JOIN (
      SELECT
        session_key,
        COUNT(*) AS tool_call_count
      FROM tool_calls
      GROUP BY session_key
    ) tc ON tc.session_key = s.session_key
  `;
  list(query) {
    const limit = resolveListLimit(query.limit);
    const cursor = decodeDescendingCursor(query.cursor);
    const filters = [];
    const parameters = [];
    appendRangeFilter(filters, parameters, "s.last_seen_at", query.fromMs, query.toMs);
    appendEqualsFilter(filters, parameters, "s.channel_profile", query.channelProfile);
    appendEqualsFilter(filters, parameters, "s.channel_id", query.channelId);
    appendEqualsFilter(filters, parameters, "s.requester_id", query.requesterId);
    appendEqualsFilter(filters, parameters, "s.requester_ou_id", query.requesterOuId);
    appendBooleanFilter(filters, parameters, "s.is_group", query.isGroup);
    appendDescendingCursorFilter(filters, parameters, "s.last_seen_at", "s.session_key", cursor);
    const rows = this.database.prepare(
      `
        ${_SessionsRepository.COUNTS_SQL}
        ${buildWhereClause(filters)}
        ORDER BY s.last_seen_at DESC, s.session_key DESC
        LIMIT ?
        `
    ).all(...parameters, limit + 1);
    return buildCursorPage(
      rows,
      limit,
      mapSessionListRow,
      (row) => ({
        sortValue: row.last_seen_at,
        id: row.session_key
      })
    );
  }
  getByKey(sessionKey) {
    const row = this.database.prepare(
      `
        ${_SessionsRepository.COUNTS_SQL}
        WHERE s.session_key = ?
        `
    ).get(sessionKey);
    if (!row) {
      return null;
    }
    const recentEvents = this.database.prepare(
      `
        SELECT
          event_id,
          session_key,
          run_id,
          tool_call_id,
          approval_id,
          request_id,
          source_kind,
          hook_name,
          event_type,
          category,
          sub_category,
          direction,
          primary_module,
          risk_level,
          risk_score,
          policy_decision,
          enforcement_action,
          title,
          summary,
          content_excerpt,
          occurred_at
        FROM audit_events
        WHERE session_key = ?
        ORDER BY occurred_at DESC, event_id DESC
        LIMIT 5
        `
    ).all(sessionKey).map((eventRow) => mapAuditEventListRow(eventRow));
    const recentToolCalls = this.database.prepare(
      `
        SELECT
          tool_call_id,
          session_key,
          run_id,
          approval_id,
          tool_name,
          risk_level,
          risk_score,
          policy_decision,
          enforcement_action,
          started_at,
          finished_at,
          duration_ms,
          result_status,
          result_excerpt
        FROM tool_calls
        WHERE session_key = ?
        ORDER BY started_at DESC, tool_call_id DESC
        LIMIT 5
        `
    ).all(sessionKey).map((toolRow) => mapToolCallListRow(toolRow));
    const recentApprovals = this.database.prepare(
      `
        SELECT
          approval_id,
          pending_id,
          session_key,
          run_id,
          transport,
          requester_ou_id,
          module,
          risk_level,
          tool_name,
          scope_type,
          requested_at,
          expires_at,
          resolved_at,
          resolution,
          prompt_excerpt
        FROM approvals
        WHERE session_key = ?
        ORDER BY requested_at DESC, approval_id DESC
        LIMIT 5
        `
    ).all(sessionKey).map((approvalRow) => mapApprovalListRow(approvalRow));
    const tokenSummaryRow = this.database.prepare(
      `
        SELECT
          SUM(total_tokens) AS total_tokens,
          SUM(input_tokens) AS input_tokens,
          SUM(output_tokens) AS output_tokens,
          COUNT(*) AS row_count
        FROM token_usage
        WHERE session_key = ?
        `
    ).get(sessionKey);
    return {
      ...mapSessionListRow(row),
      metadataJson: parseJsonRecord(row.metadata_json),
      recentEvents,
      recentToolCalls,
      recentApprovals,
      tokenSummary: tokenSummaryRow && tokenSummaryRow.row_count > 0 ? {
        totalTokens: tokenSummaryRow.total_tokens ?? 0,
        inputTokens: tokenSummaryRow.input_tokens ?? 0,
        outputTokens: tokenSummaryRow.output_tokens ?? 0
      } : void 0
    };
  }
};

// src/repositories/tokens-repository.ts
function mapTokenUsageRow(row) {
  return {
    usageEventId: row.usage_event_id,
    sessionKey: row.session_key ?? void 0,
    runId: row.run_id ?? void 0,
    agentId: row.agent_id ?? void 0,
    provider: row.provider,
    model: row.model,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheReadTokens: row.cache_read_tokens,
    cacheWriteTokens: row.cache_write_tokens,
    totalTokens: row.total_tokens,
    assistantTextCount: row.assistant_text_count,
    isEstimated: fromDbBoolean(row.is_estimated),
    occurredAtMs: row.occurred_at
  };
}
var TokensRepository = class {
  constructor(database) {
    this.database = database;
  }
  buildCommonFilters(query) {
    const filters = [];
    const parameters = [];
    appendRangeFilter(filters, parameters, "occurred_at", query.fromMs, query.toMs);
    appendEqualsFilter(filters, parameters, "session_key", query.sessionKey);
    appendEqualsFilter(filters, parameters, "run_id", query.runId);
    appendEqualsFilter(filters, parameters, "provider", query.provider);
    appendEqualsFilter(filters, parameters, "model", query.model);
    if ("agentId" in query) {
      appendEqualsFilter(filters, parameters, "agent_id", query.agentId);
    }
    if ("isEstimated" in query) {
      appendBooleanFilter(filters, parameters, "is_estimated", query.isEstimated);
    }
    return { filters, parameters };
  }
  list(query) {
    const limit = resolveListLimit(query.limit);
    const cursor = decodeDescendingCursor(query.cursor);
    const { filters, parameters } = this.buildCommonFilters(query);
    appendDescendingCursorFilter(filters, parameters, "occurred_at", "usage_event_id", cursor);
    const rows = this.database.prepare(
      `
        SELECT
          usage_event_id,
          session_key,
          run_id,
          agent_id,
          provider,
          model,
          input_tokens,
          output_tokens,
          cache_read_tokens,
          cache_write_tokens,
          total_tokens,
          assistant_text_count,
          is_estimated,
          occurred_at
        FROM token_usage
        ${buildWhereClause(filters)}
        ORDER BY occurred_at DESC, usage_event_id DESC
        LIMIT ?
        `
    ).all(...parameters, limit + 1);
    return buildCursorPage(
      rows,
      limit,
      mapTokenUsageRow,
      (row) => ({
        sortValue: row.occurred_at,
        id: row.usage_event_id
      })
    );
  }
  getSummary(query) {
    const { filters, parameters } = this.buildCommonFilters(query);
    const summaryRow = this.database.prepare(
      `
        SELECT
          COALESCE(SUM(total_tokens), 0) AS total_tokens,
          COALESCE(SUM(input_tokens), 0) AS input_tokens,
          COALESCE(SUM(output_tokens), 0) AS output_tokens,
          COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
          COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
          COALESCE(SUM(CASE WHEN is_estimated = 1 THEN 1 ELSE 0 END), 0) AS estimated_count
        FROM token_usage
        ${buildWhereClause(filters)}
        `
    ).get(...parameters);
    const topModels = this.database.prepare(
      `
        SELECT
          model,
          COALESCE(SUM(total_tokens), 0) AS total_tokens
        FROM token_usage
        ${buildWhereClause(filters)}
        GROUP BY model
        ORDER BY total_tokens DESC, model ASC
        LIMIT 5
        `
    ).all(...parameters);
    return {
      totalTokens: summaryRow.total_tokens,
      inputTokens: summaryRow.input_tokens,
      outputTokens: summaryRow.output_tokens,
      cacheReadTokens: summaryRow.cache_read_tokens,
      cacheWriteTokens: summaryRow.cache_write_tokens,
      estimatedCount: summaryRow.estimated_count,
      topModels: topModels.map((row) => ({
        model: row.model,
        totalTokens: row.total_tokens
      }))
    };
  }
  getTrend(query) {
    const bucket = query.bucket ?? "hour";
    const bucketSizeMs = bucket === "day" ? 864e5 : 36e5;
    const { filters, parameters } = this.buildCommonFilters(query);
    const rows = this.database.prepare(
      `
        SELECT
          CAST(occurred_at / ${bucketSizeMs} AS INTEGER) * ${bucketSizeMs} AS bucket_start_ms,
          COALESCE(SUM(input_tokens), 0) AS input_tokens,
          COALESCE(SUM(output_tokens), 0) AS output_tokens,
          COALESCE(SUM(total_tokens), 0) AS total_tokens
        FROM token_usage
        ${buildWhereClause(filters)}
        GROUP BY bucket_start_ms
        ORDER BY bucket_start_ms ASC
        `
    ).all(...parameters);
    return {
      bucket,
      points: rows.map((row) => ({
        bucketStartMs: row.bucket_start_ms,
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        totalTokens: row.total_tokens
      }))
    };
  }
};

// src/routes/query-helpers.ts
function readStringQuery(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") {
    return void 0;
  }
  const trimmed = raw.trim();
  return trimmed ? trimmed : void 0;
}
function readStringArrayQuery(value) {
  const rawValues = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const values = rawValues.flatMap((entry) => entry.split(",")).map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  return values.length > 0 ? values : void 0;
}
function readNumberQuery(value) {
  const raw = readStringQuery(value);
  if (!raw) {
    return void 0;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : void 0;
}
function readBooleanQuery(value) {
  const raw = readStringQuery(value)?.toLowerCase();
  if (!raw) {
    return void 0;
  }
  if (raw === "true" || raw === "1") {
    return true;
  }
  if (raw === "false" || raw === "0") {
    return false;
  }
  return void 0;
}

// src/routes/approvals.ts
function registerApprovalRoutes(app2, repository) {
  app2.get("/approvals", async (request) => {
    const query = request.query;
    return repository.list({
      fromMs: readNumberQuery(query.fromMs),
      toMs: readNumberQuery(query.toMs),
      sessionKey: readStringQuery(query.sessionKey),
      runId: readStringQuery(query.runId),
      riskLevel: readStringArrayQuery(query.riskLevel),
      limit: readNumberQuery(query.limit),
      cursor: readStringQuery(query.cursor),
      resolution: readStringQuery(query.resolution),
      toolName: readStringQuery(query.toolName),
      module: readStringQuery(query.module),
      scopeType: readStringQuery(query.scopeType),
      requesterOuId: readStringQuery(query.requesterOuId)
    });
  });
  app2.get("/approvals/:approvalId", async (request, reply) => {
    const approvalId = readStringQuery(request.params.approvalId);
    const approval = approvalId ? repository.getById(approvalId) : null;
    if (!approval) {
      return reply.code(404).send({ ok: false, message: "Approval not found." });
    }
    return approval;
  });
}

// src/routes/dashboard.ts
function registerDashboardRoutes(app2, repository) {
  app2.get("/dashboard/overview", async (request) => {
    const query = request.query;
    return repository.getOverview({
      fromMs: readNumberQuery(query.fromMs),
      toMs: readNumberQuery(query.toMs)
    });
  });
}

// src/routes/events.ts
function registerEventRoutes(app2, repository) {
  app2.get("/events", async (request) => {
    const query = request.query;
    return repository.list({
      fromMs: readNumberQuery(query.fromMs),
      toMs: readNumberQuery(query.toMs),
      sessionKey: readStringQuery(query.sessionKey),
      runId: readStringQuery(query.runId),
      riskLevel: readStringArrayQuery(query.riskLevel),
      enforcementAction: readStringArrayQuery(query.enforcementAction),
      limit: readNumberQuery(query.limit),
      cursor: readStringQuery(query.cursor),
      hookName: readStringQuery(query.hookName),
      eventType: readStringQuery(query.eventType),
      category: readStringQuery(query.category),
      subCategory: readStringQuery(query.subCategory),
      direction: readStringQuery(query.direction),
      primaryModule: readStringQuery(query.primaryModule),
      requestId: readStringQuery(query.requestId),
      toolCallId: readStringQuery(query.toolCallId),
      approvalId: readStringQuery(query.approvalId)
    });
  });
  app2.get("/events/:eventId", async (request, reply) => {
    const eventId = readStringQuery(request.params.eventId);
    const event = eventId ? repository.getById(eventId) : null;
    if (!event) {
      return reply.code(404).send({ ok: false, message: "Audit event not found." });
    }
    return event;
  });
}

// src/routes/health.ts
function registerHealthRoutes(app2) {
  app2.get("/health", async () => ({
    ok: true,
    serverTimeMs: Date.now(),
    schemaVersion: LOCAL_CONSOLE_INGEST_SCHEMA_VERSION
  }));
}

// src/routes/ingest.ts
function registerIngestRoutes(app2, ingestService) {
  app2.post("/ingest/batch", async (request) => {
    return ingestService.processBatch(request.body);
  });
}

// src/routes/lynx-checks.ts
function registerLynxCheckRoutes(app2, repository) {
  app2.get("/lynx-checks", async (request) => {
    const query = request.query;
    return repository.list({
      fromMs: readNumberQuery(query.fromMs),
      toMs: readNumberQuery(query.toMs),
      sessionKey: readStringQuery(query.sessionKey),
      limit: readNumberQuery(query.limit),
      cursor: readStringQuery(query.cursor),
      source: readStringQuery(query.source),
      trigger: readStringQuery(query.trigger),
      status: readStringQuery(query.status),
      messageProvider: readStringQuery(query.messageProvider)
    });
  });
  app2.get("/lynx-checks/:requestId", async (request, reply) => {
    const requestId = readStringQuery(request.params.requestId);
    const lynxCheck = requestId ? repository.getById(requestId) : null;
    if (!lynxCheck) {
      return reply.code(404).send({ ok: false, message: "Lynx check not found." });
    }
    return lynxCheck;
  });
}

// src/routes/meta.ts
function registerMetaRoutes(app2, capabilities = {
  tokenUsageEnabled: false,
  gatewayAuthLogsEnabled: false
}) {
  app2.get("/meta/capabilities", async () => ({
    tokenUsageEnabled: capabilities.tokenUsageEnabled,
    gatewayAuthLogsEnabled: capabilities.gatewayAuthLogsEnabled,
    queryApiVersion: LOCAL_CONSOLE_QUERY_API_VERSION
  }));
}

// src/routes/sessions.ts
function registerSessionRoutes(app2, repository) {
  app2.get("/sessions", async (request) => {
    const query = request.query;
    return repository.list({
      fromMs: readNumberQuery(query.fromMs),
      toMs: readNumberQuery(query.toMs),
      limit: readNumberQuery(query.limit),
      cursor: readStringQuery(query.cursor),
      channelProfile: readStringQuery(query.channelProfile),
      channelId: readStringQuery(query.channelId),
      requesterId: readStringQuery(query.requesterId),
      requesterOuId: readStringQuery(query.requesterOuId),
      isGroup: readBooleanQuery(query.isGroup)
    });
  });
  app2.get("/sessions/:sessionKey", async (request, reply) => {
    const sessionKey = readStringQuery(request.params.sessionKey);
    const session = sessionKey ? repository.getByKey(sessionKey) : null;
    if (!session) {
      return reply.code(404).send({ ok: false, message: "Session not found." });
    }
    return session;
  });
}

// src/routes/tokens.ts
function registerTokenRoutes(app2, repository) {
  app2.get("/tokens/usage", async (request) => {
    const query = request.query;
    return repository.list({
      fromMs: readNumberQuery(query.fromMs),
      toMs: readNumberQuery(query.toMs),
      sessionKey: readStringQuery(query.sessionKey),
      runId: readStringQuery(query.runId),
      limit: readNumberQuery(query.limit),
      cursor: readStringQuery(query.cursor),
      provider: readStringQuery(query.provider),
      model: readStringQuery(query.model),
      agentId: readStringQuery(query.agentId),
      isEstimated: readBooleanQuery(query.isEstimated)
    });
  });
  app2.get("/tokens/summary", async (request) => {
    const query = request.query;
    return repository.getSummary({
      fromMs: readNumberQuery(query.fromMs),
      toMs: readNumberQuery(query.toMs),
      sessionKey: readStringQuery(query.sessionKey),
      runId: readStringQuery(query.runId),
      provider: readStringQuery(query.provider),
      model: readStringQuery(query.model)
    });
  });
  app2.get("/tokens/trend", async (request) => {
    const query = request.query;
    return repository.getTrend({
      fromMs: readNumberQuery(query.fromMs),
      toMs: readNumberQuery(query.toMs),
      sessionKey: readStringQuery(query.sessionKey),
      runId: readStringQuery(query.runId),
      provider: readStringQuery(query.provider),
      model: readStringQuery(query.model),
      bucket: readStringQuery(query.bucket)
    });
  });
}

// src/routes/tool-calls.ts
function registerToolCallRoutes(app2, repository) {
  app2.get("/tool-calls", async (request) => {
    const query = request.query;
    return repository.list({
      fromMs: readNumberQuery(query.fromMs),
      toMs: readNumberQuery(query.toMs),
      sessionKey: readStringQuery(query.sessionKey),
      runId: readStringQuery(query.runId),
      riskLevel: readStringArrayQuery(query.riskLevel),
      enforcementAction: readStringArrayQuery(query.enforcementAction),
      limit: readNumberQuery(query.limit),
      cursor: readStringQuery(query.cursor),
      toolName: readStringQuery(query.toolName),
      resultStatus: readStringQuery(query.resultStatus),
      approvalId: readStringQuery(query.approvalId)
    });
  });
  app2.get("/tool-calls/:toolCallId", async (request, reply) => {
    const toolCallId = readStringQuery(request.params.toolCallId);
    const toolCall = toolCallId ? repository.getById(toolCallId) : null;
    if (!toolCall) {
      return reply.code(404).send({ ok: false, message: "Tool call not found." });
    }
    return toolCall;
  });
}

// src/services/ingest-service.ts
import { z } from "zod";
var literalTuple = (values) => values;
var riskLevelSchema = z.enum(literalTuple(RISK_LEVELS));
var enforcementActionSchema = z.enum(literalTuple(ENFORCEMENT_ACTIONS));
var sourceKindSchema = z.enum(literalTuple(INGEST_SOURCE_KINDS));
var directionSchema = z.enum(literalTuple(INGEST_DIRECTIONS));
var scopeTypeSchema = z.enum(literalTuple(APPROVAL_SCOPE_TYPES));
var lynxCheckSourceSchema = z.enum(literalTuple(LYNX_CHECK_SOURCES));
var lynxCheckTriggerSchema = z.enum(literalTuple(LYNX_CHECK_TRIGGERS));
var lynxCheckTargetKindSchema = z.enum(literalTuple(LYNX_CHECK_TARGET_KINDS));
var lynxCheckStatusSchema = z.enum(literalTuple(LYNX_CHECK_STATUSES));
var itemBaseSchema = z.object({
  itemId: z.string().min(1),
  occurredAtMs: z.number().int()
});
var sessionUpsertSchema = itemBaseSchema.extend({
  kind: z.literal("sessionUpsert"),
  data: z.object({
    sessionKey: z.string().min(1),
    channelProfile: z.string().optional(),
    channelId: z.string().optional(),
    requesterId: z.string().optional(),
    requesterOuId: z.string().optional(),
    accountId: z.string().optional(),
    conversationId: z.string().optional(),
    threadId: z.union([z.string(), z.number().int()]).optional(),
    isGroup: z.boolean().optional(),
    firstSeenAtMs: z.number().int(),
    lastSeenAtMs: z.number().int(),
    endedAtMs: z.number().int().optional(),
    metadataJson: z.record(z.unknown()).optional()
  })
});
var auditEventSchema = itemBaseSchema.extend({
  kind: z.literal("auditEvent"),
  data: z.object({
    eventId: z.string().min(1),
    sessionKey: z.string().optional(),
    runId: z.string().optional(),
    toolCallId: z.string().optional(),
    approvalId: z.string().optional(),
    requestId: z.string().optional(),
    sourceKind: sourceKindSchema,
    hookName: z.string().min(1),
    eventType: z.string().min(1),
    category: z.string().min(1),
    subCategory: z.string().optional(),
    direction: directionSchema.optional(),
    contentKind: z.string().optional(),
    primaryModule: z.string().optional(),
    modules: z.array(z.string()).optional(),
    riskLevel: riskLevelSchema.optional(),
    riskScore: z.number().int().optional(),
    policyDecision: z.string().optional(),
    enforcementAction: enforcementActionSchema,
    title: z.string().min(1),
    summary: z.string().optional(),
    recommendation: z.string().optional(),
    contentExcerpt: z.string().optional(),
    contentHash: z.string().optional(),
    payloadJson: z.record(z.unknown()).optional()
  })
});
var toolCallSchema = itemBaseSchema.extend({
  kind: z.literal("toolCallUpsert"),
  data: z.object({
    toolCallId: z.string().min(1),
    sessionKey: z.string().optional(),
    runId: z.string().optional(),
    approvalId: z.string().optional(),
    toolName: z.string().min(1),
    paramSummary: z.string().optional(),
    paramHash: z.string().optional(),
    triggeredModules: z.array(z.string()).optional(),
    riskLevel: riskLevelSchema.optional(),
    riskScore: z.number().int().optional(),
    policyDecision: z.string().optional(),
    enforcementAction: enforcementActionSchema,
    startedAtMs: z.number().int(),
    finishedAtMs: z.number().int().optional(),
    durationMs: z.number().int().optional(),
    resultStatus: z.string().optional(),
    resultExcerpt: z.string().optional(),
    errorText: z.string().optional(),
    metadataJson: z.record(z.unknown()).optional()
  })
});
var approvalSchema = itemBaseSchema.extend({
  kind: z.literal("approvalUpsert"),
  data: z.object({
    approvalId: z.string().min(1),
    pendingId: z.string().optional(),
    sessionKey: z.string().optional(),
    runId: z.string().optional(),
    transport: z.string().optional(),
    channelProfile: z.string().optional(),
    channelId: z.string().optional(),
    accountId: z.string().optional(),
    conversationId: z.string().optional(),
    requesterOuId: z.string().optional(),
    approverOuIds: z.array(z.string()).optional(),
    resolvedApproverOuId: z.string().optional(),
    requestFingerprintHash: z.string().optional(),
    module: z.string().min(1),
    riskLevel: riskLevelSchema,
    toolName: z.string().optional(),
    scopeType: scopeTypeSchema,
    requestedAtMs: z.number().int(),
    expiresAtMs: z.number().int(),
    resolvedAtMs: z.number().int().optional(),
    resolution: z.string().optional(),
    promptExcerpt: z.string().optional(),
    auditSummaryJson: z.record(z.unknown()).optional(),
    metadataJson: z.record(z.unknown()).optional()
  })
});
var lynxCheckSchema = itemBaseSchema.extend({
  kind: z.literal("lynxCheckUpsert"),
  data: z.object({
    requestId: z.string().min(1),
    source: lynxCheckSourceSchema,
    trigger: lynxCheckTriggerSchema,
    preferredTargetKind: lynxCheckTargetKindSchema,
    sessionKey: z.string().optional(),
    targetKey: z.string().optional(),
    channelId: z.string().optional(),
    messageProvider: z.string().optional(),
    status: lynxCheckStatusSchema,
    sendAttempted: z.boolean().optional(),
    sendSucceeded: z.boolean().optional(),
    transport: z.string().optional(),
    reportPath: z.string().optional(),
    errorMessage: z.string().optional(),
    deliveryAttemptsJson: z.array(z.record(z.unknown())).optional(),
    createdAtMs: z.number().int(),
    completedAtMs: z.number().int().optional()
  })
});
var tokenUsageSchema = itemBaseSchema.extend({
  kind: z.literal("tokenUsage"),
  data: z.object({
    usageEventId: z.string().min(1),
    sessionKey: z.string().optional(),
    runId: z.string().optional(),
    agentId: z.string().optional(),
    provider: z.string().min(1),
    model: z.string().min(1),
    inputTokens: z.number().int().optional(),
    outputTokens: z.number().int().optional(),
    cacheReadTokens: z.number().int().optional(),
    cacheWriteTokens: z.number().int().optional(),
    totalTokens: z.number().int(),
    assistantTextCount: z.number().int().optional(),
    isEstimated: z.boolean().optional(),
    payloadJson: z.record(z.unknown()).optional()
  })
});
var ingestItemSchema = z.discriminatedUnion("kind", [
  sessionUpsertSchema,
  auditEventSchema,
  toolCallSchema,
  approvalSchema,
  lynxCheckSchema,
  tokenUsageSchema
]);
var ingestBatchSchema = z.object({
  schemaVersion: z.literal(LOCAL_CONSOLE_INGEST_SCHEMA_VERSION),
  producer: z.object({
    pluginId: z.literal("openclaw-lynx-guardian"),
    pluginVersion: z.string().optional(),
    instanceId: z.string().optional(),
    host: z.string().optional()
  }),
  sentAtMs: z.number().int(),
  batchId: z.string().min(1),
  items: z.array(z.unknown())
});
function toRejectedKind(value) {
  return INGEST_ITEM_KINDS.find((candidate) => candidate === value) ?? "auditEvent";
}
var IngestService = class {
  constructor(repository, now = () => Date.now()) {
    this.repository = repository;
    this.now = now;
  }
  processBatch(payload) {
    const parsedBatch = ingestBatchSchema.parse(payload);
    const validItems = [];
    const rejectedItems = [];
    parsedBatch.items.forEach((rawItem, itemIndex) => {
      const result = ingestItemSchema.safeParse(rawItem);
      if (!result.success) {
        rejectedItems.push({
          itemIndex,
          kind: toRejectedKind(rawItem?.kind),
          code: "invalid_item",
          message: result.error.issues.map((issue) => issue.message).join("; ")
        });
        return;
      }
      validItems.push(result.data);
    });
    let persistedCount = 0;
    let duplicateCount = 0;
    this.repository.withTransaction(() => {
      const ingestedAtMs = this.now();
      for (const item of validItems) {
        const result = this.persistItem(item, ingestedAtMs);
        if (result.status === "persisted") {
          persistedCount += 1;
        } else {
          duplicateCount += 1;
        }
      }
    });
    return {
      ok: true,
      schemaVersion: LOCAL_CONSOLE_INGEST_SCHEMA_VERSION,
      batchId: parsedBatch.batchId,
      acceptedCount: validItems.length,
      persistedCount,
      duplicateCount,
      rejectedCount: rejectedItems.length,
      rejectedItems,
      serverTimeMs: this.now()
    };
  }
  persistItem(item, ingestedAtMs) {
    switch (item.kind) {
      case "sessionUpsert":
        return this.repository.persistSession(item);
      case "auditEvent":
        return this.repository.persistAuditEvent(item, ingestedAtMs);
      case "toolCallUpsert":
        return this.repository.persistToolCall(item);
      case "approvalUpsert":
        return this.repository.persistApproval(item);
      case "lynxCheckUpsert":
        return this.repository.persistLynxCheck(item);
      case "tokenUsage":
        return this.repository.persistTokenUsage(item, ingestedAtMs);
    }
  }
};

// src/services/static-service.ts
import { readFile } from "fs/promises";
import { normalize, resolve as resolve2, sep } from "path";
var MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};
function normalizeRoutePrefix(value) {
  const prefixed = value.startsWith("/") ? value : `/${value}`;
  return prefixed.replace(/\/+$/, "");
}
function hasFileExtension(value) {
  return /\.[A-Za-z0-9]+$/.test(value);
}
function isPathInsideRoot(rootDir, candidatePath) {
  if (candidatePath === rootDir) {
    return true;
  }
  const rootPrefix = rootDir.endsWith(sep) ? rootDir : `${rootDir}${sep}`;
  return candidatePath.startsWith(rootPrefix);
}
function resolveContentType(fullPath) {
  const extension = fullPath.slice(fullPath.lastIndexOf("."));
  return MIME_TYPES[extension.toLowerCase()] ?? "application/octet-stream";
}
async function sendFile(reply, fullPath, cacheControl) {
  const file = await readFile(fullPath);
  return reply.header("Cache-Control", cacheControl).type(resolveContentType(fullPath)).send(file);
}
async function staticHandler(request, reply, rootDir) {
  const requestedPath = request.params["*"] ?? "";
  let decodedPath = requestedPath;
  try {
    decodedPath = decodeURIComponent(requestedPath);
  } catch {
    return reply.code(400).type("text/plain; charset=utf-8").send("Bad Request");
  }
  const normalizedRoot = normalize(resolve2(rootDir));
  const relativePath = decodedPath.replace(/^\/+/, "");
  if (!relativePath || !hasFileExtension(relativePath)) {
    return sendFile(reply, resolve2(normalizedRoot, "index.html"), "no-store");
  }
  const requestedFilePath = normalize(resolve2(normalizedRoot, relativePath));
  if (!isPathInsideRoot(normalizedRoot, requestedFilePath)) {
    return reply.code(403).type("text/plain; charset=utf-8").send("Forbidden");
  }
  try {
    return await sendFile(reply, requestedFilePath, "public, max-age=3600");
  } catch {
    return reply.code(404).type("text/plain; charset=utf-8").send("Not Found");
  }
}
function registerStaticWebviewRoutes(app2, options) {
  const routePrefix = normalizeRoutePrefix(options.routePrefix ?? "/webview");
  const handle = (request, reply) => staticHandler(request, reply, options.rootDir);
  app2.get(routePrefix, async (_request, reply) => sendFile(
    reply,
    resolve2(options.rootDir, "index.html"),
    "no-store"
  ));
  app2.get(`${routePrefix}/*`, handle);
}

// src/app.ts
async function createLocalConsoleApp(overrides = {}) {
  const config2 = resolveBackendConfig(process.env, overrides);
  const database = openSqliteDatabase(config2.databasePath);
  runMigrations(database);
  const repository = new IngestRepository(database);
  const ingestService = new IngestService(repository);
  const eventsRepository = new EventsRepository(database);
  const toolCallsRepository = new ToolCallsRepository(database);
  const approvalsRepository = new ApprovalsRepository(database);
  const lynxChecksRepository = new LynxChecksRepository(database);
  const sessionsRepository = new SessionsRepository(database);
  const tokensRepository = new TokensRepository(database);
  const dashboardRepository = new DashboardRepository(database);
  const app2 = Fastify({
    logger: false
  });
  app2.addHook("onRequest", createRequireLoopback({
    trustedProxyIps: config2.trustedProxyIps
  }));
  app2.addHook("onClose", async () => {
    database.close();
  });
  registerStaticWebviewRoutes(app2, {
    rootDir: config2.frontendDistPath
  });
  app2.register(async (queryApp) => {
    registerHealthRoutes(queryApp);
    registerMetaRoutes(queryApp, {
      tokenUsageEnabled: config2.tokenUsageEnabled,
      gatewayAuthLogsEnabled: false
    });
    registerEventRoutes(queryApp, eventsRepository);
    registerToolCallRoutes(queryApp, toolCallsRepository);
    registerApprovalRoutes(queryApp, approvalsRepository);
    registerLynxCheckRoutes(queryApp, lynxChecksRepository);
    registerSessionRoutes(queryApp, sessionsRepository);
    registerDashboardRoutes(queryApp, dashboardRepository);
    registerTokenRoutes(queryApp, tokensRepository);
  }, {
    prefix: LOCAL_CONSOLE_API_BASE_PATH
  });
  app2.register(async (ingestApp) => {
    ingestApp.addHook("preHandler", requireIngestAuth(config2.ingestToken));
    registerIngestRoutes(ingestApp, ingestService);
  }, {
    prefix: `${LOCAL_CONSOLE_API_BASE_PATH}/internal/v1`
  });
  return app2;
}

// src/main.ts
var config = resolveBackendConfig();
var app = await createLocalConsoleApp(config);
try {
  await app.listen({
    host: config.listenHost,
    port: config.port
  });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
