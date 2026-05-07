package routes

import (
	"github.com/gin-gonic/gin"

	"github.com/openclaw/lynx-guardian/backend/internal/httpserver"
	"github.com/openclaw/lynx-guardian/backend/internal/repo"
)

// RegisterApprovals mirrors registerApprovalRoutes.
func RegisterApprovals(router gin.IRoutes, repository *repo.ApprovalsRepository) {
	router.GET("/approvals", func(c *gin.Context) {
		values := c.Request.URL.Query()
		query := repo.ApprovalsListQuery{
			Q:             httpserver.ReadString(values, "q"),
			FromMs:        httpserver.ReadInt64(values, "fromMs"),
			ToMs:          httpserver.ReadInt64(values, "toMs"),
			SessionKey:    httpserver.ReadString(values, "sessionKey"),
			RunID:         httpserver.ReadString(values, "runId"),
			RiskLevel:     httpserver.ReadStringSlice(values, "riskLevel"),
			PageNum:       httpserver.ReadInt(values, "pageNum"),
			PageSize:      httpserver.ReadInt(values, "pageSize"),
			Limit:         httpserver.ReadInt(values, "limit"),
			Cursor:        httpserver.ReadString(values, "cursor"),
			Resolution:    httpserver.ReadString(values, "resolution"),
			ToolName:      httpserver.ReadString(values, "toolName"),
			Module:        httpserver.ReadString(values, "module"),
			ScopeType:     httpserver.ReadString(values, "scopeType"),
			RequesterOuID: httpserver.ReadString(values, "requesterOuId"),
		}

		page, err := repository.List(query)
		if err != nil {
			c.JSON(500, gin.H{"ok": false, "message": err.Error()})
			return
		}
		c.JSON(200, page)
	})

	router.GET("/approvals/:approvalId", func(c *gin.Context) {
		approvalID := c.Param("approvalId")
		if approvalID == "" {
			c.JSON(404, gin.H{"ok": false, "message": "Approval not found."})
			return
		}
		approval, err := repository.GetByID(approvalID)
		if err != nil {
			c.JSON(500, gin.H{"ok": false, "message": err.Error()})
			return
		}
		if approval == nil {
			c.JSON(404, gin.H{"ok": false, "message": "Approval not found."})
			return
		}
		c.JSON(200, approval)
	})
}
