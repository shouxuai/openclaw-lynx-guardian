# OpenClaw Docker Debug Runbook

## Environment

- Plugin repo: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian`
- Docker OpenClaw repo: `D:\all-works\openclaw`
- Gateway compose service: `openclaw-gateway`
- Host runtime data: `%USERPROFILE%\.openclaw`

## Fast Log Triage

From `D:\all-works\openclaw`:

```powershell
docker compose ps
docker compose logs --tail=200 openclaw-gateway
docker compose logs --tail=200 -f openclaw-gateway
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:18789/healthz
```

From the Windows host runtime:

```powershell
Get-Content "$env:USERPROFILE\.openclaw\lynx\hook-probe.log" -Tail 200

Get-ChildItem "$env:USERPROFILE\.openclaw\lynx\check-runs" -File |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 20 FullName,LastWriteTime,Length

Get-ChildItem "$env:USERPROFILE\.openclaw\agents\main\sessions" -File |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 10 FullName,LastWriteTime,Length
```

## `/lynx-check` Debug Sequence

1. Tail gateway logs.
2. Search for `Managed /lynx-check run created requestId=`.
3. Extract the `requestId`.
4. Read:

```powershell
Get-Content "$env:USERPROFILE\.openclaw\lynx\check-runs\<requestId>.intent.json"
Get-Content "$env:USERPROFILE\.openclaw\lynx\check-runs\<requestId>.result.json"
Get-Content "$env:USERPROFILE\.openclaw\lynx\check-runs\<requestId>.report.md"
```

5. Correlate with the latest `%USERPROFILE%\.openclaw\agents\main\sessions\*.jsonl`.
6. Only after that move into source-level diagnosis.

## Plugin Sync After Local Changes

From `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian`:

```powershell
node scripts-dev/verify-dev-sync.mjs
.\scripts-dev\sync-openclaw-dev.ps1 --logs 200
```

Recommended follow-up:

```powershell
Set-Location D:\all-works\openclaw
docker compose logs --tail=200 openclaw-gateway
```

## Focused Test Commands

From the plugin repo:

```powershell
npx vitest run test/plugin.test.ts -t "orchestrator"
npx vitest run test/plugin.test.ts -t "agent_end"
npx vitest run test/plugin.test.ts -t "run result"
npx vitest run --exclude ".worktrees/**" test/plugin.test.ts test/lynx-check-run-store.test.ts
```

Why the `--exclude` matters:

- this repo can contain historical copies under `.worktrees/`
- plain `vitest run` may include those copied tests and report unrelated failures
- the exclude form gives the current working tree's broad regression result

From `D:\all-works\openclaw` for pairing-related behavior:

```powershell
pnpm test -- src/cli/devices-cli.test.ts -t "pairing required"
pnpm test -- src/commands/status.test.ts -t "pairing required"
```

## Failure Signatures To Recognize Quickly

- `gateway closed (1008): pairing required`
- `Self-safety-guard blocked tool`
- run result remains `not_started`
- result file uses unsupported `status: "partial"`
- `EPERM ... copyfile ... /home/node/.openclaw/skills/...`
- `/bin/sh: 1: ss: not found`

Treat the first four as the primary signals for the current Lynx orchestration issue.
