package backend_test

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/openclaw/lynx-guardian/backend/internal/api"
	"github.com/openclaw/lynx-guardian/backend/internal/chain"
	"github.com/openclaw/lynx-guardian/backend/internal/db"
	"github.com/openclaw/lynx-guardian/backend/internal/grants"
	"github.com/openclaw/lynx-guardian/backend/internal/repo"
	"github.com/openclaw/lynx-guardian/backend/internal/routes"
	_ "modernc.org/sqlite"
)

func TestChainPromptCoverage(t *testing.T) {
	router, database := setupChainPromptCoverageRouter(t)

	postJSON(t, router, http.MethodPost, "/lynx/internal/v1/chains/update", api.ChainUpdateRequest{
		ChainID:        "chain-prompts",
		SessionKey:     "session-prompts",
		ChannelProfile: "webchat",
		ConversationID: "conversation-prompts",
		RequesterID:    "requester-prompts",
		EventType:      "before_dispatch",
		Hook:           "before_dispatch",
		RiskLevel:      "L2",
		Action:         "allow",
		Content:        "first prompt",
	})

	insertChainPromptQARecord(t, database, "qa-2", "session-prompts", "run-2", "second prompt", "L3", "completed", 2000)
	insertChainPromptQARecord(t, database, "qa-1", "session-prompts", "run-1", "first prompt", "L2", "completed", 1000)
	insertChainPromptQARecord(t, database, "qa-other", "session-other", "run-other", "other prompt", "L1", "completed", 500)

	recorder := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/lynx/chains/chain-prompts", nil)
	router.ServeHTTP(recorder, req)
	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected status %d for chain detail: %s", recorder.Code, recorder.Body.String())
	}

	var detail api.ChainSummary
	if err := json.Unmarshal(recorder.Body.Bytes(), &detail); err != nil {
		t.Fatalf("decode chain detail: %v", err)
	}

	if detail.PromptCount != 2 {
		t.Fatalf("prompt count = %d, want 2; detail=%#v", detail.PromptCount, detail)
	}
	if len(detail.CoveredPrompts) != 2 {
		t.Fatalf("covered prompts length = %d, want 2; detail=%#v", len(detail.CoveredPrompts), detail)
	}
	expectCoveredPrompt(t, detail.CoveredPrompts[0], "qa-1", "run-1", "first prompt", "L2", int64(1000), "completed")
	expectCoveredPrompt(t, detail.CoveredPrompts[1], "qa-2", "run-2", "second prompt", "L3", int64(2000), "completed")
}

func setupChainPromptCoverageRouter(t *testing.T) (*gin.Engine, *sql.DB) {
	t.Helper()

	gin.SetMode(gin.TestMode)
	database, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })
	database.SetMaxOpenConns(1)
	if err := db.Migrate(database); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	chainRepository := repo.NewChainRepository(database)
	grantRepository := repo.NewGrantRepository(database)
	grantService := grants.NewService(grantRepository)
	chainService := chain.NewService(chainRepository, grantService)

	router := gin.New()
	query := router.Group("/lynx")
	internal := query.Group("/internal/v1")
	routes.RegisterChains(query, internal, chainService, chainRepository)
	routes.RegisterGrants(query, internal, grantService, grantRepository)
	return router, database
}

func insertChainPromptQARecord(
	t *testing.T,
	database *sql.DB,
	qaRecordID string,
	sessionKey string,
	runID string,
	prompt string,
	riskLevel string,
	status string,
	startedAt int64,
) {
	t.Helper()
	_, err := database.Exec(`
		INSERT INTO qa_records (
			qa_record_id, session_key, run_id, agent_id, user_prompt_excerpt,
			status, risk_level, started_at, ingested_at, link_origin
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		qaRecordID,
		sessionKey,
		runID,
		"main",
		prompt,
		status,
		riskLevel,
		startedAt,
		startedAt,
		"runtime",
	)
	if err != nil {
		t.Fatalf("insert qa record %s: %v", qaRecordID, err)
	}
}

func expectCoveredPrompt(
	t *testing.T,
	prompt api.ChainCoveredPrompt,
	qaRecordID string,
	runID string,
	userPromptExcerpt string,
	riskLevel string,
	startedAtMs int64,
	status string,
) {
	t.Helper()
	if prompt.QARecordID != qaRecordID ||
		prompt.RunID != runID ||
		prompt.UserPromptExcerpt != userPromptExcerpt ||
		prompt.RiskLevel != riskLevel ||
		prompt.StartedAtMs != startedAtMs ||
		prompt.Status != status {
		t.Fatalf("covered prompt mismatch: %#v", prompt)
	}
}
