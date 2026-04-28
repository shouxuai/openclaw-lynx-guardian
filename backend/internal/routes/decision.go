package routes

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/openclaw/lynx-guardian/backend/internal/api"
	"github.com/openclaw/lynx-guardian/backend/internal/decision"
	"github.com/openclaw/lynx-guardian/backend/internal/repo"
)

func RegisterDecisions(
	public gin.IRoutes,
	internal gin.IRoutes,
	service *decision.Service,
	repository *repo.DecisionRepository,
) {
	registerDecisionPost(internal, "/decision/input", service)
	registerDecisionPost(internal, "/decision/tool", service)
	registerDecisionPost(internal, "/decision/output", service)
	registerDecisionPost(internal, "/decision/install", service)

	public.GET("/decisions", func(c *gin.Context) {
		decisions, err := repository.ListDecisions(c.Request.Context(), repo.DecisionListQuery{})
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

func registerDecisionPost(router gin.IRoutes, path string, service *decision.Service) {
	router.POST(path, func(c *gin.Context) {
		var request api.DecisionRequest
		if err := c.ShouldBindJSON(&request); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"ok": false, "message": err.Error()})
			return
		}
		response, err := service.Decide(c.Request.Context(), request)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, response)
	})
}
