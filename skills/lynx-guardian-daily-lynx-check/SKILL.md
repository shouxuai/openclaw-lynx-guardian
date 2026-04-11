---
name: lynx-guardian-daily-lynx-check
description: Use when legacy Lynx Guardian prompts still reference the deprecated daily `/lynx-check` skill name and need the same orchestration contract as the primary orchestrator.
---

# Deprecated Compatibility Alias

`lynx-guardian-daily-lynx-check` is the deprecated compatibility alias for `lynx-guardian-check-orchestrator`.

Use `lynx-guardian-check-orchestrator` for new prompts, new docs, and new plugin-injected execution paths.

If this legacy skill name is invoked, follow the same orchestrator contract:

- Read `.openclaw/lynx/check-runs/<requestId>.intent.json`.
- Write `.openclaw/lynx/check-runs/<requestId>.report.md`.
- Write `.openclaw/lynx/check-runs/<requestId>.result.json`.
- Include `requestId`, `status`, `sendAttempted`, `sendSucceeded`, `transport`, `reportPath`, `errorMessage`, and `completedAtMs` in the result payload.
- Dispatch audit work to `SX-security-audit`.
- Dispatch discovery work to `SX-openclaw-discovery`.
- Assemble one composite markdown report and deliver it as a new message when channel routing succeeds.
- Keep failed-send results honest so the plugin fallback path can reuse the stored report.

Do not hardcode the `/lynx-check` report in the plugin, and do not claim success when delivery did not actually happen.
