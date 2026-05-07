# Token Stats Native Usage Alignment Design

## Scope

This spec applies to the Lynx Guardian local-console token page under:

- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian`
- Frontend route: `/webview/tokens`
- Backend query routes under `/lynx/tokens/*`
- Shared DTO contracts under `shared/src/query-dto.ts` and `shared/src/ingest.ts`
- OpenClaw native usage page used as read-only reference under `D:\all-works\openclaw\ui\src\ui\views\usage*.ts`

This is an incremental product/data-correctness pass. It does not replace the existing local console, existing `token_usage` table, existing `llm_output` hook ingest, or the earlier QA-record work.

## User Problem

The current Token 统计 page is now able to read real provider usage for new records, but the page still feels weaker than OpenClaw native `18789` usage:

- The numbers are shown as raw integers too often, so totals become hard to scan.
- The trend chart is closer to a simple token ledger than the richer native usage view.
- The input/output difference looks suspicious at first glance because output can be tiny next to full prompt/context input.
- Our database currently has fewer historical rows than OpenClaw native transcript scanning, so the page can be correct for new hook data while still behind native all-time usage.

The page should make three truths visible at the same time:

1. New Lynx token rows are real actual usage when `sourceType = "actual"`.
2. Large input/output gaps are normal when the provider returns full prompt/context input and short completion output.
3. Historical coverage is not yet complete until transcript usage rows are backfilled or incrementally synced.

## Current Evidence Snapshot

Observed through the live local gateway on 2026-05-07:

```json
{
  "actualTokens": 2170856,
  "inputTokens": 2149606,
  "outputTokens": 21250,
  "estimatedCount": 0,
  "estimatedTokens": 0,
  "unavailableCount": 0,
  "measurableTokens": 2170856
}
```

Latest `/lynx/tokens/usage?pageNum=1&pageSize=3` rows were all `sourceType: "actual"`, for example:

```json
{
  "sourceType": "actual",
  "inputTokens": 64306,
  "outputTokens": 72,
  "totalTokens": 64378,
  "provider": "bailian",
  "model": "qwen3.5-plus",
  "runId": "a1c9f0bd-4eb4-4216-ab8e-9814c3d73826"
}
```

This proves the current hook path can persist real usage for new model responses. It does not prove historical parity with native usage because native OpenClaw can scan transcript `message.usage` data that predates our hook ingest.

Earlier local comparison in this task found:

```json
{
  "dbAll": { "count": 40, "input": 2149606, "output": 21250, "total": 2170856 },
  "transcriptAll": { "count": 83, "input": 3533779, "output": 26314, "total": 3560093 },
  "dbToday": { "count": 4, "input": 208573, "output": 1124, "total": 209697 },
  "transcriptToday": { "count": 4, "input": 208573, "output": 1124, "total": 209697 }
}
```

Interpretation:

- Today/new data matches because both Lynx hook ingest and native transcript data see the same recent responses.
- All-time data does not match because Lynx does not yet backfill historical transcript usage.
- The output total is real but small: `21,250 / 2,170,856`, roughly 1 percent. The UI should make it visible without pretending it is large.

## Native OpenClaw Reference

Use OpenClaw native usage as the information-architecture reference, not as a file-copy target.

Relevant native files:

- `D:\all-works\openclaw\ui\src\ui\views\usage.ts`
- `D:\all-works\openclaw\ui\src\ui\views\usage-render-overview.ts`
- `D:\all-works\openclaw\ui\src\ui\views\usage-render-details.ts`
- `D:\all-works\openclaw\ui\src\ui\views\usage-metrics.ts`
- `D:\all-works\openclaw\ui\src\styles\usage.css`

Native concepts to mirror:

- Compact token formatting: `999`, `1.0K`, `2.2M`.
- Daily trend chart with a total/by-type mode.
- Stacked token breakdown for output, input, cache write, and cache read.
- Usage mosaic showing weekday and hour density.
- Tooltips/titles that preserve exact values.

Concepts to avoid copying in the first Lynx pass:

- Full session-level native usage explorer.
- Native cost accounting unless Lynx has reliable provider price metadata.
- Native error-rate and latency insights that belong to OpenClaw session analytics rather than this token page.

## Goals

1. Make `/webview/tokens` visually and structurally comparable to OpenClaw native usage for token consumption.
2. Replace most raw number piles with compact K/M display while retaining exact numbers in titles, aria labels, or detail rows.
3. Distinguish token dimensions clearly: context input, model output, cache read, cache write, actual/estimated/unavailable quality, and data origin.
4. Keep tiny but nonzero output usage visible and explicitly labeled.
5. Add a transcript backfill path so Lynx can close the historical gap with native usage.
6. Keep all runtime claims evidence-backed through the local gateway and real `/lynx/tokens/*` endpoints.

## Non-Goals

- Do not build a new standalone analytics product.
- Do not rewrite the local-console frontend shell.
- Do not edit OpenClaw source under `D:\all-works\openclaw`.
- Do not fabricate cost when provider/model price metadata is missing.
- Do not treat transcript backfill as a startup-time scan that surprises users.
- Do not hide exact token values behind compact formatting only.

## Data Semantics

### Existing fields remain valid

`sourceType` keeps its current meaning:

- `actual`: provider/runtime returned usage.
- `estimated`: Lynx estimated usage because actual usage was missing.
- `unavailable`: no reliable usage value exists.

`totalTokens` remains actual-only in summary for compatibility. `measurableTokens` means `actual + estimated`.

### Add source origin

Add a separate `sourceOrigin` concept because `sourceType` and data origin answer different questions.

Recommended values:

- `hook`: row came from the current Lynx `llm_output` hook path.
- `transcript`: row came from OpenClaw transcript `message.usage` backfill/sync.

Rules:

- `sourceType = "actual"` can appear with either `sourceOrigin = "hook"` or `sourceOrigin = "transcript"`.
- Data origin must never change token quality. A transcript row with provider usage is still actual.
- UI badges should show both dimensions when space allows: `实际 · 实时 hook` or `实际 · Transcript 回填`.

### Historical parity strategy

The current hook path should stay the live source for new responses. Transcript sync fills gaps:

1. Scan OpenClaw session JSONL files under the configured session store.
2. Extract rows with nonzero usage from assistant/message entries.
3. Generate stable transcript usage ids.
4. Skip rows already represented in `token_usage`.
5. Insert missing usage rows with `sourceOrigin = "transcript"`.

The backfill must be explicit and observable. It should not run silently on every backend startup.

## Transcript Usage Backfill

### Session store

The scanner should support at least the current Docker-backed path:

```text
%USERPROFILE%\.openclaw\docker-state\agents\main\sessions
```

Inside the container this corresponds to:

```text
/home/node/.openclaw/docker-state/agents/main/sessions
```

The implementation should keep the sessions directory configurable so future OpenClaw state-layout changes do not require code edits.

### Usage extraction

The scanner should accept common usage field shapes:

- `inputTokens`, `input_tokens`, `promptTokens`, `prompt_tokens`, `input`
- `outputTokens`, `output_tokens`, `completionTokens`, `completion_tokens`, `output`
- `cacheReadTokens`, `cache_read_tokens`, `cacheRead`, `cached_tokens`
- `cacheWriteTokens`, `cache_write_tokens`, `cacheWrite`, `cache_creation_input_tokens`
- `totalTokens`, `total_tokens`, `total`

Fallback total:

```text
totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens
```

Rows with all token dimensions equal to `0` are skipped.

### Stable identity

Use a deterministic id:

```text
token-usage:transcript:<sha1(session-file-name|message-id|timestamp|model|total)>
```

If the transcript has a stable response id, include it. If not, use the JSONL file name plus timestamp and model. The backfill result must report how many rows were inserted, skipped as duplicates, or skipped because no usage was present.

### Duplicate handling

Avoid double-counting hook rows and transcript rows for the same response:

- Prefer response id matching when available in payload JSON.
- Otherwise match by `sessionKey + runId + occurredAtMs window + provider + model + totalTokens`.
- When the match is ambiguous, skip insertion and report it as `ambiguousDuplicateCount`.

This is conservative on purpose. Missing one historical duplicate is better than inflating totals.

### Backfill endpoint

Add an ingest-protected endpoint:

```text
POST /lynx/internal/v1/tokens/backfill-transcripts
```

Request:

```ts
interface TokenTranscriptBackfillRequestDto {
  sessionsDir?: string;
  agentId?: string;
  dryRun?: boolean;
  fromMs?: number;
  toMs?: number;
}
```

Response:

```ts
interface TokenTranscriptBackfillResponseDto {
  ok: boolean;
  dryRun: boolean;
  scannedFiles: number;
  scannedLines: number;
  scannedUsageRows: number;
  insertedCount: number;
  duplicateCount: number;
  ambiguousDuplicateCount: number;
  skippedNoUsageCount: number;
  skippedInvalidCount: number;
  fromMs?: number;
  toMs?: number;
}
```

The first implementation can expose this for operator-triggered sync. A later UI button can call it only after explicit user confirmation.

## Query API Additions

### Token usage list

Extend:

```text
GET /lynx/tokens/usage
```

Add query:

```text
sourceOrigin=hook|transcript
```

Each row should include:

```ts
sourceOrigin?: "hook" | "transcript";
```

### Token summary

Extend:

```text
GET /lynx/tokens/summary
```

Add optional origin counts/totals:

```ts
originTotals?: Array<{
  sourceOrigin: "hook" | "transcript";
  totalTokens: number;
  count: number;
}>;
```

### Token trend

Extend trend points to include all four token dimensions:

```ts
interface TokenTrendPointDto {
  bucketStartMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
}
```

Existing clients that only read input/output/total should keep working.

### Token heatmap

Add:

```text
GET /lynx/tokens/heatmap?fromMs=...&toMs=...&provider=...&model=...
```

Response:

```ts
interface TokenHeatmapDto {
  timeZone: "local";
  totalTokens: number;
  hourTotals: Array<{ hour: number; totalTokens: number }>;
  weekdayTotals: Array<{ weekday: number; label: string; totalTokens: number }>;
}
```

The backend should compute this from `token_usage.occurred_at` in the server/local timezone used by the console. If UTC support is later needed, add an explicit `timeZone=utc|local` query rather than guessing.

## Frontend UX Design

### Page hierarchy

The Token page should be a work-focused dashboard, not a marketing/landing page.

Recommended layout:

1. Top summary band:
   - 当前范围消耗总量
   - 上下文输入
   - 模型输出
   - 真实覆盖
2. Main trend panel:
   - segmented control: `总量` / `按类型`
   - daily/hour bars depending on range
   - stacked segments for input/output/cache read/cache write in by-type mode
3. Breakdown strip:
   - context input, model output, cache read, cache write
   - compact values plus percentages
4. Usage mosaic:
   - weekday density
   - 0-23 hour density
5. Detail table:
   - time, provider/model, total, input/output/cache, source quality, data origin, session/run link

### Compact formatting

Use one shared formatter:

```ts
formatCompactTokens(0) === "0"
formatCompactTokens(999) === "999"
formatCompactTokens(1000) === "1.0K"
formatCompactTokens(64306) === "64.3K"
formatCompactTokens(2170856) === "2.2M"
```

Rules:

- Compact display is for visual scan.
- Exact integer display remains in `title`, `aria-label`, detail table hover text, or secondary copy.
- Do not mix comma-format and compact-format in the same visual tier unless the exact value is intentionally secondary.

### Input/output explanation

Labels should avoid implying output is missing:

- Use `上下文输入`, not only `输入`.
- Use `模型输出`, not only `输出`.
- Show ratio as `输入/输出 101.2:1` when output is nonzero.
- If output is zero, show `模型输出 0` and avoid dividing by zero.
- Nonzero output segments should have a minimum visual thickness in stacked bars, while the tooltip keeps exact values.

This directly addresses the confusing case where one row has `64.3K` input and only `72` output. That is plausible actual usage, not proof the output is absent.

### Chart behavior

Trend:

- `last1h` and `last24h` use hour buckets.
- `last7d`, `last30d`, and `all` use day buckets.
- Empty trend renders a clear empty state.
- `总量` mode emphasizes totalTokens.
- `按类型` mode stacks output, input, cache write, cache read.

Breakdown:

- Preserve native ordering in visual bars: output, input, cache write, cache read.
- Keep legend names localized in readable Chinese.
- If a dimension is zero, keep it in the legend but render a muted value.

Mosaic:

- Weekday cells show compact token totals.
- Hour cells use intensity based on the max hour in the current filter range.
- Hour cell titles include exact-ish compact value and hour label.
- If no timeline data exists, show one compact empty state.

Detail table:

- Total token cell uses compact display with exact title.
- Input/output cell can render `64.3K -> 72` to keep the asymmetry obvious.
- Source badge examples:
  - `实际`
  - `估算`
  - `不可用`
  - `实时 hook`
  - `Transcript 回填`

## Visual Direction

The page should stay in the local console's utilitarian dashboard language:

- dense but breathable grid
- small-radius cards
- no page-level hero
- no decorative gradient blobs
- charts built for scanning, comparison, and repeated operational use
- mobile layout stacks summary, trend, mosaic, and table without text overlap

Token colors:

- context input: console accent blue/teal
- model output: distinct violet or magenta accent
- cache write: amber
- cache read: green
- unavailable/estimated quality: neutral/warn tone

The palette must not collapse into one blue-purple theme. Cache colors should make the four token dimensions distinguishable.

## Testing Requirements

Frontend:

- Unit tests for `formatCompactTokens`.
- `TokensPage` tests for compact summary values, exact-value titles, trend total/by-type toggle, heatmap rendering, and time-range requests.
- Tests for estimated-only measurable usage should continue to prove the page does not show an empty dashboard.
- Tests should assert readable Chinese strings, not mojibake fragments.

Backend:

- Migration test for `source_origin` on `token_usage`.
- Repository/route tests for `sourceOrigin` filtering.
- Route test for `/lynx/tokens/heatmap`.
- Backfill scanner tests with JSONL fixtures covering actual usage, no usage, duplicate response id, and dry-run mode.
- Existing token summary tests must keep passing.

Shared:

- DTO build/typecheck after adding heatmap/backfill/sourceOrigin contracts.

Runtime:

- After implementation, run the repo sync flow before claiming behavior changed:

```powershell
node scripts/verify-dev-sync.mjs
.\scripts\sync-openclaw-dev-ready.ps1 --logs 200
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:18789/healthz
```

- Read back:

```powershell
Invoke-RestMethod -UseBasicParsing http://127.0.0.1:18789/lynx/tokens/summary
Invoke-RestMethod -UseBasicParsing 'http://127.0.0.1:18789/lynx/tokens/usage?pageNum=1&pageSize=10'
Invoke-RestMethod -UseBasicParsing 'http://127.0.0.1:18789/lynx/tokens/heatmap'
```

- If transcript backfill is executed, compare before/after summary totals and confirm new rows have `sourceOrigin = "transcript"`.

## Implementation Order

1. Add compact token formatting and frontend tests.
2. Add `sourceOrigin` contracts, migration, repository mapping, and filtering.
3. Add token heatmap backend route and frontend API.
4. Add transcript usage scanner/backfill endpoint.
5. Redesign the Token page panels and charts to mirror native information structure.
6. Run local tests, then sync and verify through the real OpenClaw gateway.

## Acceptance Criteria

- `/webview/tokens` shows compact K/M values in summary, trend, breakdown, mosaic, and table.
- Exact token values are still accessible through titles/aria/detail display.
- Top-level summary clearly separates total, context input, model output, and actual coverage.
- Trend supports total/by-type display.
- Breakdown shows input/output/cache read/cache write with percentages.
- Mosaic shows weekday/hour density for the selected range.
- Rows can distinguish token quality from origin.
- Historical transcript rows can be backfilled without double-counting hook rows.
- Runtime verification proves the running gateway serves the updated page/API.
