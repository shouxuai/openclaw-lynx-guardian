import { createServer, type IncomingMessage, type Server, type ServerResponse } from "http";
import type { AddressInfo } from "net";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createLocalConsoleGatewayProxyHandler } from "../src/console/runtime.js";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(closeServer));
});

describe("local console gateway proxy", () => {
  it("allows private-network webview requests that already reached the OpenClaw gateway", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html>lynx</html>", {
      headers: { "content-type": "text/html" },
      status: 200,
    }));
    const handler = createLocalConsoleGatewayProxyHandler({
      config: {
        baseUrl: "http://127.0.0.1:31789",
        requestTimeoutMs: 1_000,
      },
      fetchImpl,
      supervisor: { ensureRunning: vi.fn(async () => true) },
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    const req = mockRequest({
      remoteAddress: "192.168.121.99",
      url: "/webview",
    });
    const res = mockResponse();

    const handled = await handler(req, res.response);

    expect(handled).toBe(true);
    expect(res.response.statusCode).toBe(200);
    expect(res.body()).toBe("<html>lynx</html>");
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:31789/webview",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("forwards public query API POST bodies to the local console backend", async () => {
    const upstreamRequests: Array<{
      method?: string;
      url?: string;
      contentType?: string | string[];
      body: string;
    }> = [];

    const upstream = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      req.on("end", () => {
        upstreamRequests.push({
          method: req.method,
          url: req.url,
          contentType: req.headers["content-type"],
          body: Buffer.concat(chunks).toString("utf8"),
        });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    await listen(upstream);

    const handler = createLocalConsoleGatewayProxyHandler({
      config: {
        baseUrl: `http://127.0.0.1:${portOf(upstream)}`,
        requestTimeoutMs: 1_000,
      },
      supervisor: { ensureRunning: vi.fn(async () => true) },
      logger: { warn: vi.fn(), error: vi.fn() },
    });

    const proxy = createServer((req, res) => {
      void handler(req, res).then((handled) => {
        if (!handled && !res.headersSent) {
          res.statusCode = 404;
          res.end("not handled");
        }
      });
    });
    await listen(proxy);

    const body = JSON.stringify({ path: "/tmp/lynx-protected-proof", preset: "read_only" });
    const response = await fetch(`http://127.0.0.1:${portOf(proxy)}/lynx/protected-resources`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(upstreamRequests).toEqual([
      {
        method: "POST",
        url: "/lynx/protected-resources",
        contentType: "application/json",
        body,
      },
    ]);
  });
});

async function listen(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function portOf(server: Server): number {
  return (server.address() as AddressInfo).port;
}

function mockRequest(options: {
  method?: string;
  remoteAddress: string;
  url: string;
}): IncomingMessage {
  return {
    headers: {},
    method: options.method ?? "GET",
    socket: {
      remoteAddress: options.remoteAddress,
    },
    url: options.url,
  } as unknown as IncomingMessage;
}

function mockResponse(): {
  body: () => string;
  response: ServerResponse & { statusCode: number };
} {
  const chunks: Buffer[] = [];
  const response = {
    end: vi.fn((chunk?: string | Buffer) => {
      if (chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
    }),
    setHeader: vi.fn(),
    statusCode: 200,
  } as unknown as ServerResponse & { statusCode: number };
  return {
    body: () => Buffer.concat(chunks).toString("utf8"),
    response,
  };
}
