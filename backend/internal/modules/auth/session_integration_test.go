package auth

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"simp2m/backend/internal/core/database"
)

func TestSessionLifecycle(t *testing.T) {
	dsn := os.Getenv("SIMP2M_AUTH_TEST_DSN")
	if dsn == "" {
		t.Skip("set SIMP2M_AUTH_TEST_DSN and SIMP2M_AUTH_TEST_ADMIN_DSN for the MariaDB smoke test")
	}
	ctx := context.Background()
	admin, err := database.Open(ctx, os.Getenv("SIMP2M_AUTH_TEST_ADMIN_DSN"))
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	db, err := database.Open(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for _, connection := range []*sql.DB{admin, db} {
		var schema string
		if err := connection.QueryRowContext(ctx, "SELECT DATABASE()").Scan(&schema); err != nil || !strings.HasPrefix(schema, "simp2m_auth_test_") {
			t.Fatal("smoke test requires an isolated simp2m_auth_test_ schema")
		}
	}

	email := os.Getenv("SIMP2M_BOOTSTRAP_EMAIL")
	password := os.Getenv("SIMP2M_BOOTSTRAP_PASSWORD")
	created, err := Bootstrap(ctx, admin, email, "Superadmin Smoke Test", password)
	if err != nil || !created {
		t.Fatalf("first bootstrap created=%v err=%v", created, err)
	}
	created, err = Bootstrap(ctx, admin, email, "Changed name", "different-password-for-retry")
	if err != nil || created {
		t.Fatalf("repeated bootstrap created=%v err=%v", created, err)
	}

	router := gin.New()
	const origin = "http://localhost:3000"
	Register(router, db, origin, false)
	send := func(method, path, requestOrigin, password string, cookies []*http.Cookie, status int) []*http.Cookie {
		t.Helper()
		input, _ := json.Marshal(map[string]string{"email": email, "password": password})
		request := httptest.NewRequest(method, path, bytes.NewReader(input))
		request.Header.Set("Origin", requestOrigin)
		request.Header.Set("Content-Type", "application/json")
		for _, cookie := range cookies {
			request.AddCookie(cookie)
		}
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, request)
		if recorder.Code != status {
			t.Fatalf("%s %s returned %d, expected %d", method, path, recorder.Code, status)
		}
		if path == "/api/v1/me" && status == http.StatusOK && !strings.Contains(recorder.Body.String(), "Superadmin Smoke Test") {
			t.Fatal("profile mismatch after repeated bootstrap")
		}
		return recorder.Result().Cookies()
	}
	send("GET", "/api/v1/me", origin, "", nil, 401)
	send("POST", "/api/v1/auth/login", "https://other.invalid", password, nil, 403)
	send("POST", "/api/v1/auth/login", origin, "incorrect", nil, 401)
	first := send("POST", "/api/v1/auth/login", origin, password, nil, 204)
	if len(first) != 2 {
		t.Fatal("expected access and refresh cookies")
	}
	for _, cookie := range first {
		if !cookie.HttpOnly || cookie.SameSite != http.SameSiteLaxMode {
			t.Fatal("insecure cookie")
		}
	}
	send("GET", "/api/v1/me", origin, "", first, 200)
	if _, err := admin.ExecContext(ctx, "UPDATE sessions SET access_expires_at = UTC_TIMESTAMP(6)"); err != nil {
		t.Fatal(err)
	}
	send("GET", "/api/v1/me", origin, "", first, 401)
	rotated := send("POST", "/api/v1/auth/refresh", origin, "", first, 204)
	send("GET", "/api/v1/me", origin, "", rotated, 200)
	send("POST", "/api/v1/auth/refresh", origin, "", first, 401)
	send("GET", "/api/v1/me", origin, "", rotated, 401)
	fresh := send("POST", "/api/v1/auth/login", origin, password, nil, 204)
	send("POST", "/api/v1/auth/logout", origin, "", fresh, 204)
	send("GET", "/api/v1/me", origin, "", fresh, 401)
	send("POST", "/api/v1/auth/refresh", origin, "", fresh, 401)
}
