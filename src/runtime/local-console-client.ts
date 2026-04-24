import type { Logger } from "../types.js";
import type { IngestBatchRequestV1, IngestBatchResponseV1, IngestItemV1 } from "../../shared/src/ingest.js";
import { LOCAL_CONSOLE_INGEST_SCHEMA_VERSION } from "../../shared/src/enums.js";
import type { LocalConsoleRuntimeConfig } from "./local-console-config.js";

export interface LocalConsoleIngestClient {
  enqueue(item: IngestItemV1): boolean;
  enqueueMany(items: IngestItemV1[]): number;
  flushNow(): Promise<void>;
  getQueueSize(): number;
  close(): Promise<void>;
}

interface LocalConsoleClientOptions {
  config: LocalConsoleRuntimeConfig;
  logger: Pick<Logger, "info" | "warn" | "error" | "debug">;
  getToken: () => string;
  fetchImpl?: typeof fetch;
  retryDelaysMs?: number[];
  producer?: {
    pluginVersion?: string;
    instanceId?: string;
    host?: string;
  };
}

function delayMs(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function createBatchPayload(
  items: IngestItemV1[],
  producer: LocalConsoleClientOptions["producer"],
  batchCounter: number,
  now: number,
): IngestBatchRequestV1 {
  return {
    schemaVersion: LOCAL_CONSOLE_INGEST_SCHEMA_VERSION,
    producer: {
      pluginId: "openclaw-lynx-guardian",
      pluginVersion: producer?.pluginVersion,
      instanceId: producer?.instanceId,
      host: producer?.host,
    },
    sentAtMs: now,
    batchId: `local-console-${now}-${batchCounter}`,
    items,
  };
}

async function parseBatchResponse(response: Response): Promise<IngestBatchResponseV1> {
  if (!response.ok) {
    throw new Error(`local console ingest responded with HTTP ${response.status}`);
  }

  return response.json() as Promise<IngestBatchResponseV1>;
}

export function createLocalConsoleIngestClient(options: LocalConsoleClientOptions): LocalConsoleIngestClient {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new Error("Local console ingest client requires fetch.");
  }

  const retryDelaysMs = (options.retryDelaysMs ?? [250, 500, 1000]).map((value) => Math.max(0, Math.trunc(value)));
  const queue: IngestItemV1[] = [];
  let batchCounter = 0;
  let closed = false;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let flushingPromise: Promise<void> | null = null;

  function clearFlushTimer(): void {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
  }

  function scheduleFlush(delay = options.config.flushIntervalMs): void {
    if (closed || flushTimer || queue.length === 0) {
      return;
    }

    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flushNow();
    }, delay);
  }

  async function sendBatch(items: IngestItemV1[]): Promise<IngestBatchResponseV1> {
    const token = options.getToken().trim();
    if (!token) {
      throw new Error("local console ingest token is missing");
    }

    batchCounter += 1;
    const payload = createBatchPayload(items, options.producer, batchCounter, Date.now());
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), options.config.requestTimeoutMs);

    try {
      const response = await fetchImpl(options.config.ingestUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      return await parseBatchResponse(response);
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  async function sendBatchWithRetry(items: IngestItemV1[]): Promise<boolean> {
    let attempt = 0;
    while (true) {
      try {
        await sendBatch(items);
        return true;
      } catch (error) {
        const retryDelayMs = retryDelaysMs[attempt];
        if (retryDelayMs === undefined) {
          options.logger.error(
            `[lynx-guardian] local console ingest failed after retries: ${error instanceof Error ? error.message : String(error)}`,
          );
          return false;
        }

        options.logger.warn(
          `[lynx-guardian] local console retrying ingest batch (${items.length} items) in ${retryDelayMs}ms`,
        );
        attempt += 1;
        await delayMs(retryDelayMs);
      }
    }
  }

  async function drainQueue(): Promise<void> {
    while (queue.length > 0) {
      const batch = queue.splice(0, options.config.maxBatchItems);
      const delivered = await sendBatchWithRetry(batch);
      if (!delivered) {
        queue.unshift(...batch);
        scheduleFlush();
        return;
      }
    }
  }

  function flushNow(): Promise<void> {
    if (closed) {
      return Promise.resolve();
    }

    if (flushingPromise) {
      return flushingPromise;
    }

    clearFlushTimer();
    flushingPromise = (async () => {
      await drainQueue();
    })().finally(() => {
      flushingPromise = null;
      scheduleFlush();
    });

    return flushingPromise;
  }

  return {
    enqueue(item) {
      if (closed) {
        return false;
      }
      if (queue.length >= options.config.maxQueueItems) {
        options.logger.warn(
          `[lynx-guardian] local console queue is full (${options.config.maxQueueItems}); dropping ${item.kind}`,
        );
        return false;
      }

      queue.push(item);
      scheduleFlush();
      return true;
    },

    enqueueMany(items) {
      let acceptedCount = 0;
      for (const item of items) {
        if (this.enqueue(item)) {
          acceptedCount += 1;
        }
      }
      return acceptedCount;
    },

    async flushNow() {
      await flushNow();
    },

    getQueueSize() {
      return queue.length;
    },

    async close() {
      closed = true;
      clearFlushTimer();
      if (flushingPromise) {
        await flushingPromise;
      }
    },
  };
}
