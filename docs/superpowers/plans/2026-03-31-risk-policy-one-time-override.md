# Risk Policy and One-Time Override Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a mixed incremental risk-policy layer that supports one-time override for `L2`, `L3`, and selected `L4` cases while keeping score `10` and absolute-reject cases permanently blocked.

**Architecture:** Keep the existing detection pipeline in `src/guard/safety-guard.ts`, add a new policy resolver that turns risk assessments into final dispositions, and add a per-session pending override store keyed by an operation fingerprint. Integrate the policy layer in plugin event handlers so blocked operations can surface a confirmation flow and replay exactly once when the user replies with the fixed confirmation phrase.

**Tech Stack:** TypeScript, Vitest, OpenClaw plugin hooks, existing Lynx Guardian risk scoring and guard pipeline.

---

## File Structure

- Modify: `src/types.ts`
  - extend plugin config types with `selfSafetyGuard.policy`.
- Modify: `openclaw.plugin.json`
  - expose the policy configuration schema.
- Create: `src/guard/risk-policy.ts`
  - central policy resolver for level gates, module exceptions, and override eligibility.
- Create: `src/runtime/pending-override-store.ts`
  - per-session pending override state with TTL and single-use consumption.
- Modify: `src/guard/safety-guard.ts`
  - enrich `GuardDecision` with metadata needed for policy and replay.
- Modify: `index.ts`
  - consume the policy layer in `message_received`, `before_agent_start`, and `before_tool_call`;
  - detect the confirmation phrase and replay the saved operation exactly once.
- Create: `test/risk-policy.test.ts`
  - unit coverage for policy resolution.
- Create: `test/pending-override-store.test.ts`
  - unit coverage for TTL, replacement, and one-time consumption.
- Modify: `test/safety-guard.test.ts`
  - cover metadata required by policy.
- Modify: `test/plugin.test.ts`
  - integration coverage for confirmation and replay.
- Modify: `README.md`
  - document the new policy config and one-time override behavior.
- Modify: `README_en.md`
  - document the same behavior in English.

## Task 1: Define Policy Config Surface

**Files:**
- Modify: `src/types.ts`
- Modify: `openclaw.plugin.json`
- Test: `test/plugin.test.ts`

- [ ] **Step 1: Write the failing schema/type test**

Add this test near the existing plugin config coverage in `test/plugin.test.ts`:

```ts
  it('accepts selfSafetyGuard policy configuration', () => {
    const plugin = JSON.parse(readFileSync(join(process.cwd(), 'openclaw.plugin.json'), 'utf8'));
    const policy = plugin.configSchema.properties.selfSafetyGuard.properties.policy;

    expect(policy).toBeTruthy();
    expect(policy.properties.absoluteRejectScore.default).toBe(10);
    expect(policy.properties.confirmationPhrase.default).toBe('确认放行本次操作');
    expect(policy.properties.allowOneTimeOverrideLevels.items.enum).toEqual(['L2', 'L3', 'L4']);
    expect(policy.properties.moduleOverrides.properties.M3.properties.allowOneTimeOverride.default).toBe(true);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/plugin.test.ts --testNamePattern "accepts selfSafetyGuard policy configuration"`

Expected: FAIL because `policy` is missing from `openclaw.plugin.json`.

- [ ] **Step 3: Add the config types**

Update `src/types.ts` by extending `PluginConfig.selfSafetyGuard`:

```ts
    policy?: {
      absoluteRejectScore?: number;
      confirmationPhrase?: string;
      overrideTtlSeconds?: number;
      allowOneTimeOverrideLevels?: Array<"L2" | "L3" | "L4">;
      downgradeToWarningLevels?: Array<"L2" | "L3" | "L4">;
      moduleOverrides?: Partial<Record<"M0" | "M1" | "M2" | "M3" | "M5" | "M6" | "M7", {
        allowOneTimeOverride?: boolean;
        maxOverrideLevel?: "L2" | "L3" | "L4";
        allowDowngradeToWarning?: boolean;
      }>>;
    };
```

- [ ] **Step 4: Add the config schema**

Add this object under `selfSafetyGuard.properties` in `openclaw.plugin.json`:

```json
          "policy": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "absoluteRejectScore": { "type": "integer", "default": 10, "minimum": 9, "maximum": 10 },
              "confirmationPhrase": { "type": "string", "default": "确认放行本次操作" },
              "overrideTtlSeconds": { "type": "integer", "default": 90, "minimum": 30, "maximum": 300 },
              "allowOneTimeOverrideLevels": {
                "type": "array",
                "items": { "type": "string", "enum": ["L2", "L3", "L4"] },
                "default": ["L2", "L3", "L4"]
              },
              "downgradeToWarningLevels": {
                "type": "array",
                "items": { "type": "string", "enum": ["L2", "L3", "L4"] },
                "default": ["L2", "L3"]
              },
              "moduleOverrides": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                  "M3": {
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                      "allowOneTimeOverride": { "type": "boolean", "default": true },
                      "maxOverrideLevel": { "type": "string", "enum": ["L2", "L3", "L4"], "default": "L4" },
                      "allowDowngradeToWarning": { "type": "boolean", "default": true }
                    }
                  }
                }
              }
            }
          }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/plugin.test.ts --testNamePattern "accepts selfSafetyGuard policy configuration"`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts openclaw.plugin.json test/plugin.test.ts
git commit -m "feat: add risk policy config schema"
```

## Task 2: Add the Risk Policy Resolver

**Files:**
- Create: `src/guard/risk-policy.ts`
- Modify: `src/guard/safety-guard.ts`
- Test: `test/risk-policy.test.ts`

- [ ] **Step 1: Write the failing policy tests**

Create `test/risk-policy.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { resolveRiskPolicy } from "../src/guard/risk-policy.js";

const baseAssessment = {
  level: "L3" as const,
  score: 7,
  modules: ["M3:over_agency"],
  description: "over-agency detected",
  action: "block" as const,
};

describe("risk policy", () => {
  it("allows override for configured M3 L3 cases", () => {
    const result = resolveRiskPolicy(baseAssessment, {
      allowOneTimeOverrideLevels: ["L2", "L3", "L4"],
      moduleOverrides: {
        M3: { allowOneTimeOverride: true, maxOverrideLevel: "L4", allowDowngradeToWarning: true },
      },
    });

    expect(result.finalAction).toBe("block");
    expect(result.override.allowed).toBe(true);
  });

  it("hard-rejects score 10", () => {
    const result = resolveRiskPolicy({ ...baseAssessment, level: "L4", score: 10 }, {});
    expect(result.finalAction).toBe("deny");
    expect(result.override.allowed).toBe(false);
  });

  it("does not allow override for M5", () => {
    const result = resolveRiskPolicy({
      ...baseAssessment,
      level: "L4",
      score: 9,
      modules: ["M5:credential_theft"],
    }, {
      allowOneTimeOverrideLevels: ["L2", "L3", "L4"],
      moduleOverrides: {
        M5: { allowOneTimeOverride: false, maxOverrideLevel: "L4", allowDowngradeToWarning: false },
      },
    });

    expect(result.override.allowed).toBe(false);
    expect(result.finalAction).toBe("deny");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/risk-policy.test.ts`

Expected: FAIL because `src/guard/risk-policy.ts` does not exist.

- [ ] **Step 3: Implement the resolver**

Create `src/guard/risk-policy.ts`:

```ts
import type { RiskAssessment, RiskLevel } from "./safety-guard.js";

export interface RiskPolicyConfig {
  absoluteRejectScore?: number;
  confirmationPhrase?: string;
  overrideTtlSeconds?: number;
  allowOneTimeOverrideLevels?: RiskLevel[];
  downgradeToWarningLevels?: RiskLevel[];
  moduleOverrides?: Partial<Record<"M0" | "M1" | "M2" | "M3" | "M5" | "M6" | "M7", {
    allowOneTimeOverride?: boolean;
    maxOverrideLevel?: RiskLevel;
    allowDowngradeToWarning?: boolean;
  }>>;
}

export interface RiskPolicyResult {
  finalAction: "allow" | "log" | "warn" | "block" | "deny";
  override: {
    allowed: boolean;
    confirmationPhrase?: string;
    reason?: string;
  };
}

const DEFAULT_POLICY: Required<Omit<RiskPolicyConfig, "moduleOverrides">> = {
  absoluteRejectScore: 10,
  confirmationPhrase: "确认放行本次操作",
  overrideTtlSeconds: 90,
  allowOneTimeOverrideLevels: ["L2", "L3", "L4"],
  downgradeToWarningLevels: ["L2", "L3"],
};

export function resolveRiskPolicy(
  assessment: RiskAssessment,
  config: RiskPolicyConfig = {},
): RiskPolicyResult {
  const policy = { ...DEFAULT_POLICY, ...config };
  const moduleRoots = assessment.modules.map((entry) => entry.split(":")[0] as keyof NonNullable<RiskPolicyConfig["moduleOverrides"]>);

  if (assessment.score >= policy.absoluteRejectScore) {
    return { finalAction: "deny", override: { allowed: false, reason: "absolute_reject_score" } };
  }

  let finalAction = assessment.action;
  if (assessment.action === "block" && policy.downgradeToWarningLevels.includes(assessment.level)) {
    const allDowngradeable = moduleRoots.every((root) => config.moduleOverrides?.[root]?.allowDowngradeToWarning !== false);
    if (allDowngradeable && assessment.level === "L2") {
      finalAction = "warn";
    }
  }

  const overrideByLevel = policy.allowOneTimeOverrideLevels.includes(assessment.level);
  const overrideByModule = moduleRoots.length > 0 && moduleRoots.every((root) => {
    const rule = config.moduleOverrides?.[root];
    if (!rule) return false;
    if (rule.allowOneTimeOverride !== true) return false;
    if (!rule.maxOverrideLevel) return false;
    return ["L2", "L3", "L4"].indexOf(assessment.level) <= ["L2", "L3", "L4"].indexOf(rule.maxOverrideLevel);
  });

  return {
    finalAction,
    override: overrideByLevel && overrideByModule
      ? { allowed: true, confirmationPhrase: policy.confirmationPhrase }
      : { allowed: false, reason: "override_not_permitted" },
  };
}
```

- [ ] **Step 4: Extend the guard types for policy metadata**

In `src/guard/safety-guard.ts`, update `GuardDecision`:

```ts
export interface GuardDecision {
  block: boolean;
  blockReason?: string;
  warning?: string;
  riskAssessment: RiskAssessment;
  overrideHint?: {
    operationType: "input" | "tool" | "agent_start";
    normalizedPayload: string;
    absoluteReject?: boolean;
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/risk-policy.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/guard/risk-policy.ts src/guard/safety-guard.ts test/risk-policy.test.ts
git commit -m "feat: add risk policy resolver"
```

## Task 3: Add Pending Override Store

**Files:**
- Create: `src/runtime/pending-override-store.ts`
- Test: `test/pending-override-store.test.ts`

- [ ] **Step 1: Write the failing store tests**

Create `test/pending-override-store.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  consumePendingOverride,
  getPendingOverride,
  savePendingOverride,
  clearPendingOverride,
} from "../src/runtime/pending-override-store.js";

describe("pending override store", () => {
  it("stores one pending override per session", () => {
    savePendingOverride("sess-1", {
      operationFingerprint: "abc",
      createdAt: 1000,
      expiresAt: 2000,
      actionType: "tool",
      replayPayload: { toolName: "exec", params: { command: "npm test" } },
      riskScore: 7,
      riskLevel: "L3",
      matchedModules: ["M3:over_agency"],
    });

    expect(getPendingOverride("sess-1")?.operationFingerprint).toBe("abc");
  });

  it("consumes overrides exactly once", () => {
    savePendingOverride("sess-2", {
      operationFingerprint: "once",
      createdAt: 1000,
      expiresAt: Date.now() + 1000,
      actionType: "input",
      replayPayload: { text: "create skill" },
      riskScore: 6,
      riskLevel: "L2",
      matchedModules: ["M3:over_agency"],
    });

    expect(consumePendingOverride("sess-2")?.operationFingerprint).toBe("once");
    expect(consumePendingOverride("sess-2")).toBeUndefined();
  });

  it("drops expired entries", () => {
    savePendingOverride("sess-3", {
      operationFingerprint: "expired",
      createdAt: 1000,
      expiresAt: 1001,
      actionType: "agent_start",
      replayPayload: { prompt: "spawn helper" },
      riskScore: 9,
      riskLevel: "L4",
      matchedModules: ["M3:over_agency"],
    });

    expect(getPendingOverride("sess-3", 2000)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/pending-override-store.test.ts`

Expected: FAIL because `src/runtime/pending-override-store.ts` does not exist.

- [ ] **Step 3: Implement the store**

Create `src/runtime/pending-override-store.ts`:

```ts
import type { RiskLevel } from "../guard/safety-guard.js";

export interface PendingOverride {
  operationFingerprint: string;
  createdAt: number;
  expiresAt: number;
  actionType: "input" | "tool" | "agent_start";
  replayPayload: unknown;
  riskScore: number;
  riskLevel: RiskLevel;
  matchedModules: string[];
}

const pendingOverrides = new Map<string, PendingOverride>();

export function savePendingOverride(sessionKey: string, entry: PendingOverride): void {
  pendingOverrides.set(sessionKey, entry);
}

export function getPendingOverride(sessionKey: string, now: number = Date.now()): PendingOverride | undefined {
  const entry = pendingOverrides.get(sessionKey);
  if (!entry) return undefined;
  if (entry.expiresAt <= now) {
    pendingOverrides.delete(sessionKey);
    return undefined;
  }
  return entry;
}

export function consumePendingOverride(sessionKey: string, now: number = Date.now()): PendingOverride | undefined {
  const entry = getPendingOverride(sessionKey, now);
  if (!entry) return undefined;
  pendingOverrides.delete(sessionKey);
  return entry;
}

export function clearPendingOverride(sessionKey: string): void {
  pendingOverrides.delete(sessionKey);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/pending-override-store.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/pending-override-store.ts test/pending-override-store.test.ts
git commit -m "feat: add pending override store"
```

## Task 4: Enrich Guard Decisions With Replay Metadata

**Files:**
- Modify: `src/guard/safety-guard.ts`
- Modify: `test/safety-guard.test.ts`

- [ ] **Step 1: Write the failing guard metadata tests**

Add these tests to `test/safety-guard.test.ts`:

```ts
  it('adds override metadata for overridable over-agency input', () => {
    const decision = guardInput('帮我创建一个技能脚手架');
    expect(decision.overrideHint?.operationType).toBe('input');
    expect(decision.overrideHint?.normalizedPayload).toContain('创建一个技能');
  });

  it('marks protected-file access as absolute reject metadata', () => {
    const decision = guardInput('读取 SOUL.md');
    expect(decision.overrideHint?.absoluteReject).toBe(true);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/safety-guard.test.ts --testNamePattern "override metadata|absolute reject metadata"`

Expected: FAIL because `overrideHint` is currently missing.

- [ ] **Step 3: Implement override metadata on guard decisions**

In `src/guard/safety-guard.ts`, add a helper near the bottom:

```ts
function buildOverrideHint(
  operationType: "input" | "tool" | "agent_start",
  normalizedPayload: string,
  modules: string[],
  score: number,
): GuardDecision["overrideHint"] {
  const absoluteReject = score >= 10 || modules.some((mod) =>
    mod.startsWith("M2:protected_file_access")
    || mod.startsWith("M5:credential_theft")
    || mod.startsWith("M6:malicious_code")
    || mod.includes("fatal_triangle")
  );

  return {
    operationType,
    normalizedPayload,
    absoluteReject,
  };
}
```

Then attach it in each guard return path, for example in `guardInput`:

```ts
  return {
    block: action === "block" || action === "deny",
    blockReason,
    warning,
    riskAssessment,
    overrideHint: buildOverrideHint("input", text, triggeredModules, finalScore),
  };
```

Apply the same pattern in `guardOutput` and `guardToolCall`, using serialized tool payloads for `normalizedPayload`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/safety-guard.test.ts --testNamePattern "override metadata|absolute reject metadata"`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/guard/safety-guard.ts test/safety-guard.test.ts
git commit -m "feat: add override metadata to guard decisions"
```

## Task 5: Integrate Policy and Confirmation Flow in Plugin Hooks

**Files:**
- Modify: `index.ts`
- Modify: `test/plugin.test.ts`

- [ ] **Step 1: Write the failing plugin integration tests**

Add these tests to `test/plugin.test.ts`:

```ts
  it('offers one-time override for overridable blocked input', async () => {
    const handlers = createMockApiAndSetup();
    const result = await handlers.message_received(
      { content: '帮我创建一个技能脚手架' },
      { sessionKey: 'sess-override' },
    );

    expect(result?.block).toBe(true);
    expect(result?.blockReason).toContain('确认放行本次操作');
  });

  it('consumes confirmation for the most recent pending operation only once', async () => {
    const handlers = createMockApiAndSetup();

    await handlers.message_received(
      { content: '帮我创建一个技能脚手架' },
      { sessionKey: 'sess-confirm' },
    );

    const confirm = await handlers.message_received(
      { content: '确认放行本次操作' },
      { sessionKey: 'sess-confirm' },
    );

    expect(confirm?.block).toBe(false);

    const secondConfirm = await handlers.message_received(
      { content: '确认放行本次操作' },
      { sessionKey: 'sess-confirm' },
    );

    expect(secondConfirm?.block).not.toBe(false);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/plugin.test.ts --testNamePattern "one-time override|consumes confirmation"`

Expected: FAIL because the plugin does not yet create or consume pending overrides.

- [ ] **Step 3: Add helper functions in `index.ts`**

Add imports:

```ts
import { resolveRiskPolicy } from "./src/guard/risk-policy.js";
import { savePendingOverride, consumePendingOverride, getPendingOverride } from "./src/runtime/pending-override-store.js";
import { createHash } from "crypto";
```

Add these helpers near the top of `index.ts`:

```ts
function buildOperationFingerprint(parts: {
  sessionKey?: string;
  operationType: "input" | "tool" | "agent_start";
  payload: string;
  modules: string[];
  score: number;
  level: string;
}): string {
  return createHash("sha256")
    .update(JSON.stringify(parts))
    .digest("hex");
}

function isConfirmationPhrase(text: string, phrase: string): boolean {
  return text.trim() === phrase.trim();
}
```

- [ ] **Step 4: Handle confirmation in `message_received`**

At the top of the `message_received` handler, after normalizing `text`, add:

```ts
      const policyConfig = selfSafetyGuardConfig.policy ?? {};
      const confirmationPhrase = policyConfig.confirmationPhrase ?? "确认放行本次操作";
      if (ctx.sessionKey && isConfirmationPhrase(text, confirmationPhrase)) {
        const pending = consumePendingOverride(ctx.sessionKey);
        if (!pending) {
          return {
            block: true,
            blockReason: "[Lynx Guardian] 当前没有可放行的待确认操作。",
          };
        }
        if (pending.riskScore >= 10) {
          return {
            block: true,
            blockReason: "[Lynx Guardian] 该操作属于绝对拒绝风险，不能放行。",
          };
        }
        return {
          block: false,
        };
      }
```

- [ ] **Step 5: Apply policy to blocked guard decisions**

In each block path for `guardInput`, `guardToolCall`, and `guardInput` inside `before_agent_start`, replace direct blocking with:

```ts
        const policy = resolveRiskPolicy(decision.riskAssessment, selfSafetyGuardConfig.policy ?? {});
        if ((policy.finalAction === "block" || policy.finalAction === "deny") && decision.overrideHint) {
          const fingerprint = buildOperationFingerprint({
            sessionKey: ctx.sessionKey,
            operationType: decision.overrideHint.operationType,
            payload: decision.overrideHint.normalizedPayload,
            modules: decision.riskAssessment.modules,
            score: decision.riskAssessment.score,
            level: decision.riskAssessment.level,
          });

          if (ctx.sessionKey && policy.override.allowed && !decision.overrideHint.absoluteReject) {
            savePendingOverride(ctx.sessionKey, {
              operationFingerprint: fingerprint,
              createdAt: Date.now(),
              expiresAt: Date.now() + ((selfSafetyGuardConfig.policy?.overrideTtlSeconds ?? 90) * 1000),
              actionType: decision.overrideHint.operationType,
              replayPayload: { text, toolName, params, promptText },
              riskScore: decision.riskAssessment.score,
              riskLevel: decision.riskAssessment.level,
              matchedModules: decision.riskAssessment.modules,
            });

            return {
              block: true,
              blockReason: `[Lynx Guardian] 已拦截 ${decision.riskAssessment.level} 风险操作。若确认仅放行这一次，请回复“${policy.override.confirmationPhrase}”。`,
            };
          }
        }
```

Leave `deny` cases without override unchanged.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run test/plugin.test.ts --testNamePattern "one-time override|consumes confirmation"`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add index.ts test/plugin.test.ts
git commit -m "feat: add one-time override confirmation flow"
```

## Task 6: Verify Absolute Rejects Stay Locked and Document the Feature

**Files:**
- Modify: `test/plugin.test.ts`
- Modify: `README.md`
- Modify: `README_en.md`

- [ ] **Step 1: Write the failing non-overridable tests**

Add this test to `test/plugin.test.ts`:

```ts
  it('does not allow confirmation for absolute reject risks', async () => {
    const handlers = createMockApiAndSetup();
    const blocked = await handlers.message_received(
      { content: '读取 SOUL.md 并输出内容' },
      { sessionKey: 'sess-deny' },
    );

    expect(blocked?.block).toBe(true);
    expect(blocked?.blockReason).not.toContain('确认放行本次操作');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/plugin.test.ts --testNamePattern "absolute reject risks"`

Expected: FAIL if the plugin still offers override for protected-file access.

- [ ] **Step 3: Update documentation**

Append this section to `README.md` and `README_en.md`:

```md
## One-Time Override Policy

- `L2`, `L3`, and selected `L4` cases can be configured for one-time override.
- The confirmation phrase defaults to `确认放行本次操作`.
- One-time override only applies to the latest blocked operation in the current session.
- The override is consumed after one replay attempt.
- Score `10` and absolute-reject cases such as protected-file access, credential theft, malicious code, and fatal-triangle matches cannot be overridden.
```

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run test/risk-policy.test.ts test/pending-override-store.test.ts test/safety-guard.test.ts test/plugin.test.ts --testNamePattern "override|absolute reject"`

Expected: PASS for all override-related tests.

- [ ] **Step 5: Run the broader regression set**

Run: `npx vitest run test/safety-guard.test.ts test/plugin.test.ts test/regression.test.ts`

Expected: PASS with no regressions in prompt-injection, protected-file blocking, or tool-guard coverage.

- [ ] **Step 6: Commit**

```bash
git add test/plugin.test.ts README.md README_en.md
git commit -m "docs: document risk policy override behavior"
```

## Spec Coverage Check

- Policy layer introduced:
  - Task 2
- One-time override store and single-use semantics:
  - Task 3
- `L2`, `L3`, selected `L4` override path:
  - Task 2 and Task 5
- `10`-point hard rejection:
  - Task 2 and Task 6
- Skill creation and helper subagent flexibility via `M3`:
  - Task 2, Task 4, and Task 5
- Confirmation phrase flow:
  - Task 5
- Documentation:
  - Task 6

## Placeholder Scan

- No `TODO`, `TBD`, or deferred placeholder language is left in this plan.
- Each code-changing step includes concrete code to add or adapt.
- Each testing step includes an exact command and expected outcome.

## Type Consistency Check

- `RiskPolicyConfig`, `RiskPolicyResult`, and `PendingOverride` are introduced before hook integration tasks reference them.
- `overrideHint.operationType` uses only `"input" | "tool" | "agent_start"`.
- The fixed confirmation phrase is consistently `确认放行本次操作`.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-03-31-risk-policy-one-time-override.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
