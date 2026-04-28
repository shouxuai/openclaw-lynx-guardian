// Package app mirrors backend/src/app.ts.
package app

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/openclaw/lynx-guardian/backend-go/internal/config"
	"github.com/openclaw/lynx-guardian/backend-go/internal/db"
	"github.com/openclaw/lynx-guardian/backend-go/internal/middleware"
	"github.com/openclaw/lynx-guardian/backend-go/internal/repo"
	"github.com/openclaw/lynx-guardian/backend-go/internal/routes"
	"github.com/openclaw/lynx-guardian/backend-go/internal/service"
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
	lynxChecks := repo.NewLynxChecksRepository(database)
	tokens := repo.NewTokensRepository(database)
	dashboard := repo.NewDashboardRepository(database)

	root := gin.New()
	root.Use(middleware.RequireLoopback(cfg.TrustedProxyIPs))

	webviewHandler := gin.WrapH(service.StaticWebview(cfg.FrontendDistPath))
	root.GET("/webview", webviewHandler)
	root.GET("/webview/*filepath", webviewHandler)

	query := root.Group(apiBasePath)
	routes.RegisterHealth(query)
	routes.RegisterMeta(query, routes.MetaCapabilities{
		TokenUsageEnabled:      cfg.TokenUsageEnabled,
		GatewayAuthLogsEnabled: false,
	})
	routes.RegisterEvents(query, events)
	routes.RegisterToolCalls(query, toolCalls)
	routes.RegisterApprovals(query, approvals)
	routes.RegisterLynxChecks(query, lynxChecks)
	routes.RegisterSessions(query, sessions)
	routes.RegisterDashboard(query, dashboard)
	routes.RegisterTokens(query, tokens)

	ingest := query.Group("/internal/v1")
	ingest.Use(middleware.RequireIngestAuth(cfg.IngestToken))
	routes.RegisterIngest(ingest)

	closer := func() error { return database.Close() }
	return root, closer, nil
}

func noopCloser() error { return nil }
