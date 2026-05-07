package routes

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/openclaw/lynx-guardian/backend/internal/api"
	"github.com/openclaw/lynx-guardian/backend/internal/grants"
	"github.com/openclaw/lynx-guardian/backend/internal/httpserver"
	"github.com/openclaw/lynx-guardian/backend/internal/repo"
)

func RegisterGrants(
	public gin.IRoutes,
	internal gin.IRoutes,
	service *grants.Service,
	repository *repo.GrantRepository,
	approvalRepositories ...*repo.ApprovalsRepository,
) {
	var approvalsRepository *repo.ApprovalsRepository
	if len(approvalRepositories) > 0 {
		approvalsRepository = approvalRepositories[0]
	}

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

	resolveApproval := func(c *gin.Context) {
		var request api.ApprovalResolveRequest
		if err := c.ShouldBindJSON(&request); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"ok": false, "message": err.Error()})
			return
		}
		if request.ApprovalID == "" {
			request.ApprovalID = c.Param("approvalId")
		}
		if request.RiskLevel == "L4" {
			c.JSON(http.StatusForbidden, gin.H{"ok": false, "message": "L4 是硬拒绝，不能在本地审批放行。"})
			return
		}
		if approvalsRepository != nil {
			approval, err := approvalsRepository.GetByID(request.ApprovalID)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "message": err.Error()})
				return
			}
			if approval != nil && approval.RiskLevel == "L4" {
				c.JSON(http.StatusForbidden, gin.H{"ok": false, "message": "L4 是硬拒绝，不能在本地审批放行。"})
				return
			}
		}
		if request.Resolution == "" {
			request.Resolution = "allow-current-chain"
		}
		if request.Resolution != "allow-current-chain" && request.Resolution != "allow-once" && request.Resolution != "allow-always" {
			if approvalsRepository != nil {
				if err := approvalsRepository.MarkResolved(c.Request.Context(), request.ApprovalID, request.Resolution, request.ApproverOuID, time.Now().UnixMilli()); err != nil {
					c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "message": err.Error()})
					return
				}
			}
			c.JSON(http.StatusOK, gin.H{"ok": true, "resolution": request.Resolution})
			return
		}
		grant, err := service.CreateAllowCurrentChain(c.Request.Context(), request)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "message": err.Error()})
			return
		}
		if approvalsRepository != nil {
			if err := approvalsRepository.MarkResolved(c.Request.Context(), request.ApprovalID, "approved", request.ApproverOuID, time.Now().UnixMilli()); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "message": err.Error()})
				return
			}
		}
		c.JSON(http.StatusOK, grant)
	}

	public.POST("/approvals/:approvalId/resolve", resolveApproval)
	internal.POST("/approvals/:approvalId/resolve", resolveApproval)

	public.GET("/grants", func(c *gin.Context) {
		values := c.Request.URL.Query()
		grants, err := repository.List(c.Request.Context(), repo.GrantListQuery{
			Q:           httpserver.ReadString(values, "q"),
			ChainID:     httpserver.ReadString(values, "chainId"),
			RequesterID: httpserver.ReadString(values, "requesterId"),
			Revoked:     httpserver.ReadBool(values, "revoked"),
			PageNum:     httpserver.ReadInt(values, "pageNum"),
			PageSize:    httpserver.ReadInt(values, "pageSize"),
			Limit:       httpserver.ReadInt(values, "limit"),
		})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, grants)
	})
}
