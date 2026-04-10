import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import type { ScheduledLynxDeliveryMode } from "./recent-active-delivery.js";
import { resolveRuntimeHomeDir } from "./plugin-runtime-helpers.js";

export const SCHEDULED_LYNX_CHECK_JOB_ID = "lynx-guardian-scheduled-lynx-check";

export interface ScheduledLynxCheckConfig {
  enabled?: boolean;
  cron?: string;
  timezone?: string;
  jobName?: string;
  announce?: boolean;
  deliveryMode?: ScheduledLynxDeliveryMode;
  storePath?: string;
}

interface CronJobRecord {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  createdAtMs: number;
  updatedAtMs: number;
  schedule: {
    kind: "cron";
    expr: string;
    tz?: string;
  };
  sessionTarget: "isolated";
  wakeMode: "now";
  payload: {
    kind: "agentTurn";
    message: "/lynx-check";
  };
  delivery?: {
    mode: "announce" | "none";
  };
  state: Record<string, never>;
}

interface CronStore {
  version: 1;
  jobs: any[];
}

export function resolveScheduledLynxCheckConfig(
  inlineConfig?: ScheduledLynxCheckConfig,
): Required<Omit<ScheduledLynxCheckConfig, "timezone" | "storePath">> & Pick<ScheduledLynxCheckConfig, "timezone" | "storePath"> {
  const normalized = inlineConfig && typeof inlineConfig === "object" && !Array.isArray(inlineConfig)
    ? inlineConfig
    : {};

  return {
    enabled: normalized.enabled !== false,
    cron: typeof normalized.cron === "string" && normalized.cron.trim().length > 0
      ? normalized.cron.trim()
      : "37 8 * * *",
    timezone: typeof normalized.timezone === "string" && normalized.timezone.trim().length > 0
      ? normalized.timezone.trim()
      : undefined,
    jobName: typeof normalized.jobName === "string" && normalized.jobName.trim().length > 0
      ? normalized.jobName.trim()
      : "Lynx Guardian Daily Check",
    announce: normalized.announce !== false,
    deliveryMode: normalized.deliveryMode === "announce" ? "announce" : "recent-active",
    storePath: typeof normalized.storePath === "string" && normalized.storePath.trim().length > 0
      ? resolveStorePath(normalized.storePath)
      : undefined,
  };
}

export function buildScheduledLynxCheckJob(
  config: ScheduledLynxCheckConfig,
  now: number = Date.now(),
  existing?: Partial<CronJobRecord> | null,
): CronJobRecord {
  const resolvedConfig = resolveScheduledLynxCheckConfig(config);

  return {
    id: SCHEDULED_LYNX_CHECK_JOB_ID,
    name: resolvedConfig.jobName,
    description: "Managed by Lynx Guardian plugin. Runs /lynx-check on schedule.",
    enabled: true,
    createdAtMs: typeof existing?.createdAtMs === "number" ? existing.createdAtMs : now,
    updatedAtMs: now,
    schedule: {
      kind: "cron",
      expr: resolvedConfig.cron,
      ...(resolvedConfig.timezone ? { tz: resolvedConfig.timezone } : {}),
    },
    sessionTarget: "isolated",
    wakeMode: "now",
    payload: {
      kind: "agentTurn",
      message: "/lynx-check",
    },
    ...(resolvedConfig.announce
      ? { delivery: { mode: "announce" as const } }
      : { delivery: { mode: "none" as const } }),
    state: {},
  };
}

export async function reconcileScheduledLynxCheck(params: {
  config?: ScheduledLynxCheckConfig;
  storePath?: string;
  logger?: {
    info: (message: string) => void;
    warn: (message: string) => void;
    error: (message: string) => void;
  };
  now?: number;
}): Promise<void> {
  const logger = params.logger;
  const resolvedConfig = resolveScheduledLynxCheckConfig(params.config);
  const storePath = params.storePath
    ? resolveStorePath(params.storePath)
    : resolvedConfig.storePath ?? getDefaultCronStorePath();
  const now = typeof params.now === "number" ? params.now : Date.now();

  try {
    const store = loadCronStore(storePath);
    const nextJobs = store.jobs.filter((job) => job?.id !== SCHEDULED_LYNX_CHECK_JOB_ID);

    if (resolvedConfig.enabled) {
      const existing = store.jobs.find((job) => job?.id === SCHEDULED_LYNX_CHECK_JOB_ID) ?? null;
      nextJobs.push(buildScheduledLynxCheckJob(resolvedConfig, now, existing));
      logger?.info(
        `[lynx-guardian] Scheduled /lynx-check synced to cron store (${resolvedConfig.cron}${resolvedConfig.timezone ? ` ${resolvedConfig.timezone}` : ""})`,
      );
    } else if (nextJobs.length !== store.jobs.length) {
      logger?.info("[lynx-guardian] Scheduled /lynx-check removed from cron store");
    }

    if (nextJobs.length === store.jobs.length && !resolvedConfig.enabled) {
      return;
    }

    saveCronStore(storePath, {
      version: 1,
      jobs: nextJobs,
    });
  } catch (err: any) {
    logger?.error(`[lynx-guardian] Failed to reconcile scheduled /lynx-check: ${err.message}`);
  }
}

function getDefaultCronStorePath(): string {
  return join(resolveRuntimeHomeDir(), ".openclaw", "cron", "jobs.json");
}

function resolveStorePath(storePath: string): string {
  const trimmed = storePath.trim();
  if (!trimmed) {
    return getDefaultCronStorePath();
  }
  if (trimmed.startsWith("~")) {
    return resolve(trimmed.replace(/^~(?=$|[\\/])/, resolveRuntimeHomeDir()));
  }
  return resolve(trimmed);
}

function loadCronStore(storePath: string): CronStore {
  if (!existsSync(storePath)) {
    return { version: 1, jobs: [] };
  }

  const raw = readFileSync(storePath, "utf8");
  const parsed = JSON.parse(raw);
  const parsedRecord = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed
    : {};

  return {
    version: 1,
    jobs: Array.isArray((parsedRecord as any).jobs) ? (parsedRecord as any).jobs.filter(Boolean) : [],
  };
}

function saveCronStore(storePath: string, store: CronStore): void {
  mkdirSync(dirname(storePath), { recursive: true });
  const tmpPath = `${storePath}.${process.pid}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(store, null, 2), "utf8");
  renameSync(tmpPath, storePath);

  try {
    copyFileSync(storePath, `${storePath}.bak`);
  } catch {
    // best effort only
  }
}
