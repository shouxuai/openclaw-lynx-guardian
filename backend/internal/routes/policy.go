package routes

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/openclaw/lynx-guardian/backend/internal/api"
	"github.com/openclaw/lynx-guardian/backend/internal/repo"
)

func RegisterPolicy(router gin.IRoutes, repository *repo.PolicyRepository) {
	router.GET("/policies", func(c *gin.Context) {
		overview, err := repository.Overview(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, overview)
	})

	router.POST("/protected-resources", func(c *gin.Context) {
		var request api.ProtectedResourceUpsertRequest
		if err := c.ShouldBindJSON(&request); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"ok": false, "message": err.Error()})
			return
		}
		item, err := repository.UpsertProtectedResource(c.Request.Context(), request)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, item)
	})

	router.POST("/policy-rules", func(c *gin.Context) {
		var request api.PolicyRuleUpsertRequest
		if err := c.ShouldBindJSON(&request); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"ok": false, "message": err.Error()})
			return
		}
		item, err := repository.UpsertPolicyRule(c.Request.Context(), request)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, item)
	})
}
