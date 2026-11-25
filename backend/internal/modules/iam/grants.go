package iam

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const grantRead = "grants.read"
const grantManage = "grants.manage"

var publishedPeriod = errors.New("grant period already published")

type grantPeriod struct {
	ID           int64     `json:"id"`
	Code         string    `json:"code"`
	Name         string    `json:"name"`
	ProposalYear int       `json:"proposalYear"`
	ProjectYear  int       `json:"projectYear"`
	BudgetYear   int       `json:"budgetYear"`
	OpensAt      time.Time `json:"opensAt"`
	ClosesAt     time.Time `json:"closesAt"`
	State        string    `json:"state"`
}

type grantVersion struct {
	ID             int64     `json:"id"`
	PeriodID       int64     `json:"periodId"`
	SchemeID       int64     `json:"schemeId"`
	SourceID       int64     `json:"sourceId"`
	Version        int       `json:"version"`
	Scheme         string    `json:"scheme"`
	Source         string    `json:"source"`
	Budget         string    `json:"budget"`
	Quota          int       `json:"quota"`
	Duration       int       `json:"duration"`
	ActiveLecturer bool      `json:"activeLecturer"`
	Manual         string    `json:"manual"`
	PublishedAt    time.Time `json:"publishedAt"`
}

func (s service) mayManageGrants(ctx context.Context, a actor) bool {
	var role string
	return a.system() || (a.mode == "production" && s.roleForPermission(ctx, a, grantManage, &role) == nil)
}

type grantChoice struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

func (s service) grantOptions(c *gin.Context, a actor) {
	ctx := c.Request.Context()
	schemes, err := s.grantChoices(ctx, a.tenant, "SELECT id,name FROM schemes WHERE institution_id=? AND is_active ORDER BY name")
	if err != nil {
		c.Status(503)
		return
	}
	sources, err := s.grantChoices(ctx, a.tenant, "SELECT id,name FROM funding_sources WHERE institution_id=? AND is_active ORDER BY name")
	if err != nil {
		c.Status(503)
		return
	}
	c.JSON(200, gin.H{"schemes": schemes, "sources": sources})
}

func (s service) grantChoices(ctx context.Context, tenant int64, query string) ([]grantChoice, error) {
	rows, err := s.db.QueryContext(ctx, query, tenant)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []grantChoice{}
	for rows.Next() {
		var item grantChoice
		if err := rows.Scan(&item.ID, &item.Name); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s service) grantOverview(c *gin.Context, a actor) {
	ctx := c.Request.Context()
	administrator := s.mayManageGrants(ctx, a)
	periods, err := s.grantPeriods(ctx, a.tenant, administrator)
	if err != nil {
		c.Status(503)
		return
	}
	versions, err := s.grantVersions(ctx, a.tenant, administrator)
	if err != nil {
		c.Status(503)
		return
	}
	c.JSON(200, gin.H{"periods": periods, "versions": versions, "canManage": administrator})
}

func (s service) grantPeriods(ctx context.Context, tenant int64, all bool) ([]grantPeriod, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id,code,name,proposal_year,project_year,budget_year,opens_at,closes_at,
  CASE WHEN UTC_TIMESTAMP()<opens_at THEN 'scheduled' WHEN UTC_TIMESTAMP()>=closes_at THEN 'closed' ELSE 'open' END
  FROM grant_periods WHERE institution_id=? AND (? OR (opens_at<=UTC_TIMESTAMP() AND closes_at>UTC_TIMESTAMP()
   AND EXISTS (SELECT 1 FROM grant_scheme_versions v WHERE v.institution_id=grant_periods.institution_id AND v.period_id=grant_periods.id)))
  ORDER BY opens_at DESC,id DESC`, tenant, all)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []grantPeriod{}
	for rows.Next() {
		var row grantPeriod
		if err := rows.Scan(&row.ID, &row.Code, &row.Name, &row.ProposalYear, &row.ProjectYear, &row.BudgetYear, &row.OpensAt, &row.ClosesAt, &row.State); err != nil {
			return nil, err
		}
		items = append(items, row)
	}
	return items, rows.Err()
}

func (s service) grantVersions(ctx context.Context, tenant int64, all bool) ([]grantVersion, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT v.id,v.period_id,v.scheme_id,v.funding_source_id,v.version_no,v.scheme_name,v.source_name,
  CAST(v.budget_idr AS CHAR),v.quota,v.duration_months,v.active_lecturer,v.manual_requirements,v.published_at
  FROM grant_scheme_versions v JOIN grant_periods p ON p.id=v.period_id AND p.institution_id=v.institution_id
  WHERE v.institution_id=? AND (? OR (p.opens_at<=UTC_TIMESTAMP() AND p.closes_at>UTC_TIMESTAMP()
   AND v.version_no=(SELECT MAX(x.version_no) FROM grant_scheme_versions x WHERE x.institution_id=v.institution_id AND x.period_id=v.period_id AND x.scheme_id=v.scheme_id)))
  ORDER BY v.period_id DESC,v.scheme_id,v.version_no DESC`, tenant, all)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []grantVersion{}
	for rows.Next() {
		var v grantVersion
		if err := rows.Scan(&v.ID, &v.PeriodID, &v.SchemeID, &v.SourceID, &v.Version, &v.Scheme, &v.Source, &v.Budget, &v.Quota, &v.Duration, &v.ActiveLecturer, &v.Manual, &v.PublishedAt); err != nil {
			return nil, err
		}
		items = append(items, v)
	}
	return items, rows.Err()
}

func (s service) saveGrantPeriod(c *gin.Context, a actor) {
	var input struct {
		Code, Name                            string
		ProposalYear, ProjectYear, BudgetYear int
		OpensAt, ClosesAt                     time.Time
	}
	if c.ShouldBindJSON(&input) != nil {
		c.Status(400)
		return
	}
	input.Code = strings.ToUpper(strings.TrimSpace(input.Code))
	input.Name = strings.TrimSpace(input.Name)
	validYear := func(year int) bool { return year >= 2000 && year <= 2200 }
	if input.Code == "" || len(input.Code) > 64 || input.Name == "" || len(input.Name) > 200 ||
		!validYear(input.ProposalYear) || !validYear(input.ProjectYear) || !validYear(input.BudgetYear) ||
		!input.ClosesAt.After(input.OpensAt) || !validYear(input.OpensAt.Year()) || !validYear(input.ClosesAt.Year()) {
		c.Status(400)
		return
	}
	id := target(c)
	action := "grants.period.create"
	if c.Request.Method == http.MethodPut {
		if id < 1 {
			c.Status(400)
			return
		}
		action = "grants.period.update"
	}
	s.change(c, a, action, func(ctx context.Context, tx *sql.Tx) (int64, error) {
		if id > 0 {
			var locked int64
			if err := tx.QueryRowContext(ctx, "SELECT id FROM grant_periods WHERE institution_id=? AND id=? FOR UPDATE", a.tenant, id).Scan(&locked); err != nil {
				return 0, err
			}
			var published bool
			if err := tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM grant_scheme_versions WHERE institution_id=? AND period_id=?)", a.tenant, id).Scan(&published); err != nil {
				return 0, err
			}
			if published {
				return 0, publishedPeriod
			}
			_, err := tx.ExecContext(ctx, `UPDATE grant_periods SET code=?,name=?,proposal_year=?,project_year=?,budget_year=?,opens_at=?,closes_at=?
			 WHERE institution_id=? AND id=?`, input.Code, input.Name, input.ProposalYear, input.ProjectYear, input.BudgetYear, input.OpensAt.UTC(), input.ClosesAt.UTC(), a.tenant, id)
			return id, err
		}
		result, err := tx.ExecContext(ctx, `INSERT INTO grant_periods (institution_id,code,name,proposal_year,project_year,budget_year,opens_at,closes_at)
   VALUES (?,?,?,?,?,?,?,?)`, a.tenant, input.Code, input.Name, input.ProposalYear, input.ProjectYear, input.BudgetYear, input.OpensAt.UTC(), input.ClosesAt.UTC())
		if err != nil {
			return 0, err
		}
		return result.LastInsertId()
	})
}

func (s service) publishGrantVersion(c *gin.Context, a actor) {
	period, err := strconv.ParseInt(c.Param("period"), 10, 64)
	if err != nil || period < 1 {
		c.Status(400)
		return
	}
	var input struct {
		SchemeID, SourceID int64
		Budget             string
		Quota, Duration    int
		ActiveLecturer     bool
		Manual             string
	}
	if c.ShouldBindJSON(&input) != nil {
		c.Status(400)
		return
	}
	budget, err := strconv.ParseUint(input.Budget, 10, 63)
	input.Manual = strings.TrimSpace(input.Manual)
	if err != nil || input.SchemeID < 1 || input.SourceID < 1 || input.Quota < 1 || input.Quota > 1000000 ||
		input.Duration < 1 || input.Duration > 120 || len(input.Manual) > 2000 {
		c.Status(400)
		return
	}
	s.change(c, a, "grants.scheme.publish", func(ctx context.Context, tx *sql.Tx) (int64, error) {
		var closed bool
		if err := tx.QueryRowContext(ctx, "SELECT closes_at<=UTC_TIMESTAMP() FROM grant_periods WHERE institution_id=? AND id=? FOR UPDATE", a.tenant, period).Scan(&closed); err != nil {
			return 0, err
		}
		if closed {
			return 0, invalid
		}
		var scheme, source string
		if err := tx.QueryRowContext(ctx, "SELECT name FROM schemes WHERE institution_id=? AND id=? AND is_active", a.tenant, input.SchemeID).Scan(&scheme); err != nil {
			return 0, err
		}
		if err := tx.QueryRowContext(ctx, "SELECT name FROM funding_sources WHERE institution_id=? AND id=? AND is_active", a.tenant, input.SourceID).Scan(&source); err != nil {
			return 0, err
		}
		var version int
		if err := tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(version_no),0)+1 FROM grant_scheme_versions
   WHERE institution_id=? AND period_id=? AND scheme_id=?`, a.tenant, period, input.SchemeID).Scan(&version); err != nil {
			return 0, err
		}
		result, err := tx.ExecContext(ctx, `INSERT INTO grant_scheme_versions
   (institution_id,period_id,scheme_id,funding_source_id,version_no,scheme_name,source_name,budget_idr,quota,duration_months,active_lecturer,manual_requirements)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, a.tenant, period, input.SchemeID, input.SourceID, version, scheme, source, budget, input.Quota, input.Duration, input.ActiveLecturer, input.Manual)
		if err != nil {
			return 0, err
		}
		return result.LastInsertId()
	})
}

func (s service) grantEligibility(c *gin.Context, a actor) {
	id := target(c)
	if id < 1 {
		c.Status(400)
		return
	}
	ctx := c.Request.Context()
	var required, open, current bool
	var manual string
	err := s.db.QueryRowContext(ctx, `SELECT v.active_lecturer,v.manual_requirements,
  p.opens_at<=UTC_TIMESTAMP() AND p.closes_at>UTC_TIMESTAMP(),
  v.version_no=(SELECT MAX(x.version_no) FROM grant_scheme_versions x WHERE x.institution_id=v.institution_id AND x.period_id=v.period_id AND x.scheme_id=v.scheme_id)
  FROM grant_scheme_versions v JOIN grant_periods p ON p.id=v.period_id AND p.institution_id=v.institution_id
  WHERE v.institution_id=? AND v.id=?`, a.tenant, id).Scan(&required, &manual, &open, &current)
	if err == sql.ErrNoRows {
		c.Status(404)
		return
	}
	if err != nil {
		c.Status(503)
		return
	}
	if !s.mayManageGrants(ctx, a) && (!open || !current) {
		c.Status(404)
		return
	}
	result, reasons := assessEligibility(open, current, required, manual, 0, 0)
	if open && current && required {
		var matches, active int
		if err := s.db.QueryRowContext(ctx, "SELECT COUNT(*),COALESCE(SUM(is_active),0) FROM lecturers WHERE institution_id=? AND email=?", a.tenant, a.Email).Scan(&matches, &active); err != nil {
			c.Status(503)
			return
		}
		result, reasons = assessEligibility(open, current, required, manual, matches, active)
	}
	c.JSON(http.StatusOK, gin.H{"result": result, "reasons": reasons})
}

func assessEligibility(open, current, required bool, manual string, matches, active int) (string, []string) {
	if !open || !current {
		return "ineligible", []string{"Periode belum dibuka, sudah ditutup, atau versi ini sudah digantikan."}
	}
	status := "eligible"
	reasons := []string{}
	if required {
		switch {
		case matches != 1:
			status = "manual"
			reasons = append(reasons, "Status dosen belum dapat diverifikasi. Data dosen harus memakai email akun yang sama dan unik di institusi.")
		case active != 1:
			status = "ineligible"
			reasons = append(reasons, "Status dosen tercatat nonaktif.")
		default:
			reasons = append(reasons, "Status dosen aktif terverifikasi.")
		}
	}
	if manual != "" {
		if status == "eligible" {
			status = "manual"
		}
		reasons = append(reasons, "Perlu verifikasi admin/LPPM: "+manual)
	}
	if len(reasons) == 0 {
		reasons = append(reasons, "Periode terbuka dan skema tidak memiliki syarat tambahan.")
	}
	return status, reasons
}
