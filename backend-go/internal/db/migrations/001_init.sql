-- Placeholder migration. Replace with the real schema by copying from:
--   ../backend/src/db/migrations/001_init.sql
--
-- Keep this file in sync; this Go version intentionally does not fork the SQL,
-- so nothing here will be relied on in production until the copy step in
-- README.md is run.

CREATE TABLE IF NOT EXISTS schema_migrations (
    version     TEXT PRIMARY KEY,
    applied_at  INTEGER NOT NULL
);
