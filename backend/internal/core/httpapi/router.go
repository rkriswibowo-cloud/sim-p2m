package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

func NewHandler() *gin.Engine {
	router := gin.New()
	router.Use(gin.Recovery())
	router.GET("/api/v1/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})
	_ = router.SetTrustedProxies(nil)
	return router
}
