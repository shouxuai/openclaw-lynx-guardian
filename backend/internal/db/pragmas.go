package db

import "database/sql"

// applyPragmas mirrors backend/src/db/pragmas.ts.
func applyPragmas(database *sql.DB) error {
	stmts := []string{
		"PRAGMA journal_mode = WAL",
		"PRAGMA synchronous = NORMAL",
		"PRAGMA foreign_keys = OFF",
		"PRAGMA busy_timeout = 5000",
	}
	for _, stmt := range stmts {
		if _, err := database.Exec(stmt); err != nil {
			return err
		}
	}
	return nil
}
