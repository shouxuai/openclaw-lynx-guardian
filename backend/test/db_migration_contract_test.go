package backend_test

import (
	"database/sql"
	"testing"

	"github.com/openclaw/lynx-guardian/backend/internal/db"
	_ "modernc.org/sqlite"
)

func TestControlPlaneMigrationCreatesTables(t *testing.T) {
	database := openMigrationContractDB(t)

	required := []string{
		"decisions",
		"decision_arbiters",
		"decision_evidence",
		"chains",
		"approval_grants",
		"lynx_check_tasks",
		"skill_inventory",
	}
	for _, table := range required {
		var name string
		err := database.QueryRow(
			`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
			table,
		).Scan(&name)
		if err != nil {
			t.Fatalf("missing table %s: %v", table, err)
		}
	}
}

func TestQaRecordsMigrationCreatesPrimaryTableAndLinkColumns(t *testing.T) {
	database := openMigrationContractDB(t)

	requiredQaColumns := []string{
		"qa_record_id",
		"session_key",
		"run_id",
		"agent_id",
		"user_prompt_excerpt",
		"user_prompt_hash",
		"final_answer_excerpt",
		"final_answer_hash",
		"status",
		"risk_level",
		"risk_score",
		"tool_call_count",
		"approval_count",
		"detection_count",
		"total_tokens",
		"started_at",
		"completed_at",
		"ingested_at",
		"payload_json",
		"link_origin",
	}
	for _, column := range requiredQaColumns {
		if !migrationContractHasColumn(t, database, "qa_records", column) {
			t.Fatalf("qa_records missing column %s", column)
		}
	}

	for _, table := range []string{"audit_events", "tool_calls", "approvals", "lynx_checks", "token_usage"} {
		if !migrationContractHasColumn(t, database, table, "qa_record_id") {
			t.Fatalf("%s missing qa_record_id link column", table)
		}
	}
	for _, table := range []string{"lynx_checks", "lynx_check_tasks"} {
		if !migrationContractHasColumn(t, database, table, "report_markdown") {
			t.Fatalf("%s missing report_markdown column", table)
		}
	}
	if !migrationContractHasColumn(t, database, "token_usage", "source_origin") {
		t.Fatalf("token_usage missing source_origin column")
	}
	if !migrationContractHasIndex(t, database, "idx_token_usage_origin_occurred_at") {
		t.Fatalf("token_usage missing idx_token_usage_origin_occurred_at index")
	}
}

func TestTokenUsageMigrationAddsSourceOriginAndBackfillsDefault(t *testing.T) {
	database, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })

	_, err = database.Exec(`
		CREATE TABLE token_usage (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			usage_event_id TEXT NOT NULL UNIQUE,
			session_key TEXT,
			run_id TEXT,
			agent_id TEXT,
			provider TEXT NOT NULL,
			model TEXT NOT NULL,
			input_tokens INTEGER NOT NULL DEFAULT 0,
			output_tokens INTEGER NOT NULL DEFAULT 0,
			cache_read_tokens INTEGER NOT NULL DEFAULT 0,
			cache_write_tokens INTEGER NOT NULL DEFAULT 0,
			total_tokens INTEGER NOT NULL DEFAULT 0,
			assistant_text_count INTEGER NOT NULL DEFAULT 0,
			is_estimated INTEGER NOT NULL DEFAULT 0,
			occurred_at INTEGER NOT NULL,
			ingested_at INTEGER NOT NULL,
			payload_json TEXT
		);
		INSERT INTO token_usage (
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
			'usage-1',
			'session-1',
			'run-1',
			'agent-1',
			'openai',
			'gpt-4.1',
			1,
			2,
			3,
			4,
			5,
			6,
			0,
			100,
			200,
			'{}'
		);
	`)
	if err != nil {
		t.Fatalf("seed legacy token_usage table: %v", err)
	}

	if err := db.Migrate(database); err != nil {
		t.Fatalf("migrate legacy db: %v", err)
	}

	if !migrationContractHasColumn(t, database, "token_usage", "source_origin") {
		t.Fatalf("token_usage missing source_origin column after migration")
	}

	var sourceOrigin string
	if err := database.QueryRow(
		`SELECT source_origin FROM token_usage WHERE usage_event_id = ?`,
		"usage-1",
	).Scan(&sourceOrigin); err != nil {
		t.Fatalf("query migrated source_origin: %v", err)
	}
	if sourceOrigin != "hook" {
		t.Fatalf("unexpected source_origin %q", sourceOrigin)
	}

	if !migrationContractHasIndex(t, database, "idx_token_usage_origin_occurred_at") {
		t.Fatalf("token_usage missing idx_token_usage_origin_occurred_at index after migration")
	}
}

func openMigrationContractDB(t *testing.T) *sql.DB {
	t.Helper()

	database, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })

	if err := db.Migrate(database); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return database
}

func migrationContractHasColumn(t *testing.T, database *sql.DB, table string, column string) bool {
	t.Helper()
	rows, err := database.Query(`PRAGMA table_info(` + table + `)`)
	if err != nil {
		t.Fatalf("table_info %s: %v", table, err)
	}
	defer rows.Close()

	for rows.Next() {
		var cid int
		var name, columnType string
		var notNull int
		var defaultValue any
		var primaryKey int
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			t.Fatalf("scan column info: %v", err)
		}
		if name == column {
			return true
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate column info: %v", err)
	}
	return false
}

func migrationContractHasIndex(t *testing.T, database *sql.DB, indexName string) bool {
	t.Helper()

	var name string
	err := database.QueryRow(
		`SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?`,
		indexName,
	).Scan(&name)
	if err != nil {
		return false
	}
	return name == indexName
}
