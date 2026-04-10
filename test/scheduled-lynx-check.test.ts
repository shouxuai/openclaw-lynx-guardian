import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

import {
  buildScheduledLynxCheckJob,
  reconcileScheduledLynxCheck,
  resolveScheduledLynxCheckConfig,
  SCHEDULED_LYNX_CHECK_JOB_ID,
} from "../src/runtime/scheduled-lynx-check.js";

describe("scheduled lynx-check", () => {
  const tempDir = join(process.cwd(), "test-temp", "scheduled-lynx-check");
  const storePath = join(tempDir, "jobs.json");
  const stubHome = join(process.cwd(), "test-temp", "scheduled-lynx-check-home");

  beforeEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    mkdirSync(tempDir, { recursive: true });
    rmSync(stubHome, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("resolves enabled defaults when config is missing", () => {
    expect(resolveScheduledLynxCheckConfig(undefined)).toEqual({
      enabled: true,
      cron: "37 8 * * *",
      timezone: undefined,
      jobName: "Lynx Guardian Daily Check",
      announce: true,
      deliveryMode: "recent-active",
      storePath: undefined,
    });
  });

  it("creates the managed cron job from defaults when config is missing", async () => {
    await reconcileScheduledLynxCheck({
      config: undefined,
      storePath,
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
      },
      now: 1500,
    });

    expect(existsSync(storePath)).toBe(true);
    const store = JSON.parse(readFileSync(storePath, "utf8"));
    expect(store.jobs).toHaveLength(1);
    expect(store.jobs[0].id).toBe(SCHEDULED_LYNX_CHECK_JOB_ID);
    expect(store.jobs[0].schedule.expr).toBe("37 8 * * *");
    expect(store.jobs[0].delivery).toEqual({ mode: "announce" });
  });

  it("uses HOME and USERPROFILE for the default cron store path", async () => {
    vi.stubEnv("HOME", stubHome);
    vi.stubEnv("USERPROFILE", stubHome);

    await reconcileScheduledLynxCheck({
      config: undefined,
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
      },
      now: 1600,
    });

    const defaultStorePath = join(stubHome, ".openclaw", "cron", "jobs.json");
    expect(existsSync(defaultStorePath)).toBe(true);
  });

  it("builds an isolated announce cron job from config", () => {
    const job = buildScheduledLynxCheckJob({
      enabled: true,
      cron: "37 8 * * *",
      timezone: "Asia/Shanghai",
      jobName: "Custom Lynx Check",
      announce: true,
    }, 123456);

    expect(job.id).toBe(SCHEDULED_LYNX_CHECK_JOB_ID);
    expect(job.schedule).toEqual({
      kind: "cron",
      expr: "37 8 * * *",
      tz: "Asia/Shanghai",
    });
    expect(job.sessionTarget).toBe("isolated");
    expect(job.payload).toEqual({
      kind: "agentTurn",
      message: "/lynx-check",
    });
    expect(job.delivery).toEqual({
      mode: "announce",
    });
  });

  it("creates the managed cron job when enabled", async () => {
    await reconcileScheduledLynxCheck({
      config: {
        enabled: true,
        cron: "*/5 * * * *",
        timezone: "Asia/Shanghai",
        jobName: "Lynx Test",
        announce: true,
      },
      storePath,
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
      },
      now: 1000,
    });

    expect(existsSync(storePath)).toBe(true);
    const store = JSON.parse(readFileSync(storePath, "utf8"));
    expect(store.version).toBe(1);
    expect(store.jobs).toHaveLength(1);
    expect(store.jobs[0].id).toBe(SCHEDULED_LYNX_CHECK_JOB_ID);
    expect(store.jobs[0].schedule.expr).toBe("*/5 * * * *");
  });

  it("removes only the managed cron job when disabled", async () => {
    writeFileSync(storePath, JSON.stringify({
      version: 1,
      jobs: [
        {
          id: SCHEDULED_LYNX_CHECK_JOB_ID,
          name: "Lynx Guardian Daily Check",
          enabled: true,
        },
        {
          id: "user-job",
          name: "Keep Me",
          enabled: true,
        },
      ],
    }, null, 2));

    await reconcileScheduledLynxCheck({
      config: {
        enabled: false,
      },
      storePath,
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
      },
      now: 2000,
    });

    const store = JSON.parse(readFileSync(storePath, "utf8"));
    expect(store.jobs).toHaveLength(1);
    expect(store.jobs[0].id).toBe("user-job");
  });
});
