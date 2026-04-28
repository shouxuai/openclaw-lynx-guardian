package db

import (
	"database/sql"
	"embed"
	"time"
)

//go:embed migrations/001_init.sql
var migrationsFS embed.FS

const InitialSchemaVersion = "001_init"

// Migrate mirrors backend/src/db/migrate.ts.
func Migrate(database *sql.DB) error {
	sqlBytes, err := migrationsFS.ReadFile("migrations/001_init.sql")
	if err != nil {
		return err
	}

	if _, err := database.Exec(string(sqlBytes)); err != nil {
		return err
	}

	_, err = database.Exec(
		`INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)`,
		InitialSchemaVersion, time.Now().UnixMilli(),
	)
	return err
}
