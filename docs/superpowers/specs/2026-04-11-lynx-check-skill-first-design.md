# Lynx Check Skill-First Execution Design

## Summary

This design replaces the current plugin-driven `/lynx-check` execution path with a skill-first orchestration model.

The plugin will no longer directly run the Lynx check pipeline or hardcode the composite report body. Instead, the plugin will:

- recognize manual and scheduled `/lynx-check` triggers;
- persist a run intent for the current request;
- inject a strict hidden instruction that forces the model to execute the check through the existing `lynx-guardian-daily-lynx-check` skill in execution mode;
- remember the current or recent-active delivery target;
- provide a delivery fallback if the skill failed to send the final report message.

The `lynx-guardian-daily-lynx-check` skill will be upgraded from a scheduling-only skill into a dual-mode orchestrator:

- `Scheduler Mode`: manages `scheduledLynxCheck` config and native cron behavior;
- `Execution Mode`: performs the actual Lynx check run, combines the security audit and OpenClaw discovery capabilities, assembles the final report, attempts active delivery, and writes run results back for plugin fallback.

## Problem Statement

The current `codex/windcard-manual-active-send` style implementation is the wrong abstraction layer for manual `/lynx-check`.

Today the plugin directly:

- builds the Lynx composite report in code;
- decides report structure in code;
- tries to send the report message itself;
- falls back to `blockReason` with the full report body.

This has several problems:

- manual `/lynx-check` is tightly coupled to plugin code paths instead of a reusable execution contract;
- future check expansion requires repeated plugin changes instead of skill evolution;
- the model can still claim a message was sent without a reliable delivery status contract;
- the current report structure is effectively hardcoded in `manual-lynx-check.ts`, which prevents the skill from being the true execution surface;
- scheduled and manual runs do not share a clean execution protocol.

## Goals

- Unify manual and scheduled `/lynx-check` under one execution path.
- Make the existing `lynx-guardian-daily-lynx-check` skill the primary execution surface.
- Remove hardcoded composite report assembly from the plugin runtime path.
- Preserve recent-active delivery routing and sender execution plane fallback in the plugin.
- Reuse the existing `SX-security-audit` and `SX-openclaw-discovery` capabilities during check execution.
- Make delivery state explicit so the plugin can deterministically decide whether fallback sending is needed.

## Non-Goals

- Replacing the native `scheduledLynxCheck` cron sync mechanism.
- Removing current output interception hooks such as `before_message_write` or `tool_result_persist`.
- Reworking general safety-guard policy behavior.
- Introducing a second parallel Lynx execution skill.

## Current State

Current runtime behavior relevant to `/lynx-check`:

- `message_received` directly handles manual `/lynx-check`.
- `buildManualLynxCheckReport()` assembles a four-part composite report in plugin code.
- `before_agent_start` still contains `/lynx-check`-specific report injection behavior.
- `agent_end` already has an active-delivery fallback mechanism that can route to the current or recent-active target.
- `lynx-guardian-daily-lynx-check` currently describes scheduling strategy, but does not own execution.
- `SX-security-audit` and `SX-openclaw-discovery` already describe reusable audit/discovery behavior, but are not the primary execution contract for `/lynx-check`.

## Proposed Architecture

### 1. Plugin Responsibilities

The plugin becomes an orchestrator, not the executor.

The plugin is responsible for:

- detecting `/lynx-check` triggers from both manual and scheduled paths;
- creating a `LynxCheckRunIntent` record for each run;
- remembering route hints such as current-session and recent-active targets;
- injecting a strict hidden instruction that forces the model to use the upgraded skill execution mode;
- reading a `LynxCheckRunResult` during `agent_end`;
- performing fallback active send only if the skill did not send successfully.

The plugin must not:

- assemble the final composite report body for manual or scheduled `/lynx-check`;
- directly invoke the current `manual-lynx-check.ts` execution pipeline for the main flow;
- pretend a send happened without a result record confirming delivery success.

### 2. Skill Responsibilities

The existing `skills/lynx-guardian-daily-lynx-check/SKILL.md` becomes the single public Lynx execution skill.

It will expose two internal modes:

- `Scheduler Mode`
  - edits or explains `scheduledLynxCheck`;
  - keeps native cron management behavior unchanged.

- `Execution Mode`
  - reads the current run intent;
  - executes Lynx checks;
  - combines security audit and OpenClaw discovery outputs;
  - assembles the final composite report;
  - attempts active report delivery as a new message;
  - persists the run result for plugin fallback.

### 3. Capability Composition

The new execution mode should treat these existing capabilities as first-class building blocks:

- `SX-security-audit`
  - provides the security audit procedure and existing script-based audit capability;
  - contributes audit findings and summary sections to the final Lynx report.

- `SX-openclaw-discovery`
  - provides discovery semantics and output expectations for OpenClaw service detection;
  - contributes the OpenClaw discovery section and raw discovery appendix to the final report.

The final report remains a single `/lynx-check` composite report, but its content source moves from plugin hardcoding into skill orchestration.

## Run Lifecycle

### Step 1. Trigger Detection

Both of the following enter the same run lifecycle:

- manual `/lynx-check`;
- scheduled `/lynx-check`.

The plugin writes a new run intent with a unique `requestId`.

### Step 2. Intent Persistence

For each run, persist:

- `requestId`;
- `source` as `manual` or `scheduled`;
- `trigger` as `lynx_command` for manual runs or `scheduled_lynx_check` for scheduler-triggered runs;
- `preferredTargetKind` as `current` or `recent`;
- `sessionKey`;
- `routeHint`;
- `createdAt`;
- `status`.

Recommended file layout:

- `.openclaw/lynx/check-runs/<requestId>.intent.json`
- `.openclaw/lynx/check-runs/<requestId>.result.json`
- `.openclaw/lynx/check-runs/<requestId>.report.md`

### Step 3. Hidden Instruction Injection

`before_agent_start` injects a strict hidden directive that tells the model:

- this is a managed Lynx check run;
- it must use `lynx-guardian-daily-lynx-check` execution mode;
- it must combine the skill with `SX-security-audit` and `SX-openclaw-discovery`;
- it must attempt delivery of the final report as a new message;
- if delivery fails, it must write the result record instead of falsely claiming success;
- it must not state that the check is complete unless execution mode finished.

### Step 4. Skill Execution

Execution mode runs in three phases:

- `preflight`
  - load intent;
  - determine whether the run is manual or scheduled;
  - determine preferred delivery target.

- `checks`
  - run security audit capability;
  - run OpenClaw discovery capability;
  - preserve the current Lynx report sections for public exposure and skill integrity;
  - generate one composite report.

- `delivery`
  - try to send the report as a new message;
  - write a result record with send outcome.

### Step 5. Plugin Fallback

During `agent_end`, the plugin reads the run result:

- if `sendSucceeded = true`, do nothing;
- if `sendSucceeded = false` and `reportPath` exists, send the report through the sender execution plane;
- if the skill failed before producing a report, send a short failure notice instead of faking a complete report.

## Result Contract

`LynxCheckRunResult` should include:

- `requestId`;
- `status` as `not_started`, `running`, `completed`, or `failed`;
- `sendAttempted`;
- `sendSucceeded`;
- `transport`;
- `reportPath`;
- `errorMessage`;
- `completedAt`.

This is the contract boundary between skill execution and plugin fallback.

The plugin should only trust explicit run result state, not model prose.

## Delivery Rules

Delivery order:

1. skill attempts new-message delivery first;
2. plugin fallback sends only if skill delivery failed;
3. fallback prefers current-session target for manual runs and recent-active target for scheduled runs, while still honoring the sender execution plane.

The plugin continues to own:

- recent-active route memory;
- shared sender / resolved target delivery;
- current-session fallback rules;
- final send logging.

## Code Changes

### Code To Remove From Main Flow

- direct manual `/lynx-check` report construction in `index.ts`;
- direct use of `buildManualLynxCheckReport()` as the primary execution path;
- `/lynx-check`-specific hardcoded report injection in `before_agent_start`.

### Code To Keep

- trigger classification;
- scheduled cron sync;
- recent-active delivery memory;
- sender execution plane;
- `agent_end` fallback send;
- output interception hooks;
- supporting stores used by delivery and safety logic.

### Code To Introduce Or Expand

- explicit run intent store for `/lynx-check`;
- explicit run result store for `/lynx-check`;
- upgraded `lynx-guardian-daily-lynx-check` skill with execution mode;
- hidden prompt injection tailored to the new skill contract;
- plugin fallback logic that keys off run result state.

## Testing Strategy

Add or update tests for:

- manual `/lynx-check` creates intent and injects execution-mode prompt;
- scheduled `/lynx-check` creates intent and injects the same execution-mode prompt;
- skill result with `sendSucceeded = true` prevents plugin fallback send;
- skill result with `sendSucceeded = false` triggers plugin fallback send;
- plugin fallback still respects recent-active webchat and Feishu routing;
- missing result record produces a short failure message instead of a fake complete report;
- existing output interception behavior remains intact;
- legacy `manual-lynx-check.ts` no longer drives the primary runtime flow.

## Error Handling

- If intent creation fails, block the run with a short operational error.
- If execution mode fails before report generation, mark result `failed` and include `errorMessage`.
- If execution mode generates a report but fails delivery, mark `sendSucceeded = false` and let plugin fallback send.
- If plugin fallback also fails, preserve logs and keep the result record for diagnosis.

## Migration Notes

- `manual-lynx-check.ts` should be deprecated after the new skill-first execution path is stable.
- Existing discovery pending-file behavior should not remain the primary `/lynx-check` report path.
- The scheduling semantics of `scheduledLynxCheck` remain unchanged so user-facing cron behavior does not regress.

## Recommendation

Implement the migration in one focused change set:

1. introduce explicit run intent and run result records;
2. upgrade the skill to dual-mode behavior;
3. change plugin `/lynx-check` handling from direct execution to hidden prompt orchestration;
4. reuse existing sender execution plane only as fallback;
5. remove plugin-side hardcoded composite report assembly from the main runtime path.

This is the smallest change that fixes the abstraction problem without regressing recent-active routing, scheduled sync, or output interception.
