package iam

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math/big"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

type monevReviewView struct {
	ID               int64     `json:"id"`
	ProposalID       int64     `json:"proposalId"`
	ReviewerName     string    `json:"reviewerName"`
	Stage            string    `json:"stage"`
	Score            float64   `json:"score"`
	Decision         string    `json:"decision"`
	Notes            string    `json:"notes"`
	CorrectiveAction string    `json:"correctiveAction"`
	FollowUpStatus   string    `json:"followUpStatus"`
	FollowUpNote     string    `json:"followUpNote"`
	CreatedAt        time.Time `json:"createdAt"`
}

type researchOutputView struct {
	ID              int64  `json:"id"`
	ProposalID      int64  `json:"proposalId"`
	Kind            string `json:"kind"`
	Title           string `json:"title"`
	PublicationName string `json:"publicationName"`
	Identifier      string `json:"identifier"`
	OutputYear      int    `json:"outputYear"`
	Status          string `json:"status"`
	URL             string `json:"url"`
	HasProof        bool   `json:"hasProof"`
	VerifiedStatus  string `json:"verifiedStatus"`
	VerifiedNote    string `json:"verifiedNote"`
}

type projectExpenseView struct {
	ID            int64  `json:"id"`
	ProposalID    int64  `json:"proposalId"`
	Category      string `json:"category"`
	ItemName      string `json:"itemName"`
	Justification string `json:"justification"`
	Quantity      string `json:"quantity"`
	Unit          string `json:"unit"`
	UnitPrice     string `json:"unitPrice"`
	Total         string `json:"total"`
	SpentAt       string `json:"spentAt"`
}

type monevProposalItem struct {
	ProposalID      int64                `json:"proposalId"`
	ProjectID       *int64               `json:"projectId"`
	ProjectStatus   string               `json:"projectStatus"`
	ContractNumber  string               `json:"contractNumber"`
	Title           string               `json:"title"`
	Owner           string               `json:"owner"`
	OwnerID         int64                `json:"ownerId"`
	Scheme          string               `json:"scheme"`
	Period          string               `json:"period"`
	ApprovedBudget  string               `json:"approvedBudget"`
	TotalSpent      string               `json:"totalSpent"`
	HasProgress     bool                 `json:"hasProgress"`
	HasFinal        bool                 `json:"hasFinal"`
	HasPoster       bool                 `json:"hasPoster"`
	MonevReviews    []monevReviewView    `json:"monevReviews"`
	Outputs         []researchOutputView `json:"outputs"`
	Expenses        []projectExpenseView `json:"expenses"`
}

func (s service) canMonevOrVerify(ctx context.Context, a actor) (canMonev bool, canVerify bool, canClose bool) {
	if a.system() {
		return true, true, true
	}
	if a.mode != "production" {
		m := a.mode == "trial-admin"
		return m, m, m
	}
	var role string
	canVerify = s.roleForPermission(ctx, a, researchVerify, &role) == nil
	canReview := s.roleForPermission(ctx, a, researchReview, &role) == nil
	canDecide := s.roleForPermission(ctx, a, researchDecide, &role) == nil
	return canVerify || canReview, canVerify, canVerify || canDecide
}

func (s service) listMonevProposals(c *gin.Context, a actor) {
	ctx := c.Request.Context()
	canMonev, canVerify, canClose := s.canMonevOrVerify(ctx, a)

	where := "p.institution_id=? AND p.funding_decision='funded'"
	args := []any{a.tenant}
	if !canMonev && !canVerify && !canClose {
		where += " AND p.owner_user_id=?"
		args = append(args, a.ID)
	}

	rows, err := s.db.QueryContext(ctx, `SELECT p.id, pr.id, COALESCE(pr.status,'no_contract'), COALESCE(pr.contract_number,''),
 p.title, u.display_name, p.owner_user_id, v.scheme_name, g.name,
 CAST(COALESCE(pr.approved_budget_idr, p.approved_budget_idr, p.budget_idr) AS CHAR),
 EXISTS(SELECT 1 FROM research_reports rp WHERE rp.institution_id=p.institution_id AND rp.proposal_id=p.id AND rp.kind='progress' AND rp.is_active AND JSON_LENGTH(rp.payload)>0),
 EXISTS(SELECT 1 FROM research_reports rf WHERE rf.institution_id=p.institution_id AND rf.proposal_id=p.id AND rf.kind='final' AND rf.is_active AND JSON_LENGTH(rf.payload)>0),
 EXISTS(SELECT 1 FROM research_proposal_images im WHERE im.proposal_id=p.id AND im.kind='poster')
 FROM research_proposals p
 LEFT JOIN research_projects pr ON pr.institution_id=p.institution_id AND pr.proposal_id=p.id
 JOIN users u ON u.id=p.owner_user_id
 JOIN grant_scheme_versions v ON v.institution_id=p.institution_id AND v.id=p.grant_version_id
 JOIN grant_periods g ON g.institution_id=v.institution_id AND g.id=v.period_id
 WHERE `+where+` ORDER BY p.id DESC LIMIT 200`, args...)
	if err != nil {
		c.Status(503)
		return
	}
	defer rows.Close()

	items := []monevProposalItem{}
	idxByProp := map[int64]int{}
	for rows.Next() {
		var item monevProposalItem
		var projID sql.NullInt64
		if err := rows.Scan(&item.ProposalID, &projID, &item.ProjectStatus, &item.ContractNumber,
			&item.Title, &item.Owner, &item.OwnerID, &item.Scheme, &item.Period, &item.ApprovedBudget,
			&item.HasProgress, &item.HasFinal, &item.HasPoster); err != nil {
			c.Status(503)
			return
		}
		if projID.Valid {
			v := projID.Int64
			item.ProjectID = &v
		}
		item.TotalSpent = "0"
		item.MonevReviews = []monevReviewView{}
		item.Outputs = []researchOutputView{}
		item.Expenses = []projectExpenseView{}
		idxByProp[item.ProposalID] = len(items)
		items = append(items, item)
	}

	// Load monev reviews
	mRows, err := s.db.QueryContext(ctx, `SELECT m.id, m.proposal_id, u.display_name, m.stage, m.score, m.decision,
 m.notes, m.corrective_action, m.follow_up_status, m.follow_up_note, m.created_at
 FROM monitoring_reviews m JOIN users u ON u.id=m.reviewer_user_id
 WHERE m.institution_id=? ORDER BY m.id DESC`, a.tenant)
	if err == nil {
		defer mRows.Close()
		for mRows.Next() {
			var mv monevReviewView
			if mRows.Scan(&mv.ID, &mv.ProposalID, &mv.ReviewerName, &mv.Stage, &mv.Score, &mv.Decision,
				&mv.Notes, &mv.CorrectiveAction, &mv.FollowUpStatus, &mv.FollowUpNote, &mv.CreatedAt) == nil {
				if idx, ok := idxByProp[mv.ProposalID]; ok {
					items[idx].MonevReviews = append(items[idx].MonevReviews, mv)
				}
			}
		}
	}

	// Load outputs
	oRows, err := s.db.QueryContext(ctx, `SELECT id, proposal_id, kind, title, publication_name, identifier, output_year,
 status, url, LENGTH(COALESCE(proof_content,''))>0, verified_status, verified_note
 FROM research_outputs WHERE institution_id=? ORDER BY id DESC`, a.tenant)
	if err == nil {
		defer oRows.Close()
		for oRows.Next() {
			var ov researchOutputView
			if oRows.Scan(&ov.ID, &ov.ProposalID, &ov.Kind, &ov.Title, &ov.PublicationName, &ov.Identifier, &ov.OutputYear,
				&ov.Status, &ov.URL, &ov.HasProof, &ov.VerifiedStatus, &ov.VerifiedNote) == nil {
				if idx, ok := idxByProp[ov.ProposalID]; ok {
					items[idx].Outputs = append(items[idx].Outputs, ov)
				}
			}
		}
	}

	// Load expenses
	spentTotals := map[int64]uint64{}
	eRows, err := s.db.QueryContext(ctx, `SELECT id, proposal_id, category, item_name, justification,
 CAST(quantity AS CHAR), unit, CAST(unit_price_idr AS CHAR), CAST(total_idr AS CHAR),
 COALESCE(DATE_FORMAT(spent_at,'%Y-%m-%d'),'')
 FROM project_expenses WHERE institution_id=? ORDER BY id DESC`, a.tenant)
	if err == nil {
		defer eRows.Close()
		for eRows.Next() {
			var ev projectExpenseView
			if eRows.Scan(&ev.ID, &ev.ProposalID, &ev.Category, &ev.ItemName, &ev.Justification,
				&ev.Quantity, &ev.Unit, &ev.UnitPrice, &ev.Total, &ev.SpentAt) == nil {
				if idx, ok := idxByProp[ev.ProposalID]; ok {
					items[idx].Expenses = append(items[idx].Expenses, ev)
					if v, err := strconv.ParseUint(ev.Total, 10, 64); err == nil {
						spentTotals[ev.ProposalID] += v
					}
				}
			}
		}
	}
	for i := range items {
		items[i].TotalSpent = strconv.FormatUint(spentTotals[items[i].ProposalID], 10)
	}

	c.JSON(200, gin.H{"items": items, "canMonev": canMonev, "canVerify": canVerify, "canClose": canClose, "currentUserId": a.ID})
}

func (s service) createMonevReview(c *gin.Context, a actor) {
	ctx := c.Request.Context()
	canMonev, _, _ := s.canMonevOrVerify(ctx, a)
	if !canMonev {
		c.Status(403)
		return
	}
	propID := target(c)
	var input struct {
		Stage            string  `json:"stage"`
		Score            float64 `json:"score"`
		Decision         string  `json:"decision"`
		Notes            string  `json:"notes"`
		CorrectiveAction string  `json:"correctiveAction"`
	}
	if propID < 1 || c.ShouldBindJSON(&input) != nil {
		c.Status(400)
		return
	}
	stage := strings.TrimSpace(input.Stage)
	dec := strings.TrimSpace(input.Decision)
	if (stage != "progress" && stage != "final") || (dec != "accepted" && dec != "revision_needed") || input.Score < 0 || input.Score > 100 {
		c.JSON(400, gin.H{"error": "validation", "message": "Tahap monev, keputusan, dan skor (0-100) harus valid."})
		return
	}
	notes := strings.TrimSpace(input.Notes)
	corr := strings.TrimSpace(input.CorrectiveAction)
	if notes == "" {
		c.JSON(400, gin.H{"error": "validation", "message": "Catatan hasil monev wajib diisi."})
		return
	}
	followUp := "none"
	if dec == "revision_needed" {
		followUp = "pending"
	}

	s.change(c, a, "research.monev.create", func(ctx context.Context, tx *sql.Tx) (int64, error) {
		var decision string
		if err := tx.QueryRowContext(ctx, "SELECT funding_decision FROM research_proposals WHERE institution_id=? AND id=? FOR UPDATE", a.tenant, propID).Scan(&decision); err != nil {
			return 0, err
		}
		if decision != "funded" {
			return 0, fmt.Errorf("%w: monev hanya dilakukan pada proyek yang didanai", invalidProposal)
		}
		res, err := tx.ExecContext(ctx, `INSERT INTO monitoring_reviews (institution_id, proposal_id, reviewer_user_id, stage, score, decision, notes, corrective_action, follow_up_status, follow_up_note)
 VALUES (?,?,?,?,?,?,?,?,?,'')`, a.tenant, propID, a.ID, stage, input.Score, dec, notes, corr, followUp)
		if err != nil {
			return 0, err
		}
		return res.LastInsertId()
	})
}

func (s service) respondMonevFollowUp(c *gin.Context, a actor) {
	monevID := target(c)
	var input struct {
		Note string `json:"note"`
	}
	if monevID < 1 || c.ShouldBindJSON(&input) != nil || strings.TrimSpace(input.Note) == "" {
		c.JSON(400, gin.H{"error": "validation", "message": "Keterangan tindak lanjut wajib diisi."})
		return
	}
	s.change(c, a, "research.monev.followup", func(ctx context.Context, tx *sql.Tx) (int64, error) {
		res, err := tx.ExecContext(ctx, `UPDATE monitoring_reviews m
 JOIN research_proposals p ON p.institution_id=m.institution_id AND p.id=m.proposal_id
 SET m.follow_up_status='resolved', m.follow_up_note=?
 WHERE m.institution_id=? AND m.id=? AND p.owner_user_id=?`, strings.TrimSpace(input.Note), a.tenant, monevID, a.ID)
		if err != nil {
			return 0, err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return 0, sql.ErrNoRows
		}
		return monevID, nil
	})
}

func (s service) addProjectExpense(c *gin.Context, a actor) {
	propID := target(c)
	var input struct {
		Category      string `json:"category"`
		ItemName      string `json:"itemName"`
		Justification string `json:"justification"`
		Quantity      string `json:"quantity"`
		Unit          string `json:"unit"`
		UnitPrice     string `json:"unitPrice"`
		SpentAt       string `json:"spentAt"`
	}
	if propID < 1 || c.ShouldBindJSON(&input) != nil {
		c.Status(400)
		return
	}
	cat := strings.TrimSpace(input.Category)
	item := strings.TrimSpace(input.ItemName)
	qtyStr := strings.TrimSpace(input.Quantity)
	priceStr := strings.TrimSpace(input.UnitPrice)
	if cat == "" || item == "" || !quantityPattern.MatchString(qtyStr) || !pricePattern.MatchString(priceStr) {
		c.JSON(400, gin.H{"error": "validation", "message": "Lengkapi kategori, item pengeluaran, kuantitas positif, dan harga satuan rupiah bulat."})
		return
	}
	qty, _ := new(big.Rat).SetString(qtyStr)
	price, _ := new(big.Rat).SetString(priceStr)
	sub := new(big.Rat).Mul(qty, price)
	sub.Add(sub, big.NewRat(1, 2))
	totalInt := new(big.Int).Quo(sub.Num(), sub.Denom())
	if !totalInt.IsUint64() {
		c.JSON(400, gin.H{"error": "validation", "message": "Nominal pengeluaran melampaui batas."})
		return
	}
	var spentAt any
	if strings.TrimSpace(input.SpentAt) != "" {
		if _, err := time.Parse("2006-01-02", strings.TrimSpace(input.SpentAt)); err != nil {
			c.JSON(400, gin.H{"error": "validation", "message": "Format tanggal harus YYYY-MM-DD."})
			return
		}
		spentAt = strings.TrimSpace(input.SpentAt)
	}

	s.change(c, a, "research.expense.add", func(ctx context.Context, tx *sql.Tx) (int64, error) {
		var owner int64
		if err := tx.QueryRowContext(ctx, "SELECT owner_user_id FROM research_proposals WHERE institution_id=? AND id=? AND funding_decision='funded' FOR UPDATE", a.tenant, propID).Scan(&owner); err != nil {
			return 0, err
		}
		if owner != a.ID {
			return 0, sql.ErrNoRows
		}
		res, err := tx.ExecContext(ctx, `INSERT INTO project_expenses (institution_id, proposal_id, category, item_name, justification, quantity, unit, unit_price_idr, total_idr, spent_at)
 VALUES (?,?,?,?,?,?,?,?,?,?)`, a.tenant, propID, cat, item, strings.TrimSpace(input.Justification), qtyStr, strings.TrimSpace(input.Unit), priceStr, totalInt.Uint64(), spentAt)
		if err != nil {
			return 0, err
		}
		return res.LastInsertId()
	})
}

func (s service) deleteProjectExpense(c *gin.Context, a actor) {
	expID := target(c)
	if expID < 1 {
		c.Status(400)
		return
	}
	s.change(c, a, "research.expense.delete", func(ctx context.Context, tx *sql.Tx) (int64, error) {
		res, err := tx.ExecContext(ctx, `DELETE e FROM project_expenses e
 JOIN research_proposals p ON p.institution_id=e.institution_id AND p.id=e.proposal_id
 WHERE e.institution_id=? AND e.id=? AND p.owner_user_id=?`, a.tenant, expID, a.ID)
		if err != nil {
			return 0, err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return 0, sql.ErrNoRows
		}
		return expID, nil
	})
}

func (s service) saveResearchOutput(c *gin.Context, a actor) {
	propID := target(c)
	var input struct {
		Kind            string `json:"kind"`
		Title           string `json:"title"`
		PublicationName string `json:"publicationName"`
		Identifier      string `json:"identifier"`
		OutputYear      int    `json:"outputYear"`
		Status          string `json:"status"`
		URL             string `json:"url"`
	}
	if propID < 1 || c.ShouldBindJSON(&input) != nil {
		c.Status(400)
		return
	}
	kind := strings.TrimSpace(input.Kind)
	title := strings.TrimSpace(input.Title)
	st := strings.TrimSpace(input.Status)
	if kind == "" || title == "" || input.OutputYear < 2000 || input.OutputYear > 2200 ||
		(st != "planned" && st != "submitted" && st != "accepted" && st != "published" && st != "granted") {
		c.JSON(400, gin.H{"error": "validation", "message": "Lengkapi jenis, judul, tahun, dan status luaran."})
		return
	}
	s.change(c, a, "research.output.save", func(ctx context.Context, tx *sql.Tx) (int64, error) {
		var owner int64
		if err := tx.QueryRowContext(ctx, "SELECT owner_user_id FROM research_proposals WHERE institution_id=? AND id=? AND funding_decision='funded' FOR UPDATE", a.tenant, propID).Scan(&owner); err != nil {
			return 0, err
		}
		if owner != a.ID {
			return 0, sql.ErrNoRows
		}
		res, err := tx.ExecContext(ctx, `INSERT INTO research_outputs (institution_id, proposal_id, owner_user_id, kind, title, publication_name, identifier, output_year, status, url)
 VALUES (?,?,?,?,?,?,?,?,?,?)`, a.tenant, propID, a.ID, kind, title, strings.TrimSpace(input.PublicationName), strings.TrimSpace(input.Identifier), input.OutputYear, st, strings.TrimSpace(input.URL))
		if err != nil {
			return 0, err
		}
		return res.LastInsertId()
	})
}

func (s service) uploadOutputProof(c *gin.Context, a actor) {
	outID := target(c)
	if outID < 1 {
		c.Status(400)
		return
	}
	mimeType, content, err := readProofUpload(c, "proof")
	if err != nil {
		c.JSON(400, gin.H{"error": "invalid_file", "message": err.Error()})
		return
	}
	s.change(c, a, "research.output.proof", func(ctx context.Context, tx *sql.Tx) (int64, error) {
		res, err := tx.ExecContext(ctx, "UPDATE research_outputs SET proof_mime=?, proof_content=? WHERE institution_id=? AND id=? AND owner_user_id=?",
			mimeType, content, a.tenant, outID, a.ID)
		if err != nil {
			return 0, err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return 0, sql.ErrNoRows
		}
		return outID, nil
	})
}

func (s service) downloadOutputProof(c *gin.Context, a actor) {
	outID := target(c)
	if outID < 1 {
		c.Status(400)
		return
	}
	ctx := c.Request.Context()
	canMonev, canVerify, canClose := s.canMonevOrVerify(ctx, a)
	var ownerID int64
	var mimeType string
	var content []byte
	err := s.db.QueryRowContext(ctx, "SELECT owner_user_id, proof_mime, proof_content FROM research_outputs WHERE institution_id=? AND id=?", a.tenant, outID).Scan(&ownerID, &mimeType, &content)
	if errors.Is(err, sql.ErrNoRows) || len(content) == 0 {
		c.Status(404)
		return
	}
	if err != nil {
		c.Status(503)
		return
	}
	if !canMonev && !canVerify && !canClose && ownerID != a.ID {
		c.Status(403)
		return
	}
	c.Header("X-Content-Type-Options", "nosniff")
	c.Data(200, mimeType, content)
}

func (s service) verifyResearchOutput(c *gin.Context, a actor) {
	outID := target(c)
	var input struct {
		Status string `json:"status"`
		Note   string `json:"note"`
	}
	if outID < 1 || c.ShouldBindJSON(&input) != nil {
		c.Status(400)
		return
	}
	st := strings.TrimSpace(input.Status)
	if st != "verified" && st != "rejected" {
		c.Status(400)
		return
	}
	s.change(c, a, "research.output.verify", func(ctx context.Context, tx *sql.Tx) (int64, error) {
		res, err := tx.ExecContext(ctx, "UPDATE research_outputs SET verified_status=?, verified_note=?, verified_by=? WHERE institution_id=? AND id=?",
			st, strings.TrimSpace(input.Note), a.ID, a.tenant, outID)
		if err != nil {
			return 0, err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return 0, sql.ErrNoRows
		}
		return outID, nil
	})
}

func (s service) closeProject(c *gin.Context, a actor) {
	ctx := c.Request.Context()
	_, _, canClose := s.canMonevOrVerify(ctx, a)
	if !canClose {
		c.Status(403)
		return
	}
	propID := target(c)
	if propID < 1 {
		c.Status(400)
		return
	}
	s.change(c, a, "research.project.close", func(ctx context.Context, tx *sql.Tx) (int64, error) {
		var projID int64
		var curStatus string
		err := tx.QueryRowContext(ctx, "SELECT id, status FROM research_projects WHERE institution_id=? AND proposal_id=? FOR UPDATE", a.tenant, propID).Scan(&projID, &curStatus)
		if errors.Is(err, sql.ErrNoRows) {
			return 0, fmt.Errorf("%w: kontrak proyek belum diterbitkan", invalidProposal)
		}
		if err != nil {
			return 0, err
		}
		var hasFinal bool
		if err := tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM research_reports WHERE institution_id=? AND proposal_id=? AND kind='final' AND is_active AND JSON_LENGTH(payload)>0)", a.tenant, propID).Scan(&hasFinal); err != nil {
			return 0, err
		}
		if !hasFinal {
			return 0, fmt.Errorf("%w: laporan akhir belum diisi sebelum penutupan proyek", invalidProposal)
		}
		var verifiedOutputs int
		if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM research_outputs WHERE institution_id=? AND proposal_id=? AND verified_status='verified'", a.tenant, propID).Scan(&verifiedOutputs); err != nil {
			return 0, err
		}
		if verifiedOutputs < 1 {
			return 0, fmt.Errorf("%w: minimal 1 capaian luaran harus diverifikasi LPPM sebelum penutupan proyek", invalidProposal)
		}
		var pendingFollowUps int
		if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM monitoring_reviews WHERE institution_id=? AND proposal_id=? AND follow_up_status='pending'", a.tenant, propID).Scan(&pendingFollowUps); err != nil {
			return 0, err
		}
		if pendingFollowUps > 0 {
			return 0, fmt.Errorf("%w: masih terdapat tindak lanjut monev yang belum diselesaikan", invalidProposal)
		}
		if _, err := tx.ExecContext(ctx, "UPDATE research_projects SET status='completed' WHERE id=?", projID); err != nil {
			return 0, err
		}
		return projID, nil
	})
}

