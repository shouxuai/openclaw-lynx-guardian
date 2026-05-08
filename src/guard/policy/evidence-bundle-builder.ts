import type { RiskAssessment } from "../safety-guard.js";
import type { AttackGraphState } from "./attack-graph.js";
import type { GuardEvidenceBundle } from "./evidence-bundle.js";
import type { EvidenceItemInput } from "./evidence-scorer.js";

const SUMMARY_SLICE_LENGTH = 120;

const MODULE_EVIDENCE: Record<string, readonly EvidenceItemInput[]> = {
  "M0:identity_verification": [
    { dimension: "auth", weight: 3, confidence: 1, reason: "identity verification required" },
  ],
  "M2:protected_file_access": [
    { dimension: "auth", weight: 4, confidence: 1, reason: "protected file access requires authorization" },
    { dimension: "harm", weight: 4, confidence: 1, reason: "protected file access can expose sensitive policy context" },
  ],
  "M2:memory_session_privacy": [
    { dimension: "auth", weight: 4, confidence: 1, reason: "memory/session access requires authorization" },
    { dimension: "harm", weight: 4, confidence: 1, reason: "memory/session data exposure risk" },
  ],
  "M5:credential_theft": [
    { dimension: "auth", weight: 5, confidence: 1, reason: "credential access attempt requires strict authorization" },
    { dimension: "harm", weight: 5, confidence: 1, reason: "credential theft impact is high severity" },
  ],
  fatal_triangle: [
    { dimension: "harm", weight: 5, confidence: 1, reason: "fatal triangle indicates high-impact chain risk" },
    { dimension: "pattern", weight: 4, confidence: 1, reason: "fatal triangle pattern detected" },
  ],
};

const DEFAULT_MODULE_EVIDENCE: EvidenceItemInput = {
  dimension: "pattern",
  weight: 1,
  confidence: 1,
  reason: "module triggered without a dedicated evidence mapping",
};

function summaryFallback(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= SUMMARY_SLICE_LENGTH) {
    return trimmed;
  }
  return `${trimmed.slice(0, SUMMARY_SLICE_LENGTH)}...`;
}

function summarizeToolParams(params: Record<string, unknown>): string {
  try {
    const serialized = JSON.stringify(params);
    if (serialized && serialized !== "{}") {
      return summaryFallback(serialized);
    }
  } catch {
    // Fall through to a stable key-based summary for circular or custom values.
  }

  const keys = Object.keys(params);
  if (keys.length > 0) {
    return summaryFallback(`params keys=${keys.join(",")}`);
  }

  return "tool parameters";
}

function moduleEvidenceItems(modules: string[], atMs?: number): EvidenceItemInput[] {
  const items: EvidenceItemInput[] = [];

  for (const moduleId of modules) {
    const templates = MODULE_EVIDENCE[moduleId] ?? [DEFAULT_MODULE_EVIDENCE];
    for (const template of templates) {
      items.push({
        ...template,
        source: moduleId,
        atMs,
      });
    }
  }

  return items;
}

function chainEvidenceItems(chainProgress: AttackGraphState | null | undefined, atMs?: number): EvidenceItemInput[] {
  if (!chainProgress) {
    return [];
  }

  const CHAIN_STAGE_EVIDENCE: Record<AttackGraphState["stage"], EvidenceItemInput> = {
    idle: {
      dimension: "chain",
      weight: 1,
      confidence: 1,
      reason: "attack chain idle",
      source: "attack_graph",
    },
    sensitive_scope_entered: {
      dimension: "chain",
      weight: 2,
      confidence: 1,
      reason: "sensitive scope entered",
      source: "attack_graph",
    },
    artifact_prepared: {
      dimension: "chain",
      weight: 4,
      confidence: 1,
      reason: "artifact prepared",
      source: "attack_graph",
    },
    execution_ready: {
      dimension: "chain",
      weight: 5,
      confidence: 1,
      reason: "tainted artifact execution ready",
      source: "attack_graph",
    },
    exfiltration_ready: {
      dimension: "chain",
      weight: 5,
      confidence: 1,
      reason: "exfiltration-ready chain",
      source: "attack_graph",
    },
  };

  return [{
    ...CHAIN_STAGE_EVIDENCE[chainProgress.stage],
    target: chainProgress.stage,
    atMs,
  }];
}

function taintEvidenceItems(
  taintReadLabels: string[] | undefined,
  taintWriteLabels: string[] | undefined,
  atMs?: number,
): EvidenceItemInput[] {
  const items: EvidenceItemInput[] = [];
  for (const label of taintReadLabels ?? []) {
    items.push({
      dimension: "taint",
      weight: 4,
      confidence: 1,
      reason: `tainted artifact involved: ${label}`,
      source: "artifact_taint",
      target: label,
      atMs,
    });
  }
  for (const label of taintWriteLabels ?? []) {
    items.push({
      dimension: "taint",
      weight: 4,
      confidence: 1,
      reason: `tainted artifact involved: ${label}`,
      source: "artifact_taint",
      target: label,
      atMs,
    });
  }
  return items;
}

function createBaseBundle(
  eventKind: GuardEvidenceBundle["eventKind"],
  summary: string,
  assessment: RiskAssessment,
  sessionKey: string | undefined,
  chainProgress: AttackGraphState | null | undefined,
  taintReadLabels: string[],
  taintWriteLabels: string[],
  atMs?: number,
): GuardEvidenceBundle {
  return {
    eventKind,
    summary,
    modules: assessment.modules,
    evidenceItems: [
      ...moduleEvidenceItems(assessment.modules, atMs),
      ...chainEvidenceItems(chainProgress, atMs),
      ...taintEvidenceItems(taintReadLabels, taintWriteLabels, atMs),
    ],
    sessionKey,
    chainProgress: chainProgress ?? null,
    taintReadLabels,
    taintWriteLabels,
  };
}

export function buildInputEvidenceBundle(input: {
  text: string;
  assessment: RiskAssessment;
  sessionKey?: string;
  atMs?: number;
}): GuardEvidenceBundle {
  return createBaseBundle(
    "input",
    input.assessment.description || summaryFallback(input.text),
    input.assessment,
    input.sessionKey,
    null,
    [],
    [],
    input.atMs,
  );
}

export function buildToolEvidenceBundle(input: {
  toolName: string;
  params: Record<string, unknown>;
  assessment: RiskAssessment;
  sessionKey?: string;
  chainProgress?: AttackGraphState | null;
  taintReadLabels?: string[];
  taintWriteLabels?: string[];
  atMs?: number;
}): GuardEvidenceBundle {
  const description = input.assessment.description || summarizeToolParams(input.params);
  return createBaseBundle(
    "tool",
    `${input.toolName}: ${description}`,
    input.assessment,
    input.sessionKey,
    input.chainProgress,
    input.taintReadLabels ?? [],
    input.taintWriteLabels ?? [],
    input.atMs,
  );
}

export function buildOutputEvidenceBundle(input: {
  output: string;
  assessment: RiskAssessment;
  sessionKey?: string;
  chainProgress?: AttackGraphState | null;
  taintReadLabels?: string[];
  atMs?: number;
}): GuardEvidenceBundle {
  return createBaseBundle(
    "output",
    input.assessment.description || summaryFallback(input.output),
    input.assessment,
    input.sessionKey,
    input.chainProgress,
    input.taintReadLabels ?? [],
    [],
    input.atMs,
  );
}
