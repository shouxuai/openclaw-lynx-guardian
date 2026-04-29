# Src Conservative Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize `src/` into a few feature-oriented folders while keeping foundational modules directly under `src/`.

**Architecture:** Perform a conservative folder move only for clearly grouped modules. Update imports with minimal churn so runtime behavior stays unchanged and tests remain valid.

**Tech Stack:** TypeScript, Vitest, NodeNext ESM, tsup

---

### Task 1: Move grouped files into new folders

**Files:**
- Create: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\discovery\`
- Create: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\guard\`
- Create: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\skills\`
- Create: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\`
- Move: grouped `.ts` files from `src/` into those folders

- [ ] Move discovery-related modules into `src/discovery/`
- [ ] Move guard-related modules into `src/guard/`
- [ ] Move skill-related modules into `src/skills/`
- [ ] Move runtime/helper modules into `src/runtime/`

### Task 2: Update import paths

**Files:**
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\index.ts`
- Modify: moved modules inside `src/`
- Modify: tests under `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\`

- [ ] Update `index.ts` imports to new folder paths
- [ ] Update moved modules to use correct relative imports
- [ ] Update tests to import from the new locations

### Task 3: Verify behavior

**Files:**
- Test: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\hook-helpers.test.ts`
- Test: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\manual-lynx-check.test.ts`
- Test: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\plugin.test.ts`

- [ ] Run focused helper tests
- [ ] Run focused plugin regression tests
- [ ] Run build and confirm `dist/` is produced successfully
