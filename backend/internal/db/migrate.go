package db

import (
	"database/sql"
	"embed"
	"io/fs"
	"sort"
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

	_, err = database.Exec(
		`INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)`,
		InitialSchemaVersion, time.Now().UnixMilli(),
	)
	return err
}
