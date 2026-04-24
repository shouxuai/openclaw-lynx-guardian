import type { FastifyInstance } from "fastify";

import { LOCAL_CONSOLE_INGEST_SCHEMA_VERSION } from "../../../shared/src/enums.js";

export function registerHealthRoutes(app: FastifyInstance): void {
  app.get("/health", async () => ({
    ok: true,
    serverTimeMs: Date.now(),
    schemaVersion: LOCAL_CONSOLE_INGEST_SCHEMA_VERSION,
  }));
}
