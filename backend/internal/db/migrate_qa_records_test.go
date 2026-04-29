package db

import (
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"
)

func TestQaRecordsMigrationCreatesPrimaryTableAndLinkColumns(t *testing.T) {
	database, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	defer database.Close()

	if err := Migrate(database); err != nil {
		t.Fatalf("migrate: %v", err)
	}

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
		if !hasColumn(t, database, "qa_records", column) {
			t.Fatalf("qa_records missing column %s", column)
		}
	}

	for _, table := range []string{"audit_events", "tool_calls", "approvals", "lynx_checks", "token_usage"} {
		if !hasColumn(t, database, table, "qa_record_id") {
			t.Fatalf("%s missing qa_record_id link column", table)
		}
	}
	for _, table := range []string{"lynx_checks", "lynx_check_tasks"} {
		if !hasColumn(t, database, table, "report_markdown") {
			t.Fatalf("%s missing report_markdown column", table)
		}
	}
}

func hasColumn(t *testing.T, database *sql.DB, table string, column string) bool {
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
