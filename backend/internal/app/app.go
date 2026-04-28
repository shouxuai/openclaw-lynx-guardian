// Package app mirrors backend/src/app.ts.
package app

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/openclaw/lynx-guardian/backend/internal/chain"
	"github.com/openclaw/lynx-guardian/backend/internal/config"
	"github.com/openclaw/lynx-guardian/backend/internal/db"
	"github.com/openclaw/lynx-guardian/backend/internal/decision"
	"github.com/openclaw/lynx-guardian/backend/internal/grants"
	"github.com/openclaw/lynx-guardian/backend/internal/ingest"
	"github.com/openclaw/lynx-guardian/backend/internal/middleware"
	"github.com/openclaw/lynx-guardian/backend/internal/repo"
	"github.com/openclaw/lynx-guardian/backend/internal/routes"
	"github.com/openclaw/lynx-guardian/backend/internal/service"
	"github.com/openclaw/lynx-guardian/backend/internal/tasks"
)

// LOCAL_CONSOLE_API_BASE_PATH mirrors shared/src/enums.ts.
const apiBasePath = "/lynx"

// Closer releases app-held resources (DB handle).
type Closer func() error

// Build assembles the full HTTP handler. Ownership of the returned closer is
// the caller's (usually a defer in main).
func Build(cfg *config.Config) (http.Handler, Closer, error) {
	database, err := db.Open(cfg.DatabasePath)
	if err != nil {
		return nil, noopCloser, err
	}
	if err := db.Migrate(database); err != nil {
		_ = database.Close()
		return nil, noopCloser, err
	}

	approvals := repo.NewApprovalsRepository(database)
	events := repo.NewEventsRepository(database)
	toolCalls := repo.NewToolCallsRepository(database)
	sessions := repo.NewSessionsRepository(database)
	lynxCheckTasks := repo.NewLynxCheckTaskRepository(database)
	tokens := repo.NewTokensRepository(database)
	dashboard := repo.NewDashboardRepository(database)
	decisions := repo.NewDecisionRepository(database)
	chains := repo.NewChainRepository(database)
	approvalGrants := repo.NewGrantRepository(database)
	decisionService := decision.NewService(decisions)
	grantService := grants.NewService(approvalGrants)
	chainService := chain.NewService(chains, grantService)
	lynxCheckService := tasks.NewLynxCheckService(lynxCheckTasks)
	ingestService := ingest.NewService(repo.NewIngestRepository(database))

	root := gin.New()
	root.Use(middleware.RequireLoopback(cfg.TrustedProxyIPs))

	webviewHandler := gin.WrapH(service.StaticWebview(cfg.FrontendDistPath))
	root.GET("/webview", webviewHandler)
	root.GET("/webview/*filepath", webviewHandler)

	query := root.Group(apiBasePath)
	ingestGroup := query.Group("/internal/v1")
	ingestGroup.Use(middleware.RequireIngestAuth(cfg.IngestToken))

	routes.RegisterDocs(query)
	routes.RegisterHealth(query)
	routes.RegisterMeta(query, routes.MetaCapabilities{
		TokenUsageEnabled:      cfg.TokenUsageEnabled,
		GatewayAuthLogsEnabled: false,
	})
	routes.RegisterEvents(query, events)
	routes.RegisterToolCalls(query, toolCalls)
	routes.RegisterApprovals(query, approvals)
	routes.RegisterLynxCheckTasks(query, ingestGroup, lynxCheckService, lynxCheckTasks)
	routes.RegisterSessions(query, sessions)
	routes.RegisterDashboard(query, dashboard)
	routes.RegisterTokens(query, tokens)

	routes.RegisterChains(query, ingestGroup, chainService, chains)
	routes.RegisterGrants(query, ingestGroup, grantService, approvalGrants)
	routes.RegisterIngest(ingestGroup, ingestService)
	routes.RegisterDecisions(query, ingestGroup, decisionService, decisions)

	closer := func() error { return database.Close() }
	return root, closer, nil
}

func noopCloser() error { return nil }
