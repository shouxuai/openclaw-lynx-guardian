package db

import (
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"
)

func TestControlPlaneMigrationCreatesTables(t *testing.T) {
	database, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	defer database.Close()

	if err := Migrate(database); err != nil {
		t.Fatalf("migrate: %v", err)
	}

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
