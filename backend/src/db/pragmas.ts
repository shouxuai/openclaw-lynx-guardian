import type Database from "better-sqlite3";

export function applySqlitePragmas(database: Database.Database): void {
  database.pragma("journal_mode = WAL");
  database.pragma("synchronous = NORMAL");
  database.pragma("foreign_keys = OFF");
  database.pragma("busy_timeout = 5000");
}
