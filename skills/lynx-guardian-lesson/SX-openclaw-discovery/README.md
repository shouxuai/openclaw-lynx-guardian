# SX-openclaw-discovery

This directory is the execution-heavy discovery capability used by Lynx Guardian.

## What lives here

- discovery-focused `references/`
- discovery-focused `scripts/`
- the capability contract consumed by the Lynx check orchestrator

## How it is used now

`lynx-guardian-daily-lynx-check` is responsible for scheduling and dispatch.

When a managed `/lynx-check` run starts, the orchestrator should:

1. call `SX-security-audit` for the audit section;
2. call `SX-openclaw-discovery` for the discovery section;
3. merge both outputs into one report;
4. attempt active delivery;
5. record `sendSucceeded` and related result fields for plugin fallback.

## Testing Notes

Preferred validation paths:

- local API: `http://127.0.0.1:18789/v1/chat/completions`
- OpenClaw TUI

The goal is to validate the real orchestrated `/lynx-check` path, not only isolated unit behavior.
