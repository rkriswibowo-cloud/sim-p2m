package iam

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const researchApply = "research.apply"
const researchVerify = "research.verify"

var staleProposal = errors.New("proposal revision changed")
var invalidProposal = errors.New("proposal validation")
var unavailableGrant = errors.New("grant version unavailable")
var quotaFull = errors.New("scheme quota reached")
var eligibilityBlocked = errors.New("grant eligibility not met")

type proposal struct {
	ID                   int64           `json:"id"`
	GrantVersionID       int64           `json:"grantVersionId"`
	PeriodID             int64           `json:"periodId"`
	SchemeID             int64           `json:"schemeId"`
	GrantVersion         int             `json:"grantVersion"`
	RequiresVerification bool            `json:"requiresVerification"`
	FieldID              *int64          `json:"fieldId"`
	Title                string          `json:"title"`
	Status               string          `json:"status"`
	Revision             int             `json:"revision"`
	Budget               string          `json:"budget"`
	Scheme               string          `json:"scheme"`
	Period               string          `json:"period"`
	Owner                string          `json:"owner"`
	UpdatedAt            time.Time       `json:"updatedAt"`
	Data                 proposalData    `json:"data"`
	RoadmapImage         bool            `json:"roadmapImage"`
	MethodImage          bool            `json:"methodImage"`
	StudentLetterFile    bool            `json:"studentLetterFile"`
	Verification         string          `json:"verification"`
	WorkflowStatus       string          `json:"workflowStatus"`
	FundingDecision      string          `json:"fundingDecision"`
	ApprovedBudget       *string         `json:"approvedBudget"`
	DecisionNote         string          `json:"decisionNote"`
	Consents             []memberConsent `json:"consents"`
	Approvals            []approvalEntry `json:"approvals,omitempty"`
	PublicReviews        []reviewRow     `json:"publicReviews,omitempty"`
}

const proposalSelectFields = `SELECT p.id,p.grant_version_id,v.period_id,v.scheme_id,v.version_no,(v.active_lecturer OR v.manual_requirements<>''),p.research_field_id,p.title,p.status,p.revision,
 CAST(p.budget_idr AS CHAR),v.scheme_name,g.name,u.display_name,p.updated_at,p.workflow_status,p.funding_decision,CAST(p.approved_budget_idr AS CHAR),p.decision_note,`
const proposalSelectJoins = `,
 EXISTS(SELECT 1 FROM research_proposal_images i WHERE i.proposal_id=p.id AND i.kind='roadmap'),
 EXISTS(SELECT 1 FROM research_proposal_images i WHERE i.proposal_id=p.id AND i.kind='method'),
 EXISTS(SELECT 1 FROM research_proposal_images i WHERE i.proposal_id=p.id AND i.kind='student_letter'),
 CASE WHEN p.verified_revision=p.revision THEN 'verified' WHEN p.verification_requested THEN 'requested' ELSE 'none' END
 FROM research_proposals p JOIN grant_scheme_versions v ON v.institution_id=p.institution_id AND v.id=p.grant_version_id
 JOIN grant_periods g ON g.institution_id=v.institution_id AND g.id=v.period_id
 JOIN users u ON u.id=p.owner_user_id`
const proposalSelect = proposalSelectFields + "p.payload" + proposalSelectJoins

type rowScanner interface{ Scan(...any) error }

func readProposal(row rowScanner) (proposal, error) {
	var item proposal
	var payload []byte
	var approved sql.NullString
	err := row.Scan(&item.ID, &item.GrantVersionID, &item.PeriodID, &item.SchemeID, &item.GrantVersion, &item.RequiresVerification, &item.FieldID, &item.Title, &item.Status, &item.Revision, &item.Budget, &item.Scheme, &item.Period, &item.Owner, &item.UpdatedAt, &item.WorkflowStatus, &item.FundingDecision, &approved, &item.DecisionNote, &payload, &item.RoadmapImage, &item.MethodImage, &item.StudentLetterFile, &item.Verification)
	if err != nil {
		return item, err
	}
	if approved.Valid {
		val := approved.String
		item.ApprovedBudget = &val
	}
	return item, json.Unmarshal(payload, &item.Data)
}

func (s service) researchOptions(c *gin.Context, a actor) {
	ctx := c.Request.Context()
	periods, err := s.grantPeriods(ctx, a.tenant, false, "research")
	if err != nil {
		c.Status(503)
		return
	}
	versions, err := s.grantVersions(ctx, a.tenant, false, "research")
	if err != nil {
		c.Status(503)
		return
	}
	fields, err := s.grantChoices(ctx, a.tenant, "SELECT id,name FROM research_fields WHERE institution_id=? AND is_active ORDER BY name")
	if err != nil {
		c.Status(503)
		return
	}
	lecturers, err := s.grantChoices(ctx, a.tenant, "SELECT id,CONCAT(name,' · ',code) FROM lecturers WHERE institution_id=? AND is_active ORDER BY name")
	if err != nil {
		c.Status(503)
		return
	}
	students, err := s.grantChoices(ctx, a.tenant, "SELECT id,CONCAT(name,' · ',code) FROM students WHERE institution_id=? AND is_active ORDER BY name")
	if err != nil {
		c.Status(503)
		return
	}
	var role string
	canVerify := a.system() || (a.mode == "production" && s.roleForPermission(ctx, a, researchVerify, &role) == nil)
	budgetCategories, err := s.grantChoices(ctx, a.tenant, "SELECT id,name FROM budget_categories WHERE institution_id=? AND is_active ORDER BY name")
	if err != nil {
		c.Status(503)
		return
	}
	targetYears, err := s.grantChoices(ctx, a.tenant, "SELECT id,code FROM output_target_years WHERE institution_id=? AND is_active ORDER BY code")
	if err != nil {
		c.Status(503)
		return
	}
	c.JSON(200, gin.H{"periods": periods, "versions": versions, "fields": fields, "lecturers": lecturers, "students": students, "budgetCategories": budgetCategories, "targetYears": targetYears, "canVerify": canVerify})
}

func (s service) listProposals(c *gin.Context, a actor) {
	rows, err := s.db.QueryContext(c.Request.Context(), proposalSelectFields+"'{}'"+proposalSelectJoins+" WHERE p.institution_id=? AND p.owner_user_id=? AND p.status<>'archived' ORDER BY p.updated_at DESC,p.id DESC LIMIT 100", a.tenant, a.ID)
	if err != nil {
		c.Status(503)
		return
	}
	defer rows.Close()
	items := []proposal{}
	for rows.Next() {
		item, err := readProposal(rows)
		if err != nil {
			c.Status(503)
			return
		}
		items = append(items, item)
	}
	if rows.Err() != nil {
		c.Status(503)
		return
	}
	c.JSON(200, items)
}

func (s service) getProposal(c *gin.Context, a actor) {
	item, err := readProposal(s.db.QueryRowContext(c.Request.Context(), proposalSelect+" WHERE p.institution_id=? AND p.owner_user_id=? AND p.id=? AND p.status<>'archived'", a.tenant, a.ID, target(c)))
	if errors.Is(err, sql.ErrNoRows) {
		c.Status(404)
		return
	}
	if err != nil {
		c.Status(503)
		return
	}
	consents, err := loadProposalConsents(c.Request.Context(), s.db, a.tenant, item.ID)
	if err != nil {
		c.Status(503)
		return
	}
	item.Consents = consents
	if apps, err := loadApprovalsForProposal(c.Request.Context(), s.db, a.tenant, item.ID); err == nil {
		item.Approvals = apps
	}
	if revs, err := loadPublicReviewsForProposal(c.Request.Context(), s.db, a.tenant, item.ID); err == nil {
		item.PublicReviews = revs
	}
	c.JSON(200, item)
}

type selectedGrant struct {
	period, scheme  int64
	budget          uint64
	quota, duration int
	required        bool
	requireNuptk    bool
	minJafung       string
	manual          string
	open, current   bool
}

func lockGrant(ctx context.Context, tx *sql.Tx, tenant, period, version int64) (selectedGrant, error) {
	var g selectedGrant
	// Acquire the same period lock as publisher and other submissions.
	err := tx.QueryRowContext(ctx, "SELECT id FROM grant_periods WHERE institution_id=? AND id=? FOR UPDATE", tenant, period).Scan(&g.period)
	if err != nil {
		return g, err
	}
	err = tx.QueryRowContext(ctx, `SELECT v.scheme_id,v.budget_idr,v.quota,v.duration_months,v.active_lecturer,v.require_nuptk,v.min_jafung,v.manual_requirements,
 p.opens_at<=UTC_TIMESTAMP() AND p.closes_at>UTC_TIMESTAMP(),
 v.version_no=(SELECT MAX(x.version_no) FROM grant_scheme_versions x WHERE x.institution_id=v.institution_id AND x.period_id=v.period_id AND x.scheme_id=v.scheme_id)
 FROM grant_scheme_versions v JOIN grant_periods p ON p.id=v.period_id AND p.institution_id=v.institution_id
 WHERE v.institution_id=? AND v.id=? AND p.program='research'`, tenant, version).Scan(&g.scheme, &g.budget, &g.quota, &g.duration, &g.required, &g.requireNuptk, &g.minJafung, &g.manual, &g.open, &g.current)
	return g, err
}

func (s service) createProposal(c *gin.Context, a actor) {
	var input struct{ GrantVersionID int64 }
	if c.ShouldBindJSON(&input) != nil || input.GrantVersionID < 1 {
		c.Status(400)
		return
	}
	var period int64
	err := s.db.QueryRowContext(c.Request.Context(), "SELECT period_id FROM grant_scheme_versions WHERE institution_id=? AND id=?", a.tenant, input.GrantVersionID).Scan(&period)
	if errors.Is(err, sql.ErrNoRows) {
		c.Status(404)
		return
	}
	if err != nil {
		c.Status(503)
		return
	}
	s.change(c, a, "research.draft.create", func(ctx context.Context, tx *sql.Tx) (int64, error) {
		grant, err := lockGrant(ctx, tx, a.tenant, period, input.GrantVersionID)
		if err != nil {
			return 0, err
		}
		if !grant.open || !grant.current {
			return 0, unavailableGrant
		}
		leaderCount, err := countLeaderProposalsInPeriod(ctx, tx, a.tenant, a.ID, period, 0)
		if err != nil {
			return 0, err
		}
		if leaderCount > 0 {
			return 0, fmt.Errorf("%w: setiap dosen hanya dapat mengajukan maksimal 1 usulan sebagai Ketua dalam 1 periode hibah", invalidProposal)
		}
		result, err := tx.ExecContext(ctx, `INSERT INTO research_proposals (institution_id,owner_user_id,grant_version_id,payload)
   VALUES (?,?,?,'{}')`, a.tenant, a.ID, input.GrantVersionID)
		if err != nil {
			return 0, err
		}
		return result.LastInsertId()
	})
}

func (s service) saveProposal(c *gin.Context, a actor) {
	id := target(c)
	var input struct {
		Title    string
		FieldID  *int64
		Revision int
		Data     proposalData
	}
	if id < 1 || c.ShouldBindJSON(&input) != nil || input.Revision < 1 || len(strings.TrimSpace(input.Title)) > 300 {
		c.Status(400)
		return
	}
	budget, err := input.Data.budget()
	if err != nil {
		c.JSON(400, gin.H{"error": "validation", "message": err.Error()})
		return
	}
	s.change(c, a, "research.draft.save", func(ctx context.Context, tx *sql.Tx) (int64, error) {
		versionID, err := lockDraft(ctx, tx, a, id, input.Revision)
		if err != nil {
			return 0, err
		}
		var periodID int64
		if err := tx.QueryRowContext(ctx, "SELECT period_id FROM grant_scheme_versions WHERE institution_id=? AND id=?", a.tenant, versionID).Scan(&periodID); err != nil {
			return 0, err
		}
		if input.FieldID != nil {
			var found int64
			if err := tx.QueryRowContext(ctx, "SELECT id FROM research_fields WHERE institution_id=? AND id=?", a.tenant, *input.FieldID).Scan(&found); err != nil {
				if errors.Is(err, sql.ErrNoRows) {
					return 0, fmt.Errorf("%w: bidang riset tidak tersedia", invalidProposal)
				}
				return 0, err
			}
		}
		if err := validateTeamRefs(ctx, tx, a.tenant, input.Data); err != nil {
			return 0, err
		}
		if err := validateTeamPeriodQuota(ctx, tx, a.tenant, periodID, id, input.Data.Team); err != nil {
			return 0, err
		}
		if err := resolveBudgetCategories(ctx, tx, a.tenant, &input.Data, false); err != nil {
			return 0, err
		}
		input.Data.sanitizeNarratives()
		raw, err := json.Marshal(input.Data)
		if err != nil {
			return 0, err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE research_proposals SET title=?,research_field_id=?,payload=?,budget_idr=?,revision=revision+1,verification_requested=FALSE WHERE id=?`,
			strings.TrimSpace(input.Title), input.FieldID, string(raw), budget, id); err != nil {
			return 0, err
		}
		if err := syncProposalConsents(ctx, tx, a.tenant, id, input.Data.Team); err != nil {
			return 0, err
		}
		return id, nil
	})
}

func lockDraft(ctx context.Context, tx *sql.Tx, a actor, id int64, revision int) (int64, error) {
	var version int64
	var found int
	var status, wf string
	err := tx.QueryRowContext(ctx, `SELECT grant_version_id,revision,status,workflow_status FROM research_proposals
 WHERE institution_id=? AND owner_user_id=? AND id=? FOR UPDATE`, a.tenant, a.ID, id).Scan(&version, &found, &status, &wf)
	if err != nil {
		return 0, err
	}
	editable := status == "draft" || (status == "submitted" && (wf == "admin_revision" || wf == "review_revision"))
	if found != revision || !editable {
		return 0, staleProposal
	}
	return version, nil
}

func (s service) submitProposal(c *gin.Context, a actor) {
	id := target(c)
	var input struct {
		Revision  int
		Confirmed bool
	}
	if id < 1 || c.ShouldBindJSON(&input) != nil || input.Revision < 1 || !input.Confirmed {
		c.Status(400)
		return
	}
	var period, version int64
	err := s.db.QueryRowContext(c.Request.Context(), `SELECT v.period_id,v.id FROM research_proposals p JOIN grant_scheme_versions v ON v.id=p.grant_version_id
 WHERE p.institution_id=? AND p.owner_user_id=? AND p.id=?`, a.tenant, a.ID, id).Scan(&period, &version)
	if errors.Is(err, sql.ErrNoRows) {
		c.Status(404)
		return
	}
	if err != nil {
		c.Status(503)
		return
	}
	s.change(c, a, "research.proposal.submit", func(ctx context.Context, tx *sql.Tx) (int64, error) {
		grant, err := lockGrant(ctx, tx, a.tenant, period, version)
		if err != nil {
			return 0, err
		}
		if _, err := lockDraft(ctx, tx, a, id, input.Revision); err != nil {
			return 0, err
		}
		if !grant.open || !grant.current {
			return 0, unavailableGrant
		}
		var matches, active, withNUPTK int
		var lecturerJafung string
		if grant.required || grant.requireNuptk || grant.minJafung != "" {
			if err := tx.QueryRowContext(ctx, `SELECT COUNT(*),COALESCE(SUM(is_active),0),
 COALESCE(SUM(is_active AND TRIM(nuptk)<>'' AND TRIM(nuptk)<>'-'),0),
 COALESCE(MAX(CASE WHEN is_active THEN jafung ELSE '' END),'')
 FROM lecturers WHERE institution_id=? AND (user_id=? OR (user_id IS NULL AND email=?))`, a.tenant, a.ID, a.Email).Scan(&matches, &active, &withNUPTK, &lecturerJafung); err != nil {
				return 0, err
			}
		}
		overdue, err := countOverdueReports(ctx, tx, a.tenant, a.ID, grant.period)
		if err != nil {
			return 0, err
		}
		leaderCount, err := countLeaderProposalsInPeriod(ctx, tx, a.tenant, a.ID, grant.period, id)
		if err != nil {
			return 0, err
		}
		item, err := readProposal(tx.QueryRowContext(ctx, proposalSelect+" WHERE p.id=?", id))
		if err != nil {
			return 0, err
		}
		eligibility, reasons := assessEligibility(grant.open, grant.current, grant.required, grant.requireNuptk, grant.minJafung, grant.manual, matches, active, withNUPTK, lecturerJafung, overdue, leaderCount)
		if eligibility == "ineligible" {
			return 0, fmt.Errorf("%w: %s", eligibilityBlocked, strings.Join(reasons, " "))
		}
		if err := validateTeamPeriodQuota(ctx, tx, a.tenant, grant.period, id, item.Data.Team); err != nil {
			return 0, err
		}
		if err := resolveBudgetCategories(ctx, tx, a.tenant, &item.Data, true); err != nil {
			return 0, err
		}
		if err := checkProposalConsentsApproved(ctx, tx, a.tenant, id); err != nil {
			return 0, err
		}
		if len(item.Data.Students) > 0 && !item.StudentLetterFile {
			return 0, fmt.Errorf("%w: penelitian yang melibatkan mahasiswa harus menyertakan unggahan Surat Keterlibatan Mahasiswa (PDF/JPG/PNG)", invalidProposal)
		}
		if err := item.Data.validateSubmission(item.Title, item.FieldID, grant); err != nil {
			return 0, fmt.Errorf("%w: %s", invalidProposal, err)
		}
		if err := validateTeamRefs(ctx, tx, a.tenant, item.Data); err != nil {
			return 0, err
		}
		var field int64
		if err := tx.QueryRowContext(ctx, "SELECT id FROM research_fields WHERE institution_id=? AND id=? AND is_active", a.tenant, *item.FieldID).Scan(&field); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return 0, fmt.Errorf("%w: bidang riset sudah nonaktif", invalidProposal)
			}
			return 0, err
		}
		var count int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM research_proposals p JOIN grant_scheme_versions v ON v.id=p.grant_version_id
   WHERE p.institution_id=? AND v.period_id=? AND v.scheme_id=? AND p.status='submitted'`, a.tenant, grant.period, grant.scheme).Scan(&count); err != nil {
			return 0, err
		}
		if count >= grant.quota {
			return 0, quotaFull
		}
		raw, err := json.Marshal(item.Data)
		if err != nil {
			return 0, err
		}
		if _, err := tx.ExecContext(ctx, "UPDATE research_proposals SET status='submitted',workflow_status='submitted',payload=?,submitted_at=UTC_TIMESTAMP(6),revision=revision+1 WHERE id=?", string(raw), id); err != nil {
			return 0, err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO proposal_approvals (institution_id, proposal_id, from_status, to_status, actor_user_id, role_name, note, revision)
 VALUES (?,?,?,?,?,?,?,?)`, a.tenant, id, "draft", "submitted", a.ID, a.role, "Usulan dikirim oleh peneliti", item.Revision+1); err != nil {
			return 0, err
		}
		return id, nil
	})
}

func (s service) archiveProposal(c *gin.Context, a actor) {
	id := target(c)
	var input struct{ Revision int }
	if id < 1 || c.ShouldBindJSON(&input) != nil || input.Revision < 1 {
		c.Status(http.StatusBadRequest)
		return
	}
	s.change(c, a, "research.draft.archive", func(ctx context.Context, tx *sql.Tx) (int64, error) {
		if _, err := lockDraft(ctx, tx, a, id, input.Revision); err != nil {
			return 0, err
		}
		_, err := tx.ExecContext(ctx, "UPDATE research_proposals SET status='archived',revision=revision+1 WHERE id=?", id)
		return id, err
	})
}

func validateTeamPeriodQuota(ctx context.Context, tx *sql.Tx, tenant, periodID, proposalID int64, team []memberInput) error {
	for _, m := range team {
		if m.ID < 1 {
			continue
		}
		count, err := countMemberProposalsInPeriod(ctx, tx, tenant, m.ID, periodID, proposalID)
		if err != nil {
			return err
		}
		if count > 0 {
			var name string
			_ = tx.QueryRowContext(ctx, "SELECT name FROM lecturers WHERE institution_id=? AND id=?", tenant, m.ID).Scan(&name)
			if name == "" {
				name = fmt.Sprintf("Dosen #%d", m.ID)
			}
			return fmt.Errorf("%w: %s sudah terdaftar sebagai Anggota pada usulan lain di periode ini (maksimal 1 usulan sebagai Anggota per periode)", invalidProposal, name)
		}
	}
	return nil
}
