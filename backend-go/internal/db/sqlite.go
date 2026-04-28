// Package db wraps modernc.org/sqlite to mirror backend/src/db/sqlite.ts.
package db

import (
	"database/sql"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

func Open(databasePath string) (*sql.DB, error) {
	if err := os.MkdirAll(filepath.Dir(databasePath), 0o755); err != nil {
		return nil, err
	}

	database, err := sql.Open("sqlite", databasePath)
	if err != nil {
		return nil, err
	}
	database.SetMaxOpenConns(1)

	if err := applyPragmas(database); err != nil {
		_ = database.Close()
		return nil, err
	}
	return database, nil
}
