package routes

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/openclaw/lynx-guardian/backend/internal/api"
	"github.com/openclaw/lynx-guardian/backend/internal/grants"
	"github.com/openclaw/lynx-guardian/backend/internal/repo"
)

func RegisterGrants(
	public gin.IRoutes,
	internal gin.IRoutes,
	service *grants.Service,
	repository *repo.GrantRepository,
) {
	internal.POST("/grants/check", func(c *gin.Context) {
		var request api.GrantCheckRequest
		if err := c.ShouldBindJSON(&request); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"ok": false, "message": err.Error()})
			return
		}
		result, err := service.Check(c.Request.Context(), request)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, result)
	})

	internal.POST("/grants/revoke", func(c *gin.Context) {
		var request api.RevokeGrantRequest
		if err := c.ShouldBindJSON(&request); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"ok": false, "message": err.Error()})
			return
		}
		if err := service.Revoke(c.Request.Context(), request); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	internal.POST("/approvals/request", func(c *gin.Context) {
		var request api.ApprovalRequestDraft
		if err := c.ShouldBindJSON(&request); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"ok": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, request)
	})

	internal.POST("/approvals/:approvalId/resolve", func(c *gin.Context) {
		var request api.ApprovalResolveRequest
		if err := c.ShouldBindJSON(&request); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"ok": false, "message": err.Error()})
			return
		}
		if request.ApprovalID == "" {
			request.ApprovalID = c.Param("approvalId")
		}
		if request.Resolution == "" {
			request.Resolution = "allow-current-chain"
		}
		if request.Resolution != "allow-current-chain" && request.Resolution != "allow-once" && request.Resolution != "allow-always" {
			c.JSON(http.StatusOK, gin.H{"ok": true, "resolution": request.Resolution})
			return
		}
		grant, err := service.CreateAllowCurrentChain(c.Request.Context(), request)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, grant)
	})

	public.GET("/grants", func(c *gin.Context) {
		grants, err := repository.List(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, grants)
	})
}
