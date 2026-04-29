# OpenClaw Plugin Dev Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a required project skill and repository guardrail that force future agents to keep edits inside the plugin repo and verify claimed behavior through OpenClaw.

**Architecture:** Add a new top-level project skill for workflow guidance, then wire it into `AGENTS.md` as a mandatory prerequisite for plugin development and validation work. Validate by syncing the plugin into the real OpenClaw runtime and checking the deployed skill artifact.

**Tech Stack:** Markdown docs, project skills, PowerShell sync scripts, Dockerized OpenClaw runtime

---

### Task 1: Capture The Workflow Contract

**Files:**
- Create: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\skills\openclaw-plugin-dev-workflow\SKILL.md`

- [ ] **Step 1: Verify the skill does not already exist**

Run: `Get-ChildItem skills -Directory | Select-Object Name`
Expected: the list does not include `openclaw-plugin-dev-workflow`

- [ ] **Step 2: Write the skill**

Create `skills/openclaw-plugin-dev-workflow/SKILL.md` with:

- a trigger-focused frontmatter description
- explicit read-only guidance for `D:\all-works\openclaw`
- an edit boundary limited to this plugin repo
- required runtime verification through sync plus OpenClaw API or `openclaw agent`
- `/lynx-check` artifact-first verification reminders

- [ ] **Step 3: Verify the new skill file exists**

Run: `Get-Content -Raw skills\openclaw-plugin-dev-workflow\SKILL.md`
Expected: the file exists and contains the workflow rules above

### Task 2: Make The Skill Mandatory At Repo Level

**Files:**
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\AGENTS.md`

- [ ] **Step 1: Verify the current repo instructions do not already require this skill**

Run: `Select-String -Path AGENTS.md -Pattern 'openclaw-plugin-dev-workflow|127\.0\.0\.1:18789|必备 skill|必备skill'`
Expected: no matches

- [ ] **Step 2: Add the required-skill section**

Add a new section near the top of `AGENTS.md` that requires future agents to read and follow `skills/openclaw-plugin-dev-workflow/SKILL.md` before plugin development, debugging, regression testing, or validation.

- [ ] **Step 3: Extend repo-level verification notes**

Add repo guidance that:

- `D:\all-works\openclaw` may be read for learning only
- plugin code changes must stay in this repo
- runtime claims require OpenClaw verification
- acceptable verification paths include `openclaw agent ...` and `http://127.0.0.1:18789/v1/chat/completions`

- [ ] **Step 4: Verify the new instructions are present**

Run: `Select-String -Path AGENTS.md -Pattern 'openclaw-plugin-dev-workflow|127\.0\.0\.1:18789|D:\\all-works\\openclaw'`
Expected: matches for the new required-skill and runtime-verification rules

### Task 3: Validate Through OpenClaw Runtime

**Files:**
- Modify: none
- Test: runtime sync and health verification only

- [ ] **Step 1: Run the repo sync precheck**

Run: `node scripts/verify-dev-sync.mjs`
Expected: sync precheck completes without blocking this skill/docs-only change

- [ ] **Step 2: Sync into the real OpenClaw runtime**

Run: `.\scripts\sync-openclaw-dev-ready.ps1 --logs 200`
Expected: the script reports `SUCCESS` after staging the plugin, syncing `skills/`, and restarting the gateway

- [ ] **Step 3: Verify OpenClaw health**

Run: `Invoke-WebRequest -UseBasicParsing http://127.0.0.1:18789/healthz`
Expected: an HTTP 200 response

- [ ] **Step 4: Verify the deployed skill artifact exists**

Run: `Get-Content -Raw "$env:USERPROFILE\.openclaw\skills\openclaw-plugin-dev-workflow\SKILL.md"`
Expected: the synced runtime copy matches the new project skill
