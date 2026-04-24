import type { FastifyInstance } from "fastify";

import type { SessionsRepository } from "../repositories/sessions-repository.js";
import { readBooleanQuery, readNumberQuery, readStringQuery } from "./query-helpers.js";

export function registerSessionRoutes(app: FastifyInstance, repository: SessionsRepository): void {
  app.get("/sessions", async (request) => {
    const query = request.query as Record<string, unknown>;
    return repository.list({
      fromMs: readNumberQuery(query.fromMs),
      toMs: readNumberQuery(query.toMs),
      limit: readNumberQuery(query.limit),
      cursor: readStringQuery(query.cursor),
      channelProfile: readStringQuery(query.channelProfile),
      channelId: readStringQuery(query.channelId),
      requesterId: readStringQuery(query.requesterId),
      requesterOuId: readStringQuery(query.requesterOuId),
      isGroup: readBooleanQuery(query.isGroup),
    });
  });

  app.get("/sessions/:sessionKey", async (request, reply) => {
    const sessionKey = readStringQuery((request.params as Record<string, unknown>).sessionKey);
    const session = sessionKey ? repository.getByKey(sessionKey) : null;
    if (!session) {
      return reply.code(404).send({ ok: false, message: "Session not found." });
    }
    return session;
  });
}
