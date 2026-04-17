import type { AttackGraphState } from "./attack-graph.js";
import type { EvidenceItemInput } from "./evidence-scorer.js";

export interface GuardEvidenceBundle {
  eventKind: "input" | "tool" | "output";
  summary: string;
  modules: string[];
  evidenceItems: EvidenceItemInput[];
  sessionKey?: string;
  chainProgress?: AttackGraphState | null;
  taintReadLabels?: string[];
  taintWriteLabels?: string[];
  workflowCandidate?: boolean;
  workflowAuthorized?: boolean;
  isAuditWhitelisted?: boolean;
  auditBoundaryExceeded?: boolean;
}
