package routes

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/openclaw/lynx-guardian/backend/internal/api"
	"github.com/openclaw/lynx-guardian/backend/internal/decision"
	"github.com/openclaw/lynx-guardian/backend/internal/httpserver"
	"github.com/openclaw/lynx-guardian/backend/internal/policy"
	"github.com/openclaw/lynx-guardian/backend/internal/repo"
)

func RegisterDecisions(
	public gin.IRoutes,
	internal gin.IRoutes,
	service *decision.Service,
	repository *repo.DecisionRepository,
	policyService *policy.Service,
) {
	registerDecisionPost(internal, "/decision/input", service, policyService)
	registerDecisionPost(internal, "/decision/tool", service, policyService)
	registerDecisionPost(internal, "/decision/output", service, policyService)
	registerDecisionPost(internal, "/decision/install", service, policyService)

	public.GET("/decisions", func(c *gin.Context) {
		values := c.Request.URL.Query()
		decisions, err := repository.ListDecisions(c.Request.Context(), repo.DecisionListQuery{
			Q:              httpserver.ReadString(values, "q"),
			RiskLevel:      httpserver.ReadStringSlice(values, "riskLevel"),
			Action:         httpserver.ReadStringSlice(values, "action"),
			Stage:          httpserver.ReadStringSlice(values, "stage"),
			WinningArbiter: httpserver.ReadStringSlice(values, "winningArbiter"),
			PageNum:        httpserver.ReadInt(values, "pageNum"),
			PageSize:       httpserver.ReadInt(values, "pageSize"),
			Limit:          httpserver.ReadInt(values, "limit"),
		})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, decisions)
	})

	public.GET("/decisions/:decisionId", func(c *gin.Context) {
		decisionID := c.Param("decisionId")
		decision, err := repository.GetDecision(c.Request.Context(), decisionID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "message": err.Error()})
			return
		}
		if decision.DecisionID == "" {
			c.JSON(http.StatusNotFound, gin.H{"ok": false, "message": "Decision not found."})
			return
		}
		c.JSON(http.StatusOK, decision)
	})
}

func registerDecisionPost(router gin.IRoutes, path string, service *decision.Service, policyService *policy.Service) {
	router.POST(path, func(c *gin.Context) {
		var request api.DecisionRequest
		if err := c.ShouldBindJSON(&request); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"ok": false, "message": err.Error()})
			return
		}
		enriched, err := policyService.EnrichDecisionRequest(c.Request.Context(), request)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "message": err.Error()})
			return
		}
		response, err := service.Decide(c.Request.Context(), enriched)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "message": err.Error()})
			return
		}
		if err := policyService.InsertScriptFindings(c.Request.Context(), response.DecisionID, enriched); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, response)
	})
}
