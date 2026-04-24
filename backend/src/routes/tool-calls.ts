import type { FastifyInstance } from "fastify";

import type { ToolCallsRepository } from "../repositories/tool-calls-repository.js";
import { readNumberQuery, readStringArrayQuery, readStringQuery } from "./query-helpers.js";

export function registerToolCallRoutes(app: FastifyInstance, repository: ToolCallsRepository): void {
  app.get("/tool-calls", async (request) => {
    const query = request.query as Record<string, unknown>;
    return repository.list({
      fromMs: readNumberQuery(query.fromMs),
      toMs: readNumberQuery(query.toMs),
      sessionKey: readStringQuery(query.sessionKey),
      runId: readStringQuery(query.runId),
      riskLevel: readStringArrayQuery(query.riskLevel) as never,
      enforcementAction: readStringArrayQuery(query.enforcementAction) as never,
      limit: readNumberQuery(query.limit),
      cursor: readStringQuery(query.cursor),
      toolName: readStringQuery(query.toolName),
      resultStatus: readStringQuery(query.resultStatus),
      approvalId: readStringQuery(query.approvalId),
    });
  });

  app.get("/tool-calls/:toolCallId", async (request, reply) => {
    const toolCallId = readStringQuery((request.params as Record<string, unknown>).toolCallId);
    const toolCall = toolCallId ? repository.getById(toolCallId) : null;
    if (!toolCall) {
      return reply.code(404).send({ ok: false, message: "Tool call not found." });
    }
    return toolCall;
  });
}
