---
name: lynx-guardian-daily-lynx-check
description: Use when OpenClaw should create, inspect, or update an automated daily Lynx Guardian check that runs `/lynx-check` on a schedule and returns the report without manual prompting.
---

# Lynx Guardian Daily `/lynx-check`

Prefer the plugin's `scheduledLynxCheck` config block, which keeps one native OpenClaw cron job in sync automatically.

## Choose the scheduler

- Use `cron` when the check should run exactly once per day, at a clear local time, and deliver a report immediately.
- Use heartbeat only when the user explicitly wants approximate timing or wants this check batched with other heartbeat work.

## Default workflow

1. Edit the plugin config instead of hand-maintaining cron jobs when Lynx Guardian is installed.
2. Set `scheduledLynxCheck.enabled` to `true`.
3. Set `scheduledLynxCheck.cron` to the exact schedule needed.
4. Keep the managed job message as the exact text `/lynx-check`.

## Recommended config

```json
{
  "scheduledLynxCheck": {
    "enabled": true,
    "cron": "0 9 * * *",
    "timezone": "Asia/Shanghai",
    "jobName": "Lynx Guardian Daily Check",
    "announce": true
  }
}
```

Common `cron` values:

- `37 8 * * *` -> 08:37 every day
- `*/5 * * * *` -> every 5 minutes for testing
- `* * * * *` -> every minute for testing

## Why this shape

- The plugin writes one managed native cron job, so there are no duplicate daily checks.
- The exact message `/lynx-check` reuses Lynx Guardian's existing manual detection path.
- `announce` returns the produced report automatically instead of waiting for a later heartbeat turn.

## Heartbeat fallback

Use heartbeat only when the user explicitly prefers one shared periodic loop over exact timing. In that case:

- keep the heartbeat instructions minimal;
- store a "last run date" marker in workspace memory;
- only emit `/lynx-check` once per calendar day;
- tell the user this is approximate and may drift with heartbeat cadence or quiet hours.

## Avoid

- Do not build a second timer inside the plugin.
- Do not rely on natural-language paraphrases for the scheduled command when exact `/lynx-check` is available.
- Do not create both heartbeat and cron schedules for the same daily check unless the user explicitly asks for both.
- Do not hand-edit the managed cron job if changing plugin config is available.
