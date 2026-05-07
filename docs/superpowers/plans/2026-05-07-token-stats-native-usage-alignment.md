# Token Stats Native Usage Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/webview/tokens` match the useful chart information structure of OpenClaw native usage while preserving real exact token values and closing the transcript history gap.

**Architecture:** Keep the current local-console token API and `token_usage` table as the live foundation. Add a compact formatter, a token-origin dimension, heatmap/backfill contracts, and a Token page layout that mirrors native daily chart, type breakdown, and usage mosaic without copying native source code.

**Tech Stack:** Go backend, SQLite, TypeScript shared DTOs, React + Vite frontend, Ant Design where already used, Vitest/Testing Library, focused Go contract tests, existing OpenClaw sync scripts for runtime proof.

---

## Source Spec

Implement against:

- `docs/superpowers/specs/2026-05-07-token-stats-native-usage-alignment-design.md`

Read-only native reference:

- `D:\all-works\openclaw\ui\src\ui\views\usage.ts`
- `D:\all-works\openclaw\ui\src\ui\views\usage-render-overview.ts`
- `D:\all-works\openclaw\ui\src\ui\views\usage-render-details.ts`
- `D:\all-works\openclaw\ui\src\ui\views\usage-metrics.ts`
- `D:\all-works\openclaw\ui\src\styles\usage.css`

Related local-console source of truth that remains valid:

- `docs/superpowers/specs/2026-04-29-lynx-local-console-product-ux-data-correctness-spec.md`
- `docs/superpowers/plans/2026-04-29-lynx-local-console-product-ux-data-correctness.md`

## Current Baseline

Already present and should be preserved:

- `shared/src/query-dto.ts` has `PageResponse<T>` and token summary DTOs.
- `backend/internal/repo/tokens.go` has list, summary, and trend queries.
- `backend/internal/routes/query.go` registers `/tokens/usage`, `/tokens/summary`, and `/tokens/trend`.
- `frontend/src/pages/TokensPage.tsx` has a working page with summary, range filter, trend, and table.
- `/lynx/tokens/summary` currently returns real all-time actual totals, including `actualTokens=2170856`, `inputTokens=2149606`, and `outputTokens=21250`.

Missing from the target design:

- shared compact token formatter
- `sourceOrigin` contract and persistence
- heatmap API
- transcript usage scanner/backfill
- native-like total/by-type trend toggle
- weekday/hour usage mosaic
- compact K/M display across summary, chart, breakdown, mosaic, and table

## File Map

Frontend:

- Modify: `frontend/src/utils/format.ts`
- Create: `frontend/test/utils/format.test.ts`
- Modify: `frontend/src/api/tokens.ts`
- Modify: `frontend/src/pages/TokensPage.tsx`
- Modify: `frontend/test/pages/TokensPage.test.tsx`
- Modify: `frontend/src/styles/theme.css`
- Modify: `frontend/src/data/mock-console.ts`

Shared:

- Modify: `shared/src/query-dto.ts`
- Modify: `shared/src/ingest.ts`

Backend:

- Modify: `backend/internal/db/migrations/001_init.sql`
- Modify: `backend/internal/db/migrate.go`
- Modify: `backend/internal/config/config.go`
- Modify: `backend/internal/repo/ingest.go`
- Modify: `backend/internal/repo/tokens.go`
- Modify: `backend/internal/repo/qa_records.go`
- Modify: `backend/internal/routes/query.go`
- Modify: `backend/internal/app/app.go`
- Create: `backend/internal/tokens/transcript_usage.go`
- Create: `backend/internal/tokens/backfill_service.go`
- Create: `backend/test/app_token_origin_heatmap_contract_test.go`
- Create: `backend/test/token_transcript_backfill_contract_test.go`
- Modify: `backend/test/db_migration_contract_test.go`
- Modify: `backend/test/app_parity_test.go`

Runtime validation:

- Use existing `scripts/verify-dev-sync.mjs`
- Use existing `scripts/sync-openclaw-dev-ready.ps1`

---

## Phase 0: Pre-Flight

### Task 0.1: Confirm Starting State

**Files:** none

- [ ] **Step 1: Inspect worktree**

Run:

```powershell
git status --short
```

Expected:

- New planning docs may be dirty.
- No unrelated user changes are reverted or reformatted.

- [ ] **Step 2: Read the design spec as UTF-8**

Run:

```powershell
node -e "const fs=require('fs'); const p='docs/superpowers/specs/2026-05-07-token-stats-native-usage-alignment-design.md'; const s=fs.readFileSync(p,'utf8'); console.log(s.slice(0,1200));"
```

Expected:

- Chinese text is readable.
- The spec includes compact formatting, source origin, heatmap, and transcript backfill.

- [ ] **Step 3: Verify live token endpoint baseline**

Run:

```powershell
Invoke-RestMethod -UseBasicParsing http://127.0.0.1:18789/lynx/tokens/summary | ConvertTo-Json -Depth 8
Invoke-RestMethod -UseBasicParsing 'http://127.0.0.1:18789/lynx/tokens/usage?pageNum=1&pageSize=3' | ConvertTo-Json -Depth 8
```

Expected:

- Summary returns JSON.
- Usage rows include `sourceType`.
- This is a baseline read, not proof that new work is already synced.

---

## Phase 1: Compact Token Formatting

### Task 1.1: Add Formatter Tests

**Files:**

- Create: `frontend/test/utils/format.test.ts`
- Modify: `frontend/src/utils/format.ts`

- [ ] **Step 1: Write failing formatter tests**

Create `frontend/test/utils/format.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { formatCompactTokens, formatInteger } from "../../src/utils/format";

describe("formatCompactTokens", () => {
  it("keeps small token values exact", () => {
    expect(formatCompactTokens(0)).toBe("0");
    expect(formatCompactTokens(72)).toBe("72");
    expect(formatCompactTokens(999)).toBe("999");
  });

  it("formats thousands and millions with compact units", () => {
    expect(formatCompactTokens(1_000)).toBe("1.0K");
    expect(formatCompactTokens(64_306)).toBe("64.3K");
    expect(formatCompactTokens(2_170_856)).toBe("2.2M");
  });

  it("rounds invalid or negative values into the token display domain", () => {
    expect(formatCompactTokens(Number.NaN)).toBe("0");
    expect(formatCompactTokens(-5)).toBe("0");
  });

  it("keeps exact integer formatting available for titles", () => {
    expect(formatInteger(2_170_856)).toBe("2,170,856");
  });
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```powershell
cd frontend
npx.cmd vitest run --no-color --reporter verbose test/utils/format.test.ts
```

Expected:

- Failure because `formatCompactTokens` is not exported yet.

### Task 1.2: Implement Compact Formatter

**Files:**

- Modify: `frontend/src/utils/format.ts`

- [ ] **Step 1: Add the formatter**

Add:

```ts
function normalizeTokenValue(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.round(value);
}

export function formatCompactTokens(value: number): string {
  const safeValue = normalizeTokenValue(value);
  if (safeValue >= 1_000_000) {
    return `${(safeValue / 1_000_000).toFixed(1)}M`;
  }
  if (safeValue >= 1_000) {
    return `${(safeValue / 1_000).toFixed(1)}K`;
  }
  return String(safeValue);
}
```

- [ ] **Step 2: Run formatter tests**

Run:

```powershell
cd frontend
npx.cmd vitest run --no-color --reporter verbose test/utils/format.test.ts
```

Expected:

- `formatCompactTokens` tests pass.

---

## Phase 2: Token Origin Contract

### Task 2.1: Extend Shared DTOs

**Files:**

- Modify: `shared/src/query-dto.ts`
- Modify: `shared/src/ingest.ts`
- Modify: `frontend/src/api/tokens.ts`

- [ ] **Step 1: Add the token origin type**

In `shared/src/query-dto.ts`, add near token DTOs:

```ts
export type TokenSourceOrigin = "hook" | "transcript";
```

Extend `TokenUsageListItemDto`:

```ts
sourceOrigin?: TokenSourceOrigin;
```

Extend `TokenSummaryDto`:

```ts
originTotals?: Array<{
  sourceOrigin: TokenSourceOrigin;
  totalTokens: number;
  count: number;
}>;
```

In `shared/src/ingest.ts`, extend `TokenUsageData`:

```ts
sourceOrigin?: "hook" | "transcript";
```

In `frontend/src/api/tokens.ts`, extend `TokenUsageListQuery`:

```ts
sourceOrigin?: "hook" | "transcript";
```

- [ ] **Step 2: Build shared DTOs**

Run:

```powershell
npm --prefix shared run build
```

Expected:

- Shared package builds.

### Task 2.2: Add Token Origin Migration

**Files:**

- Modify: `backend/internal/db/migrations/001_init.sql`
- Modify: `backend/internal/db/migrate.go`
- Modify: `backend/test/db_migration_contract_test.go`

- [ ] **Step 1: Write/extend migration contract test**

In `backend/test/db_migration_contract_test.go`, assert `token_usage` includes:

```go
assertTableColumn(t, database, "token_usage", "source_origin")
```

Also assert an existing database without the column receives it after `db.Migrate(database)`.

- [ ] **Step 2: Add schema column**

In `backend/internal/db/migrations/001_init.sql`, add to `token_usage`:

```sql
  source_origin TEXT NOT NULL DEFAULT 'hook' CHECK (
    source_origin IN ('hook', 'transcript')
  ),
```

Add index:

```sql
CREATE INDEX IF NOT EXISTS idx_token_usage_origin_occurred_at
  ON token_usage (source_origin, occurred_at DESC);
```

- [ ] **Step 3: Add migration helper**

In `backend/internal/db/migrate.go`, add an ensure function equivalent to the existing `ensureTokenUsageSourceTypeColumn`, with this behavior:

```go
ALTER TABLE token_usage ADD COLUMN source_origin TEXT NOT NULL DEFAULT 'hook'
```

Then create the index:

```go
CREATE INDEX IF NOT EXISTS idx_token_usage_origin_occurred_at
  ON token_usage (source_origin, occurred_at DESC)
```

Call the helper from `Migrate`.

- [ ] **Step 4: Run migration tests**

Run:

```powershell
cd backend
go test ./test -run TestDatabaseMigration -count=1
```

Expected:

- Migration contract passes.
- Existing rows default to `source_origin = 'hook'`.

### Task 2.3: Persist And Query Token Origin

**Files:**

- Modify: `backend/internal/repo/ingest.go`
- Modify: `backend/internal/repo/tokens.go`
- Modify: `backend/internal/repo/qa_records.go`
- Modify: `backend/internal/routes/query.go`
- Create: `backend/test/app_token_origin_heatmap_contract_test.go`
- Modify: `backend/test/app_parity_test.go`

- [ ] **Step 1: Write route contract test for source origin**

Create `backend/test/app_token_origin_heatmap_contract_test.go` with a test that ingests two token rows:

```go
func TestTokenUsageSourceOriginCanBeFiltered(t *testing.T) {
	handler := buildTestApp(t)
	ingestTokenUsage(t, handler, map[string]any{
		"usageEventId": "token-usage:hook:1",
		"provider": "bailian",
		"model": "qwen3.5-plus",
		"sourceType": "actual",
		"sourceOrigin": "hook",
		"inputTokens": 1000,
		"outputTokens": 10,
		"totalTokens": 1010,
	})
	ingestTokenUsage(t, handler, map[string]any{
		"usageEventId": "token-usage:transcript:1",
		"provider": "bailian",
		"model": "qwen3.5-plus",
		"sourceType": "actual",
		"sourceOrigin": "transcript",
		"inputTokens": 2000,
		"outputTokens": 20,
		"totalTokens": 2020,
	})

	body := decodeObjectStatus(t, doJSON(t, handler, http.MethodGet, "/lynx/tokens/usage?sourceOrigin=transcript", nil, false), http.StatusOK)
	items := expectItems(t, body)
	if len(items) != 1 {
		t.Fatalf("expected 1 transcript row, got %d", len(items))
	}
	expectString(t, items[0], "sourceOrigin", "transcript")
	expectNumber(t, items[0], "totalTokens", 2020)
}
```

Use existing test helpers from `backend/test/app_parity_test.go` or the nearest token contract test. Keep helper names consistent with the current test package.

- [ ] **Step 2: Run the test and confirm it fails**

Run:

```powershell
cd backend
go test ./test -run TestTokenUsageSourceOriginCanBeFiltered -count=1
```

Expected:

- Failure because the route/repository does not map `sourceOrigin` yet.

- [ ] **Step 3: Update ingest persistence**

In `backend/internal/repo/ingest.go`:

```go
type TokenUsageData struct {
	UsageEventID       string         `json:"usageEventId"`
	QARecordID         *string        `json:"qaRecordId,omitempty"`
	SessionKey         *string        `json:"sessionKey,omitempty"`
	RunID              *string        `json:"runId,omitempty"`
	AgentID            *string        `json:"agentId,omitempty"`
	Provider           string         `json:"provider"`
	Model              string         `json:"model"`
	SourceType         *string        `json:"sourceType,omitempty"`
	SourceOrigin       *string        `json:"sourceOrigin,omitempty"`
	InputTokens        *int64         `json:"inputTokens,omitempty"`
	OutputTokens       *int64         `json:"outputTokens,omitempty"`
	CacheReadTokens    *int64         `json:"cacheReadTokens,omitempty"`
	CacheWriteTokens   *int64         `json:"cacheWriteTokens,omitempty"`
	TotalTokens        int64          `json:"totalTokens"`
	AssistantTextCount *int64         `json:"assistantTextCount,omitempty"`
	IsEstimated        *bool          `json:"isEstimated,omitempty"`
	PayloadJSON        map[string]any `json:"payloadJson,omitempty"`
}
```

Add:

```go
func normalizeTokenSourceOrigin(sourceOrigin *string) string {
	if sourceOrigin == nil {
		return "hook"
	}
	switch strings.ToLower(strings.TrimSpace(*sourceOrigin)) {
	case "transcript":
		return "transcript"
	default:
		return "hook"
	}
}
```

Use this value in `INSERT OR IGNORE INTO token_usage`.

- [ ] **Step 4: Update list/summary/trend mapping**

In `backend/internal/repo/tokens.go`:

- add `SourceOrigin *string` to `TokenUsageListQuery` and `TokenSummaryQuery`
- add `SourceOrigin string` to `tokenUsageRow`
- filter with `filter.AppendEquals("source_origin", query.SourceOrigin)`
- select `source_origin`
- map `sourceOrigin`
- include `originTotals` in summary

Summary origin query:

```sql
SELECT source_origin, COALESCE(SUM(total_tokens), 0), COUNT(*)
FROM token_usage
WHERE source_type IN ('actual', 'estimated')
GROUP BY source_origin
ORDER BY source_origin ASC
```

Use the same range/provider/model/session filters as the main summary query.

- [ ] **Step 5: Update routes**

In `backend/internal/routes/query.go`, read `sourceOrigin` for:

- `/tokens/usage`
- `/tokens/summary`
- `/tokens/trend`

```go
SourceOrigin: httpserver.ReadString(values, "sourceOrigin"),
```

- [ ] **Step 6: Update QA token node mapping**

In `backend/internal/repo/qa_records.go`, include `source_origin` in token usage selects and ensure related QA token nodes can display it.

- [ ] **Step 7: Run backend token origin tests**

Run:

```powershell
cd backend
go test ./test -run 'TestTokenUsageSourceOriginCanBeFiltered|TestAppParity' -count=1
```

Expected:

- Source origin filters work.
- Existing token parity tests still pass.

---

## Phase 3: Token Heatmap API

### Task 3.1: Add Shared Heatmap Contract

**Files:**

- Modify: `shared/src/query-dto.ts`
- Modify: `frontend/src/api/tokens.ts`

- [ ] **Step 1: Add DTO**

In `shared/src/query-dto.ts`:

```ts
export interface TokenHeatmapDto {
  timeZone: "local";
  totalTokens: number;
  hourTotals: Array<{ hour: number; totalTokens: number }>;
  weekdayTotals: Array<{ weekday: number; label: string; totalTokens: number }>;
}
```

In `frontend/src/api/tokens.ts`:

```ts
import type { TokenHeatmapDto } from "@lynx/local-console-shared";

export function getTokenHeatmap(query: TokenTimeRangeQuery = {}): Promise<TokenHeatmapDto> {
  return fetchJson<TokenHeatmapDto>(`/tokens/heatmap${buildQueryString(query)}`);
}
```

- [ ] **Step 2: Build shared package**

Run:

```powershell
npm --prefix shared run build
```

Expected:

- Shared build succeeds.

### Task 3.2: Implement Backend Heatmap

**Files:**

- Modify: `backend/internal/repo/tokens.go`
- Modify: `backend/internal/routes/query.go`
- Modify: `backend/test/app_token_origin_heatmap_contract_test.go`

- [ ] **Step 1: Write heatmap route test**

Add test:

```go
func TestTokenHeatmapReturnsWeekdayAndHourTotals(t *testing.T) {
	handler := buildTestApp(t)
	ingestTokenUsageAt(t, handler, "token-usage:heatmap:1", 1_778_169_600_000, 100, 10)
	ingestTokenUsageAt(t, handler, "token-usage:heatmap:2", 1_778_173_200_000, 200, 20)

	body := decodeObjectStatus(t, doJSON(t, handler, http.MethodGet, "/lynx/tokens/heatmap", nil, false), http.StatusOK)
	expectString(t, body, "timeZone", "local")
	expectNumber(t, body, "totalTokens", 330)
	hours := body["hourTotals"].([]any)
	weekdays := body["weekdayTotals"].([]any)
	if len(hours) != 24 {
		t.Fatalf("expected 24 hour totals, got %d", len(hours))
	}
	if len(weekdays) != 7 {
		t.Fatalf("expected 7 weekday totals, got %d", len(weekdays))
	}
}
```

Use existing test helper style; replace direct type assertions with helper functions if the test package already has them.

- [ ] **Step 2: Run the test and confirm it fails**

Run:

```powershell
cd backend
go test ./test -run TestTokenHeatmapReturnsWeekdayAndHourTotals -count=1
```

Expected:

- Failure because `/lynx/tokens/heatmap` is not registered.

- [ ] **Step 3: Add repository method**

In `backend/internal/repo/tokens.go`, add:

```go
type TokenHeatmapQuery struct {
	TokenSummaryQuery
}
```

Add method behavior:

- initialize 24 hour buckets and 7 weekday buckets to zero
- filter `source_type IN ('actual','estimated')`
- apply existing time/session/run/provider/model/sourceOrigin filters
- use SQLite local time extraction:

```sql
CAST(strftime('%H', occurred_at / 1000, 'unixepoch', 'localtime') AS INTEGER)
CAST(strftime('%w', occurred_at / 1000, 'unixepoch', 'localtime') AS INTEGER)
```

- return:

```go
map[string]any{
	"timeZone": "local",
	"totalTokens": totalTokens,
	"hourTotals": hourTotals,
	"weekdayTotals": weekdayTotals,
}
```

Weekday labels:

```go
[]string{"周日", "周一", "周二", "周三", "周四", "周五", "周六"}
```

- [ ] **Step 4: Register route**

In `backend/internal/routes/query.go`, inside `RegisterTokens`, add:

```go
router.GET("/tokens/heatmap", func(c *gin.Context) {
	values := c.Request.URL.Query()
	result, err := repository.GetHeatmap(repo.TokenHeatmapQuery{
		TokenSummaryQuery: repo.TokenSummaryQuery{
			FromMs:       httpserver.ReadInt64(values, "fromMs"),
			ToMs:         httpserver.ReadInt64(values, "toMs"),
			SessionKey:   httpserver.ReadString(values, "sessionKey"),
			RunID:        httpserver.ReadString(values, "runId"),
			Provider:     httpserver.ReadString(values, "provider"),
			Model:        httpserver.ReadString(values, "model"),
			SourceOrigin: httpserver.ReadString(values, "sourceOrigin"),
		},
	})
	if err != nil {
		c.JSON(500, gin.H{"ok": false, "message": err.Error()})
		return
	}
	c.JSON(200, result)
})
```

- [ ] **Step 5: Run heatmap tests**

Run:

```powershell
cd backend
go test ./test -run 'TestTokenHeatmapReturnsWeekdayAndHourTotals|TestTokenUsageSourceOriginCanBeFiltered' -count=1
```

Expected:

- Heatmap and origin tests pass.

---

## Phase 4: Transcript Usage Backfill

### Task 4.1: Add Config For Session Store

**Files:**

- Modify: `backend/internal/config/config.go`

- [ ] **Step 1: Add config field**

Add to `Config`:

```go
OpenClawSessionsDir string
```

In `Resolve`, compute:

```go
defaultSessionsDir := filepath.Join(home, ".openclaw", "docker-state", "agents", "main", "sessions")
sessionsDir := envOr("LYNX_OPENCLAW_SESSIONS_DIR", defaultSessionsDir)
sessionsDir = expandHomePlaceholder(sessionsDir, home)
```

Return it in `Config`.

- [ ] **Step 2: Run backend compile**

Run:

```powershell
cd backend
go test ./internal/config -count=1
```

Expected:

- Config package compiles. If the package has no tests, Go reports no test files and exits successfully.

### Task 4.2: Implement Transcript Scanner Tests

**Files:**

- Create: `backend/internal/tokens/transcript_usage.go`
- Create: `backend/test/token_transcript_backfill_contract_test.go`

- [ ] **Step 1: Write scanner contract test**

Create test fixtures inside `t.TempDir()`:

```json
{"id":"msg-1","role":"assistant","model":"qwen3.5-plus","created_at":1778120197215,"usage":{"inputTokens":64306,"outputTokens":72,"totalTokens":64378}}
{"id":"msg-2","role":"assistant","model":"qwen3.5-plus","created_at":1778120198215,"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}
{"id":"msg-3","role":"assistant","model":"qwen3.5-plus","created_at":1778120199215}
```

Expected assertions:

```go
events, stats, err := tokens.ScanTranscriptUsage(tokens.TranscriptScanOptions{
	SessionsDir: tempDir,
	AgentID: "main",
})
if err != nil {
	t.Fatal(err)
}
if len(events) != 2 {
	t.Fatalf("expected 2 usage events, got %d", len(events))
}
if stats.ScannedFiles != 1 || stats.ScannedUsageRows != 2 || stats.SkippedNoUsageCount != 1 {
	t.Fatalf("unexpected stats: %+v", stats)
}
```

Assert first event:

```go
expectString(t, events[0], "sourceOrigin", "transcript")
expectString(t, events[0], "sourceType", "actual")
expectNumber(t, events[0], "inputTokens", 64306)
expectNumber(t, events[0], "outputTokens", 72)
expectNumber(t, events[0], "totalTokens", 64378)
```

- [ ] **Step 2: Run the scanner test and confirm it fails**

Run:

```powershell
cd backend
go test ./test -run TestTranscriptUsageScannerExtractsProviderUsage -count=1
```

Expected:

- Failure because the scanner package does not exist or does not return expected rows.

### Task 4.3: Implement Scanner

**Files:**

- Create: `backend/internal/tokens/transcript_usage.go`

- [ ] **Step 1: Add scanner types**

Add:

```go
package tokens

type TranscriptScanOptions struct {
	SessionsDir string
	AgentID    string
	FromMs     *int64
	ToMs       *int64
}

type TranscriptScanStats struct {
	ScannedFiles           int
	ScannedLines           int
	ScannedUsageRows       int
	SkippedNoUsageCount    int
	SkippedInvalidCount    int
}

type TranscriptUsageEvent struct {
	UsageEventID       string
	SessionKey         string
	RunID              string
	AgentID            string
	Provider           string
	Model              string
	SourceType         string
	SourceOrigin       string
	InputTokens        int64
	OutputTokens       int64
	CacheReadTokens    int64
	CacheWriteTokens   int64
	TotalTokens        int64
	AssistantTextCount int64
	OccurredAtMs       int64
	PayloadJSON        map[string]any
}
```

- [ ] **Step 2: Add extraction rules**

Implement:

- iterate `*.jsonl` files in lexical order
- parse each line into `map[string]any`
- accept assistant/message entries containing `usage`
- read token fields by the names listed in the design spec
- skip rows with total zero
- use `sha1` for stable id:

```text
token-usage:transcript:<hex>
```

- set:

```go
SourceType: "actual"
SourceOrigin: "transcript"
AssistantTextCount: 1
Provider: providerFromRecordOrUnknown(record)
Model: modelFromRecordOrUnknown(record)
SessionKey: "agent:" + agentID + ":main"
```

- [ ] **Step 3: Run scanner test**

Run:

```powershell
cd backend
go test ./test -run TestTranscriptUsageScannerExtractsProviderUsage -count=1
```

Expected:

- Scanner test passes.

### Task 4.4: Add Backfill Service And Protected Route

**Files:**

- Create: `backend/internal/tokens/backfill_service.go`
- Modify: `backend/internal/app/app.go`
- Modify: `backend/internal/routes/query.go`
- Modify: `backend/test/token_transcript_backfill_contract_test.go`

- [ ] **Step 1: Write dry-run route test**

Add test:

```go
func TestTokenTranscriptBackfillDryRunDoesNotInsertRows(t *testing.T) {
	handler := buildTestAppWithSessionsDir(t, writeTranscriptFixture(t))
	body := map[string]any{"dryRun": true}
	result := decodeObjectStatus(t, doJSON(t, handler, http.MethodPost, "/lynx/internal/v1/tokens/backfill-transcripts", body, true), http.StatusOK)
	expectBool(t, result, "dryRun", true)
	expectNumber(t, result, "scannedUsageRows", 2)
	expectNumber(t, result, "insertedCount", 0)

	usage := decodeObjectStatus(t, doJSON(t, handler, http.MethodGet, "/lynx/tokens/usage?sourceOrigin=transcript", nil, false), http.StatusOK)
	expectNumber(t, usage, "total", 0)
}
```

Add non-dry-run test:

```go
func TestTokenTranscriptBackfillInsertsTranscriptRowsOnce(t *testing.T) {
	handler := buildTestAppWithSessionsDir(t, writeTranscriptFixture(t))
	body := map[string]any{"dryRun": false}
	first := decodeObjectStatus(t, doJSON(t, handler, http.MethodPost, "/lynx/internal/v1/tokens/backfill-transcripts", body, true), http.StatusOK)
	expectNumber(t, first, "insertedCount", 2)

	second := decodeObjectStatus(t, doJSON(t, handler, http.MethodPost, "/lynx/internal/v1/tokens/backfill-transcripts", body, true), http.StatusOK)
	expectNumber(t, second, "duplicateCount", 2)
	expectNumber(t, second, "insertedCount", 0)
}
```

- [ ] **Step 2: Implement service**

In `backend/internal/tokens/backfill_service.go`, define:

```go
type BackfillRequest struct {
	SessionsDir string `json:"sessionsDir,omitempty"`
	AgentID     string `json:"agentId,omitempty"`
	DryRun      bool   `json:"dryRun,omitempty"`
	FromMs      *int64 `json:"fromMs,omitempty"`
	ToMs        *int64 `json:"toMs,omitempty"`
}

type BackfillResponse struct {
	OK                       bool  `json:"ok"`
	DryRun                   bool  `json:"dryRun"`
	ScannedFiles             int   `json:"scannedFiles"`
	ScannedLines             int   `json:"scannedLines"`
	ScannedUsageRows         int   `json:"scannedUsageRows"`
	InsertedCount            int   `json:"insertedCount"`
	DuplicateCount           int   `json:"duplicateCount"`
	AmbiguousDuplicateCount  int   `json:"ambiguousDuplicateCount"`
	SkippedNoUsageCount      int   `json:"skippedNoUsageCount"`
	SkippedInvalidCount      int   `json:"skippedInvalidCount"`
	FromMs                   *int64 `json:"fromMs,omitempty"`
	ToMs                     *int64 `json:"toMs,omitempty"`
}
```

The service should:

- call `ScanTranscriptUsage`
- skip insert when `DryRun` is true
- insert via the existing ingest repository path so table normalization stays shared
- count `INSERT OR IGNORE` duplicates as `duplicateCount`

- [ ] **Step 3: Register protected route**

In `backend/internal/app/app.go`, create the backfill service after repositories are initialized and register it on `ingestGroup`.

In `backend/internal/routes/query.go`, add:

```go
func RegisterTokenBackfill(router gin.IRoutes, service *tokens.BackfillService) {
	router.POST("/tokens/backfill-transcripts", func(c *gin.Context) {
		var request tokens.BackfillRequest
		if err := c.ShouldBindJSON(&request); err != nil {
			c.JSON(400, gin.H{"ok": false, "message": err.Error()})
			return
		}
		result, err := service.BackfillTranscripts(c.Request.Context(), request)
		if err != nil {
			c.JSON(500, gin.H{"ok": false, "message": err.Error()})
			return
		}
		c.JSON(200, result)
	})
}
```

- [ ] **Step 4: Run backfill tests**

Run:

```powershell
cd backend
go test ./test -run 'TestTokenTranscriptBackfill' -count=1
```

Expected:

- Dry run does not insert.
- Non-dry-run inserts once and reports duplicates on the second run.

---

## Phase 5: Frontend Native-Like Token Page

### Task 5.1: Update Mock Data And API Test Fixture

**Files:**

- Modify: `frontend/src/data/mock-console.ts`
- Modify: `frontend/test/pages/TokensPage.test.tsx`

- [ ] **Step 1: Update token mock data**

Ensure mocks include:

```ts
sourceOrigin: "hook",
cacheReadTokens: 0,
cacheWriteTokens: 0,
originTotals: [{ sourceOrigin: "hook", totalTokens: 2170856, count: 40 }],
```

Trend points should include:

```ts
{
  bucketStartMs: 1_778_120_000_000,
  inputTokens: 64_306,
  outputTokens: 72,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 64_378,
}
```

Heatmap mock should include 24 hours and 7 weekdays.

- [ ] **Step 2: Update fetch mocks**

In `frontend/test/pages/TokensPage.test.tsx`, add branch:

```ts
if (url.startsWith("/lynx/tokens/heatmap")) {
  return createJsonResponse({
    timeZone: "local",
    totalTokens: 64_378,
    hourTotals: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      totalTokens: hour === 21 ? 64_378 : 0,
    })),
    weekdayTotals: [
      { weekday: 0, label: "周日", totalTokens: 0 },
      { weekday: 1, label: "周一", totalTokens: 0 },
      { weekday: 2, label: "周二", totalTokens: 0 },
      { weekday: 3, label: "周三", totalTokens: 0 },
      { weekday: 4, label: "周四", totalTokens: 64_378 },
      { weekday: 5, label: "周五", totalTokens: 0 },
      { weekday: 6, label: "周六", totalTokens: 0 },
    ],
  });
}
```

- [ ] **Step 3: Run current page test and confirm it fails after expectations change**

Run:

```powershell
cd frontend
npx.cmd vitest run --no-color --reporter verbose test/pages/TokensPage.test.tsx
```

Expected:

- Test fails until page calls heatmap and renders compact/native-like sections.

### Task 5.2: Add Trend Mode, Breakdown, And Heatmap Expectations

**Files:**

- Modify: `frontend/test/pages/TokensPage.test.tsx`

- [ ] **Step 1: Assert compact values and exact titles**

Add assertions:

```ts
expect(await screen.findByText("2.2M")).toBeInTheDocument();
expect(screen.getByTitle("2,170,856 tokens")).toBeInTheDocument();
expect(screen.getByText("64.3K -> 72")).toBeInTheDocument();
```

- [ ] **Step 2: Assert trend mode toggle**

Add:

```ts
expect(screen.getByRole("button", { name: "总量" })).toHaveAttribute("aria-pressed", "true");
fireEvent.click(screen.getByRole("button", { name: "按类型" }));
expect(screen.getByRole("button", { name: "按类型" })).toHaveAttribute("aria-pressed", "true");
expect(screen.getByTestId("token-trend-output-0")).toHaveAttribute("title", "模型输出 72 tokens");
```

- [ ] **Step 3: Assert breakdown and mosaic**

Add:

```ts
expect(screen.getByText("Token 类型拆分")).toBeInTheDocument();
expect(screen.getByText("上下文输入")).toBeInTheDocument();
expect(screen.getByText("模型输出")).toBeInTheDocument();
expect(screen.getByText("缓存读取")).toBeInTheDocument();
expect(screen.getByText("缓存写入")).toBeInTheDocument();
expect(screen.getByText("使用热力分布")).toBeInTheDocument();
expect(screen.getByTitle("21:00 · 64.3K tokens")).toBeInTheDocument();
```

- [ ] **Step 4: Assert API calls**

Expected initial calls include:

```text
/lynx/tokens/summary?fromMs=...&toMs=...
/lynx/tokens/usage?fromMs=...&toMs=...&pageNum=1&pageSize=20
/lynx/tokens/trend?bucket=hour&fromMs=...&toMs=...
/lynx/tokens/heatmap?fromMs=...&toMs=...
```

### Task 5.3: Implement Frontend API Call And State

**Files:**

- Modify: `frontend/src/api/tokens.ts`
- Modify: `frontend/src/pages/TokensPage.tsx`

- [ ] **Step 1: Import heatmap DTO/API**

In `TokensPage.tsx`, import `TokenHeatmapDto` and `getTokenHeatmap`.

Add:

```ts
const EMPTY_TOKEN_HEATMAP: TokenHeatmapDto = {
  timeZone: "local",
  totalTokens: 0,
  hourTotals: Array.from({ length: 24 }, (_, hour) => ({ hour, totalTokens: 0 })),
  weekdayTotals: ["周日", "周一", "周二", "周三", "周四", "周五", "周六"].map((label, weekday) => ({
    weekday,
    label,
    totalTokens: 0,
  })),
};
```

Add state:

```ts
const [heatmap, setHeatmap] = useState<TokenHeatmapDto>(EMPTY_TOKEN_HEATMAP);
const [trendMode, setTrendMode] = useState<"total" | "byType">("total");
```

- [ ] **Step 2: Fetch heatmap with same time range**

Add an effect mirroring summary/trend:

```ts
useEffect(() => {
  let cancelled = false;
  async function loadHeatmap() {
    try {
      const nextHeatmap = await getTokenHeatmap(selectedTimeRange.query);
      if (!cancelled) {
        setHeatmap(nextHeatmap);
      }
    } catch {
      if (!cancelled) {
        setHeatmap(import.meta.env.DEV ? mockTokenHeatmap : EMPTY_TOKEN_HEATMAP);
      }
    }
  }
  void loadHeatmap();
  return () => {
    cancelled = true;
  };
}, [selectedTimeRange.query]);
```

Use the existing query memo patterns in the file. If the current effect dependencies require a stable `queryKey`, follow the existing pattern instead of introducing a fresh object loop.

### Task 5.4: Render Compact Summary And Breakdown

**Files:**

- Modify: `frontend/src/pages/TokensPage.tsx`

- [ ] **Step 1: Replace raw summary display with compact display**

Use:

```tsx
<strong className="summary-card__value" title={`${formatInteger(measurableTokens)} tokens`}>
  {formatCompactTokens(measurableTokens)}
  <span className="summary-card__unit">Tokens</span>
</strong>
```

For input/output summary:

```tsx
<strong title={`${formatInteger(measurableInputTokens)} tokens`}>
  {formatCompactTokens(measurableInputTokens)}
</strong>
<strong title={`${formatInteger(measurableOutputTokens)} tokens`}>
  {formatCompactTokens(measurableOutputTokens)}
</strong>
```

- [ ] **Step 2: Add breakdown section**

Create an array:

```ts
const tokenBreakdown = [
  { key: "input", label: "上下文输入", value: measurableInputTokens, className: "input" },
  { key: "output", label: "模型输出", value: measurableOutputTokens, className: "output" },
  { key: "cacheRead", label: "缓存读取", value: summary.measurableCacheReadTokens ?? summary.cacheReadTokens, className: "cache-read" },
  { key: "cacheWrite", label: "缓存写入", value: summary.measurableCacheWriteTokens ?? summary.cacheWriteTokens, className: "cache-write" },
];
```

Render:

```tsx
<section className="panel token-breakdown-panel">
  <div className="panel-heading">
    <h2>Token 类型拆分</h2>
    <span title={`${formatInteger(measurableTokens)} tokens`}>{formatCompactTokens(measurableTokens)}</span>
  </div>
  <div className="token-breakdown-bar" aria-label="Token 类型拆分">
    {tokenBreakdown.map((part) => (
      <span
        key={part.key}
        className={`token-breakdown-segment token-breakdown-segment--${part.className}`}
        style={{ width: `${percent(part.value, Math.max(measurableTokens, 1))}%` }}
        title={`${part.label} ${formatInteger(part.value)} tokens`}
      />
    ))}
  </div>
  <div className="token-breakdown-list">
    {tokenBreakdown.map((part) => (
      <div key={part.key} className="token-breakdown-item">
        <span className={`token-breakdown-dot token-breakdown-dot--${part.className}`} />
        <span>{part.label}</span>
        <strong title={`${formatInteger(part.value)} tokens`}>{formatCompactTokens(part.value)}</strong>
      </div>
    ))}
  </div>
</section>
```

Ensure nonzero tiny segments have a CSS `min-width` so output is visible without changing the exact tooltip.

### Task 5.5: Render Trend Toggle And By-Type Bars

**Files:**

- Modify: `frontend/src/pages/TokensPage.tsx`

- [ ] **Step 1: Add segmented control**

Render near trend heading:

```tsx
<div className="token-mode-toggle" role="group" aria-label="趋势展示模式">
  <button type="button" aria-pressed={trendMode === "total"} onClick={() => setTrendMode("total")}>
    总量
  </button>
  <button type="button" aria-pressed={trendMode === "byType"} onClick={() => setTrendMode("byType")}>
    按类型
  </button>
</div>
```

- [ ] **Step 2: Add cache dimensions to trend render**

For each point, read:

```ts
const cacheReadTokens = clampTokenCount(point.cacheReadTokens ?? 0);
const cacheWriteTokens = clampTokenCount(point.cacheWriteTokens ?? 0);
```

In `byType` mode, render segments for:

- output
- input
- cache write
- cache read

Use titles:

```tsx
title={`模型输出 ${formatInteger(outputTokens)} tokens`}
title={`上下文输入 ${formatInteger(inputTokens)} tokens`}
title={`缓存写入 ${formatInteger(cacheWriteTokens)} tokens`}
title={`缓存读取 ${formatInteger(cacheReadTokens)} tokens`}
```

- [ ] **Step 3: Keep total mode readable**

In `total` mode, render one total bar and compact label:

```tsx
<strong className="token-trend-value" title={`总计 ${formatInteger(totalTokens)} tokens`}>
  {formatCompactTokens(totalTokens)}
</strong>
```

### Task 5.6: Render Usage Mosaic

**Files:**

- Modify: `frontend/src/pages/TokensPage.tsx`

- [ ] **Step 1: Compute max values**

Add:

```ts
const maxHourTokens = Math.max(...heatmap.hourTotals.map((item) => item.totalTokens), 1);
const maxWeekdayTokens = Math.max(...heatmap.weekdayTotals.map((item) => item.totalTokens), 1);
```

- [ ] **Step 2: Render mosaic**

Add section:

```tsx
<section className="panel token-mosaic-panel">
  <div className="panel-heading">
    <h2>使用热力分布</h2>
    <span title={`${formatInteger(heatmap.totalTokens)} tokens`}>
      {formatCompactTokens(heatmap.totalTokens)}
    </span>
  </div>
  <div className="token-mosaic-grid">
    <div className="token-weekday-grid">
      {heatmap.weekdayTotals.map((item) => (
        <div
          key={item.weekday}
          className="token-weekday-cell"
          style={{ "--token-intensity": item.totalTokens / maxWeekdayTokens } as CSSProperties}
          title={`${item.label} · ${formatInteger(item.totalTokens)} tokens`}
        >
          <span>{item.label}</span>
          <strong>{formatCompactTokens(item.totalTokens)}</strong>
        </div>
      ))}
    </div>
    <div className="token-hour-grid">
      {heatmap.hourTotals.map((item) => (
        <span
          key={item.hour}
          className="token-hour-cell"
          style={{ "--token-intensity": item.totalTokens / maxHourTokens } as CSSProperties}
          title={`${String(item.hour).padStart(2, "0")}:00 · ${formatCompactTokens(item.totalTokens)} tokens`}
        />
      ))}
    </div>
  </div>
</section>
```

Use exact `formatInteger` in weekday titles. Use compact values in hour titles to match native mosaic scan behavior.

### Task 5.7: Update Token Table Cells

**Files:**

- Modify: `frontend/src/pages/TokensPage.tsx`

- [ ] **Step 1: Compact total column**

Render total as:

```tsx
<strong title={`${formatInteger(item.totalTokens)} tokens`}>
  {formatCompactTokens(item.totalTokens)}
</strong>
```

- [ ] **Step 2: Render input/output asymmetry**

Render IO as:

```tsx
<span title={`上下文输入 ${formatInteger(item.inputTokens)} tokens，模型输出 ${formatInteger(item.outputTokens)} tokens`}>
  {formatCompactTokens(item.inputTokens)} -&gt; {formatCompactTokens(item.outputTokens)}
</span>
```

For the latest observed row this should display:

```text
64.3K -> 72
```

- [ ] **Step 3: Render source origin badges**

Show quality and origin separately:

```tsx
<span className={`status-badge status-badge--${resolveSourceType(item)}`}>{sourceTypeLabel}</span>
{item.sourceOrigin ? <span className="status-badge status-badge--origin">{sourceOriginLabel}</span> : null}
```

Labels:

```ts
const sourceOriginLabels = {
  hook: "实时 hook",
  transcript: "Transcript 回填",
} as const;
```

### Task 5.8: Add Styles

**Files:**

- Modify: `frontend/src/styles/theme.css`

- [ ] **Step 1: Add classes**

Add CSS for:

- `.token-mode-toggle`
- `.token-breakdown-panel`
- `.token-breakdown-bar`
- `.token-breakdown-segment--input`
- `.token-breakdown-segment--output`
- `.token-breakdown-segment--cache-read`
- `.token-breakdown-segment--cache-write`
- `.token-mosaic-panel`
- `.token-weekday-grid`
- `.token-weekday-cell`
- `.token-hour-grid`
- `.token-hour-cell`

Style rules:

```css
.token-breakdown-segment {
  min-width: 2px;
}

.token-breakdown-segment--input,
.token-trend-segment--input {
  background: var(--accent);
}

.token-breakdown-segment--output,
.token-trend-segment--output {
  background: #a855f7;
}

.token-breakdown-segment--cache-write,
.token-trend-segment--cache-write {
  background: #f59e0b;
}

.token-breakdown-segment--cache-read,
.token-trend-segment--cache-read {
  background: #22c55e;
}

.token-hour-cell,
.token-weekday-cell {
  background: color-mix(in srgb, var(--accent) calc(12% + (var(--token-intensity, 0) * 58%)), transparent);
}
```

Keep mobile layout under existing media queries so text does not overlap.

- [ ] **Step 2: Run frontend page test**

Run:

```powershell
cd frontend
npx.cmd vitest run --no-color --reporter verbose test/pages/TokensPage.test.tsx test/utils/format.test.ts
```

Expected:

- Token page and formatter tests pass.
- Tests assert readable Chinese strings.

---

## Phase 6: Verification

### Task 6.1: Local Verification

**Files:** all touched files

- [ ] **Step 1: Run root TypeScript check**

Run:

```powershell
npx.cmd tsc --noEmit
```

Expected:

- Root/plugin TypeScript passes.

- [ ] **Step 2: Run shared build**

Run:

```powershell
npm --prefix shared run build
```

Expected:

- Shared DTO package builds.

- [ ] **Step 3: Run backend tests**

Run:

```powershell
cd backend
go test ./...
```

Expected:

- Backend tests pass, including token origin, heatmap, and transcript backfill tests.

- [ ] **Step 4: Run frontend tests/build**

Run:

```powershell
cd frontend
npx.cmd tsc --noEmit --pretty false
npm.cmd run test
npm.cmd run build -- --clearScreen false
```

Expected:

- Frontend typecheck, tests, and build pass.

- [ ] **Step 5: Check diff hygiene**

Run:

```powershell
git diff --check
git status --short
```

Expected:

- No whitespace errors.
- Only intended source, test, and Superpowers docs are changed.

### Task 6.2: Runtime Sync And Proof

**Files:** none

- [ ] **Step 1: Verify sync readiness**

Run:

```powershell
node scripts/verify-dev-sync.mjs
```

Expected:

- Script completes without blocking errors.

- [ ] **Step 2: Sync into real OpenClaw runtime**

Run:

```powershell
.\scripts\sync-openclaw-dev-ready.ps1 --logs 200
```

Expected:

- Gateway restarts.
- Log assessment is not blocked.

- [ ] **Step 3: Check health**

Run:

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:18789/healthz
```

Expected:

- HTTP 200 with live status.

- [ ] **Step 4: Read back token APIs**

Run:

```powershell
Invoke-RestMethod -UseBasicParsing http://127.0.0.1:18789/lynx/tokens/summary | ConvertTo-Json -Depth 8
Invoke-RestMethod -UseBasicParsing 'http://127.0.0.1:18789/lynx/tokens/usage?pageNum=1&pageSize=10' | ConvertTo-Json -Depth 8
Invoke-RestMethod -UseBasicParsing 'http://127.0.0.1:18789/lynx/tokens/heatmap' | ConvertTo-Json -Depth 8
```

Expected:

- Summary still shows actual usage.
- Usage rows include `sourceOrigin`.
- Heatmap returns 24 hour cells and 7 weekday cells.

- [ ] **Step 5: Execute transcript dry run**

Read ingest token:

```powershell
$token = Get-Content "$env:USERPROFILE\.openclaw\lynx\data\console.token" -Raw
$headers = @{ Authorization = "Bearer $($token.Trim())"; "Content-Type" = "application/json" }
$body = @{ dryRun = $true } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:18789/lynx/internal/v1/tokens/backfill-transcripts -Headers $headers -Body $body | ConvertTo-Json -Depth 8
```

Expected:

- Response includes `dryRun: true`.
- `scannedFiles` and `scannedUsageRows` are present.
- `insertedCount` is `0`.

- [ ] **Step 6: Run real OpenClaw path**

Run:

```powershell
docker exec openclaw-openclaw-gateway-1 sh -lc "openclaw agent --agent main --message 'reply with pong only' --json --timeout 90 2>&1"
```

Expected:

- The real gateway/agent path responds.
- If the command times out, inspect gateway logs and session artifacts before concluding runtime failure.

## Completion Criteria

- Compact K/M display is used across summary, trend, breakdown, mosaic, and table.
- Exact token values remain visible in titles, aria labels, or detail text.
- Input/output asymmetry is displayed as a real measured ratio, not hidden.
- Trend supports `总量` and `按类型`.
- Token breakdown includes context input, model output, cache read, and cache write.
- Heatmap endpoint and UI show weekday/hour distribution.
- `sourceOrigin` distinguishes live hook rows from transcript backfill rows.
- Transcript backfill dry-run and insert paths are tested.
- Runtime sync and live readback prove the running gateway has the updated behavior.
