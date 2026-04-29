import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  advanceAttackGraphState,
  clearGuardPolicyState,
  markGuardArtifactTaint,
  readAttackGraphState,
  readGuardArtifactTaint,
} from "../src/runtime/guard-policy-state.js";

describe("guard policy state", () => {
  beforeEach(() => {
    clearGuardPolicyState();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearGuardPolicyState();
  });

  it("progresses attack graph independently per session", () => {
    expect(
      advanceAttackGraphState("session-a", { action: "sensitive_read" }),
    ).toEqual({ stage: "sensitive_scope_entered" });
    expect(
      advanceAttackGraphState("session-a", { action: "artifact_write" }),
    ).toEqual({ stage: "artifact_prepared" });

    expect(readAttackGraphState("session-a")).toEqual({ stage: "artifact_prepared" });
    expect(readAttackGraphState("session-b")).toBeNull();

    expect(
      advanceAttackGraphState("session-b", { action: "sensitive_read" }),
    ).toEqual({ stage: "sensitive_scope_entered" });
    expect(readAttackGraphState("session-a")).toEqual({ stage: "artifact_prepared" });
    expect(readAttackGraphState("session-b")).toEqual({ stage: "sensitive_scope_entered" });
  });

  it("reads taint records after canonicalizing equivalent paths", () => {
    markGuardArtifactTaint(
      "session-canonical",
      "./test-temp/../test-temp/output/report.md",
      ["sensitive"],
      { fingerprint: "fp-1", atMs: 1712800000000 },
    );

    expect(
      readGuardArtifactTaint(
        "session-canonical",
        "test-temp/output/./report.md",
        { fingerprint: "fp-1" },
      ),
    ).toEqual({
      taints: ["sensitive"],
      fingerprint: "fp-1",
      updatedAt: 1712800000000,
    });
  });

  it("clears attack graph and taint for one session", () => {
    advanceAttackGraphState("session-clear-a", { action: "sensitive_read" });
    markGuardArtifactTaint("session-clear-a", "artifact-a.txt", ["tainted"]);

    advanceAttackGraphState("session-clear-b", { action: "sensitive_read" });
    markGuardArtifactTaint("session-clear-b", "artifact-b.txt", ["other"]);

    clearGuardPolicyState("session-clear-a");

    expect(readAttackGraphState("session-clear-a")).toBeNull();
    expect(readGuardArtifactTaint("session-clear-a", "artifact-a.txt")).toBeNull();
    expect(readAttackGraphState("session-clear-b")).toEqual({ stage: "sensitive_scope_entered" });
    expect(readGuardArtifactTaint("session-clear-b", "artifact-b.txt")).toEqual(
      expect.objectContaining({ taints: ["other"] }),
    );
  });

  it("clears all sessions when no session key is provided", () => {
    advanceAttackGraphState("session-all-a", { action: "sensitive_read" });
    advanceAttackGraphState("session-all-b", { action: "sensitive_read" });
    markGuardArtifactTaint("session-all-a", "artifact-a.txt", ["tainted"]);
    markGuardArtifactTaint("session-all-b", "artifact-b.txt", ["tainted"]);

    clearGuardPolicyState();

    expect(readAttackGraphState("session-all-a")).toBeNull();
    expect(readAttackGraphState("session-all-b")).toBeNull();
    expect(readGuardArtifactTaint("session-all-a", "artifact-a.txt")).toBeNull();
    expect(readGuardArtifactTaint("session-all-b", "artifact-b.txt")).toBeNull();
  });

  it("treats blank session keys as a clear no-op", () => {
    advanceAttackGraphState("session-blank-a", { action: "sensitive_read" });
    markGuardArtifactTaint("session-blank-a", "artifact-a.txt", ["tainted"]);
    advanceAttackGraphState("session-blank-b", { action: "sensitive_read" });
    markGuardArtifactTaint("session-blank-b", "artifact-b.txt", ["other"]);

    clearGuardPolicyState("");
    clearGuardPolicyState("   ");

    expect(readAttackGraphState("session-blank-a")).toEqual({ stage: "sensitive_scope_entered" });
    expect(readAttackGraphState("session-blank-b")).toEqual({ stage: "sensitive_scope_entered" });
    expect(readGuardArtifactTaint("session-blank-a", "artifact-a.txt")).toEqual(
      expect.objectContaining({ taints: ["tainted"] }),
    );
    expect(readGuardArtifactTaint("session-blank-b", "artifact-b.txt")).toEqual(
      expect.objectContaining({ taints: ["other"] }),
    );
  });

  it("returns detached attack graph and taint snapshots", () => {
    advanceAttackGraphState("session-detached", { action: "sensitive_read" });
    markGuardArtifactTaint("session-detached", "artifact-detached.txt", ["tainted"]);

    const attackGraph = readAttackGraphState("session-detached");
    const taintRecord = readGuardArtifactTaint("session-detached", "artifact-detached.txt");

    expect(attackGraph).toEqual({ stage: "sensitive_scope_entered" });
    expect(taintRecord).toEqual(expect.objectContaining({ taints: ["tainted"] }));

    if (!attackGraph || !taintRecord) {
      throw new Error("expected stored state");
    }

    attackGraph.stage = "idle";
    taintRecord.taints.push("mutated");
    taintRecord.updatedAt = 0;

    expect(readAttackGraphState("session-detached")).toEqual({ stage: "sensitive_scope_entered" });
    expect(readGuardArtifactTaint("session-detached", "artifact-detached.txt")).toEqual(
      expect.objectContaining({
        taints: ["tainted"],
      }),
    );
  });

  it("silently resets expired session state", () => {
    vi.useFakeTimers();
    const baseTime = new Date("2026-04-16T00:00:00Z").getTime();
    vi.setSystemTime(baseTime);

    advanceAttackGraphState("session-expired", { action: "sensitive_read" });
    markGuardArtifactTaint("session-expired", "artifact-expired.txt", ["tainted"]);

    vi.setSystemTime(baseTime + 30 * 60 * 1000 + 1);

    expect(readAttackGraphState("session-expired")).toBeNull();
    expect(readGuardArtifactTaint("session-expired", "artifact-expired.txt")).toBeNull();
  });

  it("refreshes session ttl on attack-graph reads", () => {
    vi.useFakeTimers();
    const baseTime = new Date("2026-04-16T00:00:00Z").getTime();
    vi.setSystemTime(baseTime);

    advanceAttackGraphState("session-refresh-attack", { action: "sensitive_read" });

    vi.setSystemTime(baseTime + 30 * 60 * 1000 - 1);
    expect(readAttackGraphState("session-refresh-attack")).toEqual({ stage: "sensitive_scope_entered" });

    vi.setSystemTime(baseTime + 30 * 60 * 1000 + 1);
    expect(readAttackGraphState("session-refresh-attack")).toEqual({ stage: "sensitive_scope_entered" });

    vi.setSystemTime(baseTime + 60 * 60 * 1000 + 1);
    expect(readAttackGraphState("session-refresh-attack")).toBeNull();
  });

  it("refreshes session ttl on taint reads", () => {
    vi.useFakeTimers();
    const baseTime = new Date("2026-04-16T00:00:00Z").getTime();
    vi.setSystemTime(baseTime);

    markGuardArtifactTaint("session-refresh-taint", "artifact-refresh.txt", ["tainted"]);

    vi.setSystemTime(baseTime + 30 * 60 * 1000 - 1);
    expect(readGuardArtifactTaint("session-refresh-taint", "artifact-refresh.txt")).toEqual(
      expect.objectContaining({ taints: ["tainted"] }),
    );

    vi.setSystemTime(baseTime + 30 * 60 * 1000 + 1);
    expect(readGuardArtifactTaint("session-refresh-taint", "artifact-refresh.txt")).toEqual(
      expect.objectContaining({ taints: ["tainted"] }),
    );

    vi.setSystemTime(baseTime + 60 * 60 * 1000 + 1);
    expect(readGuardArtifactTaint("session-refresh-taint", "artifact-refresh.txt")).toBeNull();
  });

  it("safely no-ops when required input is missing", () => {
    expect(readAttackGraphState()).toBeNull();
    expect(advanceAttackGraphState("", { action: "sensitive_read" })).toBeNull();

    markGuardArtifactTaint("", "artifact.txt", ["tainted"]);
    markGuardArtifactTaint("session-missing", "", ["tainted"]);

    expect(readGuardArtifactTaint("", "artifact.txt")).toBeNull();
    expect(readGuardArtifactTaint("session-missing", "")).toBeNull();
  });
});
