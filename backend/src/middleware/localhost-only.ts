import { existsSync, readFileSync } from "fs";

import type { FastifyReply, FastifyRequest } from "fastify";

const LOOPBACK_ADDRESSES = new Set([
  "127.0.0.1",
  "::1",
  "::ffff:127.0.0.1",
]);

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

export function resolveTrustedProxyIps(routeTablePath = "/proc/net/route"): string[] {
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

export function createRequireLoopback(options: { trustedProxyIps?: string[] } = {}) {
  const trustedAddresses = buildTrustedAddressSet(
    options.trustedProxyIps && options.trustedProxyIps.length > 0
      ? options.trustedProxyIps
      : resolveTrustedProxyIps(),
  );

  return async function requireLoopback(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const candidate = request.ip || request.socket.remoteAddress;
    if (!candidate || trustedAddresses.has(candidate) || trustedAddresses.has(normalizeAddress(candidate))) {
      return;
    }

    await reply.code(403).send({
      ok: false,
      message: "Local console only accepts loopback requests.",
    });
  };
}
