BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS qa_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  qa_record_id TEXT NOT NULL UNIQUE,
  session_key TEXT,
  run_id TEXT,
  agent_id TEXT,
  user_prompt_excerpt TEXT,
  user_prompt_hash TEXT,
  final_answer_excerpt TEXT,
  final_answer_hash TEXT,
  status TEXT NOT NULL,
  risk_level TEXT CHECK (
    risk_level IS NULL OR risk_level IN ('L0', 'L1', 'L2', 'L3', 'L4')
  ),
  risk_score INTEGER,
  tool_call_count INTEGER NOT NULL DEFAULT 0,
  approval_count INTEGER NOT NULL DEFAULT 0,
  detection_count INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  ingested_at INTEGER NOT NULL,
  payload_json TEXT,
  link_origin TEXT NOT NULL DEFAULT 'legacy' CHECK (
    link_origin IN ('runtime', 'inferred', 'legacy')
  )
);

CREATE INDEX IF NOT EXISTS idx_qa_records_started_at
  ON qa_records (started_at DESC);

CREATE INDEX IF NOT EXISTS idx_qa_records_session_started_at
  ON qa_records (session_key, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_qa_records_run_id
  ON qa_records (run_id);

INSERT OR IGNORE INTO schema_migrations (version, applied_at)
VALUES ('003_qa_records', CAST(strftime('%s', 'now') AS INTEGER));

COMMIT;
