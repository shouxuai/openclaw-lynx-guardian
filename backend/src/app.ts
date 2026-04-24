import Fastify, { type FastifyInstance } from "fastify";

import { LOCAL_CONSOLE_API_BASE_PATH } from "../../shared/src/enums.js";
import type { LocalConsoleBackendConfig } from "./config/env.js";
import { resolveBackendConfig } from "./config/env.js";
import { openSqliteDatabase } from "./db/sqlite.js";
import { runMigrations } from "./db/migrate.js";
import { requireIngestAuth } from "./middleware/ingest-auth.js";
import { createRequireLoopback } from "./middleware/localhost-only.js";
import { ApprovalsRepository } from "./repositories/approvals-repository.js";
import { DashboardRepository } from "./repositories/dashboard-repository.js";
import { EventsRepository } from "./repositories/events-repository.js";
import { IngestRepository } from "./repositories/ingest-repository.js";
import { LynxChecksRepository } from "./repositories/lynx-checks-repository.js";
import { SessionsRepository } from "./repositories/sessions-repository.js";
import { TokensRepository } from "./repositories/tokens-repository.js";
import { ToolCallsRepository } from "./repositories/tool-calls-repository.js";
import { registerApprovalRoutes } from "./routes/approvals.js";
import { registerDashboardRoutes } from "./routes/dashboard.js";
import { registerEventRoutes } from "./routes/events.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerIngestRoutes } from "./routes/ingest.js";
import { registerLynxCheckRoutes } from "./routes/lynx-checks.js";
import { registerMetaRoutes } from "./routes/meta.js";
import { registerSessionRoutes } from "./routes/sessions.js";
import { registerTokenRoutes } from "./routes/tokens.js";
import { registerToolCallRoutes } from "./routes/tool-calls.js";
import { IngestService } from "./services/ingest-service.js";
import { registerStaticWebviewRoutes } from "./services/static-service.js";

export async function createLocalConsoleApp(
  overrides: Partial<LocalConsoleBackendConfig> = {},
): Promise<FastifyInstance> {
  const config = resolveBackendConfig(process.env, overrides);
  const database = openSqliteDatabase(config.databasePath);
  runMigrations(database);

  const repository = new IngestRepository(database);
  const ingestService = new IngestService(repository);
  const eventsRepository = new EventsRepository(database);
  const toolCallsRepository = new ToolCallsRepository(database);
  const approvalsRepository = new ApprovalsRepository(database);
  const lynxChecksRepository = new LynxChecksRepository(database);
  const sessionsRepository = new SessionsRepository(database);
  const tokensRepository = new TokensRepository(database);
  const dashboardRepository = new DashboardRepository(database);

  const app = Fastify({
    logger: false,
  });

  app.addHook("onRequest", createRequireLoopback({
    trustedProxyIps: config.trustedProxyIps,
  }));
  app.addHook("onClose", async () => {
    database.close();
  });

  registerStaticWebviewRoutes(app, {
    rootDir: config.frontendDistPath,
  });

  app.register(async (queryApp) => {
    registerHealthRoutes(queryApp);
    registerMetaRoutes(queryApp, {
      tokenUsageEnabled: config.tokenUsageEnabled,
      gatewayAuthLogsEnabled: false,
    });
    registerEventRoutes(queryApp, eventsRepository);
    registerToolCallRoutes(queryApp, toolCallsRepository);
    registerApprovalRoutes(queryApp, approvalsRepository);
    registerLynxCheckRoutes(queryApp, lynxChecksRepository);
    registerSessionRoutes(queryApp, sessionsRepository);
    registerDashboardRoutes(queryApp, dashboardRepository);
    registerTokenRoutes(queryApp, tokensRepository);
  }, {
    prefix: LOCAL_CONSOLE_API_BASE_PATH,
  });
  app.register(async (ingestApp) => {
    ingestApp.addHook("preHandler", requireIngestAuth(config.ingestToken));
    registerIngestRoutes(ingestApp, ingestService);
  }, {
    prefix: `${LOCAL_CONSOLE_API_BASE_PATH}/internal/v1`,
  });

  return app;
}
