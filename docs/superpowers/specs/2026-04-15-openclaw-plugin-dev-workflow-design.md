# OpenClaw Plugin Dev Workflow Design

**Date:** 2026-04-15

## Goal

Make OpenClaw plugin development rules explicit for future agents:

- they may read `D:\all-works\openclaw` for reference
- they may modify code only inside `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian`
- they must not claim behavior changed until they verify through a real OpenClaw path
- acceptable runtime verification paths are the existing OpenClaw sync flow plus either:
  - `openclaw agent ...`
  - `http://127.0.0.1:18789/v1/chat/completions`

## Design

This should be implemented as two layers that reinforce each other.

1. Project skill

Create a new top-level project skill at `skills/openclaw-plugin-dev-workflow/SKILL.md`. This keeps the workflow reusable and discoverable as a first-class project skill instead of burying it only in prose.

2. Repository guardrail

Update `AGENTS.md` so any future agent working on this plugin must read and follow the new skill before editing, debugging, or validating the plugin. `AGENTS.md` should also repeat the non-negotiable boundaries:

- `D:\all-works\openclaw` is read-only learning/reference material for this task flow
- plugin code edits stay inside this plugin repo
- local unit tests are useful but not sufficient for runtime claims
- runtime claims require OpenClaw verification and should prefer the existing sync workflow

## Verification

Verification should match the workflow being introduced:

1. Confirm the new skill and required references exist in this repo.
2. Run the existing plugin sync workflow so the new skill is staged into the real OpenClaw runtime.
3. Check OpenClaw health after sync.
4. Confirm the synced runtime skill file exists under `%USERPROFILE%\.openclaw\skills\openclaw-plugin-dev-workflow\SKILL.md`.

The executable sync commands in this repo are:

- `node scripts/verify-dev-sync.mjs`
- `.\scripts\sync-openclaw-dev-ready.ps1 --logs 200`

## Non-Goals

- No runtime logic changes in the plugin code
- No edits in `D:\all-works\openclaw`
- No attempt to enforce this rule through plugin execution-time policy code
