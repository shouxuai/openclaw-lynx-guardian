import type { SessionSecuritySnapshot } from "./policy-types.js";

export interface SessionSecurityEvent {
  sessionKey: string;
  kind:
    | "user_input"
    | "task_switch"
    | "workflow_authorized"
    | "workflow_complete"
    | "safe_turn"
    | "suspicious_turn";
  trustedObjective?: string;
  atMs?: number;
}

interface SessionSecurityStateStoreOptions {
  sessionTtlMs?: number;
  safeTurnDecayThreshold?: number;
}

function createEmptySnapshot(sessionKey: string, atMs: number): SessionSecuritySnapshot {
  return {
    sessionKey,
    trustedObjective: "",
    recentTurns: 0,
    suspiciousTurns: 0,
    safeTurnsSinceLastSuspicion: 0,
    workflowAuthorized: false,
    lastUpdatedAt: atMs,
  };
}

export function createSessionSecurityStateStore(options: SessionSecurityStateStoreOptions = {}) {
  const sessionTtlMs = options.sessionTtlMs ?? 30 * 60 * 1000;
  const safeTurnDecayThreshold = options.safeTurnDecayThreshold ?? 4;
  const snapshots = new Map<string, SessionSecuritySnapshot>();

  function isExpired(snapshot: SessionSecuritySnapshot, nowMs: number): boolean {
    return nowMs - snapshot.lastUpdatedAt > sessionTtlMs;
  }

  function getSnapshot(sessionKey: string, nowMs: number): SessionSecuritySnapshot | null {
    const current = snapshots.get(sessionKey);
    if (!current) {
      return null;
    }

    if (isExpired(current, nowMs)) {
      snapshots.delete(sessionKey);
      return null;
    }

    return current;
  }

  return {
    record(event: SessionSecurityEvent) {
      const atMs = event.atMs ?? Date.now();
      const current = getSnapshot(event.sessionKey, atMs) ?? createEmptySnapshot(event.sessionKey, atMs);

      switch (event.kind) {
        case "task_switch":
          current.trustedObjective = event.trustedObjective ?? "";
          current.suspiciousTurns = 0;
          current.safeTurnsSinceLastSuspicion = 0;
          break;
        case "workflow_authorized":
          current.workflowAuthorized = true;
          break;
        case "workflow_complete":
          current.workflowAuthorized = false;
          current.suspiciousTurns = 0;
          current.safeTurnsSinceLastSuspicion = 0;
          break;
        case "suspicious_turn":
          current.suspiciousTurns += 1;
          current.safeTurnsSinceLastSuspicion = 0;
          break;
        case "safe_turn":
          current.safeTurnsSinceLastSuspicion += 1;
          if (
            current.suspiciousTurns > 0
            && current.safeTurnsSinceLastSuspicion >= safeTurnDecayThreshold
          ) {
            current.suspiciousTurns -= 1;
            current.safeTurnsSinceLastSuspicion = 0;
          }
          break;
        case "user_input":
        default:
          if (event.trustedObjective) {
            current.trustedObjective = current.trustedObjective || event.trustedObjective;
          }
          break;
      }

      current.recentTurns += 1;
      current.lastUpdatedAt = atMs;
      snapshots.set(event.sessionKey, current);
      return current;
    },

    read(sessionKey: string, options?: { nowMs?: number }) {
      const nowMs = options?.nowMs ?? Date.now();
      return getSnapshot(sessionKey, nowMs);
    },

    clear(sessionKey: string) {
      snapshots.delete(sessionKey);
    },
  };
}
