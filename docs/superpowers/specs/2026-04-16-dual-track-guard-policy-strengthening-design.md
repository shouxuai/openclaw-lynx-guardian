# Dual-Track Guard Policy Strengthening Design

## 1. Background

The current online guard path is still legacy-first:

- `guardInput`, `guardToolCall`, and `guardOutput` produce a legacy `RiskAssessment`
- the legacy assessment drives the main block / warn / deny flow
- `policy-runtime.ts` only bridges the legacy result into a policy-flavored decision

The new policy components already exist:

- evidence scoring
- attack graph progression
- artifact taint tracking
- policy engine risk resolution

But they are not the factual main entry path yet. In particular:

- `scoreEvidence()` is not driving online decisions
- `resolveRiskLevel()` is not the online risk resolver
- `advanceAttackGraph()` is not wired into tool or output handling
- `createArtifactTaintStore()` is not wired into runtime state

This creates a visible transitional state: the new architecture exists, but runtime behavior is still controlled by the legacy score-to-level-to-action chain.

## 2. Goal

Strengthen the online defense path without replacing the legacy guard contract yet.

The first strengthening phase should:

1. make `guardInput`, `guardToolCall`, and `guardOutput` produce an `evidence bundle` in parallel with the existing `RiskAssessment`
2. make the new bundle drive `scoreEvidence -> resolveRiskLevel -> decidePolicy`
3. combine legacy and new-policy judgments with a strict-only arbitration rule
4. wire `attack graph` and `artifact taint` only into `tool` and `output` paths for the first phase

## 3. Non-Goals

This phase does not:

- replace the legacy `RiskAssessment` contract
- remove the legacy weighted scoring logic
- make the new policy engine the sole online source of truth
- rewrite all `index.ts` enforcement branches from scratch
- connect attack graph or taint progression to the input path
- attempt a full architecture migration in one step

## 4. Key Decision

This design adopts option `A`:

- legacy chain and new policy chain both evaluate the same event
- final enforcement uses the stricter result
- the new chain may only raise severity, never lower it

Important clarification:

"Trust both chains" does not mean both chains independently emit runtime side effects.

If both chains are allowed to directly emit block prompts, workflow auth prompts, pending overrides, or delivery messages, the plugin will produce duplicated and potentially contradictory behavior. Therefore:

- both chains produce judgments
- one arbiter chooses the stricter judgment
- one effect layer emits the actual runtime consequence

This preserves the user-visible behavior model while still letting the new chain materially strengthen protection.

## 5. High-Level Architecture

For each guard entry:

1. legacy logic runs as it does today and produces `RiskAssessment`
2. new logic builds an `evidence bundle`
3. the bundle is scored by `scoreEvidence()`
4. risk is resolved by `resolveRiskLevel()`
5. final policy intent is resolved by `decidePolicy()`
6. an arbiter compares legacy and new-policy outcomes
7. the stricter outcome becomes the only emitted runtime action

### 5.1 Processing Layers

Layer 1: `Legacy Guard`

- preserves existing module detection
- preserves existing instant deny paths
- preserves existing score folding and anomaly adjustment
- preserves existing `RiskAssessment`

Layer 2: `Evidence Bundle Builder`

- converts the same event into structured evidence items
- records why each dimension increased
- attaches optional chain and taint context
- does not block by itself

Layer 3: `New Policy Evaluation`

- computes dimension heat from evidence items
- resolves risk level using bundle summary, chain stage, and taint context
- decides policy action kind

Layer 4: `Strict-Only Arbiter`

- maps the legacy assessment into a legacy policy kind
- compares legacy and new policy kinds
- picks the stricter one
- never allows the new path to lower severity

Layer 5: `Single Effect Router`

- emits block / deny / warn / confirm / workflow auth exactly once
- reuses existing runtime channels where possible
- avoids duplicated side effects

## 6. Evidence Bundle

### 6.1 Purpose

The evidence bundle is the new structured explanation package for one guard event.

It exists to answer:

- which dimensions increased
- which facts caused the increase
- whether the current event continues a chain
- whether artifacts created earlier are now being executed or exposed

### 6.2 Required Properties

The bundle should contain at least:

- event kind: `input`, `tool`, or `output`
- event summary: original text, tool name, or output excerpt
- matched legacy modules
- `EvidenceItemInput[]` for `scoreEvidence()`
- optional `chainProgress`
- optional taint reads and taint writes
- optional normalized resource descriptors
- session key and timing metadata

### 6.3 Compatibility Rule

The bundle is additive. It must not replace the existing `RiskAssessment` in this phase.

That means the guard API remains logically:

- legacy result: still required
- evidence bundle: new parallel output

The runtime can then consume both without breaking current call sites all at once.

## 7. Arbitration Model

### 7.1 Policy Kinds

The arbitration layer compares normalized policy kinds:

- `allow`
- `warn`
- `confirm`
- `workflow_auth`
- `block`
- `deny`

### 7.2 Severity Priority

The comparison order is:

`deny > block > workflow_auth > confirm > warn > allow`

`workflow_auth` is treated as stricter than `confirm`, because it demands bounded workflow authorization rather than a lighter one-shot confirmation.

### 7.3 Legacy Mapping

The legacy `RiskAssessment.action` is mapped into a policy kind:

- `deny -> deny`
- `block -> block`
- `warn -> warn`
- `log -> warn`
- `allow -> allow`

### 7.4 Arbitration Rule

The final policy kind is:

- the stricter of `legacyKind` and `newPolicyKind`

Additional rules:

- if the new policy evaluation throws or lacks required context, fall back to the legacy result
- if the new chain only ties the legacy result, preserve current behavior and messaging
- if the new chain is stricter, it may upgrade the final action but must not emit a parallel side effect path

## 8. Wiring Boundaries by Guard Entry

### 8.1 `guardInput`

`guardInput` participates in dual-track evaluation, but only at the evidence level.

For this phase:

- build evidence items from input facts
- score them in parallel
- do not advance attack graph
- do not read or write artifact taint

Rationale:

- input is important for explanation and intent evidence
- most concrete chain progression emerges during tool execution and output emission
- keeping input free of graph/taint state in phase 1 reduces false positives and integration churn

### 8.2 `guardToolCall`

`guardToolCall` is the first real chain-aware entry.

For this phase it should:

- build evidence items from tool name, parameters, detected modules, and resource classes
- classify the tool event into chain-relevant actions
- advance the session attack graph when appropriate
- mark artifact taint on suspicious writes
- read artifact taint on execute / send / upload style operations
- feed chain stage and taint-derived evidence into new policy evaluation

This is the main path for:

- sensitive read -> artifact write
- artifact write -> artifact execute
- artifact write or sensitive read -> external send

### 8.3 `guardOutput`

`guardOutput` is the second chain-aware entry.

For this phase it should:

- build evidence items from output leak, prompt leak, or high-risk advisory facts
- read current attack graph stage for the session
- read taint context when output reveals or references tainted content
- allow the new policy chain to escalate based on "prepared earlier, exposed now"

This path is especially important for:

- latent exfiltration that only becomes visible at output time
- secret disclosure that follows a suspicious tool chain
- assistant output that operationalizes tainted artifacts

## 9. Attack Graph Design for Phase 1

### 9.1 Scope

The existing attack graph stages are sufficient for the first strengthening phase:

- `idle`
- `sensitive_scope_entered`
- `artifact_prepared`
- `execution_ready`
- `exfiltration_ready`

### 9.2 Session Model

Attack graph state should be session-scoped.

State key:

- `sessionKey`

Lifecycle:

- reuse the same practical TTL assumptions as other guard session state
- allow silent expiration
- do not persist beyond the in-memory runtime for this phase

### 9.3 Tool Path Progression Rules

The first implementation should only cover the highest-value transitions:

- sensitive file read or credential-like access -> `sensitive_scope_entered`
- suspicious artifact write -> `artifact_prepared`
- tainted artifact execution or pipe-to-shell execution -> `execution_ready`
- obvious external send after suspicious preparation -> `exfiltration_ready`

The purpose of this first wiring is not perfect graph modeling. The purpose is to reliably capture the concrete multi-step chains that the legacy score folding currently flattens away.

## 10. Artifact Taint Design for Phase 1

### 10.1 Scope

Artifact taint should also be session-scoped for the first phase.

It should track suspicious artifacts created or touched during the current guard session without introducing disk-backed persistence.

### 10.2 Initial Taint Labels

The first version should keep the label set intentionally small:

- `sensitive_source`
- `credential_material`
- `session_artifact`
- `guard_bypass_script`

The exact label set can be adjusted during implementation, but the principle is:

- prefer a few stable labels
- avoid speculative taxonomies
- preserve enough information to explain why a later execution or output is treated more strictly

### 10.3 Taint Operations

On the tool path:

- suspicious writes call `mark(path, labels, ...)`
- suspicious executions or external-send operations call `read(path, ...)`
- explicit overwrite or trusted replacement may call `clear(path)` only when the implementation has strong confidence

On the output path:

- output-side checks may consult taint context when the output references or reveals previously tainted content

### 10.4 Canonicalization Rule

Taint lookups must use canonicalized paths before read or write.

Without canonicalization, the same artifact can appear under different path spellings and silently break taint propagation.

## 11. New Policy Evaluation Rules

### 11.1 Inputs

The new policy chain consumes:

- evidence bundle items
- `scoreEvidence()` result
- optional `chainProgress`
- optional taint-derived evidence
- existing context flags such as workflow candidate or audit whitelist when available

### 11.2 Risk Resolution

`scoreEvidence()` remains responsible for:

- dimension scores
- summary heat
- compatibility score for legacy-style summaries

`resolveRiskLevel()` becomes responsible for:

- base risk from summary heat
- promotion from chain stage
- promotion from taint state
- promotion from strong `auth + harm` combinations

### 11.3 Strict-Only Guarantee

The new policy chain may:

- raise legacy `allow` to `warn`, `confirm`, `workflow_auth`, `block`, or `deny`
- raise legacy `warn` to `confirm`, `workflow_auth`, `block`, or `deny`
- raise legacy `block` to `deny`

It may not:

- reduce `deny` to `block`
- reduce `block` to `warn`
- suppress a legacy warning
- suppress a legacy override requirement

## 12. Runtime Integration Strategy

### 12.1 Preserve Existing Guard Contracts

Do not replace the current `GuardDecision` return contract in this phase.

Instead, introduce an internal dual-track evaluation shape that contains:

- legacy decision
- evidence bundle
- new policy evaluation
- final arbitrated policy kind

This shape may be introduced either:

- directly as an optional extension on `GuardDecision`
- or through a small helper used immediately after each guard call

The preferred direction is the smaller change set that minimizes churn in `index.ts`.

### 12.2 Single Runtime Action Source

Even after dual-track evaluation, the runtime must still emit exactly one action:

- one block reason
- one warn message
- one confirm or workflow-auth prompt
- one audit record lineage

This means the arbiter result becomes the source for final emission, while legacy and new-policy evaluations remain diagnostic inputs behind it.

### 12.3 Existing Approval and Override Flows

This phase should reuse existing approval infrastructure whenever possible.

The new chain is allowed to escalate the final decision into:

- `confirm`
- `workflow_auth`

But it should do so by routing through the existing confirmation / pending override / workflow authorization machinery rather than introducing a parallel store model in phase 1.

## 13. Observability

The strengthened path should improve explanation, not reduce it.

The runtime should retain enough information to inspect:

- legacy modules
- new evidence items
- summary heat
- chain stage
- taint labels involved in escalation
- legacy policy kind
- new policy kind
- final arbitrated policy kind

This information does not need to be fully exposed to end users in phase 1, but it should be available for logs, records, and targeted diagnostics.

## 14. Testing Strategy

The implementation plan should focus on targeted tests, not broad repo-wide Vitest success.

High-value test groups:

1. evidence bundle generation
   - input path produces bundle without chain / taint side effects
   - tool path produces bundle with chain-relevant evidence
   - output path produces bundle with leak and taint evidence

2. attack graph progression
   - sensitive read -> artifact prepared
   - artifact prepared -> execution ready
   - artifact prepared or execution ready -> exfiltration ready

3. taint propagation
   - suspicious write marks taint
   - later execution reads taint
   - canonicalized equivalent paths hit the same record

4. arbitration
   - legacy stricter than new => legacy wins
   - new stricter than legacy => new wins
   - new failure => legacy fallback

5. regression around existing flows
   - no behavior change when new chain ties or stays lower
   - tool and output chains can escalate previously flattened attack sequences

## 15. Rollout Constraints

This is a strengthening layer, not a migration completion.

Therefore the rollout rule is:

- preserve old behavior unless the new chain has explicit stronger evidence

That rule should guide every implementation decision in this phase.

If a proposed change creates ambiguity between the old and new chains, prefer:

- smaller scope
- tool/output-only chain wiring
- legacy fallback on uncertainty

## 16. Result

After this phase, the system should still be recognizably legacy-compatible, but no longer legacy-only.

The desired end state for this phase is:

- input, tool, and output all produce `evidence bundle`
- tool and output additionally update and consume attack-chain context
- new policy evaluation runs online for every relevant guard event
- final runtime action is the stricter result of legacy and new-policy judgments
- no duplicate enforcement channels are introduced

This gives the runtime a real strengthening step now, while keeping the future full migration path open.
