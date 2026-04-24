import type { FastifyInstance } from "fastify";

import type { LynxChecksRepository } from "../repositories/lynx-checks-repository.js";
import { readNumberQuery, readStringQuery } from "./query-helpers.js";

export function registerLynxCheckRoutes(app: FastifyInstance, repository: LynxChecksRepository): void {
  app.get("/lynx-checks", async (request) => {
    const query = request.query as Record<string, unknown>;
    return repository.list({
      fromMs: readNumberQuery(query.fromMs),
      toMs: readNumberQuery(query.toMs),
      sessionKey: readStringQuery(query.sessionKey),
      limit: readNumberQuery(query.limit),
      cursor: readStringQuery(query.cursor),
      source: readStringQuery(query.source),
      trigger: readStringQuery(query.trigger),
      status: readStringQuery(query.status),
      messageProvider: readStringQuery(query.messageProvider),
    });
  });

  app.get("/lynx-checks/:requestId", async (request, reply) => {
    const requestId = readStringQuery((request.params as Record<string, unknown>).requestId);
    const lynxCheck = requestId ? repository.getById(requestId) : null;
    if (!lynxCheck) {
      return reply.code(404).send({ ok: false, message: "Lynx check not found." });
    }
    return lynxCheck;
  });
}
