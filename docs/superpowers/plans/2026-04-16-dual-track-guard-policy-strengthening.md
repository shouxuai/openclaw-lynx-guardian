# Dual-Track Guard Policy Strengthening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add dual-track guard evaluation so legacy `RiskAssessment` stays intact while a new evidence-bundle-driven policy path can raise severity, with attack graph and artifact taint wired into tool/output handling first.

**Architecture:** Keep `src/guard/safety-guard.ts` as the legacy detector and scorer, but make each guard entry attach an `evidence bundle` in parallel. Evaluate that bundle inside `src/runtime/policy-runtime.ts`, arbitrate the stricter result there, and let `index.ts` remain the single effect router that emits one runtime action. Store attack-graph and taint state in a dedicated runtime module so the new chain can accumulate cross-event context without entangling the old session score logic.

**Tech Stack:** TypeScript, Vitest, in-memory runtime stores, existing OpenClaw sync and runtime validation scripts.

---

## File Structure

**Create**

- `src/guard/policy/evidence-bundle.ts`
  Defines the bundle contract that guard functions attach in parallel with `RiskAssessment`.
- `src/guard/policy/evidence-bundle-builder.ts`
  Converts legacy modules plus optional chain/taint context into `EvidenceItemInput[]` and full bundles for input/tool/output.
- `src/runtime/guard-policy-state.ts`
  Owns per-session attack-graph state and per-session artifact taint state, including reset helpers for tests.
- `test/guard-policy-state.test.ts`
  Covers session scoping, path canonicalization, taint reads/writes, and state reset.
- `test/evidence-bundle-builder.test.ts`
  Covers bundle generation for input/tool/output and the chain/taint evidence items.

**Modify**

- `src/runtime/policy-runtime.ts`
  Adds bundle evaluation, strict-only arbitration, and an effective compatibility assessment for existing approval flows.
- `src/guard/safety-guard.ts`
  Adds optional `evidenceBundle` to `GuardDecision`, wires tool/output state updates, and attaches bundles to all three guard entries.
- `index.ts`
  Replaces direct legacy-only policy evaluation with the dual-track arbiter while keeping one effect emission path.
- `test/policy-runtime.test.ts`
  Adds arbitration and bundle-evaluation tests.
- `test/safety-guard.test.ts`
  Adds direct guard tests for bundle attachment, attack-graph progression, taint propagation, and reset behavior.
- `test/plugin.test.ts`
  Adds a focused plugin-level regression that proves the stricter new-policy result wins once `index.ts` consumes the arbiter.

## Task 1: Add Bundle Evaluation And Strict Arbitration

**Files:**
- Create: `src/guard/policy/evidence-bundle.ts`
- Modify: `src/runtime/policy-runtime.ts`
- Test: `test/policy-runtime.test.ts`

- [ ] **Step 1: Write failing bundle-evaluation and arbitration tests**

```ts
import { describe, expect, it } from "vitest";
import {
  evaluateEvidenceBundle,
  evaluateGuardDecisionPolicy,
} from "../src/runtime/policy-runtime.js";
import type { GuardEvidenceBundle } from "../src/guard/policy/evidence-bundle.js";

describe("policy-runtime dual-track evaluation", () => {
  const baseBundle: GuardEvidenceBundle = {
    eventKind: "tool",
    summary: "tainted script execution",
    modules: ["M2:protected_file_access"],
    evidenceItems: [
      { dimension: "auth", weight: 4, confidence: 1, reason: "protected file access", source: "M2:protected_file_access" },
      { dimension: "chain", weight: 4, confidence: 1, reason: "artifact prepared", source: "attack_graph" },
      { dimension: "taint", weight: 4, confidence: 1, reason: "tainted artifact executed", source: "artifact_taint" },
    ],
    chainProgress: { stage: "execution_ready" },
    isAuditWhitelisted: false,
  };

  it("evaluates a bundle into a stricter compatibility assessment", () => {
    const result = evaluateEvidenceBundle(baseBundle);

    expect(result.riskLevelLabel).toBe("L3");
    expect(result.decision.kind).toBe("block");
    expect(result.compatibilityAssessment.level).toBe("L3");
    expect(result.compatibilityAssessment.modules).toEqual(["M2:protected_file_access"]);
  });

  it("prefers the stricter new-policy decision over a legacy allow", () => {
    const result = evaluateGuardDecisionPolicy({
      assessment: {
        level: "L0",
        score: 0,
        modules: ["M2:protected_file_access"],
        description: "legacy allow",
        action: "allow",
      },
      evidenceBundle: baseBundle,
    });

    expect(result.finalDecision.kind).toBe("block");
    expect(result.effectiveAssessment.level).toBe("L3");
  });

  it("falls back to the legacy assessment when no bundle is present", () => {
    const result = evaluateGuardDecisionPolicy({
      assessment: {
        level: "L2",
        score: 4,
        modules: ["M0:identity_verification"],
        description: "identity verification",
        action: "warn",
      },
    });

    expect(result.bundleEvaluation).toBeNull();
    expect(result.finalDecision.kind).toBe("warn");
    expect(result.effectiveAssessment.level).toBe("L2");
  });
});
```

- [ ] **Step 2: Run the focused policy-runtime tests and confirm they fail**

Run:

```bash
npx vitest run test/policy-runtime.test.ts
```

Expected:

- FAIL because `GuardEvidenceBundle`, `evaluateEvidenceBundle`, and `evaluateGuardDecisionPolicy` do not exist yet.

- [ ] **Step 3: Implement bundle types and the strict-only arbitration helpers**

`src/guard/policy/evidence-bundle.ts`

```ts
import type { AttackGraphState } from "./attack-graph.js";
import type { EvidenceItemInput } from "./evidence-scorer.js";

export type GuardEventKind = "input" | "tool" | "output";

export interface GuardEvidenceBundle {
  eventKind: GuardEventKind;
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
```

`src/runtime/policy-runtime.ts`

```ts
import { decidePolicy, resolveRiskLevel } from "../guard/policy/policy-engine.js";
import { scoreEvidence, type EvidenceScoreResult } from "../guard/policy/evidence-scorer.js";
import type { GuardEvidenceBundle } from "../guard/policy/evidence-bundle.js";

export interface EvidenceBundleRuntimeEvaluation extends PolicyRuntimeEvaluation {
  score: EvidenceScoreResult;
  compatibilityAssessment: RiskAssessment;
}

export interface GuardPolicyResolution {
  legacyEvaluation: PolicyRuntimeEvaluation;
  bundleEvaluation: EvidenceBundleRuntimeEvaluation | null;
  finalDecision: {
    kind: PolicyDecisionKind;
  };
  effectiveAssessment: RiskAssessment;
}

function mapPolicyKindToAssessmentAction(
  kind: PolicyDecisionKind,
): RiskAssessment["action"] {
  switch (kind) {
    case "deny":
      return "deny";
    case "block":
      return "block";
    case "warn":
      return "warn";
    default:
      return "warn";
  }
}

export function evaluateEvidenceBundle(
  bundle: GuardEvidenceBundle,
): EvidenceBundleRuntimeEvaluation {
  const score = scoreEvidence(bundle.evidenceItems);
  const resolvedRisk = resolveRiskLevel({
    summaryHeat: score.summaryHeat,
    dimensionScores: score.dimensionScores,
    chainProgress: bundle.chainProgress ?? null,
    isAuditWhitelisted: bundle.isAuditWhitelisted ?? false,
  });
  const decision = decidePolicy({
    ...resolvedRisk,
    workflowCandidate: bundle.workflowCandidate,
    workflowAuthorized: bundle.workflowAuthorized,
    isAuditWhitelisted: bundle.isAuditWhitelisted ?? false,
    auditBoundaryExceeded: bundle.auditBoundaryExceeded,
  });

  return {
    ...resolvedRisk,
    decision,
    score,
    legacyRiskLevel: toLegacyRiskLevel(resolvedRisk.riskLevelValue),
    compatibilityAssessment: {
      level: resolvedRisk.riskLevelLabel,
      score: score.compatibilityScore,
      modules: bundle.modules,
      description: bundle.summary,
      action: mapPolicyKindToAssessmentAction(decision.kind),
    },
  };
}

export function evaluateGuardDecisionPolicy(input: {
  assessment: RiskAssessment;
  evidenceBundle?: GuardEvidenceBundle;
  options?: {
    workflowCandidate?: boolean;
    workflowAuthorized?: boolean;
    isAuditWhitelisted?: boolean;
    auditBoundaryExceeded?: boolean;
  };
}): GuardPolicyResolution {
  const legacyEvaluation = evaluateRiskAssessment(input.assessment, input.options);
  if (!input.evidenceBundle) {
    return {
      legacyEvaluation,
      bundleEvaluation: null,
      finalDecision: legacyEvaluation.decision,
      effectiveAssessment: input.assessment,
    };
  }

  const bundleEvaluation = evaluateEvidenceBundle({
    ...input.evidenceBundle,
    workflowCandidate: input.options?.workflowCandidate ?? input.evidenceBundle.workflowCandidate,
    workflowAuthorized: input.options?.workflowAuthorized ?? input.evidenceBundle.workflowAuthorized,
    isAuditWhitelisted: input.options?.isAuditWhitelisted ?? input.evidenceBundle.isAuditWhitelisted,
    auditBoundaryExceeded: input.options?.auditBoundaryExceeded ?? input.evidenceBundle.auditBoundaryExceeded,
  });
  const finalKind = pickStricterPolicyKind(
    legacyEvaluation.decision.kind,
    bundleEvaluation.decision.kind,
  );
  const effectiveAssessment =
    POLICY_DECISION_PRIORITY[finalKind] > POLICY_DECISION_PRIORITY[legacyEvaluation.decision.kind]
      ? bundleEvaluation.compatibilityAssessment
      : input.assessment;

  return {
    legacyEvaluation,
    bundleEvaluation,
    finalDecision: { kind: finalKind },
    effectiveAssessment,
  };
}
```

- [ ] **Step 4: Re-run the policy-runtime tests and confirm they pass**

Run:

```bash
npx vitest run test/policy-runtime.test.ts
```

Expected:

- PASS for the new dual-track evaluation and fallback cases.

- [ ] **Step 5: Commit the low-level arbitration helpers**

```bash
git add test/policy-runtime.test.ts src/guard/policy/evidence-bundle.ts src/runtime/policy-runtime.ts
git commit -m "feat: add dual-track policy arbitration helpers"
```

## Task 2: Add Session-Scoped Attack Graph And Artifact Taint State

**Files:**
- Create: `src/runtime/guard-policy-state.ts`
- Test: `test/guard-policy-state.test.ts`

- [ ] **Step 1: Write failing state-store tests for session scoping, path canonicalization, and resets**

```ts
import { describe, expect, it } from "vitest";
import {
  advanceAttackGraphState,
  clearGuardPolicyState,
  markGuardArtifactTaint,
  readAttackGraphState,
  readGuardArtifactTaint,
} from "../src/runtime/guard-policy-state.js";

describe("guard-policy runtime state", () => {
  it("tracks attack-graph progression per session", () => {
    clearGuardPolicyState();

    advanceAttackGraphState("sess-a", { action: "sensitive_read" });
    advanceAttackGraphState("sess-a", { action: "artifact_write" });

    expect(readAttackGraphState("sess-a")?.stage).toBe("artifact_prepared");
    expect(readAttackGraphState("sess-b")).toBeNull();
  });

  it("canonicalizes paths for taint reads", () => {
    clearGuardPolicyState();

    markGuardArtifactTaint("sess-a", "C:\\temp\\loot.txt", ["credential_material"]);

    expect(
      readGuardArtifactTaint("sess-a", "C:/temp/loot.txt")?.taints,
    ).toEqual(["credential_material"]);
  });

  it("clears both attack-graph and taint state", () => {
    clearGuardPolicyState();

    advanceAttackGraphState("sess-a", { action: "sensitive_read" });
    markGuardArtifactTaint("sess-a", "/tmp/loot.txt", ["sensitive_source"]);
    clearGuardPolicyState("sess-a");

    expect(readAttackGraphState("sess-a")).toBeNull();
    expect(readGuardArtifactTaint("sess-a", "/tmp/loot.txt")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the new state-store test file and confirm it fails**

Run:

```bash
npx vitest run test/guard-policy-state.test.ts
```

Expected:

- FAIL because `guard-policy-state.ts` does not exist yet.

- [ ] **Step 3: Implement the dedicated runtime state store**

```ts
import type { AttackGraphEvent, AttackGraphState } from "../guard/policy/attack-graph.js";
import { advanceAttackGraph } from "../guard/policy/attack-graph.js";
import { createArtifactTaintStore, type ArtifactTaintRecord } from "../guard/policy/artifact-taint-store.js";
import { canonicalizePath } from "./plugin-runtime-helpers.js";

interface GuardPolicySessionState {
  attackGraph: AttackGraphState | null;
  taintStore: ReturnType<typeof createArtifactTaintStore>;
  lastUpdatedAt: number;
}

const SESSION_TTL_MS = 30 * 60 * 1000;
const sessions = new Map<string, GuardPolicySessionState>();

function getSession(sessionKey: string): GuardPolicySessionState {
  const now = Date.now();
  const current = sessions.get(sessionKey);
  if (current && now - current.lastUpdatedAt <= SESSION_TTL_MS) {
    current.lastUpdatedAt = now;
    return current;
  }

  const fresh: GuardPolicySessionState = {
    attackGraph: null,
    taintStore: createArtifactTaintStore(),
    lastUpdatedAt: now,
  };
  sessions.set(sessionKey, fresh);
  return fresh;
}

export function readAttackGraphState(sessionKey?: string): AttackGraphState | null {
  if (!sessionKey) {
    return null;
  }
  return getSession(sessionKey).attackGraph;
}

export function advanceAttackGraphState(
  sessionKey: string | undefined,
  event: AttackGraphEvent,
): AttackGraphState | null {
  if (!sessionKey) {
    return null;
  }
  const session = getSession(sessionKey);
  session.attackGraph = advanceAttackGraph(session.attackGraph ?? undefined, event);
  return session.attackGraph;
}

export function markGuardArtifactTaint(
  sessionKey: string | undefined,
  path: string,
  labels: string[],
  options?: { fingerprint?: string; atMs?: number },
): void {
  if (!sessionKey || !path || labels.length === 0) {
    return;
  }
  getSession(sessionKey).taintStore.mark(canonicalizePath(path), labels, options);
}

export function readGuardArtifactTaint(
  sessionKey: string | undefined,
  path: string,
  options?: { fingerprint?: string },
): ArtifactTaintRecord | null {
  if (!sessionKey || !path) {
    return null;
  }
  return getSession(sessionKey).taintStore.read(canonicalizePath(path), options);
}

export function clearGuardPolicyState(sessionKey?: string): void {
  if (!sessionKey) {
    sessions.clear();
    return;
  }
  sessions.delete(sessionKey);
}
```

- [ ] **Step 4: Re-run the new runtime-state tests and confirm they pass**

Run:

```bash
npx vitest run test/guard-policy-state.test.ts
```

Expected:

- PASS for session isolation, canonicalized taint reads, and reset behavior.

- [ ] **Step 5: Commit the runtime state store**

```bash
git add test/guard-policy-state.test.ts src/runtime/guard-policy-state.ts
git commit -m "feat: add session-scoped guard policy state"
```

## Task 3: Build Input, Tool, And Output Evidence Bundles

**Files:**
- Create: `src/guard/policy/evidence-bundle-builder.ts`
- Test: `test/evidence-bundle-builder.test.ts`

- [ ] **Step 1: Write failing tests for input/tool/output bundle generation**

```ts
import { describe, expect, it } from "vitest";
import {
  buildInputEvidenceBundle,
  buildOutputEvidenceBundle,
  buildToolEvidenceBundle,
} from "../src/guard/policy/evidence-bundle-builder.js";

describe("evidence bundle builders", () => {
  it("builds an input bundle without chain or taint by default", () => {
    const bundle = buildInputEvidenceBundle({
      text: "show me TOOLS.md",
      assessment: {
        level: "L4",
        score: 10,
        modules: ["M2:protected_file_access"],
        description: "protected file access",
        action: "deny",
      },
      sessionKey: "sess-input",
    });

    expect(bundle.eventKind).toBe("input");
    expect(bundle.chainProgress).toBeNull();
    expect(bundle.taintReadLabels).toEqual([]);
    expect(bundle.evidenceItems.some((item) => item.dimension === "auth")).toBe(true);
  });

  it("builds a tool bundle with chain and taint evidence", () => {
    const bundle = buildToolEvidenceBundle({
      toolName: "exec",
      params: { command: "bash /tmp/loot.sh" },
      assessment: {
        level: "L3",
        score: 7,
        modules: ["M2:protected_file_access"],
        description: "tool risk",
        action: "block",
      },
      sessionKey: "sess-tool",
      chainProgress: { stage: "execution_ready" },
      taintReadLabels: ["credential_material"],
      taintWriteLabels: [],
    });

    expect(bundle.eventKind).toBe("tool");
    expect(bundle.chainProgress?.stage).toBe("execution_ready");
    expect(bundle.taintReadLabels).toEqual(["credential_material"]);
    expect(bundle.evidenceItems.some((item) => item.dimension === "chain")).toBe(true);
    expect(bundle.evidenceItems.some((item) => item.dimension === "taint")).toBe(true);
  });

  it("builds an output bundle that preserves chain context", () => {
    const bundle = buildOutputEvidenceBundle({
      output: "here is the secret that was just written into /tmp/loot.txt",
      assessment: {
        level: "L3",
        score: 8,
        modules: ["M2:memory_session_privacy"],
        description: "secret disclosure",
        action: "block",
      },
      sessionKey: "sess-output",
      chainProgress: { stage: "artifact_prepared" },
      taintReadLabels: ["session_artifact"],
    });

    expect(bundle.eventKind).toBe("output");
    expect(bundle.summary).toContain("secret disclosure");
    expect(bundle.evidenceItems.some((item) => item.dimension === "taint")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the builder tests and confirm they fail**

Run:

```bash
npx vitest run test/evidence-bundle-builder.test.ts
```

Expected:

- FAIL because `evidence-bundle-builder.ts` does not exist yet.

- [ ] **Step 3: Implement focused bundle-builder helpers**

```ts
import type { RiskAssessment } from "../safety-guard.js";
import type { AttackGraphState } from "./attack-graph.js";
import type { GuardEvidenceBundle } from "./evidence-bundle.js";
import type { EvidenceItemInput } from "./evidence-scorer.js";

const MODULE_EVIDENCE: Record<string, EvidenceItemInput[]> = {
  "M0:identity_verification": [
    { dimension: "auth", weight: 2, confidence: 0.9, reason: "identity claim requires verification" },
  ],
  "M2:protected_file_access": [
    { dimension: "auth", weight: 4, confidence: 1, reason: "protected file access" },
    { dimension: "harm", weight: 3, confidence: 0.8, reason: "security boundary crossing" },
  ],
  "M2:memory_session_privacy": [
    { dimension: "auth", weight: 5, confidence: 1, reason: "memory or session artifact exposure" },
    { dimension: "harm", weight: 4, confidence: 1, reason: "private state exposure" },
  ],
  "M5:credential_theft": [
    { dimension: "auth", weight: 5, confidence: 1, reason: "credential access attempt" },
    { dimension: "harm", weight: 5, confidence: 1, reason: "credential theft risk" },
  ],
  "fatal_triangle": [
    { dimension: "harm", weight: 5, confidence: 1, reason: "fatal triangle completed" },
    { dimension: "pattern", weight: 4, confidence: 1, reason: "exfiltration pattern completed" },
  ],
};

function moduleEvidenceItems(modules: string[], atMs: number): EvidenceItemInput[] {
  return modules.flatMap((moduleId) =>
    (MODULE_EVIDENCE[moduleId] ?? []).map((item) => ({
      ...item,
      source: moduleId,
      atMs,
    })),
  );
}

function chainEvidenceItems(
  chainProgress: AttackGraphState | null | undefined,
  atMs: number,
): EvidenceItemInput[] {
  switch (chainProgress?.stage) {
    case "sensitive_scope_entered":
      return [{ dimension: "chain", weight: 2, confidence: 1, reason: "sensitive scope entered", source: "attack_graph", atMs }];
    case "artifact_prepared":
      return [{ dimension: "chain", weight: 4, confidence: 1, reason: "artifact prepared", source: "attack_graph", atMs }];
    case "execution_ready":
      return [{ dimension: "chain", weight: 5, confidence: 1, reason: "tainted artifact execution ready", source: "attack_graph", atMs }];
    case "exfiltration_ready":
      return [{ dimension: "chain", weight: 5, confidence: 1, reason: "exfiltration-ready chain", source: "attack_graph", atMs }];
    default:
      return [];
  }
}

function taintEvidenceItems(labels: string[], atMs: number): EvidenceItemInput[] {
  return labels.map((label) => ({
    dimension: "taint",
    weight: 4,
    confidence: 1,
    reason: `tainted artifact involved: ${label}`,
    source: "artifact_taint",
    target: label,
    atMs,
  }));
}

export function buildInputEvidenceBundle(input: {
  text: string;
  assessment: RiskAssessment;
  sessionKey?: string;
  atMs?: number;
}): GuardEvidenceBundle {
  const atMs = input.atMs ?? Date.now();
  return {
    eventKind: "input",
    sessionKey: input.sessionKey,
    summary: input.assessment.description || input.text.slice(0, 160),
    modules: input.assessment.modules,
    evidenceItems: moduleEvidenceItems(input.assessment.modules, atMs),
    chainProgress: null,
    taintReadLabels: [],
    taintWriteLabels: [],
  };
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
  const atMs = input.atMs ?? Date.now();
  const taintReadLabels = input.taintReadLabels ?? [];
  const taintWriteLabels = input.taintWriteLabels ?? [];
  return {
    eventKind: "tool",
    sessionKey: input.sessionKey,
    summary: `${input.toolName}: ${input.assessment.description}`,
    modules: input.assessment.modules,
    evidenceItems: [
      ...moduleEvidenceItems(input.assessment.modules, atMs),
      ...chainEvidenceItems(input.chainProgress, atMs),
      ...taintEvidenceItems(taintReadLabels, atMs),
      ...taintEvidenceItems(taintWriteLabels, atMs),
    ],
    chainProgress: input.chainProgress ?? null,
    taintReadLabels,
    taintWriteLabels,
  };
}

export function buildOutputEvidenceBundle(input: {
  output: string;
  assessment: RiskAssessment;
  sessionKey?: string;
  chainProgress?: AttackGraphState | null;
  taintReadLabels?: string[];
  atMs?: number;
}): GuardEvidenceBundle {
  const atMs = input.atMs ?? Date.now();
  const taintReadLabels = input.taintReadLabels ?? [];
  return {
    eventKind: "output",
    sessionKey: input.sessionKey,
    summary: input.assessment.description || input.output.slice(0, 160),
    modules: input.assessment.modules,
    evidenceItems: [
      ...moduleEvidenceItems(input.assessment.modules, atMs),
      ...chainEvidenceItems(input.chainProgress, atMs),
      ...taintEvidenceItems(taintReadLabels, atMs),
    ],
    chainProgress: input.chainProgress ?? null,
    taintReadLabels,
    taintWriteLabels: [],
  };
}
```

- [ ] **Step 4: Re-run the builder tests and confirm they pass**

Run:

```bash
npx vitest run test/evidence-bundle-builder.test.ts
```

Expected:

- PASS for input/tool/output bundle construction.

- [ ] **Step 5: Commit the bundle builders**

```bash
git add test/evidence-bundle-builder.test.ts src/guard/policy/evidence-bundle-builder.ts
git commit -m "feat: add guard evidence bundle builders"
```

## Task 4: Wire Tool Guard Into Attack Graph, Taint State, And Bundles

**Files:**
- Modify: `src/guard/safety-guard.ts`
- Test: `test/safety-guard.test.ts`

- [ ] **Step 1: Add failing tool-guard tests for chain progression, taint propagation, and reset integration**

```ts
it("attaches a tool evidence bundle and advances the chain across read-write-exec", () => {
  const sessionKey = "tool-chain-sequence";
  clearSessionState(sessionKey);

  const readDecision = guardToolCall("exec", { command: "cat ~/.ssh/id_rsa" }, sessionKey);
  const writeDecision = guardToolCall(
    "write",
    { file_path: "/tmp/loot.sh", content: "cat ~/.ssh/id_rsa" },
    sessionKey,
  );
  const execDecision = guardToolCall("exec", { command: "bash /tmp/loot.sh" }, sessionKey);

  expect(readDecision.evidenceBundle?.chainProgress?.stage).toBe("sensitive_scope_entered");
  expect(writeDecision.evidenceBundle?.chainProgress?.stage).toBe("artifact_prepared");
  expect(execDecision.evidenceBundle?.chainProgress?.stage).toBe("execution_ready");
});

it("reads taint labels when a previously tainted artifact is executed", () => {
  const sessionKey = "tool-taint-read";
  clearSessionState(sessionKey);

  guardToolCall(
    "write",
    { file_path: "/tmp/loot.sh", content: "cat ~/.ssh/id_rsa" },
    sessionKey,
  );
  const execDecision = guardToolCall("exec", { command: "bash /tmp/loot.sh" }, sessionKey);

  expect(execDecision.evidenceBundle?.taintReadLabels).toContain("credential_material");
});

it("clears dual-track tool state when clearSessionState is called", () => {
  const sessionKey = "tool-state-reset";
  clearSessionState(sessionKey);

  guardToolCall("exec", { command: "cat ~/.ssh/id_rsa" }, sessionKey);
  clearSessionState(sessionKey);
  const nextDecision = guardToolCall("exec", { command: "bash /tmp/loot.sh" }, sessionKey);

  expect(nextDecision.evidenceBundle?.chainProgress?.stage).not.toBe("execution_ready");
});
```

- [ ] **Step 2: Run the focused safety-guard tests and confirm they fail**

Run:

```bash
npx vitest run test/safety-guard.test.ts -t "tool evidence bundle"
```

Expected:

- FAIL because `GuardDecision.evidenceBundle` does not exist and tool guard does not update the new runtime state.

- [ ] **Step 3: Extend `guardToolCall` without replacing legacy scoring**

```ts
import type { GuardEvidenceBundle } from "./policy/evidence-bundle.js";
import { buildToolEvidenceBundle } from "./policy/evidence-bundle-builder.js";
import {
  advanceAttackGraphState,
  clearGuardPolicyState,
  markGuardArtifactTaint,
  readAttackGraphState,
  readGuardArtifactTaint,
} from "../runtime/guard-policy-state.js";

export interface GuardDecision {
  block: boolean;
  blockReason?: string;
  warning?: string;
  riskAssessment: RiskAssessment;
  evidenceBundle?: GuardEvidenceBundle;
  overrideHint?: {
    allowed: boolean;
    confirmationPhrase?: string;
    reason?: string;
  };
  contextHints?: {
    masqueradeTaintLevel?: ExecMasqueradeLevel;
  };
}

function detectToolAttackEvent(
  toolName: string,
  params: Record<string, any>,
  modules: string[],
): { action: "sensitive_read" | "artifact_write" | "artifact_exec" | "external_send" } | null {
  const command = String(params?.command ?? "");
  const normalizedTool = normalizeString(toolName).toLowerCase();

  if (modules.includes("M5:credential_theft") || modules.includes("M2:protected_file_access")) {
    return { action: "sensitive_read" };
  }
  if (normalizedTool === "write" || normalizedTool === "edit") {
    return { action: "artifact_write" };
  }
  if (normalizedTool === "exec" && /\b(?:bash|sh|zsh|python|node)\b[^\n\r]*\s+\/\S+/i.test(command)) {
    return { action: "artifact_exec" };
  }
  if (normalizedTool === "exec" && /\b(?:curl|wget|scp|nc|ncat)\b/i.test(command)) {
    return { action: "external_send" };
  }
  return null;
}

function extractArtifactPath(toolName: string, params: Record<string, any>): string | null {
  if (toolName === "write" || toolName === "edit") {
    return String(params?.file_path ?? params?.path ?? "");
  }
  const command = String(params?.command ?? "");
  const execPathMatch = command.match(/\b(?:bash|sh|zsh|python|node)\b[^\n\r]*\s+(\/\S+|[A-Za-z]:\\\S+)/);
  return execPathMatch?.[1] ?? null;
}

function deriveArtifactTaintLabels(modules: string[]): string[] {
  const labels = new Set<string>();
  if (modules.includes("M5:credential_theft")) labels.add("credential_material");
  if (modules.includes("M2:memory_session_privacy")) labels.add("session_artifact");
  if (modules.includes("M2:protected_file_access")) labels.add("sensitive_source");
  if (modules.includes("M3:over_agency")) labels.add("guard_bypass_script");
  return [...labels];
}

const attackEvent = detectToolAttackEvent(toolName, params, modules);
const chainProgress = attackEvent && sessionKey
  ? advanceAttackGraphState(sessionKey, attackEvent)
  : readAttackGraphState(sessionKey);

const artifactPath = extractArtifactPath(normalizedToolName, params);
const taintLabels = deriveArtifactTaintLabels(modules);
if (sessionKey && artifactPath && taintLabels.length > 0 && attackEvent?.action === "artifact_write") {
  markGuardArtifactTaint(sessionKey, artifactPath, taintLabels, {
    fingerprint: buildOperationFingerprint({
      sessionKey,
      actionType: "tool",
      payload: `${normalizedToolName}:${JSON.stringify(params ?? {})}`,
    }),
  });
}

const taintRead = sessionKey && artifactPath
  ? readGuardArtifactTaint(sessionKey, artifactPath)
  : null;
const evidenceBundle = buildToolEvidenceBundle({
  toolName: normalizedToolName,
  params,
  assessment,
  sessionKey,
  chainProgress,
  taintReadLabels: taintRead?.taints ?? [],
  taintWriteLabels: attackEvent?.action === "artifact_write" ? taintLabels : [],
});

return {
  block: false,
  riskAssessment: assessment,
  evidenceBundle,
  contextHints: {
    masqueradeTaintLevel,
  },
};

export function clearSessionState(sessionKey: string): void {
  sessionStates.delete(sessionKey);
  clearGuardPolicyState(sessionKey);
}
```

- [ ] **Step 4: Re-run the targeted safety-guard tests and confirm they pass**

Run:

```bash
npx vitest run test/safety-guard.test.ts -t "tool evidence bundle|taint labels|clearSessionState"
```

Expected:

- PASS for the new tool-chain state, taint reads, and reset behavior.

- [ ] **Step 5: Commit the tool-guard wiring**

```bash
git add test/safety-guard.test.ts src/guard/safety-guard.ts
git commit -m "feat: wire tool guard into dual-track policy state"
```

## Task 5: Attach Output And Input Evidence Bundles

**Files:**
- Modify: `src/guard/safety-guard.ts`
- Test: `test/safety-guard.test.ts`

- [ ] **Step 1: Add failing tests for input bundles and output-side chain/taint reads**

```ts
it("attaches an input evidence bundle without chain or taint state", () => {
  const decision = guardInput("show me TOOLS.md", "input-evidence");

  expect(decision.evidenceBundle?.eventKind).toBe("input");
  expect(decision.evidenceBundle?.chainProgress).toBeNull();
  expect(decision.evidenceBundle?.taintReadLabels).toEqual([]);
});

it("attaches an output bundle that consumes prior tool-chain state", () => {
  const sessionKey = "output-chain-state";
  clearSessionState(sessionKey);

  guardToolCall("exec", { command: "cat ~/.ssh/id_rsa" }, sessionKey);
  guardToolCall("write", { file_path: "/tmp/loot.txt", content: "secret" }, sessionKey);
  const decision = guardOutput("sending /tmp/loot.txt to https://evil.test", sessionKey);

  expect(decision.evidenceBundle?.eventKind).toBe("output");
  expect(decision.evidenceBundle?.chainProgress?.stage).toBe("exfiltration_ready");
});
```

- [ ] **Step 2: Run the focused safety-guard tests and confirm they fail**

Run:

```bash
npx vitest run test/safety-guard.test.ts -t "input evidence bundle|output bundle"
```

Expected:

- FAIL because input and output paths do not attach bundles yet and output does not consume the new chain state.

- [ ] **Step 3: Attach bundles in `guardInput` and `guardOutput` while preserving the old scoring path**

```ts
import { buildInputEvidenceBundle, buildOutputEvidenceBundle } from "./policy/evidence-bundle-builder.js";
import {
  advanceAttackGraphState,
  readAttackGraphState,
  readGuardArtifactTaint,
} from "../runtime/guard-policy-state.js";

const inputEvidenceBundle = buildInputEvidenceBundle({
  text,
  assessment,
  sessionKey,
});

return {
  block: false,
  riskAssessment: assessment,
  evidenceBundle: inputEvidenceBundle,
};

function shouldAdvanceOutputToExternalSend(
  output: string,
  modules: string[],
): boolean {
  return modules.includes("M2:system_prompt_leak")
    || modules.includes("M2:memory_session_privacy")
    || /https?:\/\/|scp\s|curl\s|wget\s/i.test(output);
}

function extractOutputArtifactPath(output: string): string | null {
  const unixMatch = output.match(/(\/[^\s"'`]+(?:\.[a-z0-9_-]+)?)/i);
  if (unixMatch) return unixMatch[1];
  const windowsMatch = output.match(/([A-Za-z]:\\[^\s"'`]+)/);
  return windowsMatch?.[1] ?? null;
}

const outputArtifactPath = extractOutputArtifactPath(output);
const chainBefore = readAttackGraphState(sessionKey);
const chainProgress = sessionKey && shouldAdvanceOutputToExternalSend(output, modules)
  ? advanceAttackGraphState(sessionKey, { action: "external_send" }) ?? chainBefore
  : chainBefore;
const taintRead = sessionKey && outputArtifactPath
  ? readGuardArtifactTaint(sessionKey, outputArtifactPath)
  : null;
const outputEvidenceBundle = buildOutputEvidenceBundle({
  output,
  assessment,
  sessionKey,
  chainProgress,
  taintReadLabels: taintRead?.taints ?? [],
});

return {
  block: false,
  riskAssessment: assessment,
  evidenceBundle: outputEvidenceBundle,
};
```

- [ ] **Step 4: Re-run the targeted safety-guard tests and confirm they pass**

Run:

```bash
npx vitest run test/safety-guard.test.ts -t "input evidence bundle|output bundle"
```

Expected:

- PASS for input bundle attachment and output-side chain/taint consumption.

- [ ] **Step 5: Commit the input/output bundle wiring**

```bash
git add test/safety-guard.test.ts src/guard/safety-guard.ts
git commit -m "feat: attach input and output evidence bundles"
```

## Task 6: Route `index.ts` Through The Dual-Track Arbiter

**Files:**
- Modify: `index.ts`
- Modify: `test/plugin.test.ts`

- [ ] **Step 1: Add a focused plugin regression that proves the stricter new-policy result wins**

```ts
it("blocks a tool call when the dual-track arbiter is stricter than the legacy allow", async () => {
  setup(mockApi);
  const handler = handlers["before_tool_call"];
  const guardSpy = vi.spyOn(safetyGuard, "guardToolCall").mockReturnValue({
    block: false,
    riskAssessment: {
      level: "L0",
      score: 0,
      modules: ["M2:protected_file_access"],
      description: "legacy allow",
      action: "allow",
    },
    evidenceBundle: {
      eventKind: "tool",
      summary: "tainted script execution",
      modules: ["M2:protected_file_access"],
      evidenceItems: [
        { dimension: "auth", weight: 4, confidence: 1, reason: "protected file access" },
        { dimension: "chain", weight: 4, confidence: 1, reason: "artifact prepared" },
        { dimension: "taint", weight: 4, confidence: 1, reason: "credential_material" },
      ],
      chainProgress: { stage: "execution_ready" },
      isAuditWhitelisted: false,
    },
  } as any);

  const result = await handler(
    { toolName: "exec", params: { command: "bash /tmp/loot.sh" } },
    { sessionKey: "sess-dual-track", runId: "run-dual-track", sendMessage: vi.fn() },
  );

  expect(result?.block).toBe(true);
  expect(String(result?.blockReason)).toContain("L3");

  guardSpy.mockRestore();
});
```

- [ ] **Step 2: Run the focused plugin test and confirm it fails**

Run:

```bash
npx vitest run test/plugin.test.ts -t "dual-track arbiter is stricter"
```

Expected:

- FAIL because `index.ts` still relies on legacy-only `decision.block`, `resolveRiskPolicy(decision.riskAssessment)`, and `evaluateRiskAssessment(decision.riskAssessment)`.

- [ ] **Step 3: Replace the legacy-only bridge calls with the dual-track arbiter**

```ts
import { evaluateGuardDecisionPolicy } from "./src/runtime/policy-runtime.js";
import type { GuardDecision } from "./src/guard/safety-guard.js";

function resolveDualTrackPolicy(
  decision: GuardDecision,
  options?: {
    workflowCandidate?: boolean;
    workflowAuthorized?: boolean;
    isAuditWhitelisted?: boolean;
    auditBoundaryExceeded?: boolean;
  },
) {
  return evaluateGuardDecisionPolicy({
    assessment: decision.riskAssessment,
    evidenceBundle: decision.evidenceBundle,
    options,
  });
}

const policyResolution = resolveDualTrackPolicy(decision, {
  workflowCandidate: false,
  workflowAuthorized: false,
  isAuditWhitelisted: false,
});
const effectiveAssessment = policyResolution.effectiveAssessment;
const policyResult = resolveRiskPolicy(effectiveAssessment, riskPolicyConfig);
const policyEvaluation = policyResolution.bundleEvaluation ?? policyResolution.legacyEvaluation;

if (policyResolution.finalDecision.kind === "deny" || policyResolution.finalDecision.kind === "block") {
  log.warn(
    `[lynx-guardian] dual-track policy blocked ${effectiveAssessment.description} (${effectiveAssessment.level}, score=${effectiveAssessment.score})`,
  );
  await pushRecord(
    userId,
    buildPolicyRecordContent(
      policyEvaluation,
      `[SSG:tool] ${toolName} ${effectiveAssessment.modules.join(",")}`,
    ),
    policyEvaluation.legacyRiskLevel,
  );
  return {
    block: true,
    blockReason: decision.blockReason
      ?? `[Lynx Guardian] ${effectiveAssessment.description} (${effectiveAssessment.level})`,
  };
}

if (
  (policyResolution.finalDecision.kind === "confirm" || policyResolution.finalDecision.kind === "workflow_auth")
  && resolveOverrideKey(ctx)
  && policyResult.override.allowed
) {
  savePendingOverrideFull(ctx, {
    operationFingerprint: toolFingerprint,
    createdAt: Date.now(),
    expiresAt: Date.now() + riskPolicyConfig.overrideTtlMs,
    actionType: "tool",
    replayPayload: {
      toolName,
      params: params ?? null,
    },
    riskScore: effectiveAssessment.score,
    riskLevel: effectiveAssessment.level,
    matchedModules: effectiveAssessment.modules,
    sourceKeys: resolveOverrideKeys(ctx),
  });
}
```

- [ ] **Step 4: Re-run the focused plugin regression and confirm it passes**

Run:

```bash
npx vitest run test/plugin.test.ts -t "dual-track arbiter is stricter"
```

Expected:

- PASS because `index.ts` now blocks on the stricter dual-track result even when the legacy `decision.block` was `false`.

- [ ] **Step 5: Commit the runtime integration**

```bash
git add test/plugin.test.ts index.ts
git commit -m "feat: route guard enforcement through dual-track arbiter"
```

## Task 7: Verify Focused Tests, Sync To OpenClaw, And Run A Real Runtime Probe

**Files:**
- Modify: `src/guard/safety-guard.ts`
- Modify: `src/runtime/policy-runtime.ts`
- Modify: `index.ts`
- Create: `src/runtime/guard-policy-state.ts`
- Create: `src/guard/policy/evidence-bundle.ts`
- Create: `src/guard/policy/evidence-bundle-builder.ts`
- Test: `test/policy-runtime.test.ts`
- Test: `test/guard-policy-state.test.ts`
- Test: `test/evidence-bundle-builder.test.ts`
- Test: `test/safety-guard.test.ts`
- Test: `test/plugin.test.ts`

- [ ] **Step 1: Run the focused local verification suite and TypeScript check**

Run:

```bash
npx vitest run test/policy-runtime.test.ts test/guard-policy-state.test.ts test/evidence-bundle-builder.test.ts
npx vitest run test/safety-guard.test.ts -t "tool evidence bundle|taint labels|clearSessionState|input evidence bundle|output bundle"
npx vitest run test/plugin.test.ts -t "dual-track arbiter is stricter"
npx tsc --noEmit
```

Expected:

- PASS for the targeted Vitest files and patterns.
- PASS for `npx tsc --noEmit`.

- [ ] **Step 2: Sync the plugin into the real OpenClaw runtime**

Run:

```powershell
node scripts/verify-dev-sync.mjs
.\scripts\sync-openclaw-dev-ready.ps1 --logs 200
```

Expected:

- `verify-dev-sync.mjs` reports the sync inputs are valid.
- `sync-openclaw-dev-ready.ps1` restarts the gateway and does not end with `[lynx-dev-sync] gateway log assessment: blocked`.

- [ ] **Step 3: Run a real runtime probe through the local authenticated OpenAI-compatible endpoint**

Run:

```powershell
$headers = @{
  Authorization = "Bearer 3394aded9042bf1e387f980b3a110c32c71ba964b1c4b40a"
  "Content-Type" = "application/json"
}

$body = @{
  model = "openclaw/main"
  messages = @(
    @{
      role = "user"
      content = "reply with dual-track guard runtime ok only"
    }
  )
} | ConvertTo-Json -Depth 6

Invoke-RestMethod -Method Post `
  -Uri http://127.0.0.1:18789/v1/chat/completions `
  -Headers $headers `
  -Body $body
```

Expected:

- HTTP 200.
- A normal completion payload proving the gateway stayed reachable after the plugin sync.

- [ ] **Step 4: Inspect supporting runtime signals before claiming completion**

Run:

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:18789/healthz
docker compose -f D:\all-works\openclaw\docker-compose.yml logs --tail=200 openclaw-gateway
```

Expected:

- `healthz` returns HTTP 200 with an `ok`/`live` payload.
- Gateway logs do not show a startup blocker such as `world-writable path`.

- [ ] **Step 5: Commit any final validation-driven fixes**

```bash
git status --short
git add src/guard/safety-guard.ts src/runtime/policy-runtime.ts index.ts src/runtime/guard-policy-state.ts src/guard/policy/evidence-bundle.ts src/guard/policy/evidence-bundle-builder.ts test/policy-runtime.test.ts test/guard-policy-state.test.ts test/evidence-bundle-builder.test.ts test/safety-guard.test.ts test/plugin.test.ts
git commit -m "feat: strengthen guard policy with dual-track evidence evaluation"
```

Expected:

- If validation required no code changes after Task 6, `git status --short` is empty and there is nothing new to commit.
- If validation required fixes, the final commit contains only those validation-driven adjustments.
