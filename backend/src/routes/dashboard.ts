import type { FastifyInstance } from "fastify";

import type { DashboardRepository } from "../repositories/dashboard-repository.js";
import { readNumberQuery } from "./query-helpers.js";

export function registerDashboardRoutes(app: FastifyInstance, repository: DashboardRepository): void {
  app.get("/dashboard/overview", async (request) => {
    const query = request.query as Record<string, unknown>;
    return repository.getOverview({
      fromMs: readNumberQuery(query.fromMs),
      toMs: readNumberQuery(query.toMs),
    });
  });
}
