import { canonicalizePath } from "./plugin-runtime-helpers.js";

export type AttackStage =
  | "idle"
  | "sensitive_scope_entered"
  | "artifact_prepared"
  | "execution_ready"
  | "exfiltration_ready";

export interface AttackGraphState {
  stage: AttackStage;
}

export interface AttackGraphEvent {
  action: "sensitive_read" | "artifact_write" | "artifact_exec" | "external_send";
}

export interface ArtifactTaintRecord {
  path: string;
  taints: string[];
  fingerprint?: string;
  updatedAt: number;
}

interface GuardPolicySessionState {
  attackGraph: AttackGraphState | null;
  taints: Map<string, ArtifactTaintRecord>;
  lastUpdatedAt: number;
}

const guardPolicySessions = new Map<string, GuardPolicySessionState>();
const SESSION_TTL_MS = 30 * 60 * 1000;

function advanceAttackGraph(
  current: AttackGraphState | undefined,
  event: AttackGraphEvent,
): AttackGraphState {
  const currentStage = current?.stage ?? "idle";
  switch (event.action) {
    case "sensitive_read":
      return currentStage === "idle"
        ? { stage: "sensitive_scope_entered" }
        : { stage: currentStage };
    case "artifact_write":
      return currentStage === "sensitive_scope_entered"
        ? { stage: "artifact_prepared" }
        : { stage: currentStage };
    case "artifact_exec":
      return currentStage === "artifact_prepared"
        ? { stage: "execution_ready" }
        : { stage: currentStage };
    case "external_send":
      return currentStage === "artifact_prepared" || currentStage === "execution_ready"
        ? { stage: "exfiltration_ready" }
        : { stage: currentStage };
  }
}

function isExpired(session: GuardPolicySessionState, now: number): boolean {
  return session.lastUpdatedAt + SESSION_TTL_MS <= now;
}

function pruneExpiredSessions(now: number = Date.now()): void {
  for (const [sessionKey, session] of guardPolicySessions) {
    if (isExpired(session, now)) {
      guardPolicySessions.delete(sessionKey);
    }
  }
}

function normalizeSessionKey(sessionKey?: string): string {
  return typeof sessionKey === "string" ? sessionKey.trim() : "";
}

function getSession(sessionKey?: string): GuardPolicySessionState | null {
  const normalizedSessionKey = normalizeSessionKey(sessionKey);
  if (!normalizedSessionKey) {
    return null;
  }

  const now = Date.now();
  pruneExpiredSessions(now);

  const existing = guardPolicySessions.get(normalizedSessionKey);
  if (!existing) {
    return null;
  }

  if (isExpired(existing, now)) {
    guardPolicySessions.delete(normalizedSessionKey);
    return null;
  }

  return existing;
}

function getOrCreateSession(sessionKey?: string): GuardPolicySessionState | null {
  const normalizedSessionKey = normalizeSessionKey(sessionKey);
  if (!normalizedSessionKey) {
    return null;
  }

  const existing = getSession(normalizedSessionKey);
  if (existing) {
    return existing;
  }

  const next: GuardPolicySessionState = {
    attackGraph: null,
    taints: new Map(),
    lastUpdatedAt: Date.now(),
  };
  guardPolicySessions.set(normalizedSessionKey, next);
  return next;
}

function canonicalizeArtifactPath(path?: string): string {
  return typeof path === "string" ? canonicalizePath(path) : "";
}

function touchSession(session: GuardPolicySessionState): void {
  session.lastUpdatedAt = Date.now();
}

function cloneAttackGraphState(state: AttackGraphState | null): AttackGraphState | null {
  return state ? { ...state } : null;
}

function cloneArtifactTaintRecord(record: ArtifactTaintRecord | null): ArtifactTaintRecord | null {
  if (!record) {
    return null;
  }

  return {
    ...record,
    taints: [...record.taints],
  };
}

export function readAttackGraphState(sessionKey?: string): AttackGraphState | null {
  const session = getSession(sessionKey);
  if (!session?.attackGraph) {
    return null;
  }

  touchSession(session);
  return cloneAttackGraphState(session.attackGraph);
}

export function advanceAttackGraphState(
  sessionKey?: string,
  event?: AttackGraphEvent,
): AttackGraphState | null {
  if (!event) {
    return null;
  }

  const session = getOrCreateSession(sessionKey);
  if (!session) {
    return null;
  }

  session.attackGraph = advanceAttackGraph(session.attackGraph ?? undefined, event);
  touchSession(session);
  return cloneAttackGraphState(session.attackGraph);
}

export function markGuardArtifactTaint(
  sessionKey?: string,
  path?: string,
  labels?: string[],
  options?: { fingerprint?: string; atMs?: number },
): void {
  const canonicalPath = canonicalizeArtifactPath(path);
  if (!canonicalPath || !Array.isArray(labels) || labels.length === 0) {
    return;
  }

  const session = getOrCreateSession(sessionKey);
  if (!session) {
    return;
  }

  const existing = session.taints.get(canonicalPath);
  const taints = new Set(existing?.taints ?? []);
  for (const label of labels) {
    taints.add(label);
  }
  session.taints.set(canonicalPath, {
    path: canonicalPath,
    taints: [...taints],
    fingerprint: options?.fingerprint ?? existing?.fingerprint,
    updatedAt: options?.atMs ?? Date.now(),
  });
  touchSession(session);
}

export function readGuardArtifactTaint(
  sessionKey?: string,
  path?: string,
  options?: { fingerprint?: string },
): ArtifactTaintRecord | null {
  const session = getSession(sessionKey);
  if (!session) {
    return null;
  }

  const canonicalPath = canonicalizeArtifactPath(path);
  if (!canonicalPath) {
    return null;
  }

  const record = session.taints.get(canonicalPath) ?? null;
  if (!record) {
    return null;
  }
  if (options?.fingerprint && record.fingerprint && record.fingerprint !== options.fingerprint) {
    return null;
  }

  touchSession(session);
  return cloneArtifactTaintRecord(record);
}

export function clearGuardPolicyState(sessionKey?: string): void {
  if (sessionKey === undefined) {
    guardPolicySessions.clear();
    return;
  }

  const normalizedSessionKey = normalizeSessionKey(sessionKey);
  if (!normalizedSessionKey) {
    return;
  }

  guardPolicySessions.delete(normalizedSessionKey);
}
