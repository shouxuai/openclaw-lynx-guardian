package db

import (
	"database/sql"
	"embed"
	"io/fs"
	"sort"
	"strings"
	"time"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

const InitialSchemaVersion = "001_init"

// Migrate mirrors backend/src/db/migrate.ts.
func Migrate(database *sql.DB) error {
	migrations, err := fs.Glob(migrationsFS, "migrations/*.sql")
	if err != nil {
		return err
	}
	sort.Strings(migrations)

	for _, migration := range migrations {
		sqlBytes, err := migrationsFS.ReadFile(migration)
		if err != nil {
			return err
		}
		if _, err := database.Exec(string(sqlBytes)); err != nil {
			return err
		}
	}

	if err := ensureTokenUsageSourceTypeColumn(database); err != nil {
		return err
	}
	if err := ensureQARecordLinkColumns(database); err != nil {
		return err
	}
	if err := ensureDetectionReportMarkdownColumns(database); err != nil {
		return err
	}

	_, err = database.Exec(
		`INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)`,
		InitialSchemaVersion, time.Now().UnixMilli(),
	)
	return err
}

func ensureDetectionReportMarkdownColumns(database *sql.DB) error {
	if err := ensureColumn(database, "lynx_checks", "report_markdown", "TEXT"); err != nil {
		return err
	}
	return ensureColumn(database, "lynx_check_tasks", "report_markdown", "TEXT NOT NULL DEFAULT ''")
}

func ensureQARecordLinkColumns(database *sql.DB) error {
	tables := []string{"audit_events", "tool_calls", "approvals", "lynx_checks", "token_usage"}
	for _, table := range tables {
		if err := ensureColumn(database, table, "qa_record_id", "TEXT"); err != nil {
			return err
		}
		if _, err := database.Exec(`CREATE INDEX IF NOT EXISTS idx_` + table + `_qa_record_id ON ` + table + ` (qa_record_id)`); err != nil {
			return err
		}
	}
	return nil
}

func ensureColumn(database *sql.DB, table string, column string, definition string) error {
	hasColumn, err := tableHasColumn(database, table, column)
	if err != nil {
		return err
	}
	if hasColumn {
		return nil
	}
	_, err = database.Exec(`ALTER TABLE ` + table + ` ADD COLUMN ` + column + ` ` + definition)
	return err
}

func tableHasColumn(database *sql.DB, table string, column string) (bool, error) {
	rows, err := database.Query(`PRAGMA table_info(` + table + `)`)
	if err != nil {
		return false, err
	}
	defer rows.Close()

	for rows.Next() {
		var cid int
		var name, columnType string
		var notNull int
		var defaultValue any
		var primaryKey int
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			return false, err
		}
		if strings.EqualFold(name, column) {
			return true, nil
		}
	}
	if err := rows.Err(); err != nil {
		return false, err
	}
	return false, nil
}

func ensureTokenUsageSourceTypeColumn(database *sql.DB) error {
	rows, err := database.Query(`PRAGMA table_info(token_usage)`)
	if err != nil {
		return err
	}
	defer rows.Close()

	hasSourceType := false
	for rows.Next() {
		var cid int
		var name, columnType string
		var notNull int
		var defaultValue any
		var primaryKey int
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			return err
		}
		if strings.EqualFold(name, "source_type") {
			hasSourceType = true
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if hasSourceType {
		return nil
	}
	if _, err := database.Exec(`ALTER TABLE token_usage ADD COLUMN source_type TEXT NOT NULL DEFAULT 'actual'`); err != nil {
		return err
	}
	_, err = database.Exec(`
		UPDATE token_usage
		SET source_type = CASE WHEN is_estimated = 1 THEN 'estimated' ELSE 'actual' END
		WHERE source_type = 'actual'
	`)
	return err
}
