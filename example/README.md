# openclaw-guardian

> **The missing safety layer for AI agents.**

## Why This Exists

OpenClaw is powerful — it gives AI agents direct access to shell commands, file operations, email, browser automation, and more. That power is exactly what makes it useful, but it's also what makes people nervous.

The community has been vocal: _"security nightmare"_, _"what if the AI deletes my files?"_, _"I don't trust it with my credentials"_. OpenClaw's existing safety (sandbox + allowlist + manual confirmation) only covers `exec`, and it's all-or-nothing — either you trust the agent completely, or you block everything.

**openclaw-guardian** fills that gap. It sits between the AI's decision and the actual execution, using a two-tier blacklist to catch dangerous operations and LLM-based intent verification to confirm the user actually asked for them. Think of it as a bouncer that checks IDs — fast for regulars, thorough for strangers.

The key insight: **99% of what an AI agent does is harmless** (reading files, fetching URLs, writing notes). Only ~1% hits the blacklist (deleting files, running destructive commands, touching system paths). Guardian only intervenes on that 1%, so you get safety without sacrificing speed.

## How It Works

```
AI Agent wants to run a tool (e.g., exec "rm -rf ~/")
                    ↓
        ┌───────────────────────┐
        │   Blacklist Matcher   │  ← Regex rules, 0ms, no model call
        │   critical / warning  │
        └───────────┬───────────┘
                    ↓
    ┌───────────────┼───────────────┐
    ↓               ↓               ↓
 No match       Warning          Critical
  (pass)       (1 LLM vote)   (3 LLM votes)
    ↓               ↓               ↓
 Execute     "Did the user     3 parallel calls,
             ask for this?"    ALL must confirm
                    ↓               ↓
             yes → execute    3/3 yes → execute
             no  → block      otherwise → block
```

### Two Blacklist Levels

| Level    | LLM Votes Required | Latency | Examples                                              |
| -------- | ------------------ | ------- | ----------------------------------------------------- |
| No match | 0                  | ~0ms    | Reading files, git commands, normal operations        |
| Warning  | 1 (single vote)    | ~1-2s   | `rm -rf /tmp/cache`, `chmod 777`, `sudo apt`          |
| Critical | 3 (unanimous)      | ~2-4s   | `rm -rf ~/`, `mkfs`, `dd if=... of=/dev/`, `shutdown` |

### What Gets Checked

Guardian only inspects three tool types:

- **`exec`** — the command string is matched against exec blacklist rules
- **`write`** / **`edit`** — the file path is matched against path blacklist rules

Everything else (read, fetch, browser, etc.) passes through instantly.

### LLM Intent Verification

When a blacklist rule matches, Guardian doesn't just block — it asks a lightweight LLM: _"Did the user explicitly request this operation?"_

The LLM reads recent conversation context and determines whether the flagged action was actually what the user wanted. This prevents false positives from blocking legitimate work.

- **Warning level**: 1 LLM call. If the LLM says the user asked for it, the operation proceeds.
- **Critical level**: 3 parallel LLM calls with the same prompt. All 3 must independently confirm user intent. If any vote says no, the operation is blocked.

Guardian auto-discovers a cheap/fast model from your existing OpenClaw provider config (prefers Haiku, falls back to whatever's available). No separate API key needed.

### LLM Fallback Behavior

If the LLM is unavailable:

- **Critical** operations are blocked (fail-safe)
- **Warning** operations prompt the user for manual confirmation

## Quick Start

```bash
openclaw plugins install openclaw-guardian
```

That's it. Guardian activates automatically and starts protecting your agent.

### Configuration

Guardian is enabled by default. To disable it, update your plugin config:

```json
{
  "openclaw-guardian": {
    "enabled": false
  }
}
```

## Blacklist Rules

Guardian uses pure regex pattern matching — no model calls, deterministic, instant.

### Critical Rules (exec)

These catch irreversible, system-level destruction:

- `rm -rf` on system paths (excludes `/tmp/` and `/home/clawdbot/`)
- `mkfs`, `dd` to block devices, redirects to `/dev/sd*`
- Writes to `/etc/passwd`, `/etc/shadow`, `/etc/sudoers`
- `shutdown`, `reboot`, `init 0/6`
- Disabling SSH (`systemctl stop sshd`)
- Bypass attempts: `eval`, absolute-path `rm`, interpreter-based destruction
- Pipe attacks: `curl | sh`, `wget | bash`
- Chain attacks: download + `chmod +x`, download + shell execute

### Warning Rules (exec)

These catch operations that are risky but not catastrophic:

- `rm -rf` on safe paths (like `/tmp/`)
- `sudo` commands
- `chmod 777`, `chown root`
- Package install/remove (`apt install`, `pip install`)
- Service management (`systemctl start/stop/restart`)
- Crontab modifications
- SSH/SCP to remote hosts
- Docker/container operations
- `kill`/`killall` commands

### Path Rules (write/edit)

- **Critical**: `/etc/passwd`, `/etc/shadow`, `/etc/sudoers`, SSH keys, systemd units
- **Warning**: dotfiles (`.bashrc`, `.zshrc`, `.profile`), `/etc/` configs, crontabs, `.env` files, `authorized_keys`

## Audit Log

Every blacklist-matched operation is logged to `~/.openclaw/guardian-audit.jsonl` with a SHA-256 hash chain:

```json
{
  "timestamp": "2025-02-25T01:00:00.000Z",
  "toolName": "exec",
  "blacklistLevel": "critical",
  "blacklistReason": "rm -rf on home directory",
  "pattern": "rm\\s+(-[a-zA-Z]*r[a-zA-Z]*\\s+|--recursive\\s+)~/",
  "userConfirmed": false,
  "finalReason": "Only 1/3 confirmed (need 3)",
  "hash": "a1b2c3...",
  "prevHash": "d4e5f6..."
}
```

Each entry's `hash` covers the full entry + `prevHash`, creating a tamper-evident chain. If someone edits the log, the chain breaks.

## Project Structure

```
extensions/guardian/
├── README.md
├── openclaw.plugin.json    # Plugin manifest
├── default-policies.json   # Default config (enabled: true)
├── index.ts                # Entry — registers before_tool_call hook
├── src/
│   ├── blacklist.ts        # Two-tier regex rules (critical/warning)
│   ├── llm-voter.ts        # LLM intent verification (singleVote/multiVote)
│   └── audit-log.ts        # SHA-256 hash-chain audit logger
└── test/
    └── blacklist.test.ts   # Comprehensive blacklist rule tests
```

### How It Hooks Into OpenClaw

OpenClaw's agent loop: `Model → tool_call → Tool Executor → result → Model`

Guardian registers a `before_tool_call` plugin hook. This hook fires **after** the model decides to call a tool but **before** the tool actually executes. If Guardian returns `{ block: true }`, the tool is stopped and the model receives a rejection message instead.

This is the same hook interface OpenClaw uses internally for loop detection — battle-tested, async-safe, and zero modifications to core code.

## Token Cost

| Scenario       | % of Operations | Extra Cost             |
| -------------- | --------------- | ---------------------- |
| No match       | ~99%            | 0 (no model call)      |
| Warning match  | ~0.5-1%         | ~500 tokens (1 call)   |
| Critical match | <0.5%           | ~1500 tokens (3 calls) |

Most operations cost nothing extra. Guardian prefers cheap models (Haiku, GPT-4o-mini, Gemini Flash) to minimize overhead.

## Status

🚧 Under active development — contributions welcome.

## License

MIT
