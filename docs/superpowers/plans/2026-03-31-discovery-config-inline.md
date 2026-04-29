# Discovery Config Inline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move discovery configuration into `openclaw.plugin.json` and eliminate the separate runtime config file from the main plugin flow.

**Architecture:** Keep the existing discovery config helper module but change it from file loading to config normalization. Update the plugin config schema and typed config surface so discovery settings flow directly from `api.config`.

**Tech Stack:** TypeScript, Vitest, JSON schema, NodeNext ESM

---

### Task 1: Add failing tests for inline config behavior

**Files:**
- Create: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\discovery-runtime-config.test.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\plugin.test.ts`

- [ ] Add a unit test that verifies defaults come from the helper when config is undefined
- [ ] Add a unit test that verifies inline `openclawDiscovery` values override defaults
- [ ] Update plugin mock expectations so the reported path is `openclaw.plugin.json`
- [ ] Run focused tests and confirm they fail for the expected old file-based behavior

### Task 2: Inline discovery config into plugin config

**Files:**
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\openclaw.plugin.json`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\types.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\discovery\discovery-runtime-config.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\index.ts`

- [ ] Add `openclawDiscovery` to the plugin schema
- [ ] Add typed `openclawDiscovery` support to `PluginConfig`
- [ ] Replace file loading logic with config normalization logic
- [ ] Pass `api.config.openclawDiscovery` from `index.ts` into the helper

### Task 3: Verify the migration

**Files:**
- Test: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\discovery-runtime-config.test.ts`
- Test: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\plugin.test.ts`

- [ ] Run `npx vitest run test/discovery-runtime-config.test.ts test/plugin.test.ts --testNamePattern "discovery|register user on startup|attach all event handlers"`
- [ ] Run `node scripts/build.js`
- [ ] Confirm no runtime code path depends on `lynx-discovery.config.json`
