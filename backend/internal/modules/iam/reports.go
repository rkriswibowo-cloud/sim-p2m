package iam

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
)

const reportsDraft = "reports.draft"

var reportFields = map[string][]string{
	"progress": {"introduction", "method", "progress", "nextPlan", "budgetNotes", "references"},
	"final":    {"abstract", "keywords", "introduction", "literature", "method", "results", "conclusion", "references", "fundUse"},
}

type outputProgress struct {
	Status   string `json:"status"`
	Result   string `json:"result"`
	Evidence string `json:"evidence"`
	FollowUp string `json:"followUp"`
}

func (s service) uploadProgressReport(c *gin.Context, a actor) {
	id := target(c)
	if id < 1 {
		c.Status(400)
		return
	}
	media, content, err := readProofUpload(c, "report")
	if c.Request.MultipartForm != nil {
		defer c.Request.MultipartForm.RemoveAll()
	}
	if err != nil || media != "application/pdf" {
		c.JSON(400, gin.H{"message": "Unggah laporan kemajuan dalam format PDF, maksimal 5 MB."})
		return
	}
	s.change(c, a, "reports.progress.upload", func(ctx context.Context, tx *sql.Tx) (int64, error) {
		var enabled bool
		err := tx.QueryRowContext(ctx, `SELECT g.allow_progress_report
 FROM research_proposals p JOIN grant_scheme_versions v ON v.institution_id=p.institution_id AND v.id=p.grant_version_id
 JOIN grant_periods g ON g.institution_id=v.institution_id AND g.id=v.period_id
 WHERE p.institution_id=? AND p.owner_user_id=? AND p.id=? AND p.status='submitted' FOR UPDATE`, a.tenant, a.ID, id).Scan(&enabled)
		if err != nil {
			return 0, err
		}
		if !enabled {
			return 0, fmt.Errorf("%w: unggahan laporan kemajuan belum diaktifkan untuk periode ini", invalidProposal)
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO progress_report_uploads (proposal_id,content) VALUES (?,?)
 ON DUPLICATE KEY UPDATE content=VALUES(content),uploaded_at=UTC_TIMESTAMP(6)`, id, content)
		return id, err
	})
}

func (s service) downloadProgressReport(c *gin.Context, a actor) {
	ctx := c.Request.Context()
	verify, decide := s.canManageFunding(ctx, a)
	var content []byte
	err := s.db.QueryRowContext(ctx, `SELECT f.content FROM progress_report_uploads f
 JOIN research_proposals p ON p.id=f.proposal_id
 WHERE p.institution_id=? AND p.id=? AND p.status='submitted' AND (p.owner_user_id=? OR ?)`, a.tenant, target(c), a.ID, verify || decide).Scan(&content)
	if err == sql.ErrNoRows {
		c.Status(404)
		return
	}
	if err != nil {
		c.Status(503)
		return
	}
	c.Header("Content-Disposition", "attachment; filename=laporan-kemajuan.pdf")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Data(200, "application/pdf", content)
}

func (s service) reportScope(c *gin.Context, a actor) (bool, string, []any) {
	ctx := c.Request.Context()
	var role string
	institutionWide := a.system() || s.roleForPermission(ctx, a, researchVerify, &role) == nil ||
		s.roleForPermission(ctx, a, researchDecide, &role) == nil || s.roleForPermission(ctx, a, auditRead, &role) == nil
	where := "p.institution_id=? AND p.status='submitted'"
	args := []any{a.tenant}
	if !institutionWide {
		where += " AND p.owner_user_id=?"
		args = append(args, a.ID)
	}
	return institutionWide, where, args
}

func (s service) reportSummary(c *gin.Context, a actor) {
	ctx := c.Request.Context()
	institutionWide, baseWhere, baseArgs := s.reportScope(c, a)
	year, _ := strconv.ParseInt(c.Query("year"), 10, 64)
	where := baseWhere
	args := append([]any(nil), baseArgs...)
	if year > 0 {
		where += " AND g.fiscal_year=?"
		args = append(args, year)
	}
	var submitted, disbursed, completed int
	var proposedBudget string
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*),
 COUNT(CASE WHEN EXISTS (SELECT 1 FROM project_disbursements d
 WHERE d.institution_id=p.institution_id AND d.project_id=pr.id AND d.status='transferred') THEN 1 END),
 COUNT(CASE WHEN pr.status='completed' THEN 1 END),
 CAST(COALESCE(SUM(p.budget_idr),0) AS CHAR)
 FROM research_proposals p
 JOIN grant_scheme_versions v ON v.institution_id=p.institution_id AND v.id=p.grant_version_id
 JOIN grant_periods g ON g.institution_id=v.institution_id AND g.id=v.period_id
 LEFT JOIN research_projects pr ON pr.institution_id=p.institution_id AND pr.proposal_id=p.id
 WHERE `+where, args...).Scan(&submitted, &disbursed, &completed, &proposedBudget)
	if err != nil {
		c.Status(503)
		return
	}
	years := []int{}
	yrRows, yrErr := s.db.QueryContext(ctx, `SELECT DISTINCT g.fiscal_year
 FROM research_proposals p
 JOIN grant_scheme_versions v ON v.institution_id=p.institution_id AND v.id=p.grant_version_id
 JOIN grant_periods g ON g.institution_id=v.institution_id AND g.id=v.period_id
 WHERE `+baseWhere+` ORDER BY g.fiscal_year DESC`, baseArgs...)
	if yrErr == nil {
		defer yrRows.Close()
		for yrRows.Next() {
			var y int
			if yrRows.Scan(&y) == nil {
				years = append(years, y)
			}
		}
	}
	c.JSON(200, gin.H{"submitted": submitted, "disbursed": disbursed, "completed": completed, "institutionWide": institutionWide, "proposedBudget": proposedBudget, "years": years})
}

func (s service) reportSubmissions(c *gin.Context, a actor) {
	const pageSize = 25
	page, err := strconv.ParseInt(c.DefaultQuery("page", "1"), 10, 32)
	if err != nil || page < 1 {
		c.Status(400)
		return
	}
	year, _ := strconv.ParseInt(c.Query("year"), 10, 64)
	_, where, args := s.reportScope(c, a)
	if year > 0 {
		where += " AND g.fiscal_year=?"
		args = append(args, year)
	}
	rows, err := s.db.QueryContext(c.Request.Context(), `SELECT p.id, COALESCE(NULLIF(l.name,''),u.display_name),
 p.title, v.scheme_name, g.fiscal_year, p.workflow_status, p.funding_decision,
 COALESCE(DATE_FORMAT(p.submitted_at, '%Y-%m-%d'), ''), CAST(p.budget_idr AS CHAR)
 FROM research_proposals p JOIN users u ON u.id=p.owner_user_id
 JOIN grant_scheme_versions v ON v.institution_id=p.institution_id AND v.id=p.grant_version_id
 JOIN grant_periods g ON g.institution_id=v.institution_id AND g.id=v.period_id
 LEFT JOIN lecturers l ON l.institution_id=p.institution_id AND l.user_id=p.owner_user_id
 WHERE `+where+` ORDER BY p.submitted_at DESC,p.id DESC LIMIT ? OFFSET ?`,
		append(args, pageSize+1, (page-1)*pageSize)...)
	if err != nil {
		c.Status(503)
		return
	}
	defer rows.Close()
	type submission struct {
		ID              int64  `json:"id"`
		Lecturer        string `json:"lecturer"`
		Title           string `json:"title"`
		Scheme          string `json:"scheme"`
		Year            int    `json:"year"`
		WorkflowStatus  string `json:"workflowStatus"`
		FundingDecision string `json:"fundingDecision"`
		SubmittedAt     string `json:"submittedAt"`
		Budget          string `json:"budget"`
	}
	items := []submission{}
	for rows.Next() {
		var item submission
		if err := rows.Scan(&item.ID, &item.Lecturer, &item.Title, &item.Scheme, &item.Year, &item.WorkflowStatus, &item.FundingDecision, &item.SubmittedAt, &item.Budget); err != nil {
			c.Status(503)
			return
		}
		items = append(items, item)
	}
	if rows.Err() != nil {
		c.Status(503)
		return
	}
	hasNext := len(items) > pageSize
	if hasNext {
		items = items[:pageSize]
	}
	c.JSON(200, gin.H{"items": items, "hasNext": hasNext, "start": (page-1)*pageSize + 1})
}

func (s service) listReports(c *gin.Context, a actor) {
	ctx := c.Request.Context()
	rows, err := s.db.QueryContext(ctx, `SELECT p.id,p.title,
 COALESCE(r.kind,''),COALESCE(r.revision,0),COALESCE(JSON_REMOVE(r.payload,'$.outputProgress'),'{}'),
 COALESCE(JSON_EXTRACT(r.payload,'$.outputProgress'),'[]'),COALESCE(JSON_EXTRACT(p.payload,'$.outputs'),'[]'),
 JSON_OBJECT('introduction',COALESCE(JSON_UNQUOTE(JSON_EXTRACT(p.payload,'$.introduction')),''),
 'literature',COALESCE(JSON_UNQUOTE(JSON_EXTRACT(p.payload,'$.literature')),''),
 'method',COALESCE(JSON_UNQUOTE(JSON_EXTRACT(p.payload,'$.method')),''),
 'references',COALESCE(JSON_UNQUOTE(JSON_EXTRACT(p.payload,'$.references')),'')),
 g.allow_progress_report, g.allow_final_report,
 EXISTS (SELECT 1 FROM progress_report_uploads f WHERE f.proposal_id=p.id),
 COALESCE(NULLIF(l.name,''),u.display_name),
 COALESCE(NULLIF(l.nuptk,''),COALESCE(l.code,'')),
 COALESCE(sp.name,''),
 COALESCE(f.name,''),
 COALESCE(l.phone,''),
 COALESCE(NULLIF(l.email,''),u.email),
 COALESCE(sp.id,0),
 COALESCE(f.id,0),
 v.scheme_name,g.project_year,g.proposal_year,
 CAST(p.budget_idr AS CHAR),COALESCE(JSON_EXTRACT(p.payload,'$.costs'),'[]'),
 COALESCE((SELECT JSON_ARRAYAGG(t.name ORDER BY t.id) FROM lecturers t
 WHERE t.institution_id=p.institution_id AND JSON_CONTAINS(JSON_EXTRACT(p.payload,'$.team'),JSON_OBJECT('id',t.id))), '[]'),
 COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('id',t.id,'name',t.name,'code',COALESCE(t.code,''),'nuptk',COALESCE(NULLIF(t.nuptk,''),COALESCE(t.code,'')),'studyProgram',COALESCE(tsp.name,'-'),'phone',COALESCE(t.phone,''),'email',COALESCE(t.email,'')) ORDER BY t.id)
 FROM lecturers t LEFT JOIN study_programs tsp ON tsp.institution_id=t.institution_id AND tsp.id=t.parent_id
 WHERE t.institution_id=p.institution_id AND JSON_CONTAINS(JSON_EXTRACT(p.payload,'$.team'),JSON_OBJECT('id',t.id))), '[]'),
 EXISTS (SELECT 1 FROM research_proposal_images i WHERE i.proposal_id=p.id AND i.kind='method'),
 EXISTS (SELECT 1 FROM research_proposal_images i WHERE i.proposal_id=p.id AND i.kind='poster')
 FROM research_proposals p
 JOIN users u ON u.id=p.owner_user_id
 LEFT JOIN lecturers l ON l.institution_id=p.institution_id AND (l.user_id=p.owner_user_id OR (l.user_id IS NULL AND l.email=u.email))
 LEFT JOIN study_programs sp ON sp.institution_id=l.institution_id AND sp.id=l.parent_id
 LEFT JOIN faculties f ON f.institution_id=sp.institution_id AND f.id=sp.parent_id
 JOIN grant_scheme_versions v ON v.institution_id=p.institution_id AND v.id=p.grant_version_id
 JOIN grant_periods g ON g.institution_id=v.institution_id AND g.id=v.period_id
 LEFT JOIN research_reports r ON r.institution_id=p.institution_id AND r.proposal_id=p.id AND r.is_active
 WHERE p.institution_id=? AND p.owner_user_id=? AND p.status='submitted' ORDER BY p.submitted_at DESC,p.id DESC,r.kind`, a.tenant, a.ID)
	if err != nil {
		c.Status(503)
		return
	}
	defer rows.Close()
	type reportRow struct {
		ProposalID          int64             `json:"proposalId"`
		Title               string            `json:"title"`
		Kind                string            `json:"kind"`
		Revision            int               `json:"revision"`
		Data                json.RawMessage   `json:"data"`
		Source              json.RawMessage   `json:"source"`
		OutputTargets       []outputInput     `json:"outputTargets"`
		OutputProgress      []outputProgress  `json:"outputProgress"`
		AllowProgressReport bool              `json:"allowProgressReport"`
		AllowFinalReport    bool              `json:"allowFinalReport"`
		ProgressUploaded    bool              `json:"progressUploaded"`
		Owner               string            `json:"owner"`
		OwnerNuptk          string            `json:"ownerNuptk"`
		OwnerStudyProgram   string            `json:"ownerStudyProgram"`
		OwnerFaculty        string            `json:"ownerFaculty"`
		OwnerPhone          string            `json:"ownerPhone"`
		OwnerEmail          string            `json:"ownerEmail"`
		Officials           proposalOfficials `json:"officials"`
		Scheme              string            `json:"scheme"`
		Year                int               `json:"year"`
		ProposalYear        int               `json:"proposalYear"`
		Budget              string            `json:"budget"`
		Costs               json.RawMessage   `json:"costs"`
		Team                []string          `json:"team"`
		TeamDetails         []lecturerDetail  `json:"teamDetails"`
		MethodDiagram       bool              `json:"methodDiagram"`
		Poster              bool              `json:"poster"`
	}
	items := []reportRow{}
	for rows.Next() {
		var item reportRow
		var data, source, progress, targets, team, teamDetails, costs []byte
		var ownerSPID, ownerFacID int64
		if err := rows.Scan(&item.ProposalID, &item.Title, &item.Kind, &item.Revision, &data, &progress, &targets, &source,
			&item.AllowProgressReport, &item.AllowFinalReport, &item.ProgressUploaded,
			&item.Owner, &item.OwnerNuptk, &item.OwnerStudyProgram, &item.OwnerFaculty, &item.OwnerPhone, &item.OwnerEmail,
			&ownerSPID, &ownerFacID, &item.Scheme, &item.Year, &item.ProposalYear,
			&item.Budget, &costs, &team, &teamDetails, &item.MethodDiagram, &item.Poster); err != nil {
			c.Status(503)
			return
		}
		if json.Unmarshal(targets, &item.OutputTargets) != nil || json.Unmarshal(progress, &item.OutputProgress) != nil || json.Unmarshal(team, &item.Team) != nil || json.Unmarshal(teamDetails, &item.TeamDetails) != nil {
			c.Status(503)
			return
		}
		item.Officials = loadProposalOfficials(ctx, s.db, a.tenant, ownerSPID, ownerFacID)
		item.Data, item.Source, item.Costs = json.RawMessage(data), json.RawMessage(source), json.RawMessage(costs)
		items = append(items, item)
	}
	if rows.Err() != nil {
		c.Status(503)
		return
	}
	c.JSON(200, items)
}

func (s service) changeReport(c *gin.Context, a actor) {
	var input struct {
		Revision       int
		Data           map[string]string
		OutputProgress []outputProgress
	}
	proposalID, kind := target(c), c.Param("kind")
	fields, valid := reportFields[kind]
	removing := c.Request.Method == "DELETE"
	if !valid || proposalID < 1 || c.ShouldBindJSON(&input) != nil || input.Revision < 0 || (removing && input.Revision == 0) {
		c.Status(400)
		return
	}
	payload := map[string]any{}
	for _, key := range fields {
		value := strings.TrimSpace(input.Data[key])
		if utf8.RuneCountInString(value) > 16000 || (key == "introduction" && len(strings.Fields(value)) > 1000) {
			c.JSON(400, gin.H{"message": "Pendahuluan maksimal 1.000 kata dan setiap bagian maksimal 16.000 karakter."})
			return
		}
		payload[key] = value
	}
	action := "reports.draft.save"
	if removing {
		action = "reports.draft.archive"
	}
	s.change(c, a, action, func(ctx context.Context, tx *sql.Tx) (int64, error) {
		var parent int64
		var allowProgress, allowFinal bool
		var targetsJSON []byte
		err := tx.QueryRowContext(ctx, `SELECT p.id, g.allow_progress_report, g.allow_final_report, COALESCE(JSON_EXTRACT(p.payload,'$.outputs'),'[]')
 FROM research_proposals p
 JOIN grant_scheme_versions v ON v.institution_id=p.institution_id AND v.id=p.grant_version_id
 JOIN grant_periods g ON g.institution_id=v.institution_id AND g.id=v.period_id
 WHERE p.institution_id=? AND p.owner_user_id=? AND p.id=? AND p.status='submitted' FOR UPDATE`, a.tenant, a.ID, proposalID).Scan(&parent, &allowProgress, &allowFinal, &targetsJSON)
		if err != nil {
			return 0, err
		}
		if kind == "progress" && !allowProgress {
			return 0, fmt.Errorf("%w: laporan kemajuan belum diaktifkan oleh Admin LPPM/Superadmin untuk periode ini", invalidProposal)
		}
		if kind == "final" && !allowFinal {
			return 0, fmt.Errorf("%w: laporan akhir belum diaktifkan oleh Admin LPPM/Superadmin untuk periode ini", invalidProposal)
		}
		if kind == "progress" && !removing {
			var targets []outputInput
			if err := json.Unmarshal(targetsJSON, &targets); err != nil {
				return 0, err
			}
			if len(input.OutputProgress) > len(targets) {
				return 0, fmt.Errorf("%w: jumlah isian kemajuan melebihi target luaran usulan", invalidProposal)
			}
			for i, item := range input.OutputProgress {
				if item.Status != "" && item.Status != "not_started" && item.Status != "in_progress" && item.Status != "achieved" {
					return 0, fmt.Errorf("%w: status luaran %d tidak tersedia", invalidProposal, i+1)
				}
				if utf8.RuneCountInString(item.Result) > 2000 || utf8.RuneCountInString(item.FollowUp) > 2000 || len(item.Evidence) > 2048 {
					return 0, fmt.Errorf("%w: isian luaran %d terlalu panjang", invalidProposal, i+1)
				}
				if item.Evidence != "" {
					link, err := url.Parse(item.Evidence)
					if err != nil || link.Hostname() == "" || link.User != nil || (link.Scheme != "http" && link.Scheme != "https") {
						return 0, fmt.Errorf("%w: tautan bukti luaran %d harus menggunakan HTTP atau HTTPS", invalidProposal, i+1)
					}
				}
			}
			payload["outputProgress"] = input.OutputProgress
		}
		raw, err := json.Marshal(payload)
		if err != nil {
			return 0, err
		}
		var id int64
		var revision int
		var active bool
		err = tx.QueryRowContext(ctx, "SELECT id,revision,is_active FROM research_reports WHERE institution_id=? AND proposal_id=? AND kind=?", a.tenant, parent, kind).Scan(&id, &revision, &active)
		if err == sql.ErrNoRows && input.Revision == 0 {
			result, err := tx.ExecContext(ctx, "INSERT INTO research_reports (institution_id,proposal_id,kind,payload) VALUES (?,?,?,?)", a.tenant, parent, kind, string(raw))
			if err != nil {
				return 0, err
			}
			return result.LastInsertId()
		}
		if err != nil {
			return 0, err
		}
		if (active && revision != input.Revision) || (!active && input.Revision != 0) {
			return 0, staleProposal
		}
		if removing {
			_, err = tx.ExecContext(ctx, "UPDATE research_reports SET is_active=FALSE,revision=revision+1 WHERE id=?", id)
		} else {
			_, err = tx.ExecContext(ctx, "UPDATE research_reports SET payload=?,is_active=TRUE,revision=revision+1 WHERE id=?", string(raw), id)
		}
		return id, err
	})
}
