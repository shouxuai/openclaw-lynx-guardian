import { createServer } from "net";

import { LOCAL_CONSOLE_API_BASE_PATH } from "../../shared/src/enums.js";

export const DEFAULT_LOCAL_CONSOLE_PORT = 31789;
export const DEFAULT_LOCAL_CONSOLE_PORT_CANDIDATE_COUNT = 21;

export interface LocalConsolePortConfigShape {
  host: string;
  port: number;
  preferredPort?: number;
  candidatePorts?: number[];
  baseUrl: string;
  healthUrl: string;
  ingestUrl: string;
}

export interface LocalConsolePortSelectionOptions {
  listenHost: string;
  candidatePorts: number[];
}

export function buildLocalConsoleBaseUrl(host: string, port: number): string {
  return `http://${host}:${port}`;
}

export function resolveLocalConsoleListenHost(host: string): string {
  const normalizedHost = host.trim().toLowerCase();
  if (
    normalizedHost === "127.0.0.1"
    || normalizedHost === "localhost"
    || normalizedHost === "::1"
    || normalizedHost === "::ffff:127.0.0.1"
  ) {
    return "0.0.0.0";
  }

  return host;
}

export function buildLocalConsoleHealthUrl(host: string, port: number): string {
  return `${buildLocalConsoleBaseUrl(host, port)}${LOCAL_CONSOLE_API_BASE_PATH}/health`;
}

export function buildLocalConsoleIngestUrl(host: string, port: number): string {
  return `${buildLocalConsoleBaseUrl(host, port)}${LOCAL_CONSOLE_API_BASE_PATH}/internal/v1/ingest/batch`;
}

export function buildLocalConsolePortCandidates(
  preferredPort: number,
  candidateCount = DEFAULT_LOCAL_CONSOLE_PORT_CANDIDATE_COUNT,
): number[] {
  const normalizedPreferredPort = Math.max(1, Math.trunc(preferredPort));
  const normalizedCandidateCount = Math.max(1, Math.trunc(candidateCount));
  return Array.from({ length: normalizedCandidateCount }, (_value, index) => normalizedPreferredPort + index);
}

export function applyLocalConsoleRuntimePort(
  config: LocalConsolePortConfigShape,
  port: number,
): void {
  config.port = port;
  config.baseUrl = buildLocalConsoleBaseUrl(config.host, port);
  config.healthUrl = buildLocalConsoleHealthUrl(config.host, port);
  config.ingestUrl = buildLocalConsoleIngestUrl(config.host, port);
}

export async function isLocalConsolePortAvailable(host: string, port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const server = createServer();
    server.unref();

    server.once("error", () => {
      resolve(false);
    });

    server.listen({
      host,
      port,
      exclusive: true,
    }, () => {
      server.close((error) => {
        resolve(!error);
      });
    });
  });
}

export async function findAvailableLocalConsolePort(
  options: LocalConsolePortSelectionOptions,
): Promise<number | null> {
  for (const candidatePort of options.candidatePorts) {
    if (await isLocalConsolePortAvailable(options.listenHost, candidatePort)) {
      return candidatePort;
    }
  }

  return null;
}
