package iam

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"simp2m/backend/internal/core/database"
	"simp2m/backend/internal/modules/auth"
)

func TestMasterDataIsolation(t *testing.T) {
	dsn, trialDSN := os.Getenv("SIMP2M_IAM_TEST_DSN"), os.Getenv("SIMP2M_IAM_TEST_TRIAL_DSN")
	if dsn == "" || trialDSN == "" {
		t.Skip("requires isolated master data test schemas")
	}
	ctx := context.Background()
	db, err := database.Open(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	trial, err := database.Open(ctx, trialDSN)
	if err != nil {
		t.Fatal(err)
	}
	defer trial.Close()
	var liveName, trialName string
	if db.QueryRowContext(ctx, "SELECT DATABASE()").Scan(&liveName) != nil || trial.QueryRowContext(ctx, "SELECT DATABASE()").Scan(&trialName) != nil ||
		!strings.HasPrefix(liveName, "simp2m_auth_test_") || !strings.HasPrefix(trialName, "simp2m_iam_") || !strings.HasSuffix(trialName, "_trial") {
		t.Fatal("unexpected schemas")
	}
	router := gin.New()
	const origin = "http://localhost:3000"
	auth.Register(router, db, origin, false)
	Register(router, db, trial, origin)
	cookies := []*http.Cookie{}
	send := func(method, path string, payload any, status int) *httptest.ResponseRecorder {
		t.Helper()
		data, _ := json.Marshal(payload)
		req := httptest.NewRequest(method, path, bytes.NewReader(data))
		req.Header.Set("Origin", origin)
		req.Header.Set("Content-Type", "application/json")
		for _, cookie := range cookies {
			req.AddCookie(cookie)
		}
		res := httptest.NewRecorder()
		router.ServeHTTP(res, req)
		if res.Code != status {
			t.Fatalf("%s %s returned %d, expected %d (%s)", method, path, res.Code, status, res.Body)
		}
		return res
	}
	readID := func(rec *httptest.ResponseRecorder) int64 {
		t.Helper()
		var value struct{ ID int64 }
		if json.Unmarshal(rec.Body.Bytes(), &value) != nil || value.ID < 1 {
			t.Fatal("missing record ID")
		}
		return value.ID
	}
	stamp := time.Now().UnixNano()
	base := "/api/v1/iam"
	send("GET", base+"/institutions/1/master-data/faculties", nil, 401)
	cookies = send("POST", "/api/v1/auth/login", map[string]string{"email": os.Getenv("M03_TEST_EMAIL"), "password": os.Getenv("M03_TEST_PASSWORD")}, 204).Result().Cookies()
	adminCookies := cookies
	var identity auth.Identity
	if err := json.Unmarshal(send("GET", "/api/v1/me", nil, 200).Body.Bytes(), &identity); err != nil || identity.ID < 1 {
		t.Fatalf("missing active Superadmin identity: %v", err)
	}
	send("DELETE", fmt.Sprintf("%s/users/%d", base, identity.ID), nil, 409)
	newTenant := func(base, code string) int64 {
		return readID(send("POST", base+"/institutions", map[string]string{"code": code, "name": code}, 200))
	}
	code := fmt.Sprintf("M%d", stamp)
	tenant := newTenant(base, code)
	other := newTenant(base, code+"X")
	scope := fmt.Sprintf("%s/institutions/%d", base, tenant)
	templateDir := t.TempDir()
	t.Setenv("SIMP2M_DOCUMENT_DIR", templateDir)
	templateBytes := []byte("test template")
	if err := os.WriteFile(filepath.Join(templateDir, documentTemplates[0].Name), templateBytes, 0600); err != nil {
		t.Fatal(err)
	}
	if got := send("GET", scope+"/documents/proposal", nil, 200); !bytes.Equal(got.Body.Bytes(), templateBytes) || !strings.Contains(got.Header().Get("Content-Disposition"), "attachment") {
		t.Fatal("document was not served as an unchanged attachment")
	}
	send("GET", scope+"/documents/unknown", nil, 404)
	master := scope + "/master-data"
	facultyCode := code + "F"
	input := map[string]any{"code": facultyCode, "name": "Fakultas Uji", "active": true}
	faculty := readID(send("POST", master+"/faculties", input, 200))
	send("POST", master+"/faculties", input, 409)
	program := map[string]any{"code": "PRODI", "name": "Prodi Uji", "active": true, "parentId": faculty}
	send("POST", master+"/study-programs", program, 200)
	send("POST", fmt.Sprintf("%s/institutions/%d/master-data/study-programs", base, other), program, 400)
	facultyPath := fmt.Sprintf("%s/faculties/%d", master, faculty)
	send("DELETE", fmt.Sprintf("%s/institutions/%d/master-data/faculties/%d", base, other, faculty), nil, 404)
	send("DELETE", facultyPath, nil, 200)
	if !strings.Contains(send("GET", master+"/faculties?status=inactive&q="+facultyCode, nil, 200).Body.String(), facultyCode) {
		t.Fatal("filtered record missing")
	}
	if !strings.Contains(send("GET", master+"/study-programs", nil, 200).Body.String(), "Fakultas Uji") {
		t.Fatal("archiving faculty broke the program relation")
	}
	if !strings.Contains(send("GET", scope+"/audit", nil, 200).Body.String(), "masterdata.faculties.delete") {
		t.Fatal("change not audited")
	}
	for i := 0; i < 25; i++ {
		send("POST", master+"/faculties", map[string]any{"code": fmt.Sprintf("PAGE%d", i), "name": "Fakultas", "active": true}, 200)
	}
	var page struct {
		Items []masterRecord
		Next  int64
	}
	if err := json.Unmarshal(send("GET", master+"/faculties", nil, 200).Body.Bytes(), &page); err != nil || page.Next == 0 || len(page.Items) != 25 {
		t.Fatalf("invalid first page: %v", err)
	}
	if err := json.Unmarshal(send("GET", fmt.Sprintf("%s/faculties?after=%d", master, page.Next), nil, 200).Body.Bytes(), &page); err != nil || page.Next != 0 || len(page.Items) != 1 {
		t.Fatalf("invalid second page: %v", err)
	}
	for kind := range datasets {
		send("GET", master+"/"+kind, nil, 200)
	}
	email := fmt.Sprintf("master%d@example.invalid", stamp)
	role := readID(send("POST", scope+"/roles", map[string]any{"name": "Master Reader", "active": true, "permissions": []string{masterRead}}, 200))
	member := readID(send("POST", scope+"/users", map[string]any{
		"email": email, "name": "Master Smoke", "password": "masterdata-test-2026",
		"roles": []int64{role}, "permissions": []string{auditRead},
	}, 200))
	memberPath := fmt.Sprintf("%s/users/%d", scope, member)
	cookies = send("POST", "/api/v1/auth/login", map[string]string{"email": email, "password": "masterdata-test-2026"}, 204).Result().Cookies()
	memberCookies := cookies
	send("GET", master+"/faculties", nil, 403)
	send("GET", scope+"/audit", nil, 200)
	cookies = adminCookies
	send("PUT", memberPath, map[string]any{"active": true, "roles": []int64{role}, "permissions": []string{}}, 200)
	cookies = memberCookies
	send("GET", scope+"/audit", nil, 403)
	send("GET", master+"/faculties", nil, 403)
	cookies = adminCookies
	send("PUT", memberPath, map[string]any{"active": true, "roles": []int64{role}, "followRoles": true}, 200)
	cookies = memberCookies
	send("GET", master+"/faculties", nil, 200)
	send("POST", master+"/faculties", input, 403)
	send("DELETE", facultyPath, nil, 403)
	send("GET", fmt.Sprintf("%s/institutions/%d/master-data/faculties", base, other), nil, 403)
	cookies = adminCookies
	groupID := readID(send("POST", master+"/scheme-groups", map[string]any{"code": "GROUP", "name": "Kelompok uji", "active": true}, 200))
	schemeID := readID(send("POST", master+"/schemes", map[string]any{"code": "SCHEME", "name": "Skema hibah uji", "active": true, "parentId": groupID}, 200))
	fundingID := readID(send("POST", master+"/funding-sources", map[string]any{"code": "FUND", "name": "Sumber uji", "active": true}, 200))
	grants := scope + "/grants"
	now := time.Now().UTC()
	periodInput := map[string]any{"code": "TEST", "name": "Periode uji", "proposalYear": now.Year(), "projectYear": now.Year(), "budgetYear": now.Year(),
		"opensAt": now.Add(-time.Hour), "closesAt": now.Add(time.Hour)}
	periodID := readID(send("POST", grants+"/periods", periodInput, 200))
	periodPath := fmt.Sprintf("%s/periods/%d", grants, periodID)
	periodInput["name"] = "Jadwal uji diperbaiki"
	send("PUT", periodPath, periodInput, 200)
	versionPath := fmt.Sprintf("%s/periods/%d/versions", grants, periodID)
	versionInput := map[string]any{"schemeId": schemeID, "sourceId": fundingID, "budget": "15000000", "quota": 5, "duration": 6, "activeLecturer": true, "manual": "Periksa dokumen"}
	firstVersion := readID(send("POST", versionPath, versionInput, 200))
	send("PUT", periodPath, periodInput, 409)
	versionInput["budget"] = "20000000"
	secondVersion := readID(send("POST", versionPath, versionInput, 200))
	periodInput["code"] = "NEXT"
	readID(send("POST", grants+"/periods", periodInput, 200))
	adminOverview := send("GET", grants, nil, 200).Body.String()
	if !strings.Contains(adminOverview, "15000000") || !strings.Contains(adminOverview, "20000000") {
		t.Fatal("historical configuration missing")
	}
	send("PUT", memberPath, map[string]any{"active": true, "roles": []int64{role}, "permissions": []string{grantRead}}, 200)
	cookies = memberCookies
	readerOverview := send("GET", grants, nil, 200).Body.String()
	if strings.Contains(readerOverview, "15000000") || !strings.Contains(readerOverview, "20000000") {
		t.Fatal("applicant overview did not select the current version")
	}
	send("GET", fmt.Sprintf("%s/versions/%d/eligibility", grants, firstVersion), nil, 404)
	checkPath := fmt.Sprintf("%s/versions/%d/eligibility", grants, secondVersion)
	if !strings.Contains(send("GET", checkPath, nil, 200).Body.String(), `"result":"manual"`) {
		t.Fatal("unmatched lecturer should require verification")
	}
	send("POST", versionPath, versionInput, 403)
	send("GET", fmt.Sprintf("%s/institutions/%d/grants", base, other), nil, 403)
	cookies = adminCookies
	lecturer := map[string]any{"code": "LECT", "name": "Dosen uji", "email": email, "active": true}
	lecturerID := readID(send("POST", master+"/lecturers", lecturer, 200))
	versionInput["manual"] = ""
	verifiedVersion := readID(send("POST", versionPath, versionInput, 200))
	verifiedPath := fmt.Sprintf("%s/versions/%d/eligibility", grants, verifiedVersion)
	cookies = memberCookies
	if !strings.Contains(send("GET", verifiedPath, nil, 200).Body.String(), `"result":"eligible"`) {
		t.Fatal("active lecturer should pass the configured rule")
	}
	cookies = adminCookies
	lecturer["active"] = false
	send("PUT", fmt.Sprintf("%s/lecturers/%d", master, lecturerID), lecturer, 200)
	cookies = memberCookies
	if !strings.Contains(send("GET", verifiedPath, nil, 200).Body.String(), `"result":"ineligible"`) {
		t.Fatal("inactive lecturer should fail the configured rule")
	}
	cookies = adminCookies
	fieldID := readID(send("POST", master+"/research-fields", map[string]any{"code": "FIELD", "name": "Bidang uji", "active": true}, 200))
	categories := master + "/budget-categories"
	category := map[string]any{"code": "BAHAN", "name": "Bahan uji", "active": true}
	categoryID := readID(send("POST", categories, category, 200))
	categoryPath := fmt.Sprintf("%s/%d", categories, categoryID)
	foreignCategoryID := readID(send("POST", fmt.Sprintf("%s/institutions/%d/master-data/budget-categories", base, other), category, 200))
	lecturer["active"] = true
	send("PUT", fmt.Sprintf("%s/lecturers/%d", master, lecturerID), lecturer, 200)
	send("PUT", memberPath, map[string]any{"active": true, "roles": []int64{}, "permissions": []string{researchApply}}, 200)
	research := scope + "/research"
	cookies = memberCookies
	draftID := readID(send("POST", research, map[string]any{"grantVersionId": verifiedVersion}, 200))
	draftPath := fmt.Sprintf("%s/%d", research, draftID)
	data := proposalData{
		Object: "Objek", Location: "Lokasi", Starts: now.Format("2006-01-02"), Ends: now.AddDate(0, 1, 0).Format("2006-01-02"),
		Findings: "Temuan", Roadmap: "Roadmap", Summary: "Ringkasan", Keywords: []string{"a", "b", "c", "d", "e"},
		Introduction: "Pendahuluan", Literature: "Pustaka", Method: "Metode", Expected: "Hasil", References: "Daftar pustaka",
		Outputs:  []outputInput{{Kind: "Artikel", Status: "Target", Year: now.Year()}},
		Costs:    []costInput{{CategoryID: foreignCategoryID, Item: "Bahan", Reason: "Untuk metode", Quantity: "1.25", Unit: "kg", Price: "400"}},
		Schedule: []scheduleInput{{Name: "Kegiatan", Output: "Luaran", Indicator: "Indikator", Person: "Ketua", From: 1, To: 1}},
	}
	draftPayload := map[string]any{"title": "Judul uji", "fieldId": fieldID, "revision": 1, "data": data}
	send("POST", draftPath+"/submit", map[string]any{"revision": 1, "confirmed": true}, 400)
	send("POST", categories, category, 403)
	send("PUT", draftPath, draftPayload, 400)
	data.Costs[0].CategoryID = categoryID
	send("PUT", draftPath, draftPayload, 200)
	send("PUT", draftPath, draftPayload, 409)
	if !strings.Contains(send("GET", draftPath, nil, 200).Body.String(), `"budget":"500"`) {
		t.Fatal("server budget did not calculate decimal quantity")
	}
	cookies = adminCookies
	send("GET", draftPath, nil, 404)
	versionInput["manual"] = "Verifikasi dokumen uji"
	manualVersion := readID(send("POST", versionPath, versionInput, 200))
	cookies = memberCookies
	send("POST", draftPath+"/submit", map[string]any{"revision": 2, "confirmed": true}, 409)
	send("POST", draftPath+"/grant", map[string]any{"revision": 2}, 200)
	if !strings.Contains(send("GET", draftPath, nil, 200).Body.String(), fmt.Sprintf(`"grantVersionId":%d`, manualVersion)) {
		t.Fatal("draft did not adopt the new version")
	}
	send("POST", draftPath+"/submit", map[string]any{"revision": 3, "confirmed": true}, 409)
	send("POST", draftPath+"/verification", map[string]any{"revision": 3}, 200)
	send("POST", fmt.Sprintf("%s/verification/%d", research, draftID), map[string]any{"revision": 3}, 403)
	cookies = adminCookies
	send("POST", fmt.Sprintf("%s/verification/%d", research, draftID), map[string]any{"revision": 3}, 200)
	cookies = memberCookies
	send("POST", draftPath+"/submit", map[string]any{"revision": 3, "confirmed": true}, 200)
	journal := draftPath + "/journal"
	journalPayload := map[string]any{"date": "2026-11-25", "activity": "Pengumpulan data", "result": "Catatan awal"}
	journalID := readID(send("POST", journal, journalPayload, 200))
	journalPath := fmt.Sprintf("%s/%d", journal, journalID)
	journalPayload["revision"] = 1
	journalPayload["activity"] = "Pengumpulan data lanjutan"
	send("PUT", journalPath, journalPayload, 200)
	send("PUT", journalPath, journalPayload, 409)
	if !strings.Contains(send("GET", journal, nil, 200).Body.String(), "Pengumpulan data lanjutan") {
		t.Fatal("updated journal entry was not listed")
	}
	cookies = adminCookies
	send("PUT", journalPath, journalPayload, 404)
	if strings.TrimSpace(send("GET", journal, nil, 200).Body.String()) != "[]" {
		t.Fatal("another user's journal entry was visible")
	}
	cookies = memberCookies
	send("DELETE", journalPath, map[string]int{"revision": 2}, 200)
	if strings.TrimSpace(send("GET", journal, nil, 200).Body.String()) != "[]" {
		t.Fatal("archived journal entry remained visible")
	}
	reports := scope + "/reports"
	progress := fmt.Sprintf("%s/%d/progress", reports, draftID)
	send("GET", reports, nil, 403)
	send("GET", scope+"/documents/proposal", nil, 403)
	cookies = adminCookies
	send("PUT", progress, map[string]int{"revision": 0}, 404)
	send("PUT", memberPath, map[string]any{"active": true, "roles": []int64{}, "permissions": []string{researchApply, reportsDraft, documentsRead}}, 200)
	cookies = memberCookies
	if !strings.Contains(send("GET", reports, nil, 200).Body.String(), `"introduction":"Pendahuluan"`) {
		t.Fatal("report source did not include the submitted introduction")
	}
	progressPayload := map[string]any{"revision": 0, "data": map[string]string{"introduction": "Pendahuluan laporan"}}
	send("PUT", progress, progressPayload, 200)
	send("PUT", progress, progressPayload, 409)
	progressPayload["revision"] = 1
	send("PUT", progress, progressPayload, 200)
	send("PUT", fmt.Sprintf("%s/%d/final", reports, draftID), map[string]int{"revision": 0}, 200)
	if strings.Contains(send("GET", draftPath, nil, 200).Body.String(), "Pendahuluan laporan") {
		t.Fatal("editing the report modified the submitted proposal")
	}
	send("DELETE", progress, map[string]int{"revision": 2}, 200)
	if result := send("GET", reports, nil, 200).Body.String(); strings.Contains(result, `"kind":"progress"`) || !strings.Contains(result, `"kind":"final"`) {
		t.Fatal("report archive changed the wrong report")
	}
	send("GET", scope+"/documents/proposal", nil, 200)
	send("PUT", draftPath, map[string]any{"title": "Judul uji", "revision": 4, "data": data}, 409)
	cookies = adminCookies
	category["name"] = "Bahan uji baru"
	send("PUT", categoryPath, category, 200)
	versionInput["manual"] = ""
	versionInput["quota"] = 1
	cappedVersion := readID(send("POST", versionPath, versionInput, 200))
	cookies = memberCookies
	if !strings.Contains(send("GET", draftPath, nil, 200).Body.String(), `"category":"Bahan uji"`) {
		t.Fatal("renaming a category changed the submitted proposal")
	}
	secondDraft := readID(send("POST", research, map[string]any{"grantVersionId": cappedVersion}, 200))
	secondDraftPath := fmt.Sprintf("%s/%d", research, secondDraft)
	send("PUT", secondDraftPath, draftPayload, 200)
	if !strings.Contains(send("POST", secondDraftPath+"/submit", map[string]any{"revision": 2, "confirmed": true}, 409).Body.String(), "quota_full") {
		t.Fatal("quota did not count the submission from the previous scheme version")
	}
	cookies = adminCookies
	send("DELETE", categoryPath, nil, 200)
	cookies = memberCookies
	if !strings.Contains(send("GET", research+"/options", nil, 200).Body.String(), `"budgetCategories":[]`) {
		t.Fatal("archived category remained selectable")
	}
	send("POST", secondDraftPath+"/submit", map[string]any{"revision": 2, "confirmed": true}, 400)
	cookies = adminCookies
	community := scope + "/community"
	pkm := map[string]any{"title": "Pelatihan mitra", "data": map[string]string{"partner": "Mitra uji", "budget": "250000"}}
	pkmID := readID(send("POST", community, pkm, 200))
	pkmPath := fmt.Sprintf("%s/%d", community, pkmID)
	pkm["revision"] = 1
	pkm["title"] = "Pelatihan mitra lanjutan"
	send("PUT", pkmPath, pkm, 200)
	send("PUT", pkmPath, pkm, 409)
	send("PUT", fmt.Sprintf("%s/institutions/%d/community/%d", base, other, pkmID), pkm, 404)
	if !strings.Contains(send("GET", community, nil, 200).Body.String(), "Pelatihan mitra lanjutan") {
		t.Fatal("the updated PkM draft was not listed")
	}
	cookies = memberCookies
	send("GET", community, nil, 403)
	cookies = adminCookies
	send("PUT", memberPath, map[string]any{"active": true, "roles": []int64{}, "permissions": []string{communityDraft}}, 200)
	cookies = memberCookies
	send("PUT", pkmPath, pkm, 404)
	if strings.TrimSpace(send("GET", community, nil, 200).Body.String()) != "[]" {
		t.Fatal("another owner's PkM draft was visible")
	}
	cookies = adminCookies
	send("DELETE", pkmPath, map[string]int{"revision": 2}, 200)
	send("PUT", pkmPath, pkm, 404)
	send("DELETE", fmt.Sprintf("%s/roles/%d", scope, role), nil, 200)
	send("DELETE", fmt.Sprintf("%s/users/%d", scope, member), nil, 200)
	send("DELETE", fmt.Sprintf("%s/users/%d", base, member), nil, 200)
	send("DELETE", fmt.Sprintf("%s/institutions/%d", base, other), nil, 200)
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM memberships WHERE institution_id=? AND user_id=? AND NOT is_active", tenant, member).Scan(&page.Next); err != nil || page.Next != 1 {
		t.Fatal("archived membership was not retained")
	}
	trialAdmin := "/api/v1/trial/trial-admin/iam"
	trialTenant := newTenant(trialAdmin, code+"T")
	trialMaster := fmt.Sprintf("%s/institutions/%d/master-data/faculties", trialAdmin, trialTenant)
	trialCode := code + "TRIAL"
	send("POST", trialMaster, map[string]any{"code": trialCode, "name": "Trial Saja", "active": true}, 200)
	reader := strings.Replace(trialMaster, "trial-admin", "trial-reader", 1)
	send("GET", reader, nil, 200)
	send("POST", reader, input, 403)
	var count int
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM faculties WHERE code=?", trialCode).Scan(&count); err != nil || count != 0 {
		t.Fatalf("trial data leaked: %v", err)
	}
}
