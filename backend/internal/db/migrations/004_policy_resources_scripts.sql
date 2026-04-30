BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS policy_versions (
  version INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at_ms INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  change_summary TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS policy_rules (
  rule_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('blacklist', 'allowlist')),
  scope TEXT NOT NULL CHECK (scope IN ('input', 'tool', 'script', 'output')),
  pattern_type TEXT NOT NULL CHECK (pattern_type IN ('literal', 'regex')),
  pattern TEXT NOT NULL,
  risk_delta INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  FOREIGN KEY (version) REFERENCES policy_versions(version)
);

CREATE TABLE IF NOT EXISTS protected_resources (
  resource_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  path TEXT NOT NULL,
  real_path TEXT,
  preset TEXT NOT NULL CHECK (preset IN ('deny_all', 'read_only', 'no_modify', 'no_delete')),
  enabled INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  FOREIGN KEY (version) REFERENCES policy_versions(version)
);

CREATE TABLE IF NOT EXISTS script_findings (
  finding_id TEXT PRIMARY KEY,
  decision_id TEXT,
  tool_call_id TEXT,
  session_key TEXT,
  script_path TEXT,
  real_path TEXT,
  sha256 TEXT,
  rule_id TEXT NOT NULL,
  module TEXT NOT NULL,
  severity TEXT NOT NULL,
  behavior TEXT NOT NULL,
  line INTEGER,
  snippet TEXT,
  confidence TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS script_taints (
  taint_id TEXT PRIMARY KEY,
  version INTEGER,
  session_key TEXT,
  real_path TEXT,
  sha256 TEXT,
  risk_level TEXT NOT NULL,
  rule_ids_json TEXT NOT NULL DEFAULT '[]',
  source_tool_call_id TEXT,
  created_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER,
  FOREIGN KEY (version) REFERENCES policy_versions(version)
);

CREATE INDEX IF NOT EXISTS idx_policy_rules_scope_enabled ON policy_rules(scope, enabled);
CREATE INDEX IF NOT EXISTS idx_protected_resources_enabled_path ON protected_resources(enabled, path);
CREATE INDEX IF NOT EXISTS idx_script_findings_created ON script_findings(created_at_ms);
CREATE INDEX IF NOT EXISTS idx_script_taints_real_path ON script_taints(real_path);
CREATE INDEX IF NOT EXISTS idx_script_taints_sha256 ON script_taints(sha256);

INSERT OR IGNORE INTO schema_migrations (version, applied_at)
VALUES ('004_policy_resources_scripts', CAST(strftime('%s', 'now') AS INTEGER));

COMMIT;
