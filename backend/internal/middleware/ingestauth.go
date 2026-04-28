package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// RequireIngestAuth mirrors backend/src/middleware/ingest-auth.ts.
func RequireIngestAuth(expectedToken string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if expectedToken == "" {
			c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{
				"ok":      false,
				"message": "Local console ingest token is not configured.",
			})
			return
		}

		if c.GetHeader("Authorization") != "Bearer "+expectedToken {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"ok":      false,
				"message": "Unauthorized",
			})
			return
		}
		c.Next()
	}
}
