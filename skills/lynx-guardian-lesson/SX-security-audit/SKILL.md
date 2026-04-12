---
name: SX-security-audit
description: Use when a managed `/lynx-check` run or a direct audit request needs security audit findings that can be delivered standalone or merged into the final Lynx report.
---

# SX-security-audit

This capability owns the audit portion of Lynx Guardian checks.

## Responsibilities

- inspect security-relevant findings;
- summarize the findings clearly for chat delivery;
- support both standalone audit usage and managed `/lynx-check` precomputation.

## When used by `/lynx-check`

If the plugin-level managed `/lynx-check` flow uses this capability during precomputation or internal review:

1. return the audit findings only;
2. keep the output easy to merge into one composite report;
3. do not claim the final `/lynx-check` report has been sent;
4. let the managed plugin flow handle final assembly and delivery.

## Recommended Sections

- audit summary
- high-signal findings
- remediation notes when they materially help

## Coordination Notes

- `SX-openclaw-discovery` owns discovery execution and endpoint findings.
- the plugin-level managed `/lynx-check` flow owns report assembly, channel adaptation, and send-result recording.
