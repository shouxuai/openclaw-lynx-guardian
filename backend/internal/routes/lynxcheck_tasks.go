package routes

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/openclaw/lynx-guardian/backend/internal/api"
	"github.com/openclaw/lynx-guardian/backend/internal/httpserver"
	"github.com/openclaw/lynx-guardian/backend/internal/repo"
	"github.com/openclaw/lynx-guardian/backend/internal/tasks"
)

func RegisterLynxCheckTasks(
	public gin.IRoutes,
	internal gin.IRoutes,
	service *tasks.LynxCheckService,
	repository *repo.LynxCheckTaskRepository,
) {
	internal.POST("/tasks/lynx-check/start", func(c *gin.Context) {
		var request api.LynxCheckTaskStartRequest
		if err := c.ShouldBindJSON(&request); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"ok": false, "message": err.Error()})
			return
		}
		task, err := service.Start(c.Request.Context(), request)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, task)
	})

	internal.POST("/tasks/lynx-check/:requestId/event", func(c *gin.Context) {
		var request api.LynxCheckTaskEventRequest
		if err := c.ShouldBindJSON(&request); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"ok": false, "message": err.Error()})
			return
		}
		task, err := service.ApplyEvent(c.Request.Context(), c.Param("requestId"), request)
		if err != nil {
			status := http.StatusInternalServerError
			if errors.Is(err, tasks.ErrNotFound) {
				status = http.StatusNotFound
			}
			c.JSON(status, gin.H{"ok": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, task)
	})

	public.GET("/lynx-checks", func(c *gin.Context) {
		values := c.Request.URL.Query()
		page, err := repository.List(c.Request.Context(), repo.LynxCheckTaskListQuery{
			Q:          httpserver.ReadString(values, "q"),
			FromMs:     httpserver.ReadInt64(values, "fromMs"),
			ToMs:       httpserver.ReadInt64(values, "toMs"),
			SessionKey: httpserver.ReadString(values, "sessionKey"),
			PageNum:    httpserver.ReadInt(values, "pageNum"),
			PageSize:   httpserver.ReadInt(values, "pageSize"),
			Limit:      httpserver.ReadInt(values, "limit"),
			Cursor:     httpserver.ReadString(values, "cursor"),
			Source:     httpserver.ReadString(values, "source"),
			Trigger:    httpserver.ReadString(values, "trigger"),
			Status:     httpserver.ReadString(values, "status"),
		})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, page)
	})

	public.GET("/lynx-checks/:requestId", func(c *gin.Context) {
		task, err := repository.Get(c.Request.Context(), c.Param("requestId"))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "message": err.Error()})
			return
		}
		if task.RequestID == "" {
			c.JSON(http.StatusNotFound, gin.H{"ok": false, "message": "Lynx check task not found."})
			return
		}
		c.JSON(http.StatusOK, task)
	})
}
