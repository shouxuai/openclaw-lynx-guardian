package routes

import (
	"io"

	"github.com/gin-gonic/gin"
	"github.com/openclaw/lynx-guardian/backend/internal/httpserver"
	"github.com/openclaw/lynx-guardian/backend/internal/ingest"
	"github.com/openclaw/lynx-guardian/backend/internal/repo"
)

// RegisterEvents mirrors registerEventRoutes.
func RegisterEvents(router gin.IRoutes, repository *repo.EventsRepository) {
	router.GET("/events", func(c *gin.Context) {
		values := c.Request.URL.Query()
		page, err := repository.List(repo.EventsListQuery{
			Q:                       httpserver.ReadString(values, "q"),
			FromMs:                  httpserver.ReadInt64(values, "fromMs"),
			ToMs:                    httpserver.ReadInt64(values, "toMs"),
			SessionKey:              httpserver.ReadString(values, "sessionKey"),
			RunID:                   httpserver.ReadString(values, "runId"),
			RiskLevel:               httpserver.ReadStringSlice(values, "riskLevel"),
			EnforcementAction:       httpserver.ReadStringSlice(values, "enforcementAction"),
			Limit:                   httpserver.ReadInt(values, "limit"),
			Cursor:                  httpserver.ReadString(values, "cursor"),
			HookName:                httpserver.ReadString(values, "hookName"),
			EventType:               httpserver.ReadString(values, "eventType"),
			Category:                httpserver.ReadString(values, "category"),
			SubCategory:             httpserver.ReadString(values, "subCategory"),
			Direction:               httpserver.ReadString(values, "direction"),
			PrimaryModule:           httpserver.ReadString(values, "primaryModule"),
			RequestID:               httpserver.ReadString(values, "requestId"),
			ToolCallID:              httpserver.ReadString(values, "toolCallId"),
			ApprovalID:              httpserver.ReadString(values, "approvalId"),
			IncludeRoutineHeartbeat: httpserver.ReadBool(values, "includeRoutineHeartbeat"),
		})
		if err != nil {
			c.JSON(500, gin.H{"ok": false, "message": err.Error()})
			return
		}
		c.JSON(200, page)
	})

	router.GET("/events/:eventId", func(c *gin.Context) {
		item, err := repository.GetByID(c.Param("eventId"))
		if err != nil {
			c.JSON(500, gin.H{"ok": false, "message": err.Error()})
			return
		}
		if item == nil {
			c.JSON(404, gin.H{"ok": false, "message": "Audit event not found."})
			return
		}
		c.JSON(200, item)
	})
}

// RegisterToolCalls mirrors registerToolCallRoutes.
func RegisterToolCalls(router gin.IRoutes, repository *repo.ToolCallsRepository) {
	router.GET("/tool-calls", func(c *gin.Context) {
		values := c.Request.URL.Query()
		page, err := repository.List(repo.ToolCallsListQuery{
			FromMs:            httpserver.ReadInt64(values, "fromMs"),
			ToMs:              httpserver.ReadInt64(values, "toMs"),
			SessionKey:        httpserver.ReadString(values, "sessionKey"),
			RunID:             httpserver.ReadString(values, "runId"),
			RiskLevel:         httpserver.ReadStringSlice(values, "riskLevel"),
			EnforcementAction: httpserver.ReadStringSlice(values, "enforcementAction"),
			Limit:             httpserver.ReadInt(values, "limit"),
			Cursor:            httpserver.ReadString(values, "cursor"),
			ToolName:          httpserver.ReadString(values, "toolName"),
			ResultStatus:      httpserver.ReadString(values, "resultStatus"),
			ApprovalID:        httpserver.ReadString(values, "approvalId"),
		})
		if err != nil {
			c.JSON(500, gin.H{"ok": false, "message": err.Error()})
			return
		}
		c.JSON(200, page)
	})

	router.GET("/tool-calls/:toolCallId", func(c *gin.Context) {
		item, err := repository.GetByID(c.Param("toolCallId"))
		if err != nil {
			c.JSON(500, gin.H{"ok": false, "message": err.Error()})
			return
		}
		if item == nil {
			c.JSON(404, gin.H{"ok": false, "message": "Tool call not found."})
			return
		}
		c.JSON(200, item)
	})
}

// RegisterSessions mirrors registerSessionRoutes.
func RegisterSessions(router gin.IRoutes, repository *repo.SessionsRepository) {
	router.GET("/sessions", func(c *gin.Context) {
		values := c.Request.URL.Query()
		page, err := repository.List(repo.SessionsListQuery{
			FromMs:         httpserver.ReadInt64(values, "fromMs"),
			ToMs:           httpserver.ReadInt64(values, "toMs"),
			Limit:          httpserver.ReadInt(values, "limit"),
			Cursor:         httpserver.ReadString(values, "cursor"),
			ChannelProfile: httpserver.ReadString(values, "channelProfile"),
			ChannelID:      httpserver.ReadString(values, "channelId"),
			RequesterID:    httpserver.ReadString(values, "requesterId"),
			RequesterOuID:  httpserver.ReadString(values, "requesterOuId"),
			IsGroup:        httpserver.ReadBool(values, "isGroup"),
		})
		if err != nil {
			c.JSON(500, gin.H{"ok": false, "message": err.Error()})
			return
		}
		c.JSON(200, page)
	})

	router.GET("/sessions/:sessionKey", func(c *gin.Context) {
		item, err := repository.GetByKey(c.Param("sessionKey"))
		if err != nil {
			c.JSON(500, gin.H{"ok": false, "message": err.Error()})
			return
		}
		if item == nil {
			c.JSON(404, gin.H{"ok": false, "message": "Session not found."})
			return
		}
		c.JSON(200, item)
	})
}

// RegisterLynxChecks mirrors registerLynxCheckRoutes.
func RegisterLynxChecks(router gin.IRoutes, repository *repo.LynxChecksRepository) {
	router.GET("/lynx-checks", func(c *gin.Context) {
		values := c.Request.URL.Query()
		page, err := repository.List(repo.LynxChecksListQuery{
			FromMs:          httpserver.ReadInt64(values, "fromMs"),
			ToMs:            httpserver.ReadInt64(values, "toMs"),
			SessionKey:      httpserver.ReadString(values, "sessionKey"),
			Limit:           httpserver.ReadInt(values, "limit"),
			Cursor:          httpserver.ReadString(values, "cursor"),
			Source:          httpserver.ReadString(values, "source"),
			Trigger:         httpserver.ReadString(values, "trigger"),
			Status:          httpserver.ReadString(values, "status"),
			MessageProvider: httpserver.ReadString(values, "messageProvider"),
		})
		if err != nil {
			c.JSON(500, gin.H{"ok": false, "message": err.Error()})
			return
		}
		c.JSON(200, page)
	})

	router.GET("/lynx-checks/:requestId", func(c *gin.Context) {
		item, err := repository.GetByID(c.Param("requestId"))
		if err != nil {
			c.JSON(500, gin.H{"ok": false, "message": err.Error()})
			return
		}
		if item == nil {
			c.JSON(404, gin.H{"ok": false, "message": "Lynx check not found."})
			return
		}
		c.JSON(200, item)
	})
}

// RegisterTokens mirrors registerTokenRoutes.
func RegisterTokens(router gin.IRoutes, repository *repo.TokensRepository) {
	router.GET("/tokens/usage", func(c *gin.Context) {
		values := c.Request.URL.Query()
		page, err := repository.List(repo.TokenUsageListQuery{
			FromMs:      httpserver.ReadInt64(values, "fromMs"),
			ToMs:        httpserver.ReadInt64(values, "toMs"),
			SessionKey:  httpserver.ReadString(values, "sessionKey"),
			RunID:       httpserver.ReadString(values, "runId"),
			Limit:       httpserver.ReadInt(values, "limit"),
			Cursor:      httpserver.ReadString(values, "cursor"),
			Provider:    httpserver.ReadString(values, "provider"),
			Model:       httpserver.ReadString(values, "model"),
			AgentID:     httpserver.ReadString(values, "agentId"),
			IsEstimated: httpserver.ReadBool(values, "isEstimated"),
		})
		if err != nil {
			c.JSON(500, gin.H{"ok": false, "message": err.Error()})
			return
		}
		c.JSON(200, page)
	})

	router.GET("/tokens/summary", func(c *gin.Context) {
		values := c.Request.URL.Query()
		result, err := repository.GetSummary(repo.TokenSummaryQuery{
			FromMs:     httpserver.ReadInt64(values, "fromMs"),
			ToMs:       httpserver.ReadInt64(values, "toMs"),
			SessionKey: httpserver.ReadString(values, "sessionKey"),
			RunID:      httpserver.ReadString(values, "runId"),
			Provider:   httpserver.ReadString(values, "provider"),
			Model:      httpserver.ReadString(values, "model"),
		})
		if err != nil {
			c.JSON(500, gin.H{"ok": false, "message": err.Error()})
			return
		}
		c.JSON(200, result)
	})

	router.GET("/tokens/trend", func(c *gin.Context) {
		values := c.Request.URL.Query()
		result, err := repository.GetTrend(repo.TokenTrendQuery{
			TokenSummaryQuery: repo.TokenSummaryQuery{
				FromMs:     httpserver.ReadInt64(values, "fromMs"),
				ToMs:       httpserver.ReadInt64(values, "toMs"),
				SessionKey: httpserver.ReadString(values, "sessionKey"),
				RunID:      httpserver.ReadString(values, "runId"),
				Provider:   httpserver.ReadString(values, "provider"),
				Model:      httpserver.ReadString(values, "model"),
			},
			Bucket: httpserver.ReadString(values, "bucket"),
		})
		if err != nil {
			c.JSON(500, gin.H{"ok": false, "message": err.Error()})
			return
		}
		c.JSON(200, result)
	})
}

// RegisterDashboard mirrors registerDashboardRoutes.
func RegisterDashboard(router gin.IRoutes, repository *repo.DashboardRepository) {
	router.GET("/dashboard/overview", func(c *gin.Context) {
		values := c.Request.URL.Query()
		result, err := repository.GetOverview(repo.DashboardOverviewQuery{
			FromMs: httpserver.ReadInt64(values, "fromMs"),
			ToMs:   httpserver.ReadInt64(values, "toMs"),
		})
		if err != nil {
			c.JSON(500, gin.H{"ok": false, "message": err.Error()})
			return
		}
		c.JSON(200, result)
	})
}

// RegisterIngest mirrors registerIngestRoutes.
func RegisterIngest(router gin.IRoutes, service *ingest.Service) {
	registerIngestBatchRoute(router, "/ingest/batch", service.ProcessBatch)
	registerIngestBatchRoute(router, "/ingest/audit-events", func(payload []byte) (ingest.BatchResult, error) {
		return service.ProcessBatchForKinds(payload, "auditEvent")
	})
	registerIngestBatchRoute(router, "/ingest/sessions", func(payload []byte) (ingest.BatchResult, error) {
		return service.ProcessBatchForKinds(payload, "sessionUpsert")
	})
	registerIngestBatchRoute(router, "/ingest/tool-calls", func(payload []byte) (ingest.BatchResult, error) {
		return service.ProcessBatchForKinds(payload, "toolCallUpsert")
	})
	registerIngestBatchRoute(router, "/ingest/approvals", func(payload []byte) (ingest.BatchResult, error) {
		return service.ProcessBatchForKinds(payload, "approvalUpsert")
	})
	registerIngestBatchRoute(router, "/ingest/lynx-checks", func(payload []byte) (ingest.BatchResult, error) {
		return service.ProcessBatchForKinds(payload, "lynxCheckUpsert")
	})
	registerIngestBatchRoute(router, "/ingest/token-usage", func(payload []byte) (ingest.BatchResult, error) {
		return service.ProcessBatchForKinds(payload, "tokenUsage")
	})
}

func registerIngestBatchRoute(
	router gin.IRoutes,
	path string,
	process func([]byte) (ingest.BatchResult, error),
) {
	router.POST(path, func(c *gin.Context) {
		body, err := io.ReadAll(c.Request.Body)
		if err != nil {
			c.JSON(400, gin.H{"ok": false, "message": err.Error()})
			return
		}
		result, err := process(body)
		if err != nil {
			c.JSON(500, gin.H{"ok": false, "message": err.Error()})
			return
		}
		c.JSON(200, result)
	})
}
