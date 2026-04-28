package routes

import (
	"github.com/gin-gonic/gin"
)

const queryAPIVersion = "v1"

// MetaCapabilities mirrors LocalConsoleCapabilities.
type MetaCapabilities struct {
	TokenUsageEnabled      bool
	GatewayAuthLogsEnabled bool
}

// RegisterMeta mirrors registerMetaRoutes.
func RegisterMeta(router gin.IRoutes, cap MetaCapabilities) {
	router.GET("/meta/capabilities", func(c *gin.Context) {
		c.JSON(200, map[string]any{
			"tokenUsageEnabled":      cap.TokenUsageEnabled,
			"gatewayAuthLogsEnabled": cap.GatewayAuthLogsEnabled,
			"queryApiVersion":        queryAPIVersion,
		})
	})
}
