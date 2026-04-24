import { readFileSync } from "fs";

import type Database from "better-sqlite3";

export const INITIAL_SCHEMA_VERSION = "001_init";

const INITIAL_SCHEMA_SQL = readFileSync(
  new URL("./migrations/001_init.sql", import.meta.url),
  "utf8",
);

export function runMigrations(database: Database.Database): void {
  database.exec(INITIAL_SCHEMA_SQL);

  database
    .prepare(
      `
      INSERT OR IGNORE INTO schema_migrations (version, applied_at)
      VALUES (?, ?)
      `,
    )
    .run(INITIAL_SCHEMA_VERSION, Date.now());
}
