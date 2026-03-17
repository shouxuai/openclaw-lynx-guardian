# Security Documentation

This document provides detailed security analysis of the OpenClaw Token Optimizer skill.

## Purpose

This skill helps reduce OpenClaw API costs by optimizing context loading and model selection.

## Two-Part Architecture — Read This First

This skill has **two distinct categories of files** with different security profiles:

### Category 1: Executable Scripts (`scripts/*.py`)
These are the actual working components of the skill.
- **Network access:** None
- **External API keys:** None required
- **Code execution:** No eval/exec/compile
- **Data storage:** Local JSON files in `~/.openclaw/workspace/memory/` only
- **Verdict:** ✅ Safe to run

### Category 2: Reference Documentation (`references/PROVIDERS.md`, `assets/config-patches.json`)
These are informational guides describing optional multi-provider strategies.
- **Network access:** Described (not performed by these files)
- **External API keys:** Referenced as examples (`${OPENROUTER_API_KEY}`, `${TOGETHER_API_KEY}`)
- **Code execution:** None — these are JSON/Markdown documentation
- **Purpose:** Help users who *choose* to configure alternative providers (OpenRouter, Together.ai, etc.)
- **Verdict:** ✅ Safe files — but describe services that require external credentials if you choose to use them

**Why this matters:** Security scanners that flag API key patterns or external service references in documentation files are technically correct — those references exist. They are not executable, not auto-applied, and require explicit manual user action to use.

## Security Flag Explanation

**Why VirusTotal or AV tools may flag this skill:**

1. **API key patterns in config-patches.json** — `${OPENROUTER_API_KEY}`, `${TOGETHER_API_KEY}` are placeholder strings for optional manual configuration. They are not credentials and not automatically used.
2. **External URLs in PROVIDERS.md** — References to openrouter.ai, together.ai, etc. are documentation links, not network calls.
3. **"Optimizer" keyword + file operations** — Common AV heuristic false positive.
4. **Executable Python scripts with shebang** — Standard Python scripts, no dangerous operations.

These are documentation-level references, not executable network code.

## Shell Wrapper: optimize.sh

`scripts/optimize.sh` is a **convenience CLI wrapper** — it does nothing except call the bundled Python scripts in this same directory. It is not an installer, not a downloader, and makes no network calls.

**What it does (complete source):**
```bash
case "$1" in
    route|model)   python3 "$SCRIPT_DIR/model_router.py" "$@" ;;
    context)       python3 "$SCRIPT_DIR/context_optimizer.py" generate-agents ;;
    recommend)     python3 "$SCRIPT_DIR/context_optimizer.py" recommend "$2" ;;
    budget)        python3 "$SCRIPT_DIR/token_tracker.py" check ;;
    heartbeat)     cp "$SCRIPT_DIR/../assets/HEARTBEAT.template.md" ~/.openclaw/workspace/HEARTBEAT.md ;;
esac
```

**Security properties:**
- ✅ No network requests
- ✅ No system modifications
- ✅ No subprocess spawning beyond the Python scripts already bundled
- ✅ No eval, exec, or dynamic code execution
- ✅ Only calls scripts already in this package (same directory via `$SCRIPT_DIR`)
- ✅ Included in `.clawhubsafe` SHA256 manifest

**To verify before running:**
```bash
grep -E "curl|wget|nc |ncat|ssh|sudo|chmod|eval|exec\(" scripts/optimize.sh
# Should return nothing
```

**If you prefer not to use the shell wrapper:** use the Python scripts directly (all documented in SKILL.md). The wrapper is optional.

---

## Script-by-Script Security Analysis

### 1. context_optimizer.py

**Purpose**: Analyze prompts to determine minimal context requirements

**Operations**:
- Reads JSON state file from `~/.openclaw/workspace/memory/context-usage.json`
- Classifies prompt complexity (simple/medium/complex)
- Recommends which files to load
- Generates optimized AGENTS.md template
- Writes usage statistics to JSON

**Security**:
- ✅ No network requests
- ✅ No code execution (no eval, exec, compile)
- ✅ Only standard library imports: `json, re, pathlib, datetime`
- ✅ Read/write permissions limited to OpenClaw workspace
- ✅ No subprocess calls
- ✅ No system modifications

**Data Handling**:
- Stores: File access counts, last access timestamps
- Location: `~/.openclaw/workspace/memory/context-usage.json`
- Privacy: All data local, never transmitted

### 2. heartbeat_optimizer.py

**Purpose**: Optimize heartbeat check scheduling to reduce unnecessary API calls

**Operations**:
- Reads heartbeat state from `~/.openclaw/workspace/memory/heartbeat-state.json`
- Determines which checks are due based on intervals
- Records when checks were last performed
- Enforces quiet hours (23:00-08:00)

**Security**:
- ✅ No network requests
- ✅ No code execution
- ✅ Only standard library imports: `json, os, datetime, pathlib`
- ✅ Read/write limited to heartbeat state file
- ✅ No system commands

**Data Handling**:
- Stores: Last check timestamps, check intervals
- Location: `~/.openclaw/workspace/memory/heartbeat-state.json`
- Privacy: All local, no telemetry

### 3. model_router.py

**Purpose**: Suggest appropriate model based on task complexity to reduce costs

**Operations**:
- Analyzes prompt text
- Classifies task complexity
- Recommends cheapest appropriate model
- No state file (pure analysis)

**Security**:
- ✅ No network requests
- ✅ No code execution
- ✅ Only standard library imports: `json, re`
- ✅ No file writes
- ✅ Stateless operation

**Data Handling**:
- No data storage
- No external communication
- Pure text analysis

### 4. token_tracker.py

**Purpose**: Monitor token usage and enforce budgets

**Operations**:
- Reads budget configuration from `~/.openclaw/workspace/memory/token-budget.json`
- Tracks usage against limits
- Provides warnings and alerts
- Records daily/monthly usage

**Security**:
- ✅ No network requests
- ✅ No code execution
- ✅ Only standard library imports: `json, os, datetime, pathlib`
- ✅ Read/write limited to budget file
- ✅ No system access

**Data Handling**:
- Stores: Usage totals, budget limits, alert thresholds
- Location: `~/.openclaw/workspace/memory/token-budget.json`
- Privacy: Local only, no transmission

## Assets & References

### Assets (Templates & Config)

- `HEARTBEAT.template.md` - Markdown template for optimized heartbeat workflow
- `config-patches.json` - Suggested OpenClaw config optimizations
- `cronjob-model-guide.md` - Documentation for cron-based model routing

**Security**: Plain text/JSON files, no code execution

### References (Documentation)

- `PROVIDERS.md` - Multi-provider strategy documentation

**Security**: Plain text markdown, informational only

## Verification

### Check File Integrity

```bash
cd ~/.openclaw/skills/token-optimizer
sha256sum -c .clawhubsafe
```

### Audit Code Yourself

```bash
# Search for dangerous functions (should return nothing)
grep -r "eval(\|exec(\|__import__\|compile(\|subprocess\|os.system" scripts/

# Search for network operations (should return nothing)
grep -r "urllib\|requests\|http\|socket\|download\|fetch" scripts/

# Search for system modifications (should return nothing)  
grep -r "rm -rf\|sudo\|chmod 777\|chown" .
```

### Review Imports

All scripts use only Python standard library:
- `json` - JSON parsing
- `re` - Regular expressions for text analysis
- `pathlib` - File path handling
- `datetime` - Timestamp management
- `os` - Environment variables and path operations

No third-party libraries. No network libraries.

## Data Privacy

**What data is stored:**
- File access patterns (which files loaded when)
- Heartbeat check timestamps
- Token usage totals
- Budget configurations

**Where data is stored:**
- `~/.openclaw/workspace/memory/` (local filesystem only)

**What is NOT collected:**
- Prompt content
- User messages
- API keys
- Personal information
- System information
- Network data

**External communication:**
- None. Zero network requests.
- No telemetry
- No analytics
- No phone home

## Threat Model

**What this skill CAN do:**
- Read/write JSON files in OpenClaw workspace
- Analyze text for complexity classification
- Generate markdown templates
- Provide recommendations via stdout

**What this skill CANNOT do:**
- Execute arbitrary code
- Make network requests
- Modify system files outside workspace
- Access sensitive data
- Run system commands
- Spawn subprocesses

**Risk Level**: Minimal
- Operates entirely within OpenClaw sandbox
- No privileged operations
- No external dependencies
- Auditable source code

## Provenance & Source

This skill is maintained by **Asif2BD** (M Asif Rahman). All source code is publicly auditable:

- **GitHub repository:** https://github.com/Asif2BD/OpenClaw-Token-Optimizer
- **ClawHub listing:** https://clawhub.ai/Asif2BD/openclaw-token-optimizer
- **Author:** Asif2BD
- **License:** Apache 2.0

Every file in this skill bundle is listed in `.clawhubsafe` with its SHA256 checksum. Verify integrity at any time:
```bash
cd ~/.openclaw/skills/openclaw-token-optimizer
sha256sum -c .clawhubsafe
```

The README references the GitHub repo for users who want to review the source before installing. That link is informational — nothing in the skill auto-downloads from it.

---

## License & Attribution

- **License**: Apache 2.0
- **Author**: Asif2BD
- **Repository**: https://github.com/Asif2BD/openclaw-token-optimizer (if published)
- **ClawHub**: https://clawhub.ai/Asif2BD/openclaw-token-optimizer

## Reporting Security Issues

If you discover a security vulnerability:

1. **Do NOT open a public issue**
2. Contact: [via ClawHub or GitHub]
3. Include: Affected files, severity, reproduction steps

## Changelog

- **2026-02-12**: Added comprehensive security documentation
- **2026-02-07**: Initial release (v1.2.0)

## VirusTotal Status

**Current Status**: False positive by heuristic analysis

**Detection Reason**: Generic heuristics flagging "optimizer" keyword + file operations

**Actual Threat**: None

**Recommended Action**: Whitelist this skill or review source code yourself

---

**Bottom Line**: This skill is safe. It's a productivity tool that helps reduce API costs through intelligent context loading and model selection. All code is auditable, uses only standard Python libraries, and performs no dangerous operations.
