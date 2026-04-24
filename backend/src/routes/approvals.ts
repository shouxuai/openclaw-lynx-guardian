import type { FastifyInstance } from "fastify";

import type { ApprovalsRepository } from "../repositories/approvals-repository.js";
import { readNumberQuery, readStringArrayQuery, readStringQuery } from "./query-helpers.js";

export function registerApprovalRoutes(app: FastifyInstance, repository: ApprovalsRepository): void {
  app.get("/approvals", async (request) => {
    const query = request.query as Record<string, unknown>;
    return repository.list({
      fromMs: readNumberQuery(query.fromMs),
      toMs: readNumberQuery(query.toMs),
      sessionKey: readStringQuery(query.sessionKey),
      runId: readStringQuery(query.runId),
      riskLevel: readStringArrayQuery(query.riskLevel),
      limit: readNumberQuery(query.limit),
      cursor: readStringQuery(query.cursor),
      resolution: readStringQuery(query.resolution),
      toolName: readStringQuery(query.toolName),
      module: readStringQuery(query.module),
      scopeType: readStringQuery(query.scopeType),
      requesterOuId: readStringQuery(query.requesterOuId),
    });
  });

  app.get("/approvals/:approvalId", async (request, reply) => {
    const approvalId = readStringQuery((request.params as Record<string, unknown>).approvalId);
    const approval = approvalId ? repository.getById(approvalId) : null;
    if (!approval) {
      return reply.code(404).send({ ok: false, message: "Approval not found." });
    }
    return approval;
  });
}
