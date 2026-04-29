import type { ToolApprovalRequest, ToolApprovalResolution } from "../types.js";
import { GoControlPlaneClient } from "../api/go-control-plane.js";
import {
  getOpenClawRuntimeVersion,
  isVersionAtLeast,
} from "../runtime/hook-capabilities.js";
import { appendLocalConsoleWebviewFootnote } from "../console/runtime.js";
import type { ChannelProfile } from "../runtime/requester-provenance-store.js";

export type ApprovalRiskLevel = "L2" | "L3";

const APPROVAL_RISK_ORDER: Record<ApprovalRiskLevel, number> = {
  L2: 2,
  L3: 3,
};

export type ApprovalGrant = {
  grantId: string;
  channelProfile?: ChannelProfile;
  channelId?: string;
  accountId?: string;
  conversationId?: string;
  requesterOuId?: string;
  module: string;
  maxRiskLevel: ApprovalRiskLevel;
  createdAt: number;
  expiresAt: number;
  sourceApprovalId: string;
};

const approvalGrantsBySource = new Map<string, ApprovalGrant[]>();

function buildApprovalGrantSourceKey(input: {
  channelProfile?: ChannelProfile;
  channelId?: string;
  accountId?: string;
  conversationId?: string;
  requesterOuId?: string;
}): string | undefined {
  const sourceParts = [
    input.channelProfile ?? "",
    input.channelId ?? "",
    input.accountId ?? "",
    input.conversationId ?? "",
    input.requesterOuId ?? "",
  ];
  return sourceParts.every((part) => part.length === 0) ? undefined : sourceParts.join("::");
}

function pruneApprovalGrants(now: number = Date.now()): void {
  for (const [sourceKey, grants] of approvalGrantsBySource) {
    const active = grants.filter((grant) => grant.expiresAt > now);
    if (active.length === 0) {
      approvalGrantsBySource.delete(sourceKey);
    } else {
      approvalGrantsBySource.set(sourceKey, active);
    }
  }
}

export function saveApprovalGrant(grant: ApprovalGrant): void {
  pruneApprovalGrants();
  const sourceKey = buildApprovalGrantSourceKey(grant);
  if (!sourceKey) {
    return;
  }

  const current = approvalGrantsBySource.get(sourceKey) ?? [];
  approvalGrantsBySource.set(sourceKey, [
    ...current.filter((entry) => entry.module !== grant.module),
    { ...grant },
  ]);
}

export function matchApprovalGrant(input: {
  channelProfile?: ChannelProfile;
  channelId?: string;
  accountId?: string;
  conversationId?: string;
  requesterOuId?: string;
  module: string;
  riskLevel: ApprovalRiskLevel;
}): ApprovalGrant | undefined {
  const sourceKey = buildApprovalGrantSourceKey(input);
  if (!sourceKey) {
    return undefined;
  }

  pruneApprovalGrants();
  return (approvalGrantsBySource.get(sourceKey) ?? []).find(
    (grant) =>
      grant.module === input.module
      && APPROVAL_RISK_ORDER[grant.maxRiskLevel] >= APPROVAL_RISK_ORDER[input.riskLevel],
  );
}

export function clearApprovalGrants(): void {
  approvalGrantsBySource.clear();
}

export type LocalToolApproval = {
  approvalToken: string;
  pendingId: string;
  sessionKey?: string;
  channelProfile?: ChannelProfile;
  channelId?: string;
  accountId?: string;
  requesterOuId?: string;
  requestFingerprint?: string;
  approverOuIds: string[];
  conversationId?: string;
  module: string;
  maxRiskLevel: ApprovalRiskLevel;
  toolName: string;
  promptText?: string;
  createdAt: number;
  expiresAt: number;
  resolve: (resolution: ToolApprovalResolution) => void;
};

type LocalToolApprovalEntry = Omit<LocalToolApproval, "resolve"> & {
  dedupKey: string;
  settled: boolean;
  timer: ReturnType<typeof setTimeout>;
  executeResolution: (resolution: ToolApprovalResolution) => void;
};

const approvalsByToken = new Map<string, LocalToolApprovalEntry>();
const latestTokenByDedupKey = new Map<string, string>();
let approvalSequence = 0;

function buildLocalApprovalDedupKey(input: {
  sessionKey?: string;
  channelProfile?: ChannelProfile;
  channelId?: string;
  accountId?: string;
  conversationId?: string;
  requesterOuId?: string;
  requestFingerprint?: string;
  module: string;
}): string | undefined {
  if (input.channelProfile === "feishu") {
    const requestFingerprint = input.requestFingerprint?.trim();
    if (!requestFingerprint) {
      return undefined;
    }
    return [
      input.channelProfile,
      input.channelId ?? "",
      input.accountId ?? "",
      input.conversationId ?? "",
      input.requesterOuId ?? "",
      requestFingerprint,
      input.module,
    ].join("::");
  }

  const sourceParts = [
    input.channelProfile ?? "",
    input.channelId ?? "",
    input.accountId ?? "",
    input.conversationId ?? "",
    input.requesterOuId ?? "",
  ];
  if (sourceParts.some((part) => part.length > 0)) {
    return [...sourceParts, input.module].join("::");
  }
  return input.sessionKey ? [input.sessionKey, input.module].join("::") : undefined;
}

function nextApprovalToken(): string {
  approvalSequence += 1;
  return approvalSequence.toString(36).padStart(6, "0");
}

function removeLocalApprovalEntry(entry: LocalToolApprovalEntry): void {
  approvalsByToken.delete(entry.approvalToken);
  if (latestTokenByDedupKey.get(entry.dedupKey) === entry.approvalToken) {
    latestTokenByDedupKey.delete(entry.dedupKey);
  }
}

function settleLocalApprovalEntry(entry: LocalToolApprovalEntry, resolution: ToolApprovalResolution): void {
  if (entry.settled) {
    return;
  }
  entry.settled = true;
  clearTimeout(entry.timer);
  removeLocalApprovalEntry(entry);
  entry.executeResolution(resolution);
}

function toPublicLocalApproval(entry: LocalToolApprovalEntry): LocalToolApproval {
  return {
    approvalToken: entry.approvalToken,
    pendingId: entry.pendingId,
    sessionKey: entry.sessionKey,
    channelProfile: entry.channelProfile,
    channelId: entry.channelId,
    accountId: entry.accountId,
    requesterOuId: entry.requesterOuId,
    requestFingerprint: entry.requestFingerprint,
    approverOuIds: [...entry.approverOuIds],
    conversationId: entry.conversationId,
    module: entry.module,
    maxRiskLevel: entry.maxRiskLevel,
    toolName: entry.toolName,
    promptText: entry.promptText,
    createdAt: entry.createdAt,
    expiresAt: entry.expiresAt,
    resolve: (resolution) => settleLocalApprovalEntry(entry, resolution),
  };
}

function pruneLocalToolApprovals(now: number = Date.now()): void {
  for (const entry of approvalsByToken.values()) {
    if (entry.expiresAt <= now) {
      settleLocalApprovalEntry(entry, "timeout");
    }
  }
}

export function registerLocalToolApproval(params: {
  pendingId: string;
  sessionKey?: string;
  channelProfile?: ChannelProfile;
  channelId?: string;
  accountId?: string;
  requesterOuId?: string;
  requestFingerprint?: string;
  approverOuIds?: string[];
  conversationId?: string;
  module: string;
  riskLevel: ApprovalRiskLevel;
  toolName: string;
  promptText?: string;
  timeoutMs: number;
  onResolution: (resolution: ToolApprovalResolution) => void;
}): { created: boolean; approval?: LocalToolApproval } {
  const dedupKey = buildLocalApprovalDedupKey(params);
  if (!dedupKey) {
    return { created: false };
  }

  pruneLocalToolApprovals();
  const existingToken = latestTokenByDedupKey.get(dedupKey);
  const existing = existingToken ? approvalsByToken.get(existingToken) : undefined;
  if (
    existing
    && !existing.settled
    && APPROVAL_RISK_ORDER[existing.maxRiskLevel] >= APPROVAL_RISK_ORDER[params.riskLevel]
  ) {
    return { created: false, approval: toPublicLocalApproval(existing) };
  }

  const createdAt = Date.now();
  const entry: LocalToolApprovalEntry = {
    approvalToken: nextApprovalToken(),
    pendingId: params.pendingId,
    sessionKey: params.sessionKey,
    channelProfile: params.channelProfile,
    channelId: params.channelId,
    accountId: params.accountId,
    requesterOuId: params.requesterOuId,
    requestFingerprint: params.requestFingerprint,
    approverOuIds: [...(params.approverOuIds ?? [])],
    conversationId: params.conversationId,
    module: params.module,
    maxRiskLevel: params.riskLevel,
    toolName: params.toolName,
    promptText: params.promptText,
    createdAt,
    expiresAt: createdAt + params.timeoutMs,
    dedupKey,
    settled: false,
    timer: null as unknown as ReturnType<typeof setTimeout>,
    executeResolution: params.onResolution,
  };

  entry.timer = setTimeout(() => settleLocalApprovalEntry(entry, "timeout"), params.timeoutMs);
  approvalsByToken.set(entry.approvalToken, entry);
  latestTokenByDedupKey.set(dedupKey, entry.approvalToken);
  return { created: true, approval: toPublicLocalApproval(entry) };
}

export function readLocalToolApprovalByToken(token?: string): LocalToolApproval | undefined {
  pruneLocalToolApprovals();
  if (!token) {
    return undefined;
  }
  const approval = approvalsByToken.get(token.toLowerCase());
  return approval ? toPublicLocalApproval(approval) : undefined;
}

export function listLocalToolApprovalsForSession(input: { sessionKey?: string }): LocalToolApproval[] {
  pruneLocalToolApprovals();
  if (!input.sessionKey) {
    return [];
  }
  return [...approvalsByToken.values()]
    .filter((entry) => !entry.settled && entry.sessionKey === input.sessionKey)
    .sort((left, right) => right.createdAt - left.createdAt)
    .map((entry) => toPublicLocalApproval(entry));
}

export function discardLocalToolApproval(token?: string): void {
  pruneLocalToolApprovals();
  if (!token) {
    return;
  }
  const entry = approvalsByToken.get(token.toLowerCase());
  if (!entry) {
    return;
  }
  clearTimeout(entry.timer);
  removeLocalApprovalEntry(entry);
}

export function clearLocalToolApprovals(): void {
  for (const entry of approvalsByToken.values()) {
    clearTimeout(entry.timer);
  }
  approvalsByToken.clear();
  latestTokenByDedupKey.clear();
  approvalSequence = 0;
}

export type PendingToolApproval = {
  pendingId: string;
  runId: string;
  requesterOuId?: string;
  module: string;
  maxRiskLevel: ApprovalRiskLevel;
  createdAt: number;
  expiresAt: number;
  wait: () => Promise<ToolApprovalResolution>;
  settle: (resolution: ToolApprovalResolution) => void;
};

type PendingToolApprovalEntry = Omit<PendingToolApproval, "wait" | "settle"> & {
  promise: Promise<ToolApprovalResolution>;
  resolvePromise: (resolution: ToolApprovalResolution) => void;
  timer: ReturnType<typeof setTimeout>;
  settled: boolean;
};

const pendingByRunId = new Map<string, PendingToolApprovalEntry[]>();
const pendingById = new Map<string, PendingToolApprovalEntry>();

function removePendingEntry(entry: PendingToolApprovalEntry): void {
  pendingById.delete(entry.pendingId);
  const next = (pendingByRunId.get(entry.runId) ?? []).filter(
    (candidate) => candidate.pendingId !== entry.pendingId,
  );
  if (next.length === 0) {
    pendingByRunId.delete(entry.runId);
  } else {
    pendingByRunId.set(entry.runId, next);
  }
}

function settlePendingEntry(entry: PendingToolApprovalEntry, resolution: ToolApprovalResolution): void {
  if (entry.settled) {
    return;
  }
  entry.settled = true;
  clearTimeout(entry.timer);
  removePendingEntry(entry);
  entry.resolvePromise(resolution);
}

function toPublicPendingApproval(entry: PendingToolApprovalEntry): PendingToolApproval {
  return {
    pendingId: entry.pendingId,
    runId: entry.runId,
    requesterOuId: entry.requesterOuId,
    module: entry.module,
    maxRiskLevel: entry.maxRiskLevel,
    createdAt: entry.createdAt,
    expiresAt: entry.expiresAt,
    wait: () => entry.promise,
    settle: (resolution) => settlePendingEntry(entry, resolution),
  };
}

function prunePendingToolApprovals(now: number = Date.now()): void {
  for (const entry of pendingById.values()) {
    if (entry.expiresAt <= now) {
      settlePendingEntry(entry, "timeout");
    }
  }
}

export function getOrCreatePendingToolApproval(params: {
  runId?: string;
  requesterOuId?: string;
  module: string;
  riskLevel: ApprovalRiskLevel;
  timeoutMs: number;
  pendingId: string;
}): { created: boolean; pending?: PendingToolApproval } {
  if (!params.runId) {
    return { created: false };
  }

  prunePendingToolApprovals();
  const existing = (pendingByRunId.get(params.runId) ?? []).find(
    (entry) =>
      !entry.settled
      && entry.requesterOuId === params.requesterOuId
      && entry.module === params.module
      && APPROVAL_RISK_ORDER[entry.maxRiskLevel] >= APPROVAL_RISK_ORDER[params.riskLevel],
  );
  if (existing) {
    return { created: false, pending: toPublicPendingApproval(existing) };
  }

  const createdAt = Date.now();
  let resolvePromise!: (resolution: ToolApprovalResolution) => void;
  const promise = new Promise<ToolApprovalResolution>((resolve) => {
    resolvePromise = resolve;
  });
  const entry: PendingToolApprovalEntry = {
    pendingId: params.pendingId,
    runId: params.runId,
    requesterOuId: params.requesterOuId,
    module: params.module,
    maxRiskLevel: params.riskLevel,
    createdAt,
    expiresAt: createdAt + params.timeoutMs,
    promise,
    resolvePromise,
    timer: null as unknown as ReturnType<typeof setTimeout>,
    settled: false,
  };

  entry.timer = setTimeout(() => settlePendingEntry(entry, "timeout"), params.timeoutMs);
  pendingById.set(entry.pendingId, entry);
  pendingByRunId.set(entry.runId, [...(pendingByRunId.get(entry.runId) ?? []), entry]);
  return { created: true, pending: toPublicPendingApproval(entry) };
}

export function clearPendingToolApprovals(): void {
  for (const entry of pendingById.values()) {
    clearTimeout(entry.timer);
  }
  pendingByRunId.clear();
  pendingById.clear();
}

export type FeishuLocalApprovalGrant = {
  grantId: string;
  channelProfile: "feishu";
  channelId?: string;
  accountId?: string;
  conversationId?: string;
  requesterOuId?: string;
  module: string;
  maxRiskLevel: ApprovalRiskLevel;
  requestFingerprint: string;
  grantedByOuId?: string;
  createdAt: number;
  expiresAt: number;
  sourceApprovalId: string;
};

const feishuGrantsBySource = new Map<string, FeishuLocalApprovalGrant[]>();

function buildFeishuGrantSourceKey(input: {
  channelProfile?: ChannelProfile;
  channelId?: string;
  accountId?: string;
  conversationId?: string;
  requesterOuId?: string;
  module: string;
  requestFingerprint: string;
}): string | undefined {
  if (input.channelProfile !== "feishu") {
    return undefined;
  }
  return [
    input.channelId ?? "",
    input.accountId ?? "",
    input.conversationId ?? "",
    input.requesterOuId ?? "",
    input.module,
    input.requestFingerprint,
  ].join("::");
}

function pruneFeishuLocalApprovalGrants(now: number = Date.now()): void {
  for (const [sourceKey, grants] of feishuGrantsBySource) {
    const active = grants.filter((grant) => grant.expiresAt > now);
    if (active.length === 0) {
      feishuGrantsBySource.delete(sourceKey);
    } else {
      feishuGrantsBySource.set(sourceKey, active);
    }
  }
}

export function saveFeishuLocalApprovalGrant(grant: FeishuLocalApprovalGrant): void {
  pruneFeishuLocalApprovalGrants();
  const sourceKey = buildFeishuGrantSourceKey(grant);
  if (!sourceKey) {
    return;
  }
  feishuGrantsBySource.set(sourceKey, [...(feishuGrantsBySource.get(sourceKey) ?? []), { ...grant }]);
}

function findMatchingFeishuGrant(input: {
  channelProfile?: ChannelProfile;
  channelId?: string;
  accountId?: string;
  conversationId?: string;
  requesterOuId?: string;
  module: string;
  riskLevel: ApprovalRiskLevel;
  requestFingerprint: string;
}): {
  grants: FeishuLocalApprovalGrant[];
  match: FeishuLocalApprovalGrant | undefined;
  matchIndex: number;
  sourceKey?: string;
} {
  const sourceKey = buildFeishuGrantSourceKey(input);
  if (!sourceKey) {
    return { grants: [], match: undefined, matchIndex: -1, sourceKey };
  }
  pruneFeishuLocalApprovalGrants();
  const grants = feishuGrantsBySource.get(sourceKey) ?? [];
  const matchIndex = grants.findIndex(
    (grant) => APPROVAL_RISK_ORDER[grant.maxRiskLevel] >= APPROVAL_RISK_ORDER[input.riskLevel],
  );
  return {
    grants,
    match: matchIndex >= 0 ? grants[matchIndex] : undefined,
    matchIndex,
    sourceKey,
  };
}

export function readFeishuLocalApprovalGrant(input: {
  channelProfile?: ChannelProfile;
  channelId?: string;
  accountId?: string;
  conversationId?: string;
  requesterOuId?: string;
  module: string;
  riskLevel: ApprovalRiskLevel;
  requestFingerprint: string;
}): FeishuLocalApprovalGrant | undefined {
  const { match } = findMatchingFeishuGrant(input);
  return match ? { ...match } : undefined;
}

export function consumeFeishuLocalApprovalGrant(input: {
  channelProfile?: ChannelProfile;
  channelId?: string;
  accountId?: string;
  conversationId?: string;
  requesterOuId?: string;
  module: string;
  riskLevel: ApprovalRiskLevel;
  requestFingerprint: string;
}): FeishuLocalApprovalGrant | undefined {
  const { grants, match, matchIndex, sourceKey } = findMatchingFeishuGrant(input);
  if (!match || matchIndex < 0 || !sourceKey) {
    return undefined;
  }

  const next = grants.filter((_, index) => index !== matchIndex);
  if (next.length === 0) {
    feishuGrantsBySource.delete(sourceKey);
  } else {
    feishuGrantsBySource.set(sourceKey, next);
  }
  return { ...match };
}

export function clearFeishuLocalApprovalGrants(): void {
  feishuGrantsBySource.clear();
}

export type FeishuLocalApprovalReplay = {
  approvalToken: string;
  sessionKey?: string;
  requesterOuId?: string;
  accountId?: string;
  conversationId?: string;
  promptText: string;
  createdAt: number;
  expiresAt: number;
};

const replayByKey = new Map<string, FeishuLocalApprovalReplay>();

function buildReplayKey(input: { approvalToken?: string; sessionKey?: string }): string | undefined {
  const approvalToken = input.approvalToken?.trim().toLowerCase();
  return approvalToken ? [input.sessionKey ?? "", approvalToken].join("::") : undefined;
}

function pruneFeishuLocalApprovalReplays(now: number = Date.now()): void {
  for (const [key, replay] of replayByKey) {
    if (replay.expiresAt <= now) {
      replayByKey.delete(key);
    }
  }
}

export function saveFeishuLocalApprovalReplay(replay: FeishuLocalApprovalReplay): void {
  const key = buildReplayKey(replay);
  if (!key) {
    return;
  }
  pruneFeishuLocalApprovalReplays();
  replayByKey.set(key, { ...replay });
}

export function consumeFeishuLocalApprovalReplay(input: {
  approvalToken?: string;
  sessionKey?: string;
}): FeishuLocalApprovalReplay | undefined {
  const key = buildReplayKey(input);
  if (!key) {
    return undefined;
  }
  pruneFeishuLocalApprovalReplays();
  const replay = replayByKey.get(key);
  if (!replay) {
    return undefined;
  }
  replayByKey.delete(key);
  return { ...replay };
}

export function clearFeishuLocalApprovalReplays(): void {
  replayByKey.clear();
}

export type FeishuRunContinuation = {
  runId: string;
  channelProfile: "feishu";
  requesterOuId?: string;
  module: string;
  maxRiskLevel: ApprovalRiskLevel;
  createdAt: number;
  expiresAt: number;
};

const continuationByRunId = new Map<string, FeishuRunContinuation[]>();

function pruneFeishuRunContinuations(now: number = Date.now()): void {
  for (const [runId, windows] of continuationByRunId) {
    const active = windows.filter((window) => window.expiresAt > now);
    if (active.length === 0) {
      continuationByRunId.delete(runId);
    } else {
      continuationByRunId.set(runId, active);
    }
  }
}

export function saveFeishuRunContinuation(window: FeishuRunContinuation): void {
  if (window.channelProfile !== "feishu") {
    return;
  }

  pruneFeishuRunContinuations();
  const next = (continuationByRunId.get(window.runId) ?? []).filter(
    (entry) => !(entry.module === window.module && entry.requesterOuId === window.requesterOuId),
  );
  continuationByRunId.set(window.runId, [...next, { ...window }]);
}

export function matchFeishuRunContinuation(input: {
  runId?: string;
  channelProfile?: ChannelProfile;
  requesterOuId?: string;
  module: string;
  riskLevel: ApprovalRiskLevel;
}): FeishuRunContinuation | undefined {
  if (!input.runId || input.channelProfile !== "feishu") {
    return undefined;
  }
  pruneFeishuRunContinuations();
  const matched = (continuationByRunId.get(input.runId) ?? []).find(
    (window) =>
      window.requesterOuId === input.requesterOuId
      && window.module === input.module
      && APPROVAL_RISK_ORDER[window.maxRiskLevel] >= APPROVAL_RISK_ORDER[input.riskLevel],
  );
  return matched ? { ...matched } : undefined;
}

export function clearFeishuRunContinuations(): void {
  continuationByRunId.clear();
}

export const WORKFLOW_AUTH_MAX_TTL_MS = 15 * 60 * 1000;

export interface WorkflowAuditEntry {
  timestamp: number;
  toolName: string;
  paramSummary: string;
  triggeredModules: string[];
  riskScore: number;
  riskLevel: string;
}

export interface WorkflowAuthorization {
  grantedAt: number;
  expiresAt: number;
  allowedModules: string[];
  auditLog: WorkflowAuditEntry[];
  reported: boolean;
  scopeAll?: boolean;
}

const workflowAuths = new Map<string, WorkflowAuthorization>();

function pruneWorkflowAuths(): void {
  const now = Date.now();
  for (const [key, auth] of workflowAuths) {
    if (auth.expiresAt <= now) {
      workflowAuths.delete(key);
    }
  }
}

export function grantWorkflowAuth(
  keys: string[],
  allowedModules: string[],
  ttlMs: number = WORKFLOW_AUTH_MAX_TTL_MS,
  scopeAll: boolean = false,
): void {
  pruneWorkflowAuths();
  const now = Date.now();
  const auth: WorkflowAuthorization = {
    grantedAt: now,
    expiresAt: now + Math.min(ttlMs, WORKFLOW_AUTH_MAX_TTL_MS),
    allowedModules: [...new Set(allowedModules)],
    auditLog: [],
    reported: false,
    scopeAll,
  };
  for (const key of keys) {
    workflowAuths.set(key, auth);
  }
}

export function getWorkflowAuth(
  keys: string[],
  triggeredModules: string[],
): WorkflowAuthorization | undefined {
  pruneWorkflowAuths();
  for (const key of keys) {
    const auth = workflowAuths.get(key);
    if (auth && (auth.scopeAll || triggeredModules.every((mod) => auth.allowedModules.includes(mod)))) {
      return auth;
    }
  }
  return undefined;
}

export function recordWorkflowOperation(keys: string[], entry: WorkflowAuditEntry): void {
  for (const key of keys) {
    const auth = workflowAuths.get(key);
    if (auth) {
      auth.auditLog.push(entry);
      return;
    }
  }
}

export function revokeWorkflowAuth(keys: string[]): WorkflowAuthorization | undefined {
  pruneWorkflowAuths();
  let found: WorkflowAuthorization | undefined;
  for (const key of keys) {
    const auth = workflowAuths.get(key);
    workflowAuths.delete(key);
    if (auth && !found) {
      found = auth;
    }
  }
  if (found && !found.reported) {
    found.reported = true;
    return found;
  }
  return undefined;
}

export function hasAnyWorkflowAuth(keys: string[]): boolean {
  pruneWorkflowAuths();
  return keys.some((key) => workflowAuths.has(key));
}

export function toApprovalRiskLevel(value?: string): ApprovalRiskLevel | undefined {
  return value === "L2" || value === "L3" ? value : undefined;
}

export function buildToolApprovalRequest(params: {
  toolName: string;
  module: string;
  riskLevel: ApprovalRiskLevel;
  description: string;
  timeoutMs: number;
  onResolution: (decision: ToolApprovalResolution) => Promise<void> | void;
}): ToolApprovalRequest {
  const description = [
    `[module] ${params.module}`,
    `[risk] ${params.riskLevel}`,
    params.description,
    "Approval will resume the current tool call.",
  ].join("\n");

  return {
    title:
      params.riskLevel === "L3"
        ? `Lynx Guardian Approval (High Risk): ${params.toolName}`
        : `Lynx Guardian Approval: ${params.toolName}`,
    description: params.riskLevel === "L3"
      ? appendLocalConsoleWebviewFootnote(description)
      : description,
    severity: params.riskLevel === "L3" ? "critical" : "warning",
    timeoutMs: params.timeoutMs,
    timeoutBehavior: "deny",
    onResolution: params.onResolution,
  };
}

export type GrantControlPlaneSync = {
  baseUrl: string;
  getToken?: () => string;
  fetchImpl?: typeof fetch;
  chainId: string;
  sessionKey?: string;
  requesterId?: string;
  approverId?: string;
  approverOuId?: string;
  toolName: string;
  targetKind: string;
  targetHash: string;
  resourceScope?: Record<string, unknown>;
};

export function persistGrantFromApproval(params: {
  decision: ToolApprovalResolution;
  approvalId: string;
  channelProfile?: ChannelProfile;
  channelId?: string;
  accountId?: string;
  conversationId?: string;
  requesterOuId?: string;
  module: string;
  riskLevel: ApprovalRiskLevel;
  grantWindowMs: number;
  grantControlPlane?: GrantControlPlaneSync;
}): Promise<void> | void {
  if (params.decision !== "allow-once" && params.decision !== "allow-always") {
    return;
  }

  const now = Date.now();
  saveApprovalGrant({
    grantId: [
      params.channelProfile ?? "",
      params.channelId ?? "",
      params.accountId ?? "",
      params.conversationId ?? "",
      params.requesterOuId ?? "",
      params.module,
    ].join("::"),
    channelProfile: params.channelProfile,
    channelId: params.channelId,
    accountId: params.accountId,
    conversationId: params.conversationId,
    requesterOuId: params.requesterOuId,
    module: params.module,
    maxRiskLevel: params.riskLevel,
    createdAt: now,
    expiresAt: now + params.grantWindowMs,
    sourceApprovalId: params.approvalId,
  });

  if (params.grantControlPlane) {
    return syncGrantToControlPlane(params).catch(() => undefined);
  }
}

async function syncGrantToControlPlane(params: {
  decision: ToolApprovalResolution;
  approvalId: string;
  channelProfile?: ChannelProfile;
  channelId?: string;
  conversationId?: string;
  requesterOuId?: string;
  module: string;
  riskLevel: ApprovalRiskLevel;
  grantWindowMs: number;
  grantControlPlane?: GrantControlPlaneSync;
}): Promise<void> {
  const sync = params.grantControlPlane;
  if (!sync) {
    return;
  }
  const client = new GoControlPlaneClient(sync);
  await client.resolveApproval(params.approvalId, {
    approvalId: params.approvalId,
    resolution: "allow-current-chain",
    chainId: sync.chainId,
    sessionKey: sync.sessionKey,
    channelProfile: params.channelProfile,
    channelId: params.channelId,
    conversationId: params.conversationId,
    requesterId: sync.requesterId,
    requesterOuId: params.requesterOuId,
    approverId: sync.approverId,
    approverOuId: sync.approverOuId,
    riskFamily: params.module,
    riskLevel: params.riskLevel,
    toolName: sync.toolName,
    targetKind: sync.targetKind,
    targetHash: sync.targetHash,
    resourceScope: {
      ...(sync.resourceScope ?? {}),
      decision: params.decision,
      grantWindowMs: params.grantWindowMs,
    },
  });
}

export const PLUGIN_APPROVAL_INTRO_VERSION = "2026.3.28";

export type PluginApprovalCompatTier = "legacy" | "modern" | "unknown";
export type PluginApprovalCompatMode = "native-webchat" | "feishu-local" | "deny-no-route";

export type PluginApprovalCompatDecision = {
  runtimeVersion: string;
  runtimeTier: PluginApprovalCompatTier;
  mode: PluginApprovalCompatMode;
  transport: "native" | "local-chat" | "none";
  blockReason?: string;
};

export function classifyPluginApprovalRuntime(
  runtimeVersion?: string,
): { runtimeVersion: string; tier: PluginApprovalCompatTier } {
  const sourceVersion =
    arguments.length === 0 ? getOpenClawRuntimeVersion() : runtimeVersion;
  const normalized = sourceVersion?.trim();
  if (!normalized || normalized === "unknown" || !/^\d+(?:\.\d+)+$/.test(normalized)) {
    return { runtimeVersion: normalized || "unknown", tier: "unknown" };
  }
  if (!isVersionAtLeast(normalized, PLUGIN_APPROVAL_INTRO_VERSION)) {
    return { runtimeVersion: normalized, tier: "legacy" };
  }
  return { runtimeVersion: normalized, tier: "modern" };
}

function buildNoRouteReason(tier: PluginApprovalCompatTier): string {
  if (tier === "unknown") {
    return "[Lynx Guardian] OpenClaw version could not be identified safely and no Feishu approval route is configured, so this request is blocked. Upgrade OpenClaw or configure Feishu approval.";
  }
  return "[Lynx Guardian] OpenClaw is below 2026.3.28 and no Feishu approval route is configured, so this request is blocked. Upgrade OpenClaw or configure Feishu approval.";
}

export function resolvePluginApprovalCompat(params: {
  runtimeVersion?: string;
  currentChannelProfile: "webchat" | "feishu" | "other";
  hasFeishuApproverRoute: boolean;
  hasFeishuFallbackContext: boolean;
}): PluginApprovalCompatDecision {
  const runtime =
    params.runtimeVersion === undefined
      ? classifyPluginApprovalRuntime()
      : classifyPluginApprovalRuntime(params.runtimeVersion);

  if (params.currentChannelProfile === "feishu") {
    if (params.hasFeishuApproverRoute) {
      return {
        runtimeVersion: runtime.runtimeVersion,
        runtimeTier: runtime.tier,
        mode: "feishu-local",
        transport: "local-chat",
      };
    }
    return {
      runtimeVersion: runtime.runtimeVersion,
      runtimeTier: runtime.tier,
      mode: "deny-no-route",
      transport: "none",
      blockReason:
        "[Lynx Guardian] This request requires Feishu local approval, but no Feishu approver route is configured.",
    };
  }

  if ((runtime.tier === "modern" || runtime.tier === "unknown") && params.currentChannelProfile === "webchat") {
    return {
      runtimeVersion: runtime.runtimeVersion,
      runtimeTier: runtime.tier,
      mode: "native-webchat",
      transport: "native",
    };
  }

  if (params.hasFeishuApproverRoute && params.hasFeishuFallbackContext) {
    return {
      runtimeVersion: runtime.runtimeVersion,
      runtimeTier: runtime.tier,
      mode: "feishu-local",
      transport: "local-chat",
    };
  }

  return {
    runtimeVersion: runtime.runtimeVersion,
    runtimeTier: runtime.tier,
    mode: "deny-no-route",
    transport: "none",
    blockReason: buildNoRouteReason(runtime.tier),
  };
}
