/**
 * Workflow-level authorization store.
 *
 * When the user confirms a blocked operation they grant permission for the
 * ENTIRE agent workflow (not just one tool call). The authorization covers
 * the module categories that triggered the original block and remains active
 * until the `agent_end` hook fires — at which point it is automatically
 * revoked and an audit summary is returned for user reporting.
 *
 * A max-TTL (default 15 min) acts as a safety net in case agent_end is
 * never called (e.g. the agent was hard-killed).
 */

export const WORKFLOW_AUTH_MAX_TTL_MS = 15 * 60 * 1000; // 15 minutes

export interface WorkflowAuditEntry {
  timestamp: number;
  toolName: string;
  /** Sanitised parameter snapshot (no large blobs). */
  paramSummary: string;
  triggeredModules: string[];
  riskScore: number;
  riskLevel: string;
}

export interface WorkflowAuthorization {
  grantedAt: number;
  expiresAt: number;
  /** Module IDs whose risk is covered by this authorization (e.g. "M2:protected_file_access"). */
  allowedModules: string[];
  auditLog: WorkflowAuditEntry[];
  /** Prevents the same auth from being reported twice when stored under multiple keys. */
  reported: boolean;
}

const workflowAuths = new Map<string, WorkflowAuthorization>();

function pruneExpired(): void {
  const now = Date.now();
  for (const [key, auth] of workflowAuths) {
    if (auth.expiresAt <= now) workflowAuths.delete(key);
  }
}

/**
 * Grant workflow-level authorization for the given module categories.
 * Stored under every key in `keys` so both channelId and sessionKey lookups succeed.
 */
export function grantWorkflowAuth(
  keys: string[],
  allowedModules: string[],
  ttlMs: number = WORKFLOW_AUTH_MAX_TTL_MS,
): void {
  pruneExpired();
  const now = Date.now();
  // Share one object across all keys so reporting and audit are unified.
  const auth: WorkflowAuthorization = {
    grantedAt: now,
    expiresAt: now + ttlMs,
    allowedModules: [...new Set(allowedModules)],
    auditLog: [],
    reported: false,
  };
  for (const key of keys) {
    workflowAuths.set(key, auth);
  }
}

/**
 * Returns the active authorization if ALL triggered modules are covered,
 * undefined otherwise.
 */
export function getWorkflowAuth(
  keys: string[],
  triggeredModules: string[],
): WorkflowAuthorization | undefined {
  pruneExpired();
  for (const key of keys) {
    const auth = workflowAuths.get(key);
    if (!auth) continue;
    if (triggeredModules.every(mod => auth.allowedModules.includes(mod))) {
      return auth;
    }
  }
  return undefined;
}

/** Append an audit entry to the active workflow authorization (if any). */
export function recordWorkflowOperation(keys: string[], entry: WorkflowAuditEntry): void {
  for (const key of keys) {
    const auth = workflowAuths.get(key);
    if (auth) {
      auth.auditLog.push(entry);
      return; // shared object — one push is enough
    }
  }
}

/**
 * Revoke the workflow authorization for the given keys.
 * Returns the auth object (with full audit log) if one was found and not yet
 * reported, so the caller can send the summary to the user.
 */
export function revokeWorkflowAuth(keys: string[]): WorkflowAuthorization | undefined {
  pruneExpired();
  let found: WorkflowAuthorization | undefined;
  for (const key of keys) {
    const auth = workflowAuths.get(key);
    workflowAuths.delete(key);
    if (auth && !found) found = auth;
  }
  if (found && !found.reported) {
    found.reported = true;
    return found;
  }
  return undefined;
}

/** True if any active workflow auth exists for these keys (regardless of modules). */
export function hasAnyWorkflowAuth(keys: string[]): boolean {
  pruneExpired();
  return keys.some(key => workflowAuths.has(key));
}
