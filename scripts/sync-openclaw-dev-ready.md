# Sync OpenClaw Dev Ready

Use this wrapper when you want one command that:

1. runs `verify-dev-sync.mjs`
2. builds shared/backend/frontend and packages the latest local-console outputs into `server/`
3. runs the existing sync script
4. waits for the first Docker gateway restart to become ready
5. verifies the legacy cron store under `/home/node/.openclaw/cron/jobs.json`
6. syncs that cron store into `/home/node/.openclaw/docker-state/cron/jobs.json`
7. restarts the gateway again so cron reloads the Docker state store
8. prints a clear success callback

## Command

```powershell
.\scripts\sync-openclaw-dev-ready.ps1 --logs 200
```

Or directly:

```powershell
node .\scripts\sync-openclaw-dev-ready.mjs --repo-root "C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian" --logs 200
```

## Success Criteria

The script does not stop after the first `docker restart`. It keeps going until:

- the gateway container reports `healthy` (or `running` when no healthcheck exists)
- logs since the latest container start include:
  - `[lynx-guardian] Plugin loading...`
  - either `listening on ws://...`, `Local console gateway routes registered at /webview and /lynx`, or `starting local console backend ...`
- `/home/node/.openclaw/cron/jobs.json` contains `lynx-guardian-scheduled-lynx-check`
- `/home/node/.openclaw/docker-state/cron/jobs.json` contains `lynx-guardian-scheduled-lynx-check` after the second restart

When both checks are satisfied, it prints a line like:

```text
[lynx-dev-ready] SUCCESS: openclaw-openclaw-gateway-1 restarted and ready at 2026-04-12T02:29:31.194287003Z
```

## Wrapper Options

```text
--health-timeout-ms <ms>
--ready-timeout-ms <ms>
--poll-ms <ms>
--skip-verify
```

All normal sync arguments such as `--container`, `--openclaw-home`, `--repo-root`, `--logs`, and `--dry-run` are forwarded to the existing sync script.

## Risk Boundary Matrix

After input/output/tool boundary changes, run the runtime matrix against the real Docker gateway:

```powershell
.\scripts\verify-risk-boundary-matrix.ps1 -TimeoutSeconds 90
```

The matrix checks CLI/direct-agent, OpenAI-compatible HTTP when an API token is available, Docker cron-store presence, and recent gateway log evidence. Cron-store presence is reported as sync-state evidence only, not as proof that a cron/internal task executed through a safety boundary. The matrix treats direct-agent L4 as a warning when the runtime only exposes prompt-level `before_agent_start` fallback, instead of reporting that path as a proven physical hard stop. HTTP safe-after-L4 may warn instead of pass when the model ignores the marker because a fresh OpenAI-compatible session enters bootstrap/onboarding; it still fails if the response or logs show prior L4 or forced-denial contamination.
