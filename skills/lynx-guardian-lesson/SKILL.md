---
name: lynx-guardian-lesson
description: "Record issues, lessons learned, errors, and corrective actions reported by the Lynx-Guardian plugin for continuous improvement. This applies to the following situations: (1) [lynx-guardian] Sensitive data detected; (2) [lynx-guardian] Input risk detected; (3) [lynx-guardian] Output risk detected; (4) [lynx-guardian] Blacklist hit. Furthermore, these lessons learned should be reviewed before performing major tasks."
metadata:
---

# Lynx-Guardian Lesson Skill

Log security risks and violations to markdown files for continuous improvement. The agent should learn from these detections to avoid repeating unsafe behaviors and to improve its internal safety guidelines.

## Quick Reference

| Situation | Action |
|-----------|--------|
| [lynx-guardian] Sensitive data detected | Log to `.lynx/SENSITIVE.md` |
| [lynx-guardian] Input risk detected | Log to `.lynx/CONTENT.md` |
| [lynx-guardian] Output risk detected | Log to `.lynx/CONTENT.md` |
| [lynx-guardian] Blacklist hit | Log to `.lynx/TOOLS.md` |
| Pattern recurrence / Best Practice | Promote to `AGENTS.md`, `SOUL.md`, or `TOOLS.md` (OpenClaw workspace) |

## OpenClaw Setup

OpenClaw injects these files into every session:

```
~/.openclaw/workspace/
├── AGENTS.md          # Multi-agent workflows, delegation patterns
├── SOUL.md            # Behavioral guidelines, personality, principles
├── TOOLS.md           # Tool capabilities, integration gotchas
├── MEMORY.md          # Long-term memory (main session only)
├── .lynx/             # This skill's log files
│   ├── SENSITIVE.md   # Sensitive data logs
│   ├── CONTENT.md     # Input/Output content risk logs
│   └── TOOLS.md       # Blacklist hit logs
```

### Create Learning Files

If they don't exist, create the directory and files:

```bash
mkdir -p ~/.openclaw/workspace/.lynx
# Copy templates from assets if available, or create empty files
```

## Logging Format

### Sensitive Data Entry

Append to `.lynx/SENSITIVE.md` when `[lynx-guardian] Sensitive data detected` occurs.

```markdown
## [SEN-YYYYMMDD-XXX] Sensitive Data Detection

**Logged**: ISO-8601 timestamp
**Type**: PII | Credential | Secret | Other
**Status**: pending | resolved

### Context
Description of the data flow where sensitive information was detected.

### Correction
What action was taken or should be taken to redact or secure the data.

### Prevention
How to avoid this in the future (e.g., use environment variables, mask logs).

---
```

### Content Risk Entry

Append to `.lynx/CONTENT.md` when `[lynx-guardian] Input risk detected` or `[lynx-guardian] Output risk detected` occurs.

```markdown
## [CON-YYYYMMDD-XXX] Content Risk Detection

**Logged**: ISO-8601 timestamp
**Direction**: Input | Output
**Risk Type**: Injection | Toxic | Policy Violation

### Context
Description of the input/output that triggered the risk.

### Mitigation
How the content should be sanitized or rejected.

### Prevention
Guidance on handling similar content safely.

---
```

### Blacklist Hit Entry

Append to `.lynx/TOOLS.md` when `[lynx-guardian] Blacklist hit` occurs (malicious command execution attempt).

```markdown
## [BLK-YYYYMMDD-XXX] Blacklist Command Hit

**Logged**: ISO-8601 timestamp
**Command**: The command that was blocked (sanitized if necessary)
**Risk Level**: High

### Context
Why this command was attempted.

### Alternative
The safe alternative to achieve the same goal.

### Rule Update
If this was a false positive, suggest a rule update; otherwise, reinforce the restriction.

---
```

## Evolution Layer: From Lessons to Rules

Transform temporary learnings into permanent capabilities through **Promotion** and **Skill Extraction**.

### 1. Promotion (Rule Crystallization)

When a recurring security workflow or specific behavior pattern emerges, promote it to the workspace context files.

| Learning Type | Promote To | Example |
|---------------|------------|---------|
| **Behavioral Safety** | `SOUL.md` | "Always verify user intent before executing system commands." |
| **Workflow Security** | `AGENTS.md` | "Require human approval for high-risk operations." |
| **Tool Usage** | `TOOLS.md` | "Avoid using `curl | sh` patterns; download and inspect first." |

### 2. Skill Extraction (Capability Expansion)

When a complex, multi-step security requirement appears frequently, extract it into a dedicated, reusable **Skill**.

- **Trigger**: Complex workflows like "Audit Dockerfile for CIS Benchmarks" or "Verify Dependency Integrity".
- **Action**: Use the `skill-creator` tool to generate a new skill that encapsulates this workflow.
- **Benefit**: Converts manual, error-prone checklists into automated, reliable tools.

### Evolution Workflow

1. **Review** pending logs in `.lynx/*.md` periodically.
2. **Identify** high-value patterns or recurring errors.
3. **Execute Evolution**:
   - *Simple Rule?* → **Promote** to Workspace Files (`SOUL.md`, `AGENTS.md`, `TOOLS.md`).
   - *Complex Workflow?* → **Extract** to a new Skill using `skill-creator`.
4. **Archive** the log entry:
   - Change `**Status**: pending` → `**Status**: promoted` or `**Status**: extracted`.
