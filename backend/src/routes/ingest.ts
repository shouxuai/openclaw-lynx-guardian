import type { FastifyInstance } from "fastify";

import type { IngestService } from "../services/ingest-service.js";

export function registerIngestRoutes(
  app: FastifyInstance,
  ingestService: IngestService,
): void {
  app.post("/ingest/batch", async (request) => {
    return ingestService.processBatch(request.body);
  });
}
