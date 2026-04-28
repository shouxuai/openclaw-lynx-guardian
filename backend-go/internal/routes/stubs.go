package routes

import (
	"github.com/gin-gonic/gin"
	"github.com/openclaw/lynx-guardian/backend-go/internal/repo"
)

// These stubs keep the router wiring honest. Each one should be replaced by a
// full port of its TS counterpart: follow routes/approvals.go as the template.

func notImplemented(c *gin.Context) {
	c.JSON(501, gin.H{"ok": false, "message": "Endpoint not ported yet."})
}

// RegisterEvents mirrors registerEventRoutes. TODO: events list + /events/:id
func RegisterEvents(router gin.IRoutes, _ *repo.EventsRepository) {
	router.GET("/events", notImplemented)
	router.GET("/events/:eventId", notImplemented)
}

// RegisterToolCalls mirrors registerToolCallRoutes. TODO
func RegisterToolCalls(router gin.IRoutes, _ *repo.ToolCallsRepository) {
	router.GET("/tool-calls", notImplemented)
	router.GET("/tool-calls/:toolCallId", notImplemented)
}

// RegisterSessions mirrors registerSessionRoutes. TODO
func RegisterSessions(router gin.IRoutes, _ *repo.SessionsRepository) {
	router.GET("/sessions", notImplemented)
	router.GET("/sessions/:sessionKey", notImplemented)
}

// RegisterLynxChecks mirrors registerLynxCheckRoutes. TODO
func RegisterLynxChecks(router gin.IRoutes, _ *repo.LynxChecksRepository) {
	router.GET("/lynx-checks", notImplemented)
	router.GET("/lynx-checks/:requestId", notImplemented)
}

// RegisterTokens mirrors registerTokenRoutes. TODO
func RegisterTokens(router gin.IRoutes, _ *repo.TokensRepository) {
	router.GET("/tokens", notImplemented)
}

// RegisterDashboard mirrors registerDashboardRoutes. TODO
func RegisterDashboard(router gin.IRoutes, _ *repo.DashboardRepository) {
	router.GET("/dashboard/overview", notImplemented)
}

// RegisterIngest mirrors registerIngestRoutes. TODO
func RegisterIngest(router gin.IRoutes) {
	router.POST("/ingest/batch", notImplemented)
}
