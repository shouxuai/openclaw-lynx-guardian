import type { FastifyInstance } from "fastify";

import type { EventsRepository } from "../repositories/events-repository.js";
import { readNumberQuery, readStringArrayQuery, readStringQuery } from "./query-helpers.js";

export function registerEventRoutes(app: FastifyInstance, repository: EventsRepository): void {
  app.get("/events", async (request) => {
    const query = request.query as Record<string, unknown>;
    return repository.list({
      q: readStringQuery(query.q),
      fromMs: readNumberQuery(query.fromMs),
      toMs: readNumberQuery(query.toMs),
      sessionKey: readStringQuery(query.sessionKey),
      runId: readStringQuery(query.runId),
      riskLevel: readStringArrayQuery(query.riskLevel) as never,
      enforcementAction: readStringArrayQuery(query.enforcementAction) as never,
      limit: readNumberQuery(query.limit),
      cursor: readStringQuery(query.cursor),
      hookName: readStringQuery(query.hookName),
      eventType: readStringQuery(query.eventType),
      category: readStringQuery(query.category),
      subCategory: readStringQuery(query.subCategory),
      direction: readStringQuery(query.direction),
      primaryModule: readStringQuery(query.primaryModule),
      requestId: readStringQuery(query.requestId),
      toolCallId: readStringQuery(query.toolCallId),
      approvalId: readStringQuery(query.approvalId),
    });
  });

  app.get("/events/:eventId", async (request, reply) => {
    const eventId = readStringQuery((request.params as Record<string, unknown>).eventId);
    const event = eventId ? repository.getById(eventId) : null;
    if (!event) {
      return reply.code(404).send({ ok: false, message: "Audit event not found." });
    }
    return event;
  });
}
