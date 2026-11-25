package iam

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"simp2m/backend/internal/core/database"
	"simp2m/backend/internal/modules/auth"
)

func TestAccessIsolation(t *testing.T) {
	liveDSN, trialDSN := os.Getenv("SIMP2M_IAM_TEST_DSN"), os.Getenv("SIMP2M_IAM_TEST_TRIAL_DSN")
	if liveDSN == "" || trialDSN == "" {
		t.Skip("requires two isolated IAM test databases")
	}
	ctx := context.Background()
	live, err := database.Open(ctx, liveDSN)
	if err != nil {
		t.Fatal(err)
	}
	defer live.Close()
	trial, err := database.Open(ctx, trialDSN)
	if err != nil {
		t.Fatal(err)
	}
	defer trial.Close()
	var liveName, trialName string
	if live.QueryRowContext(ctx, "SELECT DATABASE()").Scan(&liveName) != nil || trial.QueryRowContext(ctx, "SELECT DATABASE()").Scan(&trialName) != nil ||
		!strings.HasPrefix(liveName, "simp2m_auth_test_") || !strings.HasPrefix(trialName, "simp2m_iam_") || !strings.HasSuffix(trialName, "_trial") {
		t.Fatal("unexpected test schemas")
	}
	router := gin.New()
	const origin = "http://localhost:3000"
	auth.Register(router, live, origin, false)
	Register(router, live, trial, origin)
	send := func(method, path string, payload any, cookies []*http.Cookie) *httptest.ResponseRecorder {
		data, _ := json.Marshal(payload)
		req := httptest.NewRequest(method, path, bytes.NewReader(data))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", origin)
		for _, cookie := range cookies {
			req.AddCookie(cookie)
		}
		rr := httptest.NewRecorder()
		router.ServeHTTP(rr, req)
		return rr
	}
	expect := func(rr *httptest.ResponseRecorder, status int) {
		t.Helper()
		if rr.Code != status {
			t.Fatalf("status %d, expected %d: %s", rr.Code, status, rr.Body)
		}
	}
	idOf := func(rr *httptest.ResponseRecorder) int64 {
		t.Helper()
		expect(rr, 200)
		var v struct{ ID int64 }
		if json.Unmarshal(rr.Body.Bytes(), &v) != nil || v.ID < 1 {
			t.Fatal("invalid ID response")
		}
		return v.ID
	}
	signIn := func(email, password string) []*http.Cookie {
		rr := send("POST", "/api/v1/auth/login", map[string]string{"email": email, "password": password}, nil)
		expect(rr, 204)
		return rr.Result().Cookies()
	}
	admin := signIn(os.Getenv("SIMP2M_BOOTSTRAP_EMAIL"), os.Getenv("SIMP2M_BOOTSTRAP_PASSWORD"))
	var adminID int64
	if err := live.QueryRowContext(ctx, "SELECT id FROM users WHERE email=?", os.Getenv("SIMP2M_BOOTSTRAP_EMAIL")).Scan(&adminID); err != nil {
		t.Fatal(err)
	}
	prefix := "/api/v1/iam"
	suffix := time.Now().UnixNano()
	makeInst := func(base, code string) int64 {
		return idOf(send("POST", base+"/institutions", map[string]string{"code": code, "name": code}, admin))
	}
	tenantA := fmt.Sprintf("%s/institutions/%d", prefix, makeInst(prefix, fmt.Sprintf("A%d", suffix)))
	tenantB := fmt.Sprintf("%s/institutions/%d", prefix, makeInst(prefix, fmt.Sprintf("B%d", suffix)))
	createUser := func(email string) int64 {
		return idOf(send("POST", tenantA+"/users", map[string]string{"email": email, "name": "IAM Test", "password": "iam-test-password-2026"}, admin))
	}
	email := fmt.Sprintf("member%d@example.invalid", suffix)
	memberID := createUser(email)
	role := idOf(send("POST", tenantA+"/roles", map[string]any{"name": "superadmin", "active": true, "permissions": []string{read, auditRead}}, admin))
	expect(send("PUT", fmt.Sprintf("%s/users/%d", tenantA, memberID), map[string]any{"active": true, "roles": []int64{role}}, admin), 200)
	member := signIn(email, "iam-test-password-2026")
	expect(send("GET", tenantA+"/workspace", nil, member), 200)
	expect(send("GET", tenantB+"/workspace", nil, member), 403)
	expect(send("GET", "/api/v1/trial/trial-admin/iam/institutions", nil, member), 403)
	expect(send("POST", tenantA+"/roles", map[string]any{"name": "Forbidden", "active": true}, member), 403)
	audit := send("GET", tenantA+"/audit", nil, member)
	expect(audit, 200)
	if strings.Contains(audit.Body.String(), "auth.login") {
		t.Fatal("tenant role leaked global audit")
	}
	trialPrefix := "/api/v1/trial/trial-admin/iam"
	trialCode := fmt.Sprintf("T%d", suffix)
	expect(send("POST", trialPrefix+"/enter", nil, admin), 200)
	trialID := makeInst(trialPrefix, trialCode)
	expect(send("GET", fmt.Sprintf("/api/v1/trial/trial-reader/iam/institutions/%d/workspace", trialID), nil, admin), 200)
	expect(send("POST", "/api/v1/trial/trial-reader/iam/institutions", map[string]string{"code": "DENIED", "name": "Denied"}, admin), 403)
	if strings.Contains(send("GET", prefix+"/institutions", nil, admin).Body.String(), trialCode) {
		t.Fatal("trial leaked into live organizations")
	}
	expect(send("PUT", fmt.Sprintf("%s/users/%d/active", prefix, adminID), map[string]bool{"active": false}, admin), 409)
	secondEmail := fmt.Sprintf("admin%d@example.invalid", suffix)
	secondID := createUser(secondEmail)
	expect(send("PUT", fmt.Sprintf("%s/users/%d/superadmin", prefix, secondID), map[string]bool{"granted": true}, admin), 200)
	second := signIn(secondEmail, "iam-test-password-2026")
	codes := make(chan int, 2)
	var wg sync.WaitGroup
	for _, target := range []struct {
		id      int64
		cookies []*http.Cookie
	}{{adminID, second}, {secondID, admin}} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			codes <- send("PUT", fmt.Sprintf("%s/users/%d/active", prefix, target.id), map[string]bool{"active": false}, target.cookies).Code
		}()
	}
	wg.Wait()
	close(codes)
	changed := 0
	for status := range codes {
		if status == 200 {
			changed++
		} else if status != 409 && status != 401 && status != 403 {
			t.Fatalf("unexpected concurrent status: %d", status)
		}
	}
	var count int
	if err := live.QueryRowContext(ctx, "SELECT COUNT(*) FROM users u JOIN system_role_assignments r ON r.user_id=u.id WHERE u.is_active").Scan(&count); err != nil || count != 1 || changed != 1 {
		t.Fatalf("active superadmins %d, successful mutations %d, err %v", count, changed, err)
	}
}
