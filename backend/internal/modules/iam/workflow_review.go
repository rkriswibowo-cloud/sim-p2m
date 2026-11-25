package iam

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const (
	researchReview = "research.review"
	researchDecide = "research.decide"
)

type approvalEntry struct {
	ID         int64     `json:"id"`
	FromStatus string    `json:"fromStatus"`
	ToStatus   string    `json:"toStatus"`
	ActorName  string    `json:"actorName"`
	RoleName   string    `json:"roleName"`
	Note       string    `json:"note"`
	Revision   int       `json:"revision"`
	CreatedAt  time.Time `json:"createdAt"`
}

type reviewerAssignmentView struct {
	ID           int64      `json:"id"`
	ProposalID   int64      `json:"proposalId"`
	ReviewerID   int64      `json:"reviewerId"`
	ReviewerName string     `json:"reviewerName"`
	ReviewerCode string     `json:"reviewerCode"`
	BlindReview  bool       `json:"blindReview"`
	DueDate      string     `json:"dueDate"`
	Status       string     `json:"status"`
	ConflictNote string     `json:"conflictNote"`
	Review       *reviewRow `json:"review"`
}

type reviewRow struct {
	ID              int64     `json:"id"`
	AssignmentID    int64     `json:"assignmentId"`
	ReviewerName    string    `json:"reviewerName,omitempty"`
	ScoreRelevance  float64   `json:"scoreRelevance"`
	ScoreMethod     float64   `json:"scoreMethod"`
	ScoreNovelty    float64   `json:"scoreNovelty"`
	ScoreBudget     float64   `json:"scoreBudget"`
	TotalScore      float64   `json:"totalScore"`
	Recommendation  string    `json:"recommendation"`
	PublicComment   string    `json:"publicComment"`
	InternalComment string    `json:"internalComment,omitempty"`
	SubmittedAt     time.Time `json:"submittedAt"`
}

type workflowProposalItem struct {
	ID              int64                    `json:"id"`
	Title           string                   `json:"title"`
	Owner           string                   `json:"owner"`
	OwnerEmail      string                   `json:"ownerEmail"`
	Scheme          string                   `json:"scheme"`
	Period          string                   `json:"period"`
	Revision        int                      `json:"revision"`
	Budget          string                   `json:"budget"`
	MaxBudget       string                   `json:"maxBudget"`
	WorkflowStatus  string                   `json:"workflowStatus"`
	FundingDecision string                   `json:"fundingDecision"`
	ApprovedBudget  *string                  `json:"approvedBudget"`
	DecisionNote    string                   `json:"decisionNote"`
	SubmittedAt     *time.Time               `json:"submittedAt"`
	Assignments     []reviewerAssignmentView `json:"assignments"`
	Approvals       []approvalEntry          `json:"approvals"`
	AverageScore    *float64                 `json:"averageScore"`
}

type myReviewAssignment struct {
	AssignmentID   int64        `json:"assignmentId"`
	ProposalID     int64        `json:"proposalId"`
	Title          string       `json:"title"`
	Scheme         string       `json:"scheme"`
	Period         string       `json:"period"`
	Owner          string       `json:"owner"`
	Budget         string       `json:"budget"`
	WorkflowStatus string       `json:"workflowStatus"`
	BlindReview    bool         `json:"blindReview"`
	DueDate        string       `json:"dueDate"`
	Status         string       `json:"status"`
	ConflictNote   string       `json:"conflictNote"`
	Data           proposalData `json:"data"`
	Review         *reviewRow   `json:"review"`
}

func loadApprovalsForProposal(ctx context.Context, db *sql.DB, tenant, proposalID int64) ([]approvalEntry, error) {
	rows, err := db.QueryContext(ctx, `SELECT a.id, a.from_status, a.to_status, u.display_name, a.role_name, a.note, a.revision, a.created_at
 FROM proposal_approvals a
 JOIN users u ON u.id=a.actor_user_id
 WHERE a.institution_id=? AND a.proposal_id=?
 ORDER BY a.id DESC`, tenant, proposalID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []approvalEntry{}
	for rows.Next() {
		var e approvalEntry
		if err := rows.Scan(&e.ID, &e.FromStatus, &e.ToStatus, &e.ActorName, &e.RoleName, &e.Note, &e.Revision, &e.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, e)
	}
	return items, rows.Err()
}

func loadPublicReviewsForProposal(ctx context.Context, db *sql.DB, tenant, proposalID int64) ([]reviewRow, error) {
	rows, err := db.QueryContext(ctx, `SELECT r.id, r.assignment_id, r.score_relevance, r.score_method, r.score_novelty, r.score_budget, r.total_score, r.recommendation, r.public_comment, r.submitted_at
 FROM proposal_reviews r
 WHERE r.institution_id=? AND r.proposal_id=?
 ORDER BY r.submitted_at DESC`, tenant, proposalID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []reviewRow{}
	for rows.Next() {
		var r reviewRow
		if err := rows.Scan(&r.ID, &r.AssignmentID, &r.ScoreRelevance, &r.ScoreMethod, &r.ScoreNovelty, &r.ScoreBudget, &r.TotalScore, &r.Recommendation, &r.PublicComment, &r.SubmittedAt); err != nil {
			return nil, err
		}
		items = append(items, r)
	}
	return items, rows.Err()
}

func (s service) listWorkflowProposals(c *gin.Context, a actor) {
	ctx := c.Request.Context()
	if !a.system() {
		var role string
		if s.roleForPermission(ctx, a, researchVerify, &role) != nil && s.roleForPermission(ctx, a, researchDecide, &role) != nil {
			c.Status(403)
			return
		}
	}

	rows, err := s.db.QueryContext(ctx, `SELECT p.id, p.title, u.display_name, u.email, v.scheme_name, g.name, p.revision,
 CAST(p.budget_idr AS CHAR), CAST(v.budget_idr AS CHAR),
 p.workflow_status, p.funding_decision, CAST(p.approved_budget_idr AS CHAR), p.decision_note, p.submitted_at
 FROM research_proposals p
 JOIN users u ON u.id=p.owner_user_id
 JOIN grant_scheme_versions v ON v.institution_id=p.institution_id AND v.id=p.grant_version_id
 JOIN grant_periods g ON g.institution_id=v.institution_id AND g.id=v.period_id
 WHERE p.institution_id=? AND p.status='submitted'
 ORDER BY p.submitted_at DESC, p.id DESC LIMIT 200`, a.tenant)
	if err != nil {
		c.Status(503)
		return
	}
	defer rows.Close()

	items := []workflowProposalItem{}
	indexByID := map[int64]int{}
	for rows.Next() {
		var item workflowProposalItem
		var approved sql.NullString
		var submitted sql.NullTime
		if err := rows.Scan(&item.ID, &item.Title, &item.Owner, &item.OwnerEmail, &item.Scheme, &item.Period, &item.Revision,
			&item.Budget, &item.MaxBudget, &item.WorkflowStatus, &item.FundingDecision, &approved, &item.DecisionNote, &submitted); err != nil {
			c.Status(503)
			return
		}
		if approved.Valid {
			val := approved.String
			item.ApprovedBudget = &val
		}
		if submitted.Valid {
			t := submitted.Time
			item.SubmittedAt = &t
		}
		item.Assignments = []reviewerAssignmentView{}
		item.Approvals = []approvalEntry{}
		indexByID[item.ID] = len(items)
		items = append(items, item)
	}
	if rows.Err() != nil {
		c.Status(503)
		return
	}

	// Load assignments + reviews
	aRows, err := s.db.QueryContext(ctx, `SELECT a.id, a.proposal_id, a.reviewer_id, rv.name, rv.code, a.blind_review,
 COALESCE(DATE_FORMAT(a.due_date,'%Y-%m-%d'),''), a.status, a.conflict_note,
 r.id, r.score_relevance, r.score_method, r.score_novelty, r.score_budget, r.total_score, r.recommendation, r.public_comment, r.internal_comment, r.submitted_at
 FROM proposal_reviewer_assignments a
 JOIN reviewers rv ON rv.institution_id=a.institution_id AND rv.id=a.reviewer_id
 LEFT JOIN proposal_reviews r ON r.assignment_id=a.id
 WHERE a.institution_id=? ORDER BY a.id`, a.tenant)
	if err != nil {
		c.Status(503)
		return
	}
	defer aRows.Close()
	for aRows.Next() {
		var av reviewerAssignmentView
		var rID sql.NullInt64
		var sRel, sMet, sNov, sBud, sTot sql.NullFloat64
		var rec, pub, intl sql.NullString
		var subAt sql.NullTime
		if err := aRows.Scan(&av.ID, &av.ProposalID, &av.ReviewerID, &av.ReviewerName, &av.ReviewerCode, &av.BlindReview, &av.DueDate, &av.Status, &av.ConflictNote,
			&rID, &sRel, &sMet, &sNov, &sBud, &sTot, &rec, &pub, &intl, &subAt); err != nil {
			c.Status(503)
			return
		}
		if rID.Valid {
			av.Review = &reviewRow{
				ID:              rID.Int64,
				AssignmentID:    av.ID,
				ReviewerName:    av.ReviewerName,
				ScoreRelevance:  sRel.Float64,
				ScoreMethod:     sMet.Float64,
				ScoreNovelty:    sNov.Float64,
				ScoreBudget:     sBud.Float64,
				TotalScore:      sTot.Float64,
				Recommendation:  rec.String,
				PublicComment:   pub.String,
				InternalComment: intl.String,
				SubmittedAt:     subAt.Time,
			}
		}
		if idx, ok := indexByID[av.ProposalID]; ok {
			items[idx].Assignments = append(items[idx].Assignments, av)
		}
	}

	// Calculate average scores & load approvals
	for i := range items {
		var sum float64
		var cnt int
		for _, av := range items[i].Assignments {
			if av.Review != nil {
				sum += av.Review.TotalScore
				cnt++
			}
		}
		if cnt > 0 {
			avg := math.Round((sum/float64(cnt))*100) / 100
			items[i].AverageScore = &avg
		}
		if apps, err := loadApprovalsForProposal(ctx, s.db, a.tenant, items[i].ID); err == nil {
			items[i].Approvals = apps
		}
	}

	reviewers, err := s.grantChoices(ctx, a.tenant, "SELECT id, CONCAT(name,' · ',code) FROM reviewers WHERE institution_id=? AND is_active ORDER BY name")
	if err != nil {
		c.Status(503)
		return
	}

	var role string
	canVerify := a.system() || (a.mode == "production" && s.roleForPermission(ctx, a, researchVerify, &role) == nil)
	canDecide := a.system() || (a.mode == "production" && s.roleForPermission(ctx, a, researchDecide, &role) == nil)
	c.JSON(200, gin.H{"proposals": items, "reviewers": reviewers, "canVerify": canVerify, "canDecide": canDecide})
}

var allowedTransitions = map[string]map[string]bool{
	"submitted": {
		"admin_verified": true,
		"admin_revision": true,
		"rejected_admin": true,
	},
	"admin_verified": {
		"under_review":   true,
		"admin_revision": true,
		"rejected_admin": true,
	},
	"under_review": {
		"review_revision":  true,
		"review_completed": true,
	},
	"review_completed": {
		"review_revision": true,
	},
}

func (s service) transitionProposal(c *gin.Context, a actor) {
	id := target(c)
	var input struct {
		ToStatus string `json:"toStatus"`
		Note     string `json:"note"`
		Revision int    `json:"revision"`
	}
	if id < 1 || c.ShouldBindJSON(&input) != nil || input.Revision < 1 {
		c.Status(400)
		return
	}
	to := strings.TrimSpace(input.ToStatus)
	note := strings.TrimSpace(input.Note)
	if len(note) > 500 {
		note = note[:500]
	}
	if (to == "admin_revision" || to == "review_revision" || to == "rejected_admin") && note == "" {
		c.JSON(400, gin.H{"error": "validation", "message": "Catatan wajib diisi untuk status revisi atau penolakan."})
		return
	}

	s.change(c, a, "research.workflow.transition", func(ctx context.Context, tx *sql.Tx) (int64, error) {
		var fromStatus, status string
		var rev int
		err := tx.QueryRowContext(ctx, "SELECT status, workflow_status, revision FROM research_proposals WHERE institution_id=? AND id=? FOR UPDATE",
			a.tenant, id).Scan(&status, &fromStatus, &rev)
		if err != nil {
			return 0, err
		}
		if status != "submitted" || rev != input.Revision {
			return 0, staleProposal
		}
		if !allowedTransitions[fromStatus][to] {
			return 0, fmt.Errorf("%w: transisi dari %s ke %s tidak valid", invalidProposal, fromStatus, to)
		}
		if _, err := tx.ExecContext(ctx, "UPDATE research_proposals SET workflow_status=?, revision=revision+1 WHERE id=?", to, id); err != nil {
			return 0, err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO proposal_approvals (institution_id, proposal_id, from_status, to_status, actor_user_id, role_name, note, revision)
 VALUES (?,?,?,?,?,?,?,?)`, a.tenant, id, fromStatus, to, a.ID, a.role, note, rev+1); err != nil {
			return 0, err
		}
		return id, nil
	})
}

func (s service) assignReviewer(c *gin.Context, a actor) {
	id := target(c)
	var input struct {
		ReviewerID  int64  `json:"reviewerId"`
		BlindReview bool   `json:"blindReview"`
		DueDate     string `json:"dueDate"`
	}
	if id < 1 || c.ShouldBindJSON(&input) != nil || input.ReviewerID < 1 {
		c.Status(400)
		return
	}
	var dueDate any
	if strings.TrimSpace(input.DueDate) != "" {
		if _, err := time.Parse("2006-01-02", strings.TrimSpace(input.DueDate)); err != nil {
			c.JSON(400, gin.H{"error": "validation", "message": "Format tanggal batas review harus YYYY-MM-DD."})
			return
		}
		dueDate = strings.TrimSpace(input.DueDate)
	}

	s.change(c, a, "research.reviewer.assign", func(ctx context.Context, tx *sql.Tx) (int64, error) {
		var status, wf string
		var rev int
		err := tx.QueryRowContext(ctx, "SELECT status, workflow_status, revision FROM research_proposals WHERE institution_id=? AND id=? FOR UPDATE",
			a.tenant, id).Scan(&status, &wf, &rev)
		if err != nil {
			return 0, err
		}
		if status != "submitted" || (wf != "admin_verified" && wf != "under_review") {
			return 0, fmt.Errorf("%w: usulan harus berstatus lolos administrasi sebelum ditugaskan ke reviewer", invalidProposal)
		}
		var active bool
		if err := tx.QueryRowContext(ctx, "SELECT is_active FROM reviewers WHERE institution_id=? AND id=?", a.tenant, input.ReviewerID).Scan(&active); err != nil || !active {
			return 0, fmt.Errorf("%w: reviewer tidak aktif atau tidak ditemukan di institusi", invalidProposal)
		}
		res, err := tx.ExecContext(ctx, `INSERT INTO proposal_reviewer_assignments (institution_id, proposal_id, reviewer_id, blind_review, due_date, assigned_by)
 VALUES (?,?,?,?,?,?)`, a.tenant, id, input.ReviewerID, input.BlindReview, dueDate, a.ID)
		if err != nil {
			return 0, err
		}
		if wf == "admin_verified" {
			if _, err := tx.ExecContext(ctx, "UPDATE research_proposals SET workflow_status='under_review', revision=revision+1 WHERE id=?", id); err != nil {
				return 0, err
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO proposal_approvals (institution_id, proposal_id, from_status, to_status, actor_user_id, role_name, note, revision)
 VALUES (?,?,?,?,?,?,?,?)`, a.tenant, id, "admin_verified", "under_review", a.ID, a.role, "Penugasan reviewer dimulai", rev+1); err != nil {
				return 0, err
			}
		}
		return res.LastInsertId()
	})
}

func (s service) removeReviewerAssignment(c *gin.Context, a actor) {
	id := target(c)
	if id < 1 {
		c.Status(400)
		return
	}
	s.change(c, a, "research.reviewer.remove", func(ctx context.Context, tx *sql.Tx) (int64, error) {
		var st string
		err := tx.QueryRowContext(ctx, "SELECT status FROM proposal_reviewer_assignments WHERE institution_id=? AND id=? FOR UPDATE", a.tenant, id).Scan(&st)
		if err != nil {
			return 0, err
		}
		if st == "completed" {
			return 0, fmt.Errorf("%w: penugasan yang sudah selesai dinilai tidak dapat dihapus", invalidProposal)
		}
		if _, err := tx.ExecContext(ctx, "DELETE FROM proposal_reviewer_assignments WHERE institution_id=? AND id=?", a.tenant, id); err != nil {
			return 0, err
		}
		return id, nil
	})
}

func (s service) listMyReviews(c *gin.Context, a actor) {
	if strings.TrimSpace(a.Email) == "" {
		c.JSON(200, []myReviewAssignment{})
		return
	}
	ctx := c.Request.Context()
	rows, err := s.db.QueryContext(ctx, `SELECT a.id, a.proposal_id, p.title, v.scheme_name, g.name, u.display_name,
 CAST(p.budget_idr AS CHAR), p.workflow_status, a.blind_review, COALESCE(DATE_FORMAT(a.due_date,'%Y-%m-%d'),''), a.status, a.conflict_note, p.payload,
 r.id, r.score_relevance, r.score_method, r.score_novelty, r.score_budget, r.total_score, r.recommendation, r.public_comment, r.internal_comment, r.submitted_at
 FROM proposal_reviewer_assignments a
 JOIN reviewers rv ON rv.institution_id=a.institution_id AND rv.id=a.reviewer_id
 JOIN research_proposals p ON p.institution_id=a.institution_id AND p.id=a.proposal_id
 JOIN grant_scheme_versions v ON v.institution_id=p.institution_id AND v.id=p.grant_version_id
 JOIN grant_periods g ON g.institution_id=v.institution_id AND g.id=v.period_id
 JOIN users u ON u.id=p.owner_user_id
 LEFT JOIN proposal_reviews r ON r.assignment_id=a.id
 WHERE a.institution_id=? AND rv.email=? AND rv.is_active AND p.status='submitted'
 ORDER BY (a.status='assigned') DESC, a.id DESC`, a.tenant, a.Email)
	if err != nil {
		c.Status(503)
		return
	}
	defer rows.Close()

	items := []myReviewAssignment{}
	for rows.Next() {
		var item myReviewAssignment
		var payload []byte
		var rID sql.NullInt64
		var sRel, sMet, sNov, sBud, sTot sql.NullFloat64
		var rec, pub, intl sql.NullString
		var subAt sql.NullTime
		if err := rows.Scan(&item.AssignmentID, &item.ProposalID, &item.Title, &item.Scheme, &item.Period, &item.Owner,
			&item.Budget, &item.WorkflowStatus, &item.BlindReview, &item.DueDate, &item.Status, &item.ConflictNote, &payload,
			&rID, &sRel, &sMet, &sNov, &sBud, &sTot, &rec, &pub, &intl, &subAt); err != nil {
			c.Status(503)
			return
		}
		_ = json.Unmarshal(payload, &item.Data)
		if item.BlindReview {
			item.Owner = "Peneliti (Blind Review)"
			item.Data.Team = nil
			item.Data.Students = nil
		}
		if rID.Valid {
			item.Review = &reviewRow{
				ID:              rID.Int64,
				AssignmentID:    item.AssignmentID,
				ScoreRelevance:  sRel.Float64,
				ScoreMethod:     sMet.Float64,
				ScoreNovelty:    sNov.Float64,
				ScoreBudget:     sBud.Float64,
				TotalScore:      sTot.Float64,
				Recommendation:  rec.String,
				PublicComment:   pub.String,
				InternalComment: intl.String,
				SubmittedAt:     subAt.Time,
			}
		}
		items = append(items, item)
	}
	if rows.Err() != nil {
		c.Status(503)
		return
	}
	c.JSON(200, items)
}

func (s service) respondReviewAssignment(c *gin.Context, a actor) {
	assignmentID := target(c)
	var input struct {
		Status string `json:"status"`
		Note   string `json:"note"`
	}
	if assignmentID < 1 || c.ShouldBindJSON(&input) != nil {
		c.Status(400)
		return
	}
	st := strings.TrimSpace(input.Status)
	if st != "accepted" && st != "declined" {
		c.Status(400)
		return
	}
	note := strings.TrimSpace(input.Note)
	if len(note) > 500 {
		note = note[:500]
	}
	if st == "declined" && note == "" {
		c.JSON(400, gin.H{"error": "validation", "message": "Alasan penolakan atau konflik kepentingan wajib diisi."})
		return
	}
	s.change(c, a, "research.review.respond", func(ctx context.Context, tx *sql.Tx) (int64, error) {
		var curStatus string
		err := tx.QueryRowContext(ctx, `SELECT a.status FROM proposal_reviewer_assignments a
 JOIN reviewers rv ON rv.institution_id=a.institution_id AND rv.id=a.reviewer_id
 WHERE a.institution_id=? AND a.id=? AND rv.email=? FOR UPDATE`, a.tenant, assignmentID, a.Email).Scan(&curStatus)
		if err != nil {
			return 0, err
		}
		if curStatus == "completed" {
			return 0, staleProposal
		}
		if _, err := tx.ExecContext(ctx, "UPDATE proposal_reviewer_assignments SET status=?, conflict_note=? WHERE id=?", st, note, assignmentID); err != nil {
			return 0, err
		}
		return assignmentID, nil
	})
}

func (s service) submitReview(c *gin.Context, a actor) {
	assignmentID := target(c)
	var input struct {
		ScoreRelevance  float64 `json:"scoreRelevance"`
		ScoreMethod     float64 `json:"scoreMethod"`
		ScoreNovelty    float64 `json:"scoreNovelty"`
		ScoreBudget     float64 `json:"scoreBudget"`
		Recommendation  string  `json:"recommendation"`
		PublicComment   string  `json:"publicComment"`
		InternalComment string  `json:"internalComment"`
	}
	if assignmentID < 1 || c.ShouldBindJSON(&input) != nil {
		c.Status(400)
		return
	}
	for _, sc := range []float64{input.ScoreRelevance, input.ScoreMethod, input.ScoreNovelty, input.ScoreBudget} {
		if sc < 0 || sc > 100 {
			c.JSON(400, gin.H{"error": "validation", "message": "Setiap nilai kriteria harus antara 0 hingga 100."})
			return
		}
	}
	rec := strings.TrimSpace(input.Recommendation)
	if rec != "approve" && rec != "revise" && rec != "reject" {
		c.Status(400)
		return
	}
	pub := strings.TrimSpace(input.PublicComment)
	if pub == "" {
		c.JSON(400, gin.H{"error": "validation", "message": "Komentar untuk pengusul wajib diisi."})
		return
	}
	intl := strings.TrimSpace(input.InternalComment)
	total := math.Round((input.ScoreRelevance*0.25+input.ScoreMethod*0.30+input.ScoreNovelty*0.25+input.ScoreBudget*0.20)*100) / 100

	s.change(c, a, "research.review.submit", func(ctx context.Context, tx *sql.Tx) (int64, error) {
		var propID, revID int64
		var curStatus string
		err := tx.QueryRowContext(ctx, `SELECT a.proposal_id, a.reviewer_id, a.status FROM proposal_reviewer_assignments a
 JOIN reviewers rv ON rv.institution_id=a.institution_id AND rv.id=a.reviewer_id
 WHERE a.institution_id=? AND a.id=? AND rv.email=? FOR UPDATE`, a.tenant, assignmentID, a.Email).Scan(&propID, &revID, &curStatus)
		if err != nil {
			return 0, err
		}
		if curStatus == "declined" {
			return 0, fmt.Errorf("%w: penugasan yang ditolak tidak dapat dinilai", invalidProposal)
		}
		res, err := tx.ExecContext(ctx, `INSERT INTO proposal_reviews
 (institution_id, assignment_id, proposal_id, reviewer_id, score_relevance, score_method, score_novelty, score_budget, total_score, recommendation, public_comment, internal_comment)
 VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
 ON DUPLICATE KEY UPDATE
 score_relevance=VALUES(score_relevance), score_method=VALUES(score_method), score_novelty=VALUES(score_novelty),
 score_budget=VALUES(score_budget), total_score=VALUES(total_score), recommendation=VALUES(recommendation),
 public_comment=VALUES(public_comment), internal_comment=VALUES(internal_comment), submitted_at=UTC_TIMESTAMP(6)`,
			a.tenant, assignmentID, propID, revID, input.ScoreRelevance, input.ScoreMethod, input.ScoreNovelty, input.ScoreBudget, total, rec, pub, intl)
		if err != nil {
			return 0, err
		}
		if _, err := tx.ExecContext(ctx, "UPDATE proposal_reviewer_assignments SET status='completed' WHERE id=?", assignmentID); err != nil {
			return 0, err
		}
		_, _ = res.LastInsertId()
		return assignmentID, nil
	})
}

func (s service) decideFunding(c *gin.Context, a actor) {
	id := target(c)
	var input struct {
		Decision       string `json:"decision"`
		ApprovedBudget string `json:"approvedBudget"`
		Note           string `json:"note"`
	}
	if id < 1 || c.ShouldBindJSON(&input) != nil {
		c.Status(400)
		return
	}
	dec := strings.TrimSpace(input.Decision)
	if dec != "funded" && dec != "not_funded" {
		c.Status(400)
		return
	}
	note := strings.TrimSpace(input.Note)
	if len(note) > 500 {
		note = note[:500]
	}

	var approvedBudget *uint64
	if dec == "funded" {
		rawBudget := strings.TrimSpace(input.ApprovedBudget)
		if rawBudget == "" {
			c.JSON(400, gin.H{"error": "validation", "message": "Nominal anggaran disetujui wajib diisi jika usulan didanai."})
			return
		}
		val, err := strconv.ParseUint(rawBudget, 10, 64)
		if err != nil || val == 0 {
			c.JSON(400, gin.H{"error": "validation", "message": "Anggaran disetujui harus berupa bilangan bulat positif."})
			return
		}
		approvedBudget = &val
	}

	s.change(c, a, "research.funding.decide", func(ctx context.Context, tx *sql.Tx) (int64, error) {
		var status, wf string
		var maxBudget uint64
		var rev int
		err := tx.QueryRowContext(ctx, `SELECT p.status, p.workflow_status, p.revision, v.budget_idr
 FROM research_proposals p
 JOIN grant_scheme_versions v ON v.institution_id=p.institution_id AND v.id=p.grant_version_id
 WHERE p.institution_id=? AND p.id=? FOR UPDATE`, a.tenant, id).Scan(&status, &wf, &rev, &maxBudget)
		if err != nil {
			return 0, err
		}
		if status != "submitted" || (wf != "review_completed" && wf != "admin_verified") {
			return 0, fmt.Errorf("%w: keputusan pendanaan hanya dapat dilakukan setelah proses review selesai atau lolos administrasi", invalidProposal)
		}
		if approvedBudget != nil && *approvedBudget > maxBudget {
			return 0, fmt.Errorf("%w: anggaran disetujui melampaui pagu maksimal skema", invalidProposal)
		}
		if _, err := tx.ExecContext(ctx, `UPDATE research_proposals SET funding_decision=?, approved_budget_idr=?, decision_note=?, decided_at=UTC_TIMESTAMP(6), decided_by=? WHERE id=?`,
			dec, approvedBudget, note, a.ID, id); err != nil {
			return 0, err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO proposal_approvals (institution_id, proposal_id, from_status, to_status, actor_user_id, role_name, note, revision)
 VALUES (?,?,?,?,?,?,?,?)`, a.tenant, id, wf, "decision:"+dec, a.ID, a.role, note, rev); err != nil {
			return 0, err
		}
		return id, nil
	})
}

func (s service) resubmitProposal(c *gin.Context, a actor) {
	id := target(c)
	var input struct {
		Revision  int  `json:"revision"`
		Confirmed bool `json:"confirmed"`
	}
	if id < 1 || c.ShouldBindJSON(&input) != nil || input.Revision < 1 || !input.Confirmed {
		c.Status(400)
		return
	}
	s.change(c, a, "research.proposal.resubmit", func(ctx context.Context, tx *sql.Tx) (int64, error) {
		var status, wf string
		var rev int
		var period, version int64
		err := tx.QueryRowContext(ctx, `SELECT p.status, p.workflow_status, p.revision, v.period_id, v.id
 FROM research_proposals p JOIN grant_scheme_versions v ON v.id=p.grant_version_id
 WHERE p.institution_id=? AND p.owner_user_id=? AND p.id=? FOR UPDATE`, a.tenant, a.ID, id).Scan(&status, &wf, &rev, &period, &version)
		if err != nil {
			return 0, err
		}
		if rev != input.Revision || (wf != "admin_revision" && wf != "review_revision") {
			return 0, staleProposal
		}
		grant, err := lockGrant(ctx, tx, a.tenant, period, version)
		if err != nil {
			return 0, err
		}
		item, err := readProposal(tx.QueryRowContext(ctx, proposalSelect+" WHERE p.id=?", id))
		if err != nil {
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
			return 0, fmt.Errorf("%w: %s", invalidProposal, err.Error())
		}
		nextWF := "submitted"
		if wf == "review_revision" {
			nextWF = "under_review"
		}
		if _, err := tx.ExecContext(ctx, "UPDATE research_proposals SET workflow_status=?, revision=revision+1 WHERE id=?", nextWF, id); err != nil {
			return 0, err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO proposal_approvals (institution_id, proposal_id, from_status, to_status, actor_user_id, role_name, note, revision)
 VALUES (?,?,?,?,?,?,?,?)`, a.tenant, id, wf, nextWF, a.ID, a.role, "Pengusul mengirim ulang revisi usulan", rev+1); err != nil {
			return 0, err
		}
		return id, nil
	})
}
