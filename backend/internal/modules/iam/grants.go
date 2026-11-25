package iam

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
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
	ID                 int64     `json:"id"`
	Code               string    `json:"code"`
	Name               string    `json:"name"`
	ProposalYear       int       `json:"proposalYear"`
	ProjectYear        int       `json:"projectYear"`
	BudgetYear         int       `json:"budgetYear"`
	OpensAt            time.Time `json:"opensAt"`
	ClosesAt           time.Time `json:"closesAt"`
	ReviewStart        string    `json:"reviewStart"`
	ReviewEnd          string    `json:"reviewEnd"`
	ExecutionStart     string    `json:"executionStart"`
	ProgressReportDate  string    `json:"progressReportDate"`
	FinalReportDate     string    `json:"finalReportDate"`
	AllowDailyJournal   bool      `json:"allowDailyJournal"`
	AllowProgressReport bool      `json:"allowProgressReport"`
	AllowFinalReport    bool      `json:"allowFinalReport"`
	State               string    `json:"state"`
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
	RequireNUPTK   bool      `json:"requireNuptk"`
	MinJafung      string    `json:"minJafung"`
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

func (s service) grantTimeline(c *gin.Context, a actor) {
	ctx := c.Request.Context()
	rows, err := s.db.QueryContext(ctx, `SELECT id,code,name,proposal_year,project_year,budget_year,opens_at,closes_at,
  COALESCE(DATE_FORMAT(review_start,'%Y-%m-%d'),''),
  COALESCE(DATE_FORMAT(review_end,'%Y-%m-%d'),''),
  COALESCE(DATE_FORMAT(execution_start,'%Y-%m-%d'),''),
  COALESCE(DATE_FORMAT(progress_report_date,'%Y-%m-%d'),''),
  COALESCE(DATE_FORMAT(final_report_date,'%Y-%m-%d'),''),
  allow_daily_journal, allow_progress_report, allow_final_report,
  CASE WHEN UTC_TIMESTAMP()<opens_at THEN 'scheduled' WHEN UTC_TIMESTAMP()>=closes_at THEN 'closed' ELSE 'open' END
  FROM grant_periods WHERE institution_id=?
  ORDER BY (UTC_TIMESTAMP() BETWEEN opens_at AND closes_at) DESC, opens_at DESC, id DESC LIMIT 5`, a.tenant)
	if err != nil {
		c.Status(503)
		return
	}
	defer rows.Close()
	items := []grantPeriod{}
	for rows.Next() {
		var row grantPeriod
		if err := rows.Scan(&row.ID, &row.Code, &row.Name, &row.ProposalYear, &row.ProjectYear, &row.BudgetYear, &row.OpensAt, &row.ClosesAt,
			&row.ReviewStart, &row.ReviewEnd, &row.ExecutionStart, &row.ProgressReportDate, &row.FinalReportDate,
			&row.AllowDailyJournal, &row.AllowProgressReport, &row.AllowFinalReport, &row.State); err != nil {
			c.Status(503)
			return
		}
		items = append(items, row)
	}
	if rows.Err() != nil {
		c.Status(503)
		return
	}
	c.JSON(200, gin.H{"periods": items, "serverNow": time.Now().UTC()})
}

func (s service) grantPeriods(ctx context.Context, tenant int64, all bool) ([]grantPeriod, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id,code,name,proposal_year,project_year,budget_year,opens_at,closes_at,
  COALESCE(DATE_FORMAT(review_start,'%Y-%m-%d'),''),
  COALESCE(DATE_FORMAT(review_end,'%Y-%m-%d'),''),
  COALESCE(DATE_FORMAT(execution_start,'%Y-%m-%d'),''),
  COALESCE(DATE_FORMAT(progress_report_date,'%Y-%m-%d'),''),
  COALESCE(DATE_FORMAT(final_report_date,'%Y-%m-%d'),''),
  allow_daily_journal, allow_progress_report, allow_final_report,
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
		if err := rows.Scan(&row.ID, &row.Code, &row.Name, &row.ProposalYear, &row.ProjectYear, &row.BudgetYear, &row.OpensAt, &row.ClosesAt,
			&row.ReviewStart, &row.ReviewEnd, &row.ExecutionStart, &row.ProgressReportDate, &row.FinalReportDate,
			&row.AllowDailyJournal, &row.AllowProgressReport, &row.AllowFinalReport, &row.State); err != nil {
			return nil, err
		}
		items = append(items, row)
	}
	return items, rows.Err()
}

func (s service) grantVersions(ctx context.Context, tenant int64, all bool) ([]grantVersion, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT v.id,v.period_id,v.scheme_id,v.funding_source_id,v.version_no,v.scheme_name,v.source_name,
  CAST(v.budget_idr AS CHAR),v.quota,v.duration_months,v.active_lecturer,v.require_nuptk,v.min_jafung,v.manual_requirements,v.published_at
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
		if err := rows.Scan(&v.ID, &v.PeriodID, &v.SchemeID, &v.SourceID, &v.Version, &v.Scheme, &v.Source, &v.Budget, &v.Quota, &v.Duration, &v.ActiveLecturer, &v.RequireNUPTK, &v.MinJafung, &v.Manual, &v.PublishedAt); err != nil {
			return nil, err
		}
		items = append(items, v)
	}
	return items, rows.Err()
}

func parseOptionalDate(raw string) (sql.NullString, bool) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return sql.NullString{}, true
	}
	if _, err := time.Parse("2006-01-02", s); err != nil {
		return sql.NullString{}, false
	}
	return sql.NullString{String: s, Valid: true}, true
}

func (s service) saveGrantPeriod(c *gin.Context, a actor) {
	var input struct {
		Code, Name                            string
		ProposalYear, ProjectYear, BudgetYear int
		OpensAt, ClosesAt                     time.Time
		ReviewStart, ReviewEnd                string
		ExecutionStart                        string
		ProgressReportDate, FinalReportDate   string
		AllowDailyJournal                     bool
		AllowProgressReport                   bool
		AllowFinalReport                      bool
	}
	if c.ShouldBindJSON(&input) != nil {
		c.Status(400)
		return
	}
	input.Code = strings.ToUpper(strings.TrimSpace(input.Code))
	input.Name = strings.TrimSpace(input.Name)
	validYear := func(year int) bool { return year >= 2000 && year <= 2200 }
	revStart, ok1 := parseOptionalDate(input.ReviewStart)
	revEnd, ok2 := parseOptionalDate(input.ReviewEnd)
	execStart, ok3 := parseOptionalDate(input.ExecutionStart)
	progDate, ok4 := parseOptionalDate(input.ProgressReportDate)
	finalDate, ok5 := parseOptionalDate(input.FinalReportDate)
	if input.Code == "" || len(input.Code) > 64 || input.Name == "" || len(input.Name) > 200 ||
		!validYear(input.ProposalYear) || !validYear(input.ProjectYear) || !validYear(input.BudgetYear) ||
		!input.ClosesAt.After(input.OpensAt) || !validYear(input.OpensAt.Year()) || !validYear(input.ClosesAt.Year()) ||
		!ok1 || !ok2 || !ok3 || !ok4 || !ok5 {
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
			_, err := tx.ExecContext(ctx, `UPDATE grant_periods SET code=?,name=?,proposal_year=?,project_year=?,budget_year=?,opens_at=?,closes_at=?,
   review_start=?,review_end=?,execution_start=?,progress_report_date=?,final_report_date=?,
   allow_daily_journal=?,allow_progress_report=?,allow_final_report=?
   WHERE institution_id=? AND id=?`,
				input.Code, input.Name, input.ProposalYear, input.ProjectYear, input.BudgetYear, input.OpensAt.UTC(), input.ClosesAt.UTC(),
				revStart, revEnd, execStart, progDate, finalDate,
				input.AllowDailyJournal, input.AllowProgressReport, input.AllowFinalReport, a.tenant, id)
			return id, err
		}
		result, err := tx.ExecContext(ctx, `INSERT INTO grant_periods
   (institution_id,code,name,proposal_year,project_year,budget_year,opens_at,closes_at,review_start,review_end,execution_start,progress_report_date,final_report_date,allow_daily_journal,allow_progress_report,allow_final_report)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
			a.tenant, input.Code, input.Name, input.ProposalYear, input.ProjectYear, input.BudgetYear, input.OpensAt.UTC(), input.ClosesAt.UTC(),
			revStart, revEnd, execStart, progDate, finalDate, input.AllowDailyJournal, input.AllowProgressReport, input.AllowFinalReport)
		if err != nil {
			return 0, err
		}
		return result.LastInsertId()
	})
}

func (s service) togglePeriodReporting(c *gin.Context, a actor) {
	id, err := strconv.ParseInt(c.Param("period"), 10, 64)
	var input struct {
		AllowDailyJournal   bool `json:"allowDailyJournal"`
		AllowProgressReport bool `json:"allowProgressReport"`
		AllowFinalReport    bool `json:"allowFinalReport"`
	}
	if err != nil || id < 1 || c.ShouldBindJSON(&input) != nil {
		c.Status(400)
		return
	}
	s.change(c, a, "grants.period.reporting", func(ctx context.Context, tx *sql.Tx) (int64, error) {
		var locked int64
		if err := tx.QueryRowContext(ctx, "SELECT id FROM grant_periods WHERE institution_id=? AND id=? FOR UPDATE", a.tenant, id).Scan(&locked); err != nil {
			return 0, err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE grant_periods
 SET allow_daily_journal=?, allow_progress_report=?, allow_final_report=?
 WHERE institution_id=? AND id=?`, input.AllowDailyJournal, input.AllowProgressReport, input.AllowFinalReport, a.tenant, id); err != nil {
			return 0, err
		}
		return id, nil
	})
}

type grantVersionInput struct {
	SchemeID, SourceID int64
	Budget             string
	Quota, Duration    int
	ActiveLecturer     bool
	RequireNUPTK       bool
	MinJafung          string
	Manual             string
}

func parseGrantVersionInput(c *gin.Context) (grantVersionInput, uint64, bool) {
	var input grantVersionInput
	if c.ShouldBindJSON(&input) != nil {
		c.Status(400)
		return input, 0, false
	}
	budget, err := strconv.ParseUint(input.Budget, 10, 63)
	input.Manual = strings.TrimSpace(input.Manual)
	input.MinJafung = strings.TrimSpace(input.MinJafung)
	if err != nil || input.SchemeID < 1 || input.SourceID < 1 || input.Quota < 1 || input.Quota > 1000000 ||
		input.Duration < 1 || input.Duration > 120 || len(input.Manual) > 2000 || !validJafungValues[input.MinJafung] {
		c.Status(400)
		return input, 0, false
	}
	return input, budget, true
}

func (s service) publishGrantVersion(c *gin.Context, a actor) {
	period, err := strconv.ParseInt(c.Param("period"), 10, 64)
	if err != nil || period < 1 {
		c.Status(400)
		return
	}
	input, budget, ok := parseGrantVersionInput(c)
	if !ok {
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
   (institution_id,period_id,scheme_id,funding_source_id,version_no,scheme_name,source_name,budget_idr,quota,duration_months,active_lecturer,require_nuptk,min_jafung,manual_requirements)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, a.tenant, period, input.SchemeID, input.SourceID, version, scheme, source, budget, input.Quota, input.Duration, input.ActiveLecturer, input.RequireNUPTK, input.MinJafung, input.Manual)
		if err != nil {
			return 0, err
		}
		return result.LastInsertId()
	})
}

func (s service) updateGrantVersion(c *gin.Context, a actor) {
	id := target(c)
	if id < 1 {
		c.Status(400)
		return
	}
	input, budget, ok := parseGrantVersionInput(c)
	if !ok {
		return
	}
	s.change(c, a, "grants.scheme.update", func(ctx context.Context, tx *sql.Tx) (int64, error) {
		var closed bool
		if err := tx.QueryRowContext(ctx, `SELECT p.closes_at<=UTC_TIMESTAMP()
 FROM grant_scheme_versions v
 JOIN grant_periods p ON p.institution_id=v.institution_id AND p.id=v.period_id
 WHERE v.institution_id=? AND v.id=? FOR UPDATE`, a.tenant, id).Scan(&closed); err != nil {
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
		if _, err := tx.ExecContext(ctx, `UPDATE grant_scheme_versions
 SET scheme_id=?, funding_source_id=?, scheme_name=?, source_name=?, budget_idr=?, quota=?, duration_months=?, active_lecturer=?, require_nuptk=?, min_jafung=?, manual_requirements=?
 WHERE institution_id=? AND id=?`,
			input.SchemeID, input.SourceID, scheme, source, budget, input.Quota, input.Duration, input.ActiveLecturer, input.RequireNUPTK, input.MinJafung, input.Manual, a.tenant, id); err != nil {
			return 0, err
		}
		return id, nil
	})
}

func (s service) deleteGrantVersion(c *gin.Context, a actor) {
	id := target(c)
	if id < 1 {
		c.Status(400)
		return
	}
	s.change(c, a, "grants.scheme.delete", func(ctx context.Context, tx *sql.Tx) (int64, error) {
		var used int
		if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM research_proposals WHERE institution_id=? AND grant_version_id=?", a.tenant, id).Scan(&used); err != nil {
			return 0, err
		}
		if used > 0 {
			return 0, fmt.Errorf("%w: skema tidak dapat dihapus karena sudah digunakan pada usulan penelitian", invalidProposal)
		}
		res, err := tx.ExecContext(ctx, "DELETE FROM grant_scheme_versions WHERE institution_id=? AND id=?", a.tenant, id)
		if err != nil {
			return 0, err
		}
		n, err := res.RowsAffected()
		if err != nil {
			return 0, err
		}
		if n == 0 {
			return 0, sql.ErrNoRows
		}
		return id, nil
	})
}

func (s service) grantEligibility(c *gin.Context, a actor) {
	id := target(c)
	if id < 1 {
		c.Status(400)
		return
	}
	ctx := c.Request.Context()
	var periodID int64
	var required, requireNUPTK, open, current bool
	var minJafung, manual string
	err := s.db.QueryRowContext(ctx, `SELECT v.period_id,v.active_lecturer,v.require_nuptk,v.min_jafung,v.manual_requirements,
  p.opens_at<=UTC_TIMESTAMP() AND p.closes_at>UTC_TIMESTAMP(),
  v.version_no=(SELECT MAX(x.version_no) FROM grant_scheme_versions x WHERE x.institution_id=v.institution_id AND x.period_id=v.period_id AND x.scheme_id=v.scheme_id)
  FROM grant_scheme_versions v JOIN grant_periods p ON p.id=v.period_id AND p.institution_id=v.institution_id
  WHERE v.institution_id=? AND v.id=?`, a.tenant, id).Scan(&periodID, &required, &requireNUPTK, &minJafung, &manual, &open, &current)
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
	var matches, active, withNUPTK, overdue, leaderCount int
	var lecturerJafung string
	if open && current {
		if required || requireNUPTK || minJafung != "" {
			if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*),COALESCE(SUM(is_active),0),
 COALESCE(SUM(is_active AND TRIM(nuptk)<>'' AND TRIM(nuptk)<>'-'),0),
 COALESCE(MAX(CASE WHEN is_active THEN jafung ELSE '' END),'')
 FROM lecturers WHERE institution_id=? AND (user_id=? OR (user_id IS NULL AND email=?))`, a.tenant, a.ID, a.Email).Scan(&matches, &active, &withNUPTK, &lecturerJafung); err != nil {
				c.Status(503)
				return
			}
		}
		var ovErr error
		overdue, ovErr = countOverdueReports(ctx, s.db, a.tenant, a.ID, periodID)
		if ovErr != nil {
			c.Status(503)
			return
		}
		var ldErr error
		leaderCount, ldErr = countLeaderProposalsInPeriod(ctx, s.db, a.tenant, a.ID, periodID, 0)
		if ldErr != nil {
			c.Status(503)
			return
		}
	}
	result, reasons := assessEligibility(open, current, required, requireNUPTK, minJafung, manual, matches, active, withNUPTK, lecturerJafung, overdue, leaderCount)
	c.JSON(http.StatusOK, gin.H{"result": result, "reasons": reasons})
}

type queryRower interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

func countLeaderProposalsInPeriod(ctx context.Context, q queryRower, tenant, userID, periodID, excludeProposalID int64) (int, error) {
	var count int
	err := q.QueryRowContext(ctx, `SELECT COUNT(*)
 FROM research_proposals p
 JOIN grant_scheme_versions v ON v.institution_id=p.institution_id AND v.id=p.grant_version_id
 WHERE p.institution_id=? AND p.owner_user_id=? AND v.period_id=? AND p.id<>?
   AND p.status<>'archived'
   AND p.workflow_status NOT IN ('rejected_admin','rejected_review')
   AND p.funding_decision<>'rejected'`, tenant, userID, periodID, excludeProposalID).Scan(&count)
	return count, err
}

func countMemberProposalsInPeriod(ctx context.Context, q queryRower, tenant, lecturerID, periodID, excludeProposalID int64) (int, error) {
	var lecturerUserID sql.NullInt64
	if err := q.QueryRowContext(ctx, `SELECT user_id FROM lecturers WHERE institution_id=? AND id=?`, tenant, lecturerID).Scan(&lecturerUserID); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return 0, err
	}
	var count int
	err := q.QueryRowContext(ctx, `SELECT COUNT(*)
 FROM research_proposals p
 JOIN grant_scheme_versions v ON v.institution_id=p.institution_id AND v.id=p.grant_version_id
 JOIN proposal_member_consents c ON c.institution_id=p.institution_id AND c.proposal_id=p.id
 WHERE p.institution_id=? AND c.lecturer_id=? AND v.period_id=? AND p.id<>?
   AND p.status<>'archived'
   AND p.workflow_status NOT IN ('rejected_admin','rejected_review')
   AND p.funding_decision<>'rejected'
   AND (? IS NULL OR p.owner_user_id<>?)`, tenant, lecturerID, periodID, excludeProposalID, lecturerUserID, lecturerUserID).Scan(&count)
	return count, err
}

func countOverdueReports(ctx context.Context, q queryRower, tenant, userID, currentPeriodID int64) (int, error) {
	var overdue int
	err := q.QueryRowContext(ctx, `SELECT COUNT(*)
 FROM research_proposals p
 JOIN grant_scheme_versions v ON v.institution_id=p.institution_id AND v.id=p.grant_version_id
 JOIN grant_periods g ON g.institution_id=v.institution_id AND g.id=v.period_id
 WHERE p.institution_id=? AND p.owner_user_id=? AND p.funding_decision='funded'
   AND v.period_id<>? AND g.closes_at<UTC_TIMESTAMP()
   AND NOT EXISTS (
     SELECT 1 FROM research_reports r
     WHERE r.institution_id=p.institution_id AND r.proposal_id=p.id AND r.kind='final' AND r.is_active AND JSON_LENGTH(r.payload)>0
   )`, tenant, userID, currentPeriodID).Scan(&overdue)
	return overdue, err
}

func assessEligibility(open, current, required, requireNUPTK bool, minJafung, manual string, matches, active, withNUPTK int, lecturerJafung string, overdue, leaderCount int) (string, []string) {
	if !open || !current {
		return "ineligible", []string{"Periode belum dibuka, sudah ditutup, atau versi ini sudah digantikan."}
	}
	status := "eligible"
	reasons := []string{}
	if overdue > 0 {
		status = "ineligible"
		reasons = append(reasons, fmt.Sprintf("Terdapat %d tunggakan laporan akhir penelitian/pengmas periode sebelumnya yang belum diselesaikan.", overdue))
	}
	if leaderCount > 0 {
		status = "ineligible"
		reasons = append(reasons, "Anda sudah tercatat sebagai Ketua pada 1 usulan di periode ini (maksimal 1 usulan sebagai Ketua per periode).")
	}
	if required || requireNUPTK || minJafung != "" {
		switch {
		case matches != 1:
			status = "ineligible"
			reasons = append(reasons, "Akun belum terhubung dengan data Dosen aktif. Hubungi admin atau pastikan akun terhubung di Master Data Dosen.")
		case active != 1:
			status = "ineligible"
			reasons = append(reasons, "Status dosen tercatat nonaktif.")
		case requireNUPTK && withNUPTK != 1:
			status = "ineligible"
			reasons = append(reasons, "Skema ini mewajibkan NUPTK. Lengkapi NUPTK pada Pengaturan → Profil Dosen, atau pilih skema Pemula.")
		default:
			if minJafung != "" && jafungRank(lecturerJafung) < jafungRank(minJafung) {
				status = "ineligible"
				reasons = append(reasons, fmt.Sprintf("Jabatan Fungsional minimal untuk skema ini adalah %s (jabatan Anda saat ini: %s). Perbarui di Pengaturan → Profil Dosen.", jafungLabel(minJafung), jafungLabel(lecturerJafung)))
			} else {
				nuptkInfo := "tanpa NUPTK"
				if withNUPTK == 1 {
					nuptkInfo = "NUPTK terisi"
				}
				reasons = append(reasons, fmt.Sprintf("Profil dosen memenuhi syarat (%s · Jafung: %s).", nuptkInfo, jafungLabel(lecturerJafung)))
			}
		}
	}
	if manual != "" {
		reasons = append(reasons, "Catatan syarat skema (diverifikasi LPPM setelah usulan diajukan): "+manual)
	}
	if len(reasons) == 0 {
		reasons = append(reasons, "Periode terbuka dan profil memenuhi syarat otomatis.")
	}
	return status, reasons
}
