---
name: lynx-guardian-check-orchestrator
description: Use when Lynx Guardian should orchestrate a managed `/lynx-check` run, including scheduling, dispatch, report assembly, and active delivery.
---

# Lynx Guardian Check Orchestrator

`lynx-guardian-check-orchestrator` is the primary orchestrator entrypoint for managed Lynx Guardian `/lynx-check` runs.

It has two internal modes:

- `Scheduler Mode`: maintain the native `scheduledLynxCheck` cron configuration.
- `Execution Dispatch Mode`: execute one managed `/lynx-check` run using the orchestrator contract.

## Scheduler Mode

Prefer the plugin config instead of hand-maintained jobs.

```json
{
  "scheduledLynxCheck": {
    "enabled": true,
    "cron": "37 8 * * *",
    "timezone": "Asia/Shanghai",
    "jobName": "Lynx Guardian Daily Check",
    "announce": true,
    "deliveryMode": "recent-active"
  }
}
```

Rules:

1. Keep the managed job message as the exact text `/lynx-check`.
2. Use `deliveryMode: "recent-active"` when the report should follow the most recently active chat session.
3. Use heartbeat only when the user explicitly wants approximate cadence instead of exact cron timing.

## Execution Dispatch Mode

When the plugin injects a managed `/lynx-check` run, treat this skill as the orchestrator entrypoint.

### Run Contract

- Read `.openclaw/lynx/check-runs/<requestId>.intent.json`.
- Write `.openclaw/lynx/check-runs/<requestId>.report.md`.
- Write `.openclaw/lynx/check-runs/<requestId>.result.json`.

The result file must include:

- `requestId`
- `status`
- `sendAttempted`
- `sendSucceeded`
- `transport`
- `reportPath`
- `errorMessage`
- `completedAtMs`

### Execution Steps

1. Read the current `requestId`, `source`, and `preferredTargetKind`.
2. Dispatch the audit portion to `SX-security-audit`.
3. Dispatch the discovery portion to `SX-openclaw-discovery`.
4. Assemble one composite markdown report.
5. Save that report to `.openclaw/lynx/check-runs/<requestId>.report.md`.
6. Attempt to send the report as a new message.
7. Record the send outcome in `.result.json`.

### Delivery Rules

- Manual runs prefer the current session.
- Scheduled runs prefer the recent-active remembered session.
- Use the channel's shared message sender / resolved target semantics when available.
- If sending fails, do not pretend it succeeded.
- If sending fails after the report is ready, keep the report on disk so the plugin can fallback-deliver it.

### Output Shape

The composite report should keep the public `/lynx-check` structure readable in chat:

1. Executive summary
2. Security audit findings from `SX-security-audit`
3. OpenClaw discovery findings from `SX-openclaw-discovery`
4. A short appendix or raw summary when needed for debugging

## Capability Boundaries

- `SX-security-audit` owns the audit procedure and security findings.
- `SX-openclaw-discovery` owns the execution-heavy `references/` and `scripts/` assets for discovery.
- This orchestrator owns scheduling, dispatch, aggregation, and delivery coordination only.

## Avoid

- Do not hardcode the `/lynx-check` composite report inside the plugin.
- Do not claim delivery success without a real send result.
- Do not duplicate discovery scripts back into this skill.
- Do not bypass `SX-security-audit` or `SX-openclaw-discovery` when a managed orchestrator run is active.
