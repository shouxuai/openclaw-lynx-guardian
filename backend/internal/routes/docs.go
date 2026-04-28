package routes

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/openclaw/lynx-guardian/backend/internal/openapi"
)

const swaggerDocsHTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Lynx Server API Docs</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
    <style>
      body {
        margin: 0;
        background: #f7f8fa;
      }
      .swagger-ui .topbar {
        display: none;
      }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.addEventListener("load", function () {
        SwaggerUIBundle({
          url: "/lynx/openapi.yaml",
          dom_id: "#swagger-ui",
          deepLinking: true,
          displayOperationId: true,
          persistAuthorization: true
        });
      });
    </script>
  </body>
</html>`

// RegisterDocs exposes the embedded OpenAPI document and Swagger UI shell.
func RegisterDocs(router gin.IRoutes) {
	router.GET("/openapi.yaml", func(c *gin.Context) {
		c.Data(http.StatusOK, "application/yaml; charset=utf-8", openapi.Spec())
	})

	router.GET("/docs", func(c *gin.Context) {
		c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(swaggerDocsHTML))
	})
}
