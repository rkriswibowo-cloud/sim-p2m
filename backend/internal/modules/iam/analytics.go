package iam

import (
	"bytes"
	"encoding/csv"
	"fmt"
	"html"
	"mime"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

type analyticsKPI struct {
	TotalProposals      int    `json:"totalProposals"`
	FundedProposals     int    `json:"fundedProposals"`
	ActiveProjects      int    `json:"activeProjects"`
	CompletedProjects   int    `json:"completedProjects"`
	TotalApprovedBudget string `json:"totalApprovedBudget"`
	TotalDisbursed      string `json:"totalDisbursed"`
	TotalSpent          string `json:"totalSpent"`
	VerifiedOutputs     int    `json:"verifiedOutputs"`
	ExternalFunded      int    `json:"externalFunded"`
}

type schemeAggregate struct {
	SchemeID       int64  `json:"schemeId"`
	SchemeName     string `json:"schemeName"`
	SubmittedCount int    `json:"submittedCount"`
	FundedCount    int    `json:"fundedCount"`
	ApprovedBudget string `json:"approvedBudget"`
}

type statusAggregate struct {
	Status string `json:"status"`
	Count  int    `json:"count"`
}

type yearAggregate struct {
	Year           int    `json:"year"`
	SubmittedCount int    `json:"submittedCount"`
	FundedCount    int    `json:"fundedCount"`
	ApprovedBudget string `json:"approvedBudget"`
}

func (s service) canViewAnalytics(c *gin.Context, a actor) bool {
	if a.system() || a.mode != "production" {
		return true
	}
	ctx := c.Request.Context()
	var role string
	return s.roleForPermission(ctx, a, researchVerify, &role) == nil ||
		s.roleForPermission(ctx, a, researchDecide, &role) == nil ||
		s.roleForPermission(ctx, a, auditRead, &role) == nil ||
		s.roleForPermission(ctx, a, grantRead, &role) == nil
}

func buildAnalyticsFilterSQL(tenant int64, year, schemeID, sourceID int64) (string, []any) {
	where := "p.institution_id=? AND p.status='submitted'"
	args := []any{tenant}
	if year > 0 {
		where += " AND g.fiscal_year=?"
		args = append(args, year)
	}
	if schemeID > 0 {
		where += " AND v.scheme_id=?"
		args = append(args, schemeID)
	}
	if sourceID > 0 {
		where += " AND v.funding_source_id=?"
		args = append(args, sourceID)
	}
	return where, args
}

func (s service) analyticsOverview(c *gin.Context, a actor) {
	if !s.canViewAnalytics(c, a) {
		c.Status(403)
		return
	}
	ctx := c.Request.Context()
	year, _ := strconv.ParseInt(c.Query("year"), 10, 64)
	schemeID, _ := strconv.ParseInt(c.Query("schemeId"), 10, 64)
	sourceID, _ := strconv.ParseInt(c.Query("fundingSourceId"), 10, 64)

	where, args := buildAnalyticsFilterSQL(a.tenant, year, schemeID, sourceID)

	var kpi analyticsKPI
	err := s.db.QueryRowContext(ctx, `SELECT
 COUNT(*),
 COALESCE(SUM(CASE WHEN p.funding_decision='funded' THEN 1 ELSE 0 END),0),
 COALESCE(SUM(CASE WHEN pr.status='active' THEN 1 ELSE 0 END),0),
 COALESCE(SUM(CASE WHEN pr.status='completed' THEN 1 ELSE 0 END),0),
 CAST(COALESCE(SUM(CASE WHEN p.funding_decision='funded' THEN COALESCE(pr.approved_budget_idr, p.approved_budget_idr, p.budget_idr) ELSE 0 END),0) AS CHAR)
 FROM research_proposals p
 JOIN grant_scheme_versions v ON v.institution_id=p.institution_id AND v.id=p.grant_version_id
 JOIN grant_periods g ON g.institution_id=v.institution_id AND g.id=v.period_id
 LEFT JOIN research_projects pr ON pr.institution_id=p.institution_id AND pr.proposal_id=p.id
 WHERE `+where, args...).Scan(
		&kpi.TotalProposals, &kpi.FundedProposals, &kpi.ActiveProjects, &kpi.CompletedProjects, &kpi.TotalApprovedBudget,
	)
	if err != nil {
		c.Status(503)
		return
	}

	_ = s.db.QueryRowContext(ctx, `SELECT CAST(COALESCE(SUM(d.amount_idr),0) AS CHAR)
 FROM project_disbursements d
 JOIN research_projects pr ON pr.institution_id=d.institution_id AND pr.id=d.project_id
 JOIN research_proposals p ON p.institution_id=pr.institution_id AND p.id=pr.proposal_id
 JOIN grant_scheme_versions v ON v.institution_id=p.institution_id AND v.id=p.grant_version_id
 JOIN grant_periods g ON g.institution_id=v.institution_id AND g.id=v.period_id
 WHERE d.status='transferred' AND `+where, args...).Scan(&kpi.TotalDisbursed)
	if kpi.TotalDisbursed == "" {
		kpi.TotalDisbursed = "0"
	}

	_ = s.db.QueryRowContext(ctx, `SELECT CAST(COALESCE(SUM(e.total_idr),0) AS CHAR)
 FROM project_expenses e
 JOIN research_proposals p ON p.institution_id=e.institution_id AND p.id=e.proposal_id
 JOIN grant_scheme_versions v ON v.institution_id=p.institution_id AND v.id=p.grant_version_id
 JOIN grant_periods g ON g.institution_id=v.institution_id AND g.id=v.period_id
 WHERE `+where, args...).Scan(&kpi.TotalSpent)
	if kpi.TotalSpent == "" {
		kpi.TotalSpent = "0"
	}

	_ = s.db.QueryRowContext(ctx, `SELECT COUNT(*)
 FROM research_outputs o
 JOIN research_proposals p ON p.institution_id=o.institution_id AND p.id=o.proposal_id
 JOIN grant_scheme_versions v ON v.institution_id=p.institution_id AND v.id=p.grant_version_id
 JOIN grant_periods g ON g.institution_id=v.institution_id AND g.id=v.period_id
 WHERE o.verified_status='verified' AND `+where, args...).Scan(&kpi.VerifiedOutputs)

	extWhere := "institution_id=? AND status='funded'"
	extArgs := []any{a.tenant}
	if year > 0 {
		extWhere += " AND fiscal_year=?"
		extArgs = append(extArgs, year)
	}
	_ = s.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM external_fundings WHERE "+extWhere, extArgs...).Scan(&kpi.ExternalFunded)

	// By scheme
	byScheme := []schemeAggregate{}
	sRows, err := s.db.QueryContext(ctx, `SELECT v.scheme_id, v.scheme_name, COUNT(*),
 COALESCE(SUM(CASE WHEN p.funding_decision='funded' THEN 1 ELSE 0 END),0),
 CAST(COALESCE(SUM(CASE WHEN p.funding_decision='funded' THEN COALESCE(p.approved_budget_idr, p.budget_idr) ELSE 0 END),0) AS CHAR)
 FROM research_proposals p
 JOIN grant_scheme_versions v ON v.institution_id=p.institution_id AND v.id=p.grant_version_id
 JOIN grant_periods g ON g.institution_id=v.institution_id AND g.id=v.period_id
 WHERE `+where+` GROUP BY v.scheme_id, v.scheme_name ORDER BY COUNT(*) DESC`, args...)
	if err == nil {
		defer sRows.Close()
		for sRows.Next() {
			var sa schemeAggregate
			if sRows.Scan(&sa.SchemeID, &sa.SchemeName, &sa.SubmittedCount, &sa.FundedCount, &sa.ApprovedBudget) == nil {
				byScheme = append(byScheme, sa)
			}
		}
	}

	// By workflow status
	byWorkflow := []statusAggregate{}
	wRows, err := s.db.QueryContext(ctx, `SELECT p.workflow_status, COUNT(*)
 FROM research_proposals p
 JOIN grant_scheme_versions v ON v.institution_id=p.institution_id AND v.id=p.grant_version_id
 JOIN grant_periods g ON g.institution_id=v.institution_id AND g.id=v.period_id
 WHERE `+where+` GROUP BY p.workflow_status ORDER BY COUNT(*) DESC`, args...)
	if err == nil {
		defer wRows.Close()
		for wRows.Next() {
			var st statusAggregate
			if wRows.Scan(&st.Status, &st.Count) == nil {
				byWorkflow = append(byWorkflow, st)
			}
		}
	}

	// By year
	byYear := []yearAggregate{}
	yRows, err := s.db.QueryContext(ctx, `SELECT g.fiscal_year, COUNT(*),
 COALESCE(SUM(CASE WHEN p.funding_decision='funded' THEN 1 ELSE 0 END),0),
 CAST(COALESCE(SUM(CASE WHEN p.funding_decision='funded' THEN COALESCE(p.approved_budget_idr, p.budget_idr) ELSE 0 END),0) AS CHAR)
 FROM research_proposals p
 JOIN grant_scheme_versions v ON v.institution_id=p.institution_id AND v.id=p.grant_version_id
 JOIN grant_periods g ON g.institution_id=v.institution_id AND g.id=v.period_id
 WHERE p.institution_id=? AND p.status='submitted'
 GROUP BY g.fiscal_year ORDER BY g.fiscal_year DESC`, a.tenant)
	if err == nil {
		defer yRows.Close()
		for yRows.Next() {
			var ya yearAggregate
			if yRows.Scan(&ya.Year, &ya.SubmittedCount, &ya.FundedCount, &ya.ApprovedBudget) == nil {
				byYear = append(byYear, ya)
			}
		}
	}

	schemes, _ := s.grantChoices(ctx, a.tenant, "SELECT id, name FROM schemes WHERE institution_id=? AND is_active ORDER BY name")
	sources, _ := s.grantChoices(ctx, a.tenant, "SELECT id, name FROM funding_sources WHERE institution_id=? AND is_active ORDER BY name")
	years := []int{}
	yrRows, err := s.db.QueryContext(ctx, "SELECT DISTINCT fiscal_year FROM grant_periods WHERE institution_id=? ORDER BY fiscal_year DESC", a.tenant)
	if err == nil {
		defer yrRows.Close()
		for yrRows.Next() {
			var y int
			if yrRows.Scan(&y) == nil {
				years = append(years, y)
			}
		}
	}

	c.JSON(200, gin.H{
		"kpi":        kpi,
		"byScheme":   byScheme,
		"byWorkflow": byWorkflow,
		"byYear":     byYear,
		"filters": gin.H{
			"years":          years,
			"schemes":        schemes,
			"fundingSources": sources,
		},
	})
}

func (s service) analyticsExport(c *gin.Context, a actor) {
	if !s.canViewAnalytics(c, a) {
		c.Status(403)
		return
	}
	ctx := c.Request.Context()
	kind := strings.TrimSpace(c.DefaultQuery("kind", "proposals"))
	format := strings.ToLower(strings.TrimSpace(c.DefaultQuery("format", "csv")))
	year, _ := strconv.ParseInt(c.Query("year"), 10, 64)
	schemeID, _ := strconv.ParseInt(c.Query("schemeId"), 10, 64)
	sourceID, _ := strconv.ParseInt(c.Query("fundingSourceId"), 10, 64)

	where, args := buildAnalyticsFilterSQL(a.tenant, year, schemeID, sourceID)

	var headers []string
	var dataRows [][]string
	var title string

	switch kind {
	case "proposals":
		title = "Rekapitulasi Usulan Penelitian"
		headers = []string{"No", "ID Usulan", "Judul", "Ketua Peneliti", "Skema", "Tahun", "Status Seleksi", "Keputusan", "RAB Usulan (Rp)", "Anggaran Disetujui (Rp)"}
		rows, err := s.db.QueryContext(ctx, `SELECT p.id, p.title, u.display_name, v.scheme_name, g.fiscal_year,
 p.workflow_status, p.funding_decision, CAST(p.budget_idr AS CHAR), CAST(COALESCE(p.approved_budget_idr,0) AS CHAR)
 FROM research_proposals p
 JOIN users u ON u.id=p.owner_user_id
 JOIN grant_scheme_versions v ON v.institution_id=p.institution_id AND v.id=p.grant_version_id
 JOIN grant_periods g ON g.institution_id=v.institution_id AND g.id=v.period_id
 WHERE `+where+` ORDER BY p.id DESC`, args...)
		if err != nil {
			c.Status(503)
			return
		}
		defer rows.Close()
		no := 1
		for rows.Next() {
			var id int64
			var ttl, own, sch, wf, dec, bud, app string
			var yr int
			if rows.Scan(&id, &ttl, &own, &sch, &yr, &wf, &dec, &bud, &app) == nil {
				dataRows = append(dataRows, []string{strconv.Itoa(no), strconv.FormatInt(id, 10), ttl, own, sch, strconv.Itoa(yr), wf, dec, bud, app})
				no++
			}
		}
	case "projects":
		title = "Rekapitulasi Kontrak dan Realisasi Proyek"
		headers = []string{"No", "Nomor Kontrak", "Tanggal Kontrak", "Judul", "Ketua Peneliti", "Skema", "Status Proyek", "Nilai Kontrak (Rp)", "Total Dicairkan (Rp)"}
		rows, err := s.db.QueryContext(ctx, `SELECT pr.contract_number, DATE_FORMAT(pr.contract_date,'%Y-%m-%d'), p.title, u.display_name, v.scheme_name, pr.status,
 CAST(pr.approved_budget_idr AS CHAR),
 CAST(COALESCE((SELECT SUM(d.amount_idr) FROM project_disbursements d WHERE d.project_id=pr.id AND d.status='transferred'),0) AS CHAR)
 FROM research_projects pr
 JOIN research_proposals p ON p.institution_id=pr.institution_id AND p.id=pr.proposal_id
 JOIN users u ON u.id=p.owner_user_id
 JOIN grant_scheme_versions v ON v.institution_id=p.institution_id AND v.id=p.grant_version_id
 JOIN grant_periods g ON g.institution_id=v.institution_id AND g.id=v.period_id
 WHERE `+where+` ORDER BY pr.id DESC`, args...)
		if err != nil {
			c.Status(503)
			return
		}
		defer rows.Close()
		no := 1
		for rows.Next() {
			var cno, cdt, ttl, own, sch, st, bud, disb string
			if rows.Scan(&cno, &cdt, &ttl, &own, &sch, &st, &bud, &disb) == nil {
				dataRows = append(dataRows, []string{strconv.Itoa(no), cno, cdt, ttl, own, sch, st, bud, disb})
				no++
			}
		}
	case "outputs":
		title = "Rekapitulasi Capaian Luaran Penelitian"
		headers = []string{"No", "Judul Penelitian", "Ketua", "Jenis Luaran", "Judul Luaran", "Penerbit / Jurnal", "Identifier", "Tahun", "Status", "Verifikasi LPPM"}
		rows, err := s.db.QueryContext(ctx, `SELECT p.title, u.display_name, o.kind, o.title, o.publication_name, o.identifier, o.output_year, o.status, o.verified_status
 FROM research_outputs o
 JOIN research_proposals p ON p.institution_id=o.institution_id AND p.id=o.proposal_id
 JOIN users u ON u.id=p.owner_user_id
 JOIN grant_scheme_versions v ON v.institution_id=p.institution_id AND v.id=p.grant_version_id
 JOIN grant_periods g ON g.institution_id=v.institution_id AND g.id=v.period_id
 WHERE `+where+` ORDER BY o.id DESC`, args...)
		if err != nil {
			c.Status(503)
			return
		}
		defer rows.Close()
		no := 1
		for rows.Next() {
			var pttl, own, okind, ottl, opub, oid, ost, over string
			var oyr int
			if rows.Scan(&pttl, &own, &okind, &ottl, &opub, &oid, &oyr, &ost, &over) == nil {
				dataRows = append(dataRows, []string{strconv.Itoa(no), pttl, own, okind, ottl, opub, oid, strconv.Itoa(oyr), ost, over})
				no++
			}
		}
	case "external":
		title = "Rekapitulasi Pendanaan Eksternal"
		headers = []string{"No", "Judul", "Peneliti", "Penyandang Dana", "Skema", "Tahun", "Status", "Usulan (Rp)", "Disetujui (Rp)", "No. Kontrak"}
		rows, err := s.db.QueryContext(ctx, `SELECT e.title, u.display_name, e.funder_name, e.scheme_name, e.fiscal_year, e.status,
 CAST(e.proposed_budget_idr AS CHAR), CAST(COALESCE(e.approved_budget_idr,0) AS CHAR), e.external_contract_no
 FROM external_fundings e JOIN users u ON u.id=e.owner_user_id WHERE e.institution_id=? ORDER BY e.id DESC`, a.tenant)
		if err != nil {
			c.Status(503)
			return
		}
		defer rows.Close()
		no := 1
		for rows.Next() {
			var ttl, own, fnd, sch, st, prop, app, cnt string
			var yr int
			if rows.Scan(&ttl, &own, &fnd, &sch, &yr, &st, &prop, &app, &cnt) == nil {
				dataRows = append(dataRows, []string{strconv.Itoa(no), ttl, own, fnd, sch, strconv.Itoa(yr), st, prop, app, cnt})
				no++
			}
		}
	default:
		c.Status(400)
		return
	}

	if format == "xls" || format == "excel" {
		var b strings.Builder
		b.WriteString(`<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"><style>table{border-collapse:collapse;font-family:Calibri,sans-serif;font-size:11pt}th{background:#1e3a8a;color:#fff;font-weight:bold;border:1px solid #000;padding:6px}td{border:1px solid #000;padding:5px}</style></head><body>`)
		b.WriteString(fmt.Sprintf("<h3>%s</h3><table><thead><tr>", html.EscapeString(title)))
		for _, h := range headers {
			b.WriteString("<th>" + html.EscapeString(h) + "</th>")
		}
		b.WriteString("</tr></thead><tbody>")
		for _, r := range dataRows {
			b.WriteString("<tr>")
			for _, cell := range r {
				b.WriteString("<td>" + html.EscapeString(cell) + "</td>")
			}
			b.WriteString("</tr>")
		}
		b.WriteString("</tbody></table></body></html>")
		fn := fmt.Sprintf("simp2m_%s.xls", kind)
		c.Header("Content-Type", "application/vnd.ms-excel; charset=utf-8")
		c.Header("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": fn}))
		c.Header("Cache-Control", "private, no-store")
		c.Data(http.StatusOK, "application/vnd.ms-excel; charset=utf-8", []byte(b.String()))
		return
	}

	var buf bytes.Buffer
	buf.Write([]byte{0xEF, 0xBB, 0xBF})
	cw := csv.NewWriter(&buf)
	_ = cw.Write(headers)
	for _, r := range dataRows {
		_ = cw.Write(r)
	}
	cw.Flush()
	fn := fmt.Sprintf("simp2m_%s.csv", kind)
	c.Header("Content-Type", "text/csv; charset=utf-8")
	c.Header("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": fn}))
	c.Header("Cache-Control", "private, no-store")
	c.Data(http.StatusOK, "text/csv; charset=utf-8", buf.Bytes())
}

