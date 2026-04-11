---
name: SX-security-audit
description: Use when a managed `/lynx-check` run or a direct audit request needs security audit findings that can be delivered standalone or merged into the final Lynx report.
---

# SX-security-audit

This capability owns the audit portion of Lynx Guardian checks.

## Responsibilities

- inspect security-relevant findings;
- summarize the findings clearly for chat delivery;
- support both standalone audit usage and orchestrated `/lynx-check` usage.

## When dispatched by the orchestrator

If `lynx-guardian-check-orchestrator` calls this skill during Execution Dispatch Mode:

1. return the audit findings only;
2. keep the output easy to merge into one composite report;
3. do not claim the final `/lynx-check` report has been sent;
4. let the orchestrator handle aggregation and delivery.

## Recommended Sections

- audit summary
- high-signal findings
- remediation notes when they materially help

## Coordination Notes

- `SX-openclaw-discovery` owns discovery execution and endpoint findings.
- `lynx-guardian-check-orchestrator` owns orchestration, report assembly, and send-result recording.
