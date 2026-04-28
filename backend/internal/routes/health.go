// Package routes mirrors backend/src/routes.
package routes

import (
	"time"

	"github.com/gin-gonic/gin"
)

// ingest schema version kept in lockstep with shared/src/enums.ts.
const ingestSchemaVersion = "lynx-server.ingest.v1"

// RegisterHealth mirrors registerHealthRoutes.
func RegisterHealth(router gin.IRoutes) {
	router.GET("/health", func(c *gin.Context) {
		c.JSON(200, map[string]any{
			"ok":            true,
			"serverTimeMs":  time.Now().UnixMilli(),
			"schemaVersion": ingestSchemaVersion,
		})
	})
}
