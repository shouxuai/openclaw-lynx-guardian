BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_key TEXT NOT NULL UNIQUE,
  channel_profile TEXT,
  channel_id TEXT,
  requester_id TEXT,
  requester_ou_id TEXT,
  account_id TEXT,
  conversation_id TEXT,
  thread_id TEXT,
  is_group INTEGER NOT NULL DEFAULT 0 CHECK (is_group IN (0, 1)),
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  ended_at INTEGER,
  metadata_json TEXT
);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  session_key TEXT,
  run_id TEXT,
  tool_call_id TEXT,
  approval_id TEXT,
  request_id TEXT,
  source_kind TEXT NOT NULL,
  hook_name TEXT NOT NULL,
  event_type TEXT NOT NULL,
  category TEXT NOT NULL,
  sub_category TEXT,
  direction TEXT,
  content_kind TEXT,
  primary_module TEXT,
  modules_json TEXT,
  risk_level TEXT CHECK (
    risk_level IS NULL OR risk_level IN ('L0', 'L1', 'L2', 'L3', 'L4')
  ),
  risk_score INTEGER,
  policy_decision TEXT,
  enforcement_action TEXT NOT NULL CHECK (
    enforcement_action IN (
      'allow',
      'warn',
      'block',
      'redact',
      'require_approval',
      'log_only'
    )
  ),
  title TEXT NOT NULL,
  summary TEXT,
  recommendation TEXT,
  content_excerpt TEXT,
  content_hash TEXT,
  occurred_at INTEGER NOT NULL,
  ingested_at INTEGER NOT NULL,
  payload_json TEXT
);

CREATE TABLE IF NOT EXISTS tool_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_call_id TEXT NOT NULL UNIQUE,
  session_key TEXT,
  run_id TEXT,
  approval_id TEXT,
  tool_name TEXT NOT NULL,
  param_summary TEXT,
  param_hash TEXT,
  triggered_modules_json TEXT,
  risk_level TEXT CHECK (
    risk_level IS NULL OR risk_level IN ('L0', 'L1', 'L2', 'L3', 'L4')
  ),
  risk_score INTEGER,
  policy_decision TEXT,
  enforcement_action TEXT NOT NULL CHECK (
    enforcement_action IN (
      'allow',
      'warn',
      'block',
      'redact',
      'require_approval',
      'log_only'
    )
  ),
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  duration_ms INTEGER,
  result_status TEXT,
  result_excerpt TEXT,
  error_text TEXT,
  metadata_json TEXT
);

CREATE TABLE IF NOT EXISTS approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  approval_id TEXT NOT NULL UNIQUE,
  pending_id TEXT,
  session_key TEXT,
  run_id TEXT,
  transport TEXT,
  channel_profile TEXT,
  channel_id TEXT,
  account_id TEXT,
  conversation_id TEXT,
  requester_ou_id TEXT,
  approver_ou_ids_json TEXT,
  resolved_approver_ou_id TEXT,
  request_fingerprint_hash TEXT,
  module TEXT NOT NULL,
  risk_level TEXT NOT NULL CHECK (
    risk_level IN ('L0', 'L1', 'L2', 'L3', 'L4')
  ),
  tool_name TEXT,
  scope_type TEXT NOT NULL CHECK (
    scope_type IN ('single_tool', 'workflow', 'time_window')
  ),
  requested_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  resolved_at INTEGER,
  resolution TEXT,
  prompt_excerpt TEXT,
  audit_summary_json TEXT,
  metadata_json TEXT
);

CREATE TABLE IF NOT EXISTS lynx_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  trigger TEXT NOT NULL,
  preferred_target_kind TEXT NOT NULL,
  session_key TEXT,
  target_key TEXT,
  channel_id TEXT,
  message_provider TEXT,
  status TEXT NOT NULL,
  send_attempted INTEGER NOT NULL DEFAULT 0 CHECK (send_attempted IN (0, 1)),
  send_succeeded INTEGER NOT NULL DEFAULT 0 CHECK (send_succeeded IN (0, 1)),
  transport TEXT,
  report_path TEXT,
  error_message TEXT,
  delivery_attempts_json TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE TABLE IF NOT EXISTS token_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usage_event_id TEXT NOT NULL UNIQUE,
  session_key TEXT,
  run_id TEXT,
  agent_id TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  cache_read_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cache_read_tokens >= 0),
  cache_write_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cache_write_tokens >= 0),
  total_tokens INTEGER NOT NULL DEFAULT 0 CHECK (total_tokens >= 0),
  assistant_text_count INTEGER NOT NULL DEFAULT 0 CHECK (assistant_text_count >= 0),
  is_estimated INTEGER NOT NULL DEFAULT 0 CHECK (is_estimated IN (0, 1)),
  occurred_at INTEGER NOT NULL,
  ingested_at INTEGER NOT NULL,
  payload_json TEXT
);

CREATE TABLE IF NOT EXISTS ingest_cursors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_name TEXT NOT NULL,
  source_key TEXT NOT NULL,
  cursor_type TEXT NOT NULL,
  cursor_value TEXT,
  cursor_meta_json TEXT,
  updated_at INTEGER NOT NULL,
  UNIQUE (source_name, source_key)
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_channel
  ON sessions (channel_profile, channel_id);

CREATE INDEX IF NOT EXISTS idx_sessions_requester
  ON sessions (requester_ou_id, requester_id);

CREATE INDEX IF NOT EXISTS idx_sessions_last_seen_at
  ON sessions (last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_events_occurred_at
  ON audit_events (occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_events_ingested_at
  ON audit_events (ingested_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_events_session_occurred_at
  ON audit_events (session_key, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_events_run_id
  ON audit_events (run_id);

CREATE INDEX IF NOT EXISTS idx_audit_events_tool_call_id
  ON audit_events (tool_call_id);

CREATE INDEX IF NOT EXISTS idx_audit_events_approval_id
  ON audit_events (approval_id);

CREATE INDEX IF NOT EXISTS idx_audit_events_request_id
  ON audit_events (request_id);

CREATE INDEX IF NOT EXISTS idx_audit_events_hook_occurred_at
  ON audit_events (hook_name, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_events_category_occurred_at
  ON audit_events (category, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_events_risk_action_occurred_at
  ON audit_events (risk_level, enforcement_action, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_tool_calls_session_started_at
  ON tool_calls (session_key, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_tool_calls_run_id
  ON tool_calls (run_id);

CREATE INDEX IF NOT EXISTS idx_tool_calls_approval_id
  ON tool_calls (approval_id);

CREATE INDEX IF NOT EXISTS idx_tool_calls_tool_started_at
  ON tool_calls (tool_name, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_tool_calls_risk_action_started_at
  ON tool_calls (risk_level, enforcement_action, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_tool_calls_result_status
  ON tool_calls (result_status);

CREATE INDEX IF NOT EXISTS idx_approvals_session_requested_at
  ON approvals (session_key, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_approvals_run_id
  ON approvals (run_id);

CREATE INDEX IF NOT EXISTS idx_approvals_pending_id
  ON approvals (pending_id);

CREATE INDEX IF NOT EXISTS idx_approvals_requester_requested_at
  ON approvals (requester_ou_id, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_approvals_resolution_requested_at
  ON approvals (resolution, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_approvals_tool_name
  ON approvals (tool_name);

CREATE INDEX IF NOT EXISTS idx_lynx_checks_status_created_at
  ON lynx_checks (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lynx_checks_trigger_created_at
  ON lynx_checks (trigger, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lynx_checks_session_created_at
  ON lynx_checks (session_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_token_usage_session_occurred_at
  ON token_usage (session_key, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_token_usage_run_id
  ON token_usage (run_id);

CREATE INDEX IF NOT EXISTS idx_token_usage_provider_model_occurred_at
  ON token_usage (provider, model, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_token_usage_model_occurred_at
  ON token_usage (model, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_ingest_cursors_updated_at
  ON ingest_cursors (updated_at DESC);

INSERT OR IGNORE INTO schema_migrations (version, applied_at)
VALUES ('001_init', CAST(strftime('%s', 'now') AS INTEGER));

COMMIT;
