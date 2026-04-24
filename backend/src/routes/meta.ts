import type { FastifyInstance } from "fastify";

import { LOCAL_CONSOLE_QUERY_API_VERSION } from "../../../shared/src/enums.js";

export interface LocalConsoleCapabilities {
  tokenUsageEnabled: boolean;
  gatewayAuthLogsEnabled: boolean;
}

export function registerMetaRoutes(
  app: FastifyInstance,
  capabilities: LocalConsoleCapabilities = {
    tokenUsageEnabled: false,
    gatewayAuthLogsEnabled: false,
  },
): void {
  app.get("/meta/capabilities", async () => ({
    tokenUsageEnabled: capabilities.tokenUsageEnabled,
    gatewayAuthLogsEnabled: capabilities.gatewayAuthLogsEnabled,
    queryApiVersion: LOCAL_CONSOLE_QUERY_API_VERSION,
  }));
}
