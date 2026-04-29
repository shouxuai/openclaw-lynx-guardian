# Lynx Check Async Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the managed `/lynx-check` flow so orchestrator skill reads are allowed when appropriate, slow async checks are not marked failed too early, and run-result files stay parseable and path-stable for plugin fallback delivery.

**Architecture:** Keep the existing skill-first orchestration model, but add a managed-run allowlist for internal orchestrator reads, teach `agent_end` to wait briefly for valid result state instead of reading once, and tighten the result contract so both the writer prompt and the parser agree on statuses and paths. Keep the fix scoped to Lynx Guardian first, and only open a core OpenClaw follow-up if loopback pairing still blocks legitimate managed-run subflows after local hardening.

**Tech Stack:** TypeScript, OpenClaw plugin hooks, Vitest, local Docker OpenClaw runtime

---

### Task 1: Allow Managed Orchestrator Reads Without Broadening Protected File Access

**Files:**
- Modify: `src/runtime/plugin-runtime-helpers.ts`
- Modify: `index.ts`
- Test: `test/plugin.test.ts`

- [ ] Add a failing plugin test that simulates a managed `/lynx-check` run reading `skills/lynx-guardian-check-orchestrator/SKILL.md` and expects the read to be allowed only for that managed run context
- [ ] Add a companion test that still blocks unrelated protected reads so the allowlist does not become global
- [ ] Extend the protected-read trust check to recognize the orchestrator skill path for managed `/lynx-check` runs only
- [ ] Keep the existing healthcheck and memory-path allowlist behavior intact
- [ ] Run `npx vitest run test/plugin.test.ts -t "orchestrator"` and confirm the new allowlist tests pass

### Task 2: Make `agent_end` Wait For Slow Async Result State

**Files:**
- Modify: `src/runtime/lynx-check-run-store.ts`
- Modify: `index.ts`
- Test: `test/plugin.test.ts`

- [ ] Add a failing test that creates a pending run intent, delays the result transition, and proves `agent_end` should not immediately mark the run failed while the result is still settling
- [ ] Add a small store helper or polling helper that can re-read the result for a bounded wait window
- [ ] Update the `agent_end` fallback path to wait for `running`, `completed`, or `failed` result state before deciding whether to send fallback content
- [ ] Keep the fallback bounded and deterministic so a missing result still exits cleanly
- [ ] Run `npx vitest run test/plugin.test.ts -t "agent_end"` and confirm the slow-result regression is covered

### Task 3: Tighten Run Result Contract And Path Normalization

**Files:**
- Modify: `src/runtime/lynx-check-run-store.ts`
- Modify: `src/runtime/lynx-check-orchestrator.ts`
- Test: `test/plugin.test.ts`

- [ ] Add a failing test that shows unsupported result statuses like `partial` are either normalized or rejected in a way the plugin can handle explicitly
- [ ] Add a failing test that proves the orchestrator prompt writes result/report paths that the plugin can read from the current runtime home
- [ ] Update the orchestrator prompt text so it only instructs valid statuses: `not_started`, `running`, `completed`, or `failed`
- [ ] Normalize or reject incompatible result payloads in one place so the plugin never silently treats malformed state as "not started"
- [ ] Run `npx vitest run test/plugin.test.ts -t "run result"` and confirm the contract stays aligned

### Task 4: Verify Local Docker Workflow And Capture Residual Pairing Risk

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/superpowers/openclaw-docker-debug-runbook.md`
- Test: `docs/superpowers/plans/2026-04-11-lynx-check-async-hardening.md`

- [ ] Keep the local debug instructions in `AGENTS.md` aligned with the actual Docker repo path and sync script entrypoints
- [ ] Keep the runbook aligned with `scripts-dev/sync-openclaw-dev.ps1` and `scripts-dev/verify-dev-sync.mjs`
- [ ] After code changes, run `node scripts-dev/verify-dev-sync.mjs`
- [ ] After code changes, run `.\scripts-dev\sync-openclaw-dev.ps1 --logs 200`
- [ ] Re-check `docker compose logs --tail=200 openclaw-gateway` from `D:\all-works\openclaw` and confirm the targeted failure signature changed in the expected direction

