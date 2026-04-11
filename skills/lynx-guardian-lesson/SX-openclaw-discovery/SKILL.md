---
name: SX-openclaw-discovery
description: Use when a managed `/lynx-check` run or a direct discovery request needs OpenClaw service detection, especially for the discovery section of the final Lynx report.
---

# SX-openclaw-discovery

This capability owns the OpenClaw discovery execution surface.

## Responsibilities

- Discover likely OpenClaw endpoints and gateway instances.
- Produce the discovery section used by `/lynx-check`.
- Own the execution-heavy `references/` and `scripts/` assets under this directory.

## Inputs

This skill may be used in two ways:

- standalone discovery requests;
- orchestrated `/lynx-check` dispatch from `lynx-guardian-daily-lynx-check`.

When dispatched by the orchestrator, keep the output focused on discovery facts so it can be merged into one report.

## Required Output

Return:

1. a short discovery summary;
2. confirmed or likely endpoints with host / port / scheme / confidence;
3. any raw appendix the orchestrator may embed or store.

## Asset Ownership

- `references/` contains the moved discovery references.
- `scripts/` contains the moved discovery helpers.
- The orchestrator should call into this capability instead of copying those assets elsewhere.

## Coordination Notes

- `SX-security-audit` covers audit findings; do not duplicate that work here.
- `lynx-guardian-daily-lynx-check` aggregates your output into the final composite report.
