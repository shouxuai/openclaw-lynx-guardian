BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  hook TEXT NOT NULL,
  session_key TEXT NOT NULL DEFAULT '',
  channel_profile TEXT NOT NULL DEFAULT '',
  conversation_id TEXT NOT NULL DEFAULT '',
  requester_id TEXT NOT NULL DEFAULT '',
  risk_level TEXT NOT NULL,
  action TEXT NOT NULL,
  block INTEGER NOT NULL,
  score REAL NOT NULL DEFAULT 0,
  winning_arbiter TEXT NOT NULL,
  matched_modules_json TEXT NOT NULL DEFAULT '[]',
  requires_approval INTEGER NOT NULL DEFAULT 0,
  approval_request_json TEXT NOT NULL DEFAULT '{}',
  redactions_json TEXT NOT NULL DEFAULT '[]',
  prompt_context TEXT NOT NULL DEFAULT '',
  user_message TEXT NOT NULL DEFAULT '',
  audit_json TEXT NOT NULL,
  degraded_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS decision_arbiters (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL,
  arbiter TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  action TEXT NOT NULL,
  score REAL NOT NULL DEFAULT 0,
  matched_modules_json TEXT NOT NULL DEFAULT '[]',
  evidence_json TEXT NOT NULL DEFAULT '[]',
  score_breakdown_json TEXT NOT NULL DEFAULT '[]',
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY(decision_id) REFERENCES decisions(id)
);

CREATE TABLE IF NOT EXISTS decision_evidence (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL,
  module TEXT NOT NULL,
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  severity TEXT NOT NULL,
  score_delta REAL NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(decision_id) REFERENCES decisions(id)
);

CREATE TABLE IF NOT EXISTS chains (
  id TEXT PRIMARY KEY,
  chain_id TEXT NOT NULL UNIQUE,
  session_key TEXT NOT NULL DEFAULT '',
  channel_profile TEXT NOT NULL DEFAULT '',
  channel_id TEXT NOT NULL DEFAULT '',
  conversation_id TEXT NOT NULL DEFAULT '',
  requester_id TEXT NOT NULL DEFAULT '',
  requester_ou_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  summary_json TEXT NOT NULL DEFAULT '{}',
  active_grant_id TEXT NOT NULL DEFAULT '',
  pending_approval_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  ended_at TEXT
);

CREATE TABLE IF NOT EXISTS chain_events (
  id TEXT PRIMARY KEY,
  chain_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  hook TEXT NOT NULL DEFAULT '',
  risk_level TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL DEFAULT '',
  tool_name TEXT NOT NULL DEFAULT '',
  target_uri TEXT NOT NULL DEFAULT '',
  content_excerpt TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY(chain_id) REFERENCES chains(chain_id)
);

CREATE TABLE IF NOT EXISTS taint_labels (
  id TEXT PRIMARY KEY,
  chain_id TEXT NOT NULL DEFAULT '',
  session_key TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL,
  source_kind TEXT NOT NULL DEFAULT '',
  source_uri TEXT NOT NULL DEFAULT '',
  target_uri TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  expires_at TEXT
);

CREATE TABLE IF NOT EXISTS approval_grants (
  id TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL UNIQUE,
  approval_id TEXT NOT NULL DEFAULT '',
  chain_id TEXT NOT NULL DEFAULT '',
  session_key TEXT NOT NULL DEFAULT '',
  channel_profile TEXT NOT NULL DEFAULT '',
  channel_id TEXT NOT NULL DEFAULT '',
  conversation_id TEXT NOT NULL DEFAULT '',
  requester_id TEXT NOT NULL DEFAULT '',
  requester_ou_id TEXT NOT NULL DEFAULT '',
  approver_id TEXT NOT NULL DEFAULT '',
  approver_ou_id TEXT NOT NULL DEFAULT '',
  risk_family TEXT NOT NULL DEFAULT '',
  tool_name TEXT NOT NULL DEFAULT '',
  target_kind TEXT NOT NULL DEFAULT '',
  target_hash TEXT NOT NULL DEFAULT '',
  resource_scope_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  revoked_reason TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS lynx_check_tasks (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  trigger TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  requester_id TEXT NOT NULL DEFAULT '',
  session_key TEXT NOT NULL DEFAULT '',
  target_key TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  facts_json TEXT NOT NULL DEFAULT '{}',
  evidence_bundle_json TEXT NOT NULL DEFAULT '{}',
  report_skeleton TEXT NOT NULL DEFAULT '',
  delivery_channel TEXT NOT NULL DEFAULT '',
  delivery_target TEXT NOT NULL DEFAULT '',
  delivery_status TEXT NOT NULL DEFAULT '',
  delivery_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  delivered_at TEXT,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS lynx_check_evidence (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  module TEXT NOT NULL,
  severity TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY(request_id) REFERENCES lynx_check_tasks(request_id)
);

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  install_path TEXT NOT NULL DEFAULT '',
  manifest_path TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skill_inventory (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL,
  name TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  install_path TEXT NOT NULL DEFAULT '',
  manifest_path TEXT NOT NULL DEFAULT '',
  hash_algorithm TEXT NOT NULL DEFAULT '',
  baseline_hash TEXT NOT NULL DEFAULT '',
  current_hash TEXT NOT NULL DEFAULT '',
  trust_state TEXT NOT NULL DEFAULT '',
  last_seen_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS skill_findings (
  id TEXT PRIMARY KEY,
  finding_id TEXT NOT NULL UNIQUE,
  skill_id TEXT NOT NULL,
  severity TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  message TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skill_install_events (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  skill_id TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  install_path TEXT NOT NULL DEFAULT '',
  decision_id TEXT NOT NULL DEFAULT '',
  hash TEXT NOT NULL DEFAULT '',
  findings_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS backend_health_events (
  id TEXT PRIMARY KEY,
  component TEXT NOT NULL,
  status TEXT NOT NULL,
  degraded_reason TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_decisions_created_at ON decisions(created_at);
CREATE INDEX IF NOT EXISTS idx_decisions_session_key ON decisions(session_key);
CREATE INDEX IF NOT EXISTS idx_decisions_stage_risk_action ON decisions(stage, risk_level, action);
CREATE INDEX IF NOT EXISTS idx_decision_arbiters_decision_id ON decision_arbiters(decision_id);
CREATE INDEX IF NOT EXISTS idx_decision_evidence_decision_id ON decision_evidence(decision_id);
CREATE INDEX IF NOT EXISTS idx_chains_lookup ON chains(session_key, channel_profile, conversation_id);
CREATE INDEX IF NOT EXISTS idx_approval_grants_chain ON approval_grants(chain_id, revoked_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_lynx_check_tasks_status ON lynx_check_tasks(created_at, trigger, status);
CREATE INDEX IF NOT EXISTS idx_skill_inventory_last_seen ON skill_inventory(skill_id, last_seen_at);

INSERT OR IGNORE INTO schema_migrations (version, applied_at)
VALUES ('002_control_plane', CAST(strftime('%s', 'now') AS INTEGER));

COMMIT;
