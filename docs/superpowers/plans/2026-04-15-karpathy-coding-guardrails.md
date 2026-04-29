# Karpathy Coding Guardrails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a local Codex skill that adapts the upstream Karpathy guidelines into a Codex-native guardrail skill with compact references and valid agent metadata.

**Architecture:** Create one new skill folder under `C:\Users\24716\.codex\skills`, initialize it with the official skill scaffolder, then replace the template content with a Codex-specific `SKILL.md`, a short `references/examples.md`, and generated `agents/openai.yaml`. Validate the finished structure with the official validator and a manual trigger-boundary review against the approved design spec.

**Tech Stack:** PowerShell, Python helper scripts in `C:\Users\24716\.codex\skills\.system\skill-creator\scripts`, Markdown, YAML

---

### Task 1: Establish Validation Baseline

**Files:**
- Create: `C:\Users\24716\.codex\skills\karpathy-coding-guardrails\`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\docs\superpowers\plans\2026-04-15-karpathy-coding-guardrails.md`
- Test: `C:\Users\24716\.codex\skills\.system\skill-creator\scripts\quick_validate.py`

- [ ] **Step 1: Run the failing validation before the skill exists**

```powershell
python "C:\Users\24716\.codex\skills\.system\skill-creator\scripts\quick_validate.py" "C:\Users\24716\.codex\skills\karpathy-coding-guardrails"
```

Expected: non-zero exit and a message equivalent to `SKILL.md not found`.

- [ ] **Step 2: Confirm the target skill path is not already present**

```powershell
Test-Path "C:\Users\24716\.codex\skills\karpathy-coding-guardrails"
```

Expected: `False`

### Task 2: Initialize the Skill Skeleton

**Files:**
- Create: `C:\Users\24716\.codex\skills\karpathy-coding-guardrails\SKILL.md`
- Create: `C:\Users\24716\.codex\skills\karpathy-coding-guardrails\references\`
- Create: `C:\Users\24716\.codex\skills\karpathy-coding-guardrails\agents\openai.yaml`
- Test: `C:\Users\24716\.codex\skills\.system\skill-creator\scripts\init_skill.py`

- [ ] **Step 1: Initialize the skill with the official scaffolder**

```powershell
python "C:\Users\24716\.codex\skills\.system\skill-creator\scripts\init_skill.py" `
  "karpathy-coding-guardrails" `
  --path "C:\Users\24716\.codex\skills" `
  --resources "references" `
  --interface display_name="Karpathy Coding Guardrails" `
  --interface short_description="Guardrails for ambiguity, overengineering, and broad code changes." `
  --interface default_prompt="Use $karpathy-coding-guardrails to keep this coding task simple, scoped, and explicitly verified."
```

Expected: the skill directory and initial files are created successfully.

- [ ] **Step 2: Inspect the scaffolded files**

```powershell
Get-ChildItem "C:\Users\24716\.codex\skills\karpathy-coding-guardrails" -Recurse
```

Expected: `SKILL.md`, `references\`, and `agents\openai.yaml`

### Task 3: Replace Template Content With Codex-Native Guidance

**Files:**
- Modify: `C:\Users\24716\.codex\skills\karpathy-coding-guardrails\SKILL.md`
- Create: `C:\Users\24716\.codex\skills\karpathy-coding-guardrails\references\examples.md`

- [ ] **Step 1: Write the final `SKILL.md` content**

```markdown
---
name: karpathy-coding-guardrails
description: Use when coding, reviewing, or refactoring code and there is risk of silent assumptions, overengineering, unrelated edits, or vague success criteria.
---

# Karpathy Coding Guardrails

## Overview

Use this skill to reduce common coding-agent mistakes before they spread into the implementation. Apply it when Codex needs to stay explicit, simple, scoped, and verification-oriented.

## Core Principles

### 1. Think Before Coding

- State assumptions before implementing.
- If the request can mean multiple things, surface the alternatives instead of choosing silently.
- If confusion remains, stop and ask or hand off to `brainstorming`.

Red flags:
- "This probably means..."
- "I'll just pick the most likely interpretation."
- "I can sort it out while coding."

### 2. Simplicity First

- Write the minimum code that solves the actual request.
- Remove speculative flexibility, abstraction, or configuration that was not requested.
- Prefer the existing project pattern over introducing a framework for one use.

Red flags:
- adding extensibility "for later"
- building multiple layers for a one-call site feature
- solving future requirements that are not in scope

### 3. Surgical Changes

- Change only what the request requires.
- Match surrounding style unless the user asked for a broader cleanup.
- Clean up only dead code created by your own edit.

Red flags:
- touching adjacent comments or formatting without need
- renaming unrelated symbols while already in the file
- bundling refactors into a bugfix or feature task

### 4. Goal-Driven Execution

- Turn vague instructions into explicit checks.
- Name what will prove the work is done before claiming success.
- Hand implementation to `test-driven-development` and completion checks to `verification-before-completion`.

Red flags:
- "make it work"
- "should be fixed now"
- "done" without a concrete verification command

## Handoffs

- Use `brainstorming` when the design or requirements are still unclear.
- Use `test-driven-development` before implementing a feature or bugfix.
- Use `verification-before-completion` before claiming the result is complete or passing.

## Failure Patterns

| If you catch yourself doing this | Do this instead |
|---|---|
| Picking an interpretation silently | State the assumption or ask |
| Adding flexibility for future use | Delete speculative code |
| Cleaning up nearby code "while here" | Revert unrelated edits |
| Declaring success from intuition | Name and run explicit verification |
```

- [ ] **Step 2: Write the reference examples**

```markdown
# Examples

## Ambiguous Request

User: "Make search faster."

Bad: silently add caching, async work, and indexes.
Better: state the possible meanings, recommend one, and ask which outcome matters.

## Overengineering

User: "Add a discount helper."

Bad: add strategy classes and configuration for future discount types.
Better: add one small function that matches the current requirement.

## Unrelated Cleanup

User: "Fix this validator bug."

Bad: reformat the file, rename helpers, and remove old comments.
Better: fix the validator, remove only imports made unused by the fix, and mention unrelated cleanup separately if it matters.

## Verifiable Goal

User: "Clean up the export flow."

Bad: claim completion after rewriting code.
Better: restate the target as a concrete behavior and name the command or test that proves it.
```

### Task 4: Validate the Finished Skill

**Files:**
- Test: `C:\Users\24716\.codex\skills\karpathy-coding-guardrails\SKILL.md`
- Test: `C:\Users\24716\.codex\skills\karpathy-coding-guardrails\agents\openai.yaml`
- Test: `C:\Users\24716\.codex\skills\karpathy-coding-guardrails\references\examples.md`

- [ ] **Step 1: Run structural validation**

```powershell
python "C:\Users\24716\.codex\skills\.system\skill-creator\scripts\quick_validate.py" "C:\Users\24716\.codex\skills\karpathy-coding-guardrails"
```

Expected: `Skill is valid!`

- [ ] **Step 2: Inspect the generated agent metadata**

```powershell
Get-Content "C:\Users\24716\.codex\skills\karpathy-coding-guardrails\agents\openai.yaml"
```

Expected: it contains `display_name`, `short_description`, and a `default_prompt` that explicitly references `$karpathy-coding-guardrails`.

- [ ] **Step 3: Review the final skill against the design spec**

```powershell
Get-Content "C:\Users\24716\.codex\skills\karpathy-coding-guardrails\SKILL.md"
Get-Content "C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\docs\superpowers\specs\2026-04-15-karpathy-coding-guardrails-design.md"
```

Expected: the final skill preserves the four upstream principles, stays compact, and clearly hands off to existing local process skills.
