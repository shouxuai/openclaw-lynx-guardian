package routes

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/openclaw/lynx-guardian/backend/internal/api"
	"github.com/openclaw/lynx-guardian/backend/internal/chain"
	"github.com/openclaw/lynx-guardian/backend/internal/httpserver"
	"github.com/openclaw/lynx-guardian/backend/internal/repo"
)

func RegisterChains(
	public gin.IRoutes,
	internal gin.IRoutes,
	service *chain.Service,
	repository *repo.ChainRepository,
) {
	internal.POST("/chains/update", func(c *gin.Context) {
		var request api.ChainUpdateRequest
		if err := c.ShouldBindJSON(&request); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"ok": false, "message": err.Error()})
			return
		}
		summary, err := service.Update(c.Request.Context(), request)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, summary)
	})

	public.GET("/chains", func(c *gin.Context) {
		values := c.Request.URL.Query()
		chains, err := repository.List(c.Request.Context(), repo.ChainListQuery{
			Q:              httpserver.ReadString(values, "q"),
			ChannelProfile: httpserver.ReadString(values, "channelProfile"),
			ConversationID: httpserver.ReadString(values, "conversationId"),
			SessionKey:     httpserver.ReadString(values, "sessionKey"),
			RequesterID:    httpserver.ReadString(values, "requesterId"),
			PageNum:        httpserver.ReadInt(values, "pageNum"),
			PageSize:       httpserver.ReadInt(values, "pageSize"),
			Limit:          httpserver.ReadInt(values, "limit"),
		})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, chains)
	})

	public.GET("/chains/:chainId", func(c *gin.Context) {
		summary, err := repository.Get(c.Request.Context(), c.Param("chainId"))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "message": err.Error()})
			return
		}
		if summary.ChainID == "" {
			c.JSON(http.StatusNotFound, gin.H{"ok": false, "message": "Chain not found."})
			return
		}
		c.JSON(http.StatusOK, summary)
	})
}
