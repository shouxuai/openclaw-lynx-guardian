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

	_, err = database.Exec(
		`INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)`,
		InitialSchemaVersion, time.Now().UnixMilli(),
	)
	return err
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
