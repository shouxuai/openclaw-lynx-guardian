import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { openSqliteDatabase } from "../src/db/sqlite.js";
import { runMigrations } from "../src/db/migrate.js";

describe("runMigrations", () => {
  const cleanupDirs: string[] = [];

  afterEach(() => {
    while (cleanupDirs.length > 0) {
      const dir = cleanupDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("creates the v1 schema and records the applied migration", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "lynx-console-migrate-"));
    cleanupDirs.push(dataDir);
    const databasePath = join(dataDir, "lynx.db");

    const database = openSqliteDatabase(databasePath);

    try {
      runMigrations(database);

      expect(existsSync(databasePath)).toBe(true);

      const auditEventsTable = database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'audit_events'",
        )
        .get() as { name: string } | undefined;
      expect(auditEventsTable?.name).toBe("audit_events");

      const migration = database
        .prepare("SELECT version FROM schema_migrations WHERE version = ?")
        .get("001_init") as { version: string } | undefined;
      expect(migration?.version).toBe("001_init");
    } finally {
      database.close();
    }
  });
});
