package routes

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/openclaw/lynx-guardian/backend/internal/httpserver"
	"github.com/openclaw/lynx-guardian/backend/internal/repo"
)

func RegisterQARecords(router gin.IRoutes, repository *repo.QARecordsRepository) {
	router.GET("/qa-records", func(c *gin.Context) {
		values := c.Request.URL.Query()
		page, err := repository.List(repo.QARecordsListQuery{
			SessionKey: httpserver.ReadString(values, "sessionKey"),
			RunID:      httpserver.ReadString(values, "runId"),
			PageNum:    httpserver.ReadInt(values, "pageNum"),
			PageSize:   httpserver.ReadInt(values, "pageSize"),
			Limit:      httpserver.ReadInt(values, "limit"),
		})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, page)
	})

	router.GET("/qa-records/:qaRecordId", func(c *gin.Context) {
		item, err := repository.GetDetail(c.Param("qaRecordId"))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "message": err.Error()})
			return
		}
		if item == nil {
			c.JSON(http.StatusNotFound, gin.H{"ok": false, "message": "QA record not found."})
			return
		}
		c.JSON(http.StatusOK, item)
	})
}
