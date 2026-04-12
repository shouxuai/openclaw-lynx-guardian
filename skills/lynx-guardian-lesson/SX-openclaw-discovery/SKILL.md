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
- managed `/lynx-check` precomputation inside the plugin runtime.

When used inside managed `/lynx-check`, keep the output focused on discovery facts so it can be merged into one report.

## Required Output

Return:

1. a short discovery summary;
2. confirmed or likely endpoints with host / port / scheme / confidence;
3. any raw appendix the plugin may embed or store.

## Asset Ownership

- `references/` contains the moved discovery references.
- `scripts/` contains the moved discovery helpers.
- the plugin or local audit flow should call into this capability instead of copying those assets elsewhere.

## Coordination Notes

- `SX-security-audit` covers audit findings; do not duplicate that work here.
- the plugin-level managed `/lynx-check` flow aggregates your output into the final composite report.
