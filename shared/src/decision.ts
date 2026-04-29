import type { RiskLevel } from "./enums.js";

export type { RiskLevel } from "./enums.js";

export type DecisionStage =
  | "input"
  | "prompt_context"
  | "tool_call"
  | "tool_result"
  | "assistant_output"
  | "outbound_message"
  | "install";

export type DecisionAction =
  | "allow"
  | "log_only"
  | "warn"
  | "redact"
  | "require_approval"
  | "block"
  | "deny";

export type EventSeverity = "info" | "warn" | "error" | "critical";
export type AuditColor = "neutral" | "blue" | "yellow" | "orange" | "red";
export type WinningArbiter =
  | "semantic_intent"
  | "evidence_score"
  | "local_l4"
  | "grant"
  | "fallback";

export type DecisionArbiterName = "semantic_intent" | "evidence_score";
export type EvidenceSource = "input" | "tool" | "output" | "chain" | "taint" | "provider" | "local_l4";

export interface ScoreBreakdown {
  ruleId: string;
  label: string;
  delta: number;
  reason: string;
}

export interface EvidenceItem {
  id: string;
  module: string;
  kind: string;
  value: string;
  severity: EventSeverity;
  scoreDelta: number;
  source: EvidenceSource;
}

export interface ArbiterResult {
  arbiter: DecisionArbiterName;
  riskLevel: RiskLevel;
  action: DecisionAction;
  score: number;
  matchedModules: string[];
  evidence: EvidenceItem[];
  scoreBreakdown: ScoreBreakdown[];
  reason: string;
}

export interface ApprovalRequestDraft {
  riskFamily: string;
  title: string;
  summary: string;
  scope: Record<string, unknown>;
  expiresAt?: string;
}

export interface OutputRedaction {
  kind: "secret" | "pii" | "system_prompt" | "developer_instruction" | "security_rule";
  start?: number;
  end?: number;
  replacement: string;
  reason: string;
}

export interface DecisionAudit {
  eventSeverity: EventSeverity;
  policyDecision: DecisionAction;
  enforcementAction: DecisionAction;
  color: AuditColor;
}

export interface DecisionDegraded {
  backendTimeout?: boolean;
  usedCachedDecision?: boolean;
  reason?: string;
}

export interface DecisionRequest {
  requestId: string;
  qaRecordId?: string;
  stage: DecisionStage;
  hook: string;
  sessionKey?: string;
  runId?: string;
  channelProfile?: string;
  channelId?: string;
  conversationId?: string;
  requesterId?: string;
  content?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  targetUri?: string;
  chainSummary?: Record<string, unknown>;
  taintSummary?: Record<string, unknown>;
  providerSafety?: Record<string, unknown>;
  createdAt: string;
}

export interface DecisionResponse {
  decisionId: string;
  stage: DecisionStage;
  block: boolean;
  action: DecisionAction;
  riskLevel: RiskLevel;
  score: number;
  winningArbiter: WinningArbiter;
  arbiters: ArbiterResult[];
  matchedModules: string[];
  requiresApproval: boolean;
  approvalRequest?: ApprovalRequestDraft;
  redactions?: OutputRedaction[];
  promptContext?: string;
  userMessage?: string;
  audit: DecisionAudit;
  degraded?: DecisionDegraded;
}
