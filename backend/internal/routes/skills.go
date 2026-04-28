package routes

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/openclaw/lynx-guardian/backend/internal/api"
	"github.com/openclaw/lynx-guardian/backend/internal/httpserver"
	"github.com/openclaw/lynx-guardian/backend/internal/repo"
	"github.com/openclaw/lynx-guardian/backend/internal/skills"
)

func RegisterSkills(
	public gin.IRoutes,
	internal gin.IRoutes,
	service *skills.Service,
	repository *repo.SkillRepository,
) {
	internal.POST("/skills/inventory/sync", func(c *gin.Context) {
		var request api.SkillInventorySyncRequest
		if err := c.ShouldBindJSON(&request); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"ok": false, "message": err.Error()})
			return
		}
		response, err := service.SyncInventory(c.Request.Context(), request)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, response)
	})

	public.GET("/skills", func(c *gin.Context) {
		values := c.Request.URL.Query()
		page, err := repository.List(c.Request.Context(), repo.SkillListQuery{
			Limit: httpserver.ReadInt(values, "limit"),
		})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, page)
	})

	public.GET("/skills/:skillId", func(c *gin.Context) {
		item, err := repository.Get(c.Request.Context(), c.Param("skillId"))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "message": err.Error()})
			return
		}
		if item.SkillID == "" {
			c.JSON(http.StatusNotFound, gin.H{"ok": false, "message": "Skill not found."})
			return
		}
		c.JSON(http.StatusOK, item)
	})
}
