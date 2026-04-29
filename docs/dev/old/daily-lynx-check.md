# Daily `/lynx-check`

Lynx Guardian now supports a plugin-managed native OpenClaw cron job. You configure the schedule in the plugin config, and the plugin keeps one managed cron entry in sync with that configuration.

## Plugin config

Add this block under the plugin entry config:

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

## Cron examples

- Every day at 09:00: `0 9 * * *`
- Every day at 08:37: `37 8 * * *`
- Every 5 minutes for testing: `*/5 * * * *`
- Every minute for testing: `* * * * *`

## Managed job behavior

- The plugin writes one managed native cron job that sends the exact message `/lynx-check`.
- `announce: true` keeps the run in an isolated cron session and returns the report automatically.
- Disabling `scheduledLynxCheck.enabled` removes only the managed Lynx Guardian job and leaves other cron jobs untouched.

## Optional overrides

- `timezone` is optional; if omitted, OpenClaw uses the host default timezone for the cron schedule.
- `storePath` is available as an advanced override in `openclaw.plugin.json` for test setups or non-default cron store locations.

## Heartbeat

Heartbeat is still only a fallback for approximate periodic work. For once-per-day `/lynx-check`, cron remains the recommended mechanism.
