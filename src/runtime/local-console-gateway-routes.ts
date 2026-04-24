import { existsSync, readFileSync } from "fs";
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "http";

import type { Logger } from "../types.js";
import type { LocalConsoleRuntimeConfig } from "./local-console-config.js";
import type { LocalConsoleSupervisor } from "./local-console-supervisor.js";

const LOOPBACK_ADDRESSES = new Set([
  "127.0.0.1",
  "::1",
  "::ffff:127.0.0.1",
]);

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const PASSTHROUGH_REQUEST_HEADERS = new Set([
  "accept",
  "accept-encoding",
  "accept-language",
  "cache-control",
  "if-match",
  "if-modified-since",
  "if-none-match",
  "if-unmodified-since",
  "pragma",
  "user-agent",
]);

export type LocalConsoleGatewayRouteKind = "webview" | "query-api";

export interface LocalConsoleGatewayProxyOptions {
  config: Pick<LocalConsoleRuntimeConfig, "baseUrl" | "requestTimeoutMs">;
  supervisor: Pick<LocalConsoleSupervisor, "ensureRunning">;
  logger: Pick<Logger, "warn" | "error">;
  fetchImpl?: typeof fetch;
  trustedProxyIps?: string[];
  routeTablePath?: string;
}

export interface LocalConsoleGatewayRouteRegistration {
  path: string;
  auth: "plugin";
  match: "prefix";
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;
}

function normalizeAddress(address: string): string {
  const trimmed = address.trim();
  return trimmed.startsWith("::ffff:") ? trimmed.slice("::ffff:".length) : trimmed;
}

function addTrustedAddress(addresses: Set<string>, candidate: string): void {
  const normalized = normalizeAddress(candidate);
  if (!normalized) {
    return;
  }

  addresses.add(normalized);
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalized)) {
    addresses.add(`::ffff:${normalized}`);
  }
}

function parseLinuxRouteGateway(gatewayHex: string): string | null {
  if (!/^[0-9a-fA-F]{8}$/.test(gatewayHex)) {
    return null;
  }

  const octets = gatewayHex.match(/../g);
  if (!octets || octets.length !== 4) {
    return null;
  }

  return octets
    .reverse()
    .map((octet) => Number.parseInt(octet, 16))
    .join(".");
}

export function parseLinuxDefaultGatewayAddresses(routeTable: string): string[] {
  const addresses = new Set<string>();

  for (const line of routeTable.split(/\r?\n/).slice(1)) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 3) {
      continue;
    }

    const destination = columns[1];
    const gateway = columns[2];
    if (destination !== "00000000" || gateway === "00000000") {
      continue;
    }

    const parsedGateway = parseLinuxRouteGateway(gateway);
    if (parsedGateway) {
      addresses.add(parsedGateway);
    }
  }

  return [...addresses];
}

function resolveTrustedProxyIps(routeTablePath = "/proc/net/route"): string[] {
  if (!existsSync(routeTablePath)) {
    return [];
  }

  try {
    return parseLinuxDefaultGatewayAddresses(readFileSync(routeTablePath, "utf8"));
  } catch {
    return [];
  }
}

function buildTrustedAddressSet(trustedProxyIps: string[]): Set<string> {
  const addresses = new Set<string>(LOOPBACK_ADDRESSES);
  for (const proxyIp of trustedProxyIps) {
    addTrustedAddress(addresses, proxyIp);
  }
  return addresses;
}

function isTrustedRemoteAddress(remoteAddress: string | undefined, trustedAddresses: Set<string>): boolean {
  if (!remoteAddress) {
    return false;
  }

  return trustedAddresses.has(remoteAddress) || trustedAddresses.has(normalizeAddress(remoteAddress));
}

function normalizePathname(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.replace(/\/+$/, "");
  }

  return pathname;
}

export function resolveLocalConsoleGatewayRouteKind(pathname: string): LocalConsoleGatewayRouteKind | null {
  const normalizedPath = normalizePathname(pathname);

  if (normalizedPath === "/webview" || normalizedPath.startsWith("/webview/")) {
    return "webview";
  }

  if (normalizedPath === "/lynx" || normalizedPath.startsWith("/lynx/")) {
    if (normalizedPath === "/lynx/internal" || normalizedPath.startsWith("/lynx/internal/")) {
      return null;
    }
    return "query-api";
  }

  return null;
}

function buildForwardHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  const forwarded: Record<string, string> = {};

  for (const [name, value] of Object.entries(headers)) {
    if (!PASSTHROUGH_REQUEST_HEADERS.has(name.toLowerCase())) {
      continue;
    }
    if (Array.isArray(value)) {
      forwarded[name] = value.join(", ");
      continue;
    }
    if (typeof value === "string") {
      forwarded[name] = value;
    }
  }

  return forwarded;
}

function applyResponseHeaders(res: ServerResponse, headers: Headers): void {
  headers.forEach((value, name) => {
    if (HOP_BY_HOP_HEADERS.has(name.toLowerCase())) {
      return;
    }
    res.setHeader(name, value);
  });
}

function sendTextResponse(
  res: ServerResponse,
  statusCode: number,
  message: string,
): true {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(message);
  return true;
}

export function createLocalConsoleGatewayProxyHandler(
  options: LocalConsoleGatewayProxyOptions,
): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new Error("Local console gateway proxy requires fetch.");
  }

  const trustedAddresses = buildTrustedAddressSet(
    options.trustedProxyIps && options.trustedProxyIps.length > 0
      ? options.trustedProxyIps
      : resolveTrustedProxyIps(options.routeTablePath),
  );

  return async (req, res) => {
    const requestUrl = new URL(req.url ?? "/", "http://localhost");
    const routeKind = resolveLocalConsoleGatewayRouteKind(requestUrl.pathname);
    if (!routeKind) {
      return false;
    }

    const method = (req.method ?? "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      res.statusCode = 405;
      res.setHeader("Allow", "GET, HEAD");
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Method Not Allowed");
      return true;
    }

    if (!isTrustedRemoteAddress(req.socket.remoteAddress, trustedAddresses)) {
      return sendTextResponse(res, 403, "Local console only accepts loopback requests.");
    }

    const started = await options.supervisor.ensureRunning("gateway-http-route");
    if (!started) {
      return sendTextResponse(res, 503, "Local console backend is unavailable.");
    }

    const upstreamUrl = new URL(`${requestUrl.pathname}${requestUrl.search}`, options.config.baseUrl).toString();
    const controller = new AbortController();
    const timeoutHandle = setTimeout(
      () => controller.abort(),
      Math.max(options.config.requestTimeoutMs * 4, 5000),
    );

    try {
      const upstreamResponse = await fetchImpl(upstreamUrl, {
        headers: buildForwardHeaders(req.headers),
        method,
        signal: controller.signal,
      });

      res.statusCode = upstreamResponse.status;
      applyResponseHeaders(res, upstreamResponse.headers);
      if (method === "HEAD") {
        res.end();
        return true;
      }

      const responseBody = Buffer.from(await upstreamResponse.arrayBuffer());
      res.end(responseBody);
      return true;
    } catch (error) {
      options.logger.warn(
        `[lynx-guardian] local console gateway proxy failed (${routeKind}) ${method} ${requestUrl.pathname}: ${error instanceof Error ? error.message : String(error)}`,
      );
      if (!res.headersSent) {
        return sendTextResponse(res, 502, "Local console gateway proxy failed.");
      }
      return true;
    } finally {
      clearTimeout(timeoutHandle);
    }
  };
}

export function createLocalConsoleGatewayRouteRegistrations(
  options: LocalConsoleGatewayProxyOptions,
): LocalConsoleGatewayRouteRegistration[] {
  const handler = createLocalConsoleGatewayProxyHandler(options);

  return [
    {
      path: "/webview",
      auth: "plugin",
      match: "prefix",
      handler,
    },
    {
      path: "/lynx",
      auth: "plugin",
      match: "prefix",
      handler,
    },
  ];
}
