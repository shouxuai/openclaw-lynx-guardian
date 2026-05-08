import {
  advanceAttackGraph,
  type AttackGraphEvent,
  type AttackGraphState,
} from "../guard/policy/attack-graph.js";
import {
  createArtifactTaintStore,
  type ArtifactTaintRecord,
} from "../guard/policy/artifact-taint-store.js";
import { canonicalizePath } from "./plugin-runtime-helpers.js";

interface GuardPolicySessionState {
  attackGraph: AttackGraphState | null;
  taintStore: ReturnType<typeof createArtifactTaintStore>;
  lastUpdatedAt: number;
}

const guardPolicySessions = new Map<string, GuardPolicySessionState>();

const SESSION_TTL_MS = 30 * 60 * 1000;
const ATTACK_GRAPH_TTL_MS = 30 * 60 * 1000;
const ARTIFACT_TAINT_TTL_MS = 30 * 60 * 1000;

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
    taintStore: createArtifactTaintStore(),
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

function isAttackGraphExpired(state: AttackGraphState, now: number): boolean {
  return state.updatedAt + ATTACK_GRAPH_TTL_MS <= now;
}

function readFreshAttackGraphState(session: GuardPolicySessionState, now: number): AttackGraphState | null {
  if (!session.attackGraph) {
    return null;
  }

  if (isAttackGraphExpired(session.attackGraph, now)) {
    session.attackGraph = null;
    return null;
  }

  return session.attackGraph;
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
  if (!session) {
    return null;
  }

  const attackGraph = readFreshAttackGraphState(session, Date.now());
  if (!attackGraph) {
    return null;
  }

  touchSession(session);
  return cloneAttackGraphState(attackGraph);
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

  const now = Date.now();
  const currentAttackGraph = readFreshAttackGraphState(session, now);
  session.attackGraph = advanceAttackGraph(currentAttackGraph ?? undefined, event, now);
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

  session.taintStore.mark(canonicalPath, labels, options);
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

  const record = session.taintStore.read(canonicalPath, options);
  if (!record) {
    return null;
  }

  if (record.updatedAt + ARTIFACT_TAINT_TTL_MS <= Date.now()) {
    session.taintStore.clear(canonicalPath);
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
