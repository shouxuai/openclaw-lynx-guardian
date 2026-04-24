import { mkdirSync } from "fs";
import { dirname } from "path";
import Database from "better-sqlite3";

import { applySqlitePragmas } from "./pragmas.js";

export function openSqliteDatabase(databasePath: string): Database.Database {
  mkdirSync(dirname(databasePath), { recursive: true });
  const database = new Database(databasePath);
  applySqlitePragmas(database);
  return database;
}
