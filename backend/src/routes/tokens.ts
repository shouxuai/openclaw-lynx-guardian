import type { FastifyInstance } from "fastify";

import type { TokensRepository } from "../repositories/tokens-repository.js";
import { readBooleanQuery, readNumberQuery, readStringQuery } from "./query-helpers.js";

export function registerTokenRoutes(app: FastifyInstance, repository: TokensRepository): void {
  app.get("/tokens/usage", async (request) => {
    const query = request.query as Record<string, unknown>;
    return repository.list({
      fromMs: readNumberQuery(query.fromMs),
      toMs: readNumberQuery(query.toMs),
      sessionKey: readStringQuery(query.sessionKey),
      runId: readStringQuery(query.runId),
      limit: readNumberQuery(query.limit),
      cursor: readStringQuery(query.cursor),
      provider: readStringQuery(query.provider),
      model: readStringQuery(query.model),
      agentId: readStringQuery(query.agentId),
      isEstimated: readBooleanQuery(query.isEstimated),
    });
  });

  app.get("/tokens/summary", async (request) => {
    const query = request.query as Record<string, unknown>;
    return repository.getSummary({
      fromMs: readNumberQuery(query.fromMs),
      toMs: readNumberQuery(query.toMs),
      sessionKey: readStringQuery(query.sessionKey),
      runId: readStringQuery(query.runId),
      provider: readStringQuery(query.provider),
      model: readStringQuery(query.model),
    });
  });

  app.get("/tokens/trend", async (request) => {
    const query = request.query as Record<string, unknown>;
    return repository.getTrend({
      fromMs: readNumberQuery(query.fromMs),
      toMs: readNumberQuery(query.toMs),
      sessionKey: readStringQuery(query.sessionKey),
      runId: readStringQuery(query.runId),
      provider: readStringQuery(query.provider),
      model: readStringQuery(query.model),
      bucket: readStringQuery(query.bucket) as never,
    });
  });
}
