import { describe, expect, it } from "vitest";

import type { IngestItemV1 } from "../shared/src/ingest.js";
import { createLocalConsoleIngestClient } from "../src/runtime/local-console-client.js";
import type { LocalConsoleRuntimeConfig } from "../src/runtime/local-console-config.js";

const baseConfig: LocalConsoleRuntimeConfig = {
  enabled: true,
  autoStart: true,
  host: "127.0.0.1",
  listenHost: "0.0.0.0",
  port: 31789,
  preferredPort: 31789,
  candidatePorts: [31789],
  requestTimeoutMs: 500,
  flushIntervalMs: 10_000,
  maxBatchItems: 50,
  maxQueueItems: 500,
  baseUrl: "http://127.0.0.1:31789",
  healthUrl: "http://127.0.0.1:31789/lynx/health",
  ingestUrl: "http://127.0.0.1:31789/lynx/internal/v1/ingest/batch",
  paths: {
    dataDir: "data",
    databasePath: "data/lynx.db",
    tokenPath: "data/console.token",
    pidPath: "data/console.pid",
    logPath: "data/console.log",
  },
};

function item(kind: IngestItemV1["kind"], itemId: string): IngestItemV1 {
  return {
    kind,
    itemId,
    occurredAtMs: 1_776_928_800_000,
    data: {},
  } as IngestItemV1;
}

describe("createLocalConsoleIngestClient", () => {
  it("sends queued items to kind-specific ingest endpoints", async () => {
    const calls: Array<{ url: string; body: any }> = [];
    const client = createLocalConsoleIngestClient({
      config: baseConfig,
      logger: console,
      getToken: () => "test-token",
      fetchImpl: (async (url, init) => {
        calls.push({
          url: String(url),
          body: JSON.parse(String(init?.body)),
        });
        return new Response(JSON.stringify({
          ok: true,
          schemaVersion: "lynx-server.ingest.v1",
          batchId: "ok",
          acceptedCount: 1,
          persistedCount: 1,
          duplicateCount: 0,
          rejectedCount: 0,
          rejectedItems: [],
          serverTimeMs: Date.now(),
        }), { status: 200 });
      }) as typeof fetch,
    });

    client.enqueueMany([
      item("auditEvent", "audit-1"),
      item("toolCallUpsert", "tool-1"),
      item("lynxCheckUpsert", "check-1"),
    ]);
    await client.flushNow();

    expect(calls.map((call) => call.url)).toEqual([
      "http://127.0.0.1:31789/lynx/internal/v1/ingest/audit-events",
      "http://127.0.0.1:31789/lynx/internal/v1/ingest/tool-calls",
      "http://127.0.0.1:31789/lynx/internal/v1/ingest/lynx-checks",
    ]);
    expect(calls.map((call) => call.body.items.map((queuedItem: IngestItemV1) => queuedItem.kind))).toEqual([
      ["auditEvent"],
      ["toolCallUpsert"],
      ["lynxCheckUpsert"],
    ]);
  });
});
