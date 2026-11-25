package auth

import (
	"database/sql"
	"errors"
	"mime"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

const AccessCookie = "simp2m_access"
const refreshCookie = "simp2m_refresh"

type endpoints struct {
	store     Store
	origin    string
	secure    bool
	attempts  sync.Mutex
	startedAt time.Time
	count     int
	hashing   chan struct{}
}

func Register(router *gin.Engine, db *sql.DB, origin string, secure bool) {
	api := &endpoints{store: Store{DB: db}, origin: origin, secure: secure, hashing: make(chan struct{}, 4)}
	group := router.Group("/api/v1", func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		c.Next()
	})
	group.GET("/me", api.me)
	mutations := group.Group("/auth", api.sameOrigin)
	mutations.POST("/login", api.login)
	mutations.POST("/refresh", api.refresh)
	mutations.POST("/logout", api.logout)
}

func (a *endpoints) sameOrigin(c *gin.Context) {
	if c.GetHeader("Origin") != a.origin {
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "origin_forbidden"})
		return
	}
	c.Next()
}

func (a *endpoints) allowLogin() bool {
	a.attempts.Lock()
	defer a.attempts.Unlock()
	if time.Since(a.startedAt) >= time.Minute {
		a.startedAt, a.count = time.Now(), 0
	}
	if a.count >= 20 {
		return false
	}
	a.count++
	return true
}

func (a *endpoints) login(c *gin.Context) {
	mediaType, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
	if err != nil || mediaType != "application/json" {
		c.JSON(http.StatusUnsupportedMediaType, gin.H{"error": "json_required"})
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	var input struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&input); err != nil || len(input.Email) > 254 || len(input.Password) > 256 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_request"})
		return
	}
	if !a.allowLogin() {
		c.Header("Retry-After", "60")
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "login_rate_limited"})
		return
	}
	select {
	case a.hashing <- struct{}{}:
		defer func() { <-a.hashing }()
	default:
		c.Header("Retry-After", "1")
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "login_rate_limited"})
		return
	}
	tokens, valid, err := a.store.Login(c.Request.Context(), input.Email, input.Password)
	if err != nil {
		unavailable(c)
		return
	}
	if !valid {
		unauthorized(c)
		return
	}
	a.setTokens(c, tokens)
	c.Status(http.StatusNoContent)
}

func (a *endpoints) me(c *gin.Context) {
	access, _ := c.Cookie(AccessCookie)
	user, err := a.store.Me(c.Request.Context(), access)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		unauthorized(c)
	case err != nil:
		unavailable(c)
	default:
		c.JSON(http.StatusOK, user)
	}
}

func (a *endpoints) refresh(c *gin.Context) {
	refresh, _ := c.Cookie(refreshCookie)
	tokens, valid, err := a.store.Rotate(c.Request.Context(), refresh, false)
	if err != nil {
		unavailable(c)
		return
	}
	if !valid {
		a.clearTokens(c)
		unauthorized(c)
		return
	}
	a.setTokens(c, tokens)
	c.Status(http.StatusNoContent)
}

func (a *endpoints) logout(c *gin.Context) {
	refresh, _ := c.Cookie(refreshCookie)
	if _, _, err := a.store.Rotate(c.Request.Context(), refresh, true); err != nil {
		unavailable(c)
		return
	}
	a.clearTokens(c)
	c.Status(http.StatusNoContent)
}

func (a *endpoints) setTokens(c *gin.Context, tokens Tokens) {
	refreshAge := max(1, int(time.Until(tokens.RefreshExpires).Seconds()))
	a.cookie(c, AccessCookie, tokens.Access, min(refreshAge, int(AccessLifetime.Seconds())))
	a.cookie(c, refreshCookie, tokens.Refresh, refreshAge)
}

func (a *endpoints) clearTokens(c *gin.Context) {
	a.cookie(c, AccessCookie, "", -1)
	a.cookie(c, refreshCookie, "", -1)
}

func (a *endpoints) cookie(c *gin.Context, name, value string, maxAge int) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name: name, Value: value, Path: "/", MaxAge: maxAge,
		HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: a.secure,
	})
}

func unauthorized(c *gin.Context) {
	c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
}

func unavailable(c *gin.Context) {
	c.JSON(http.StatusServiceUnavailable, gin.H{"error": "auth_unavailable"})
}
