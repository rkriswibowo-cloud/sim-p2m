package iam

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"mime"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

type fundedReadyProposal struct {
	ProposalID     int64  `json:"proposalId"`
	Title          string `json:"title"`
	Owner          string `json:"owner"`
	Scheme         string `json:"scheme"`
	Period         string `json:"period"`
	ApprovedBudget string `json:"approvedBudget"`
}

type amendmentView struct {
	ID             int64     `json:"id"`
	Number         string    `json:"number"`
	Date           string    `json:"date"`
	PreviousBudget string    `json:"previousBudget"`
	NewBudget      string    `json:"newBudget"`
	Reason         string    `json:"reason"`
	CreatedAt      time.Time `json:"createdAt"`
}

type disbursementView struct {
	ID           int64  `json:"id"`
	ProjectID    int64  `json:"projectId"`
	TermName     string `json:"termName"`
	Amount       string `json:"amount"`
	Status       string `json:"status"`
	TransferDate string `json:"transferDate"`
	ReferenceNo  string `json:"referenceNo"`
	HasProof     bool   `json:"hasProof"`
	Note         string `json:"note"`
}

type projectView struct {
	ID               int64              `json:"id"`
	ProposalID       int64              `json:"proposalId"`
	Title            string             `json:"title"`
	Owner            string             `json:"owner"`
	OwnerID          int64              `json:"ownerId"`
	Scheme           string             `json:"scheme"`
	Period           string             `json:"period"`
	ContractNumber   string             `json:"contractNumber"`
	ContractDate     string             `json:"contractDate"`
	ApprovedBudget   string             `json:"approvedBudget"`
	TotalDisbursed   string             `json:"totalDisbursed"`
	Status           string             `json:"status"`
	ProgressUploaded bool               `json:"progressUploaded"`
	Amendments       []amendmentView    `json:"amendments"`
	Disbursements    []disbursementView `json:"disbursements"`
}

type externalFundingView struct {
	ID                 int64   `json:"id"`
	OwnerID            int64   `json:"ownerId"`
	Owner              string  `json:"owner"`
	Title              string  `json:"title"`
	FunderName         string  `json:"funderName"`
	SchemeName         string  `json:"schemeName"`
	FiscalYear         int     `json:"fiscalYear"`
	ProposedBudget     string  `json:"proposedBudget"`
	ApprovedBudget     *string `json:"approvedBudget"`
	ExternalContractNo string  `json:"externalContractNo"`
	Status             string  `json:"status"`
	VerificationNote   string  `json:"verificationNote"`
	HasProof           bool    `json:"hasProof"`
}

func readProofUpload(c *gin.Context, fieldName string) (string, []byte, error) {
	file, _, err := c.Request.FormFile(fieldName)
	if err != nil {
		return "", nil, err
	}
	defer file.Close()
	content, err := io.ReadAll(io.LimitReader(file, (5<<20)+1))
	if err != nil || len(content) > 5<<20 {
		return "", nil, errors.New("ukuran berkas maksimal 5 MB")
	}
	detected := http.DetectContentType(content)
	if detected == "application/pdf" || strings.HasPrefix(string(content), "%PDF-") {
		return "application/pdf", content, nil
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(content))
	if err != nil || (format != "png" && format != "jpeg") || cfg.Width < 1 || cfg.Height < 1 {
		return "", nil, errors.New("berkas bukti harus berformat PDF, JPG, atau PNG")
	}
	return "image/" + format, content, nil
}

func (s service) canManageFunding(ctx context.Context, a actor) (bool, bool) {
	if a.system() {
		return true, true
	}
	if a.mode != "production" {
		return a.mode == "trial-admin", a.mode == "trial-admin"
	}
	var role string
	canVerify := s.roleForPermission(ctx, a, researchVerify, &role) == nil
	canDecide := s.roleForPermission(ctx, a, researchDecide, &role) == nil
	return canVerify, canDecide
}

func (s service) listProjects(c *gin.Context, a actor) {
	ctx := c.Request.Context()
	canVerify, canDecide := s.canManageFunding(ctx, a)
	isManager := canVerify || canDecide

	filterOwner := ""
	args := []any{a.tenant}
	if !isManager {
		filterOwner = " AND p.owner_user_id=?"
		args = append(args, a.ID)
	}

	rows, err := s.db.QueryContext(ctx, `SELECT pr.id, pr.proposal_id, p.title, u.display_name, p.owner_user_id, v.scheme_name, g.name,
 pr.contract_number, DATE_FORMAT(pr.contract_date,'%Y-%m-%d'), CAST(pr.approved_budget_idr AS CHAR), pr.status,
 EXISTS (SELECT 1 FROM progress_report_uploads f WHERE f.proposal_id=p.id)
 FROM research_projects pr
 JOIN research_proposals p ON p.institution_id=pr.institution_id AND p.id=pr.proposal_id
 JOIN users u ON u.id=p.owner_user_id
 JOIN grant_scheme_versions v ON v.institution_id=p.institution_id AND v.id=p.grant_version_id
 JOIN grant_periods g ON g.institution_id=v.institution_id AND g.id=v.period_id
 WHERE pr.institution_id=?`+filterOwner+` ORDER BY pr.id DESC LIMIT 200`, args...)
	if err != nil {
		c.Status(503)
		return
	}
	defer rows.Close()

	projects := []projectView{}
	idxByID := map[int64]int{}
	for rows.Next() {
		var pv projectView
		if err := rows.Scan(&pv.ID, &pv.ProposalID, &pv.Title, &pv.Owner, &pv.OwnerID, &pv.Scheme, &pv.Period,
			&pv.ContractNumber, &pv.ContractDate, &pv.ApprovedBudget, &pv.Status, &pv.ProgressUploaded); err != nil {
			c.Status(503)
			return
		}
		pv.Amendments = []amendmentView{}
		pv.Disbursements = []disbursementView{}
		pv.TotalDisbursed = "0"
		idxByID[pv.ID] = len(projects)
		projects = append(projects, pv)
	}

	// Amendments
	aRows, err := s.db.QueryContext(ctx, `SELECT id, project_id, amendment_number, DATE_FORMAT(amendment_date,'%Y-%m-%d'),
 CAST(previous_budget_idr AS CHAR), CAST(new_budget_idr AS CHAR), reason, created_at
 FROM project_amendments WHERE institution_id=? ORDER BY id DESC`, a.tenant)
	if err == nil {
		defer aRows.Close()
		for aRows.Next() {
			var pid int64
			var am amendmentView
			if aRows.Scan(&am.ID, &pid, &am.Number, &am.Date, &am.PreviousBudget, &am.NewBudget, &am.Reason, &am.CreatedAt) == nil {
				if idx, ok := idxByID[pid]; ok {
					projects[idx].Amendments = append(projects[idx].Amendments, am)
				}
			}
		}
	}

	// Disbursements
	disbTotals := map[int64]uint64{}
	dRows, err := s.db.QueryContext(ctx, `SELECT id, project_id, term_name, CAST(amount_idr AS CHAR), status,
 COALESCE(DATE_FORMAT(transfer_date,'%Y-%m-%d'),''), reference_no, LENGTH(COALESCE(proof_content,''))>0, note
 FROM project_disbursements WHERE institution_id=? ORDER BY id`, a.tenant)
	if err == nil {
		defer dRows.Close()
		for dRows.Next() {
			var dv disbursementView
			if dRows.Scan(&dv.ID, &dv.ProjectID, &dv.TermName, &dv.Amount, &dv.Status, &dv.TransferDate, &dv.ReferenceNo, &dv.HasProof, &dv.Note) == nil {
				if idx, ok := idxByID[dv.ProjectID]; ok {
					projects[idx].Disbursements = append(projects[idx].Disbursements, dv)
					if dv.Status == "transferred" {
						if v, err := strconv.ParseUint(dv.Amount, 10, 64); err == nil {
							disbTotals[dv.ProjectID] += v
						}
					}
				}
			}
		}
	}
	for i := range projects {
		projects[i].TotalDisbursed = strconv.FormatUint(disbTotals[projects[i].ID], 10)
	}

	ready := []fundedReadyProposal{}
	if canDecide {
		rRows, err := s.db.QueryContext(ctx, `SELECT p.id, p.title, u.display_name, v.scheme_name, g.name,
 CAST(COALESCE(p.approved_budget_idr, p.budget_idr) AS CHAR)
 FROM research_proposals p
 JOIN users u ON u.id=p.owner_user_id
 JOIN grant_scheme_versions v ON v.institution_id=p.institution_id AND v.id=p.grant_version_id
 JOIN grant_periods g ON g.institution_id=v.institution_id AND g.id=v.period_id
 LEFT JOIN research_projects pr ON pr.institution_id=p.institution_id AND pr.proposal_id=p.id
 WHERE p.institution_id=? AND p.funding_decision='funded' AND pr.id IS NULL
 ORDER BY p.id DESC`, a.tenant)
		if err == nil {
			defer rRows.Close()
			for rRows.Next() {
				var fr fundedReadyProposal
				if rRows.Scan(&fr.ProposalID, &fr.Title, &fr.Owner, &fr.Scheme, &fr.Period, &fr.ApprovedBudget) == nil {
					ready = append(ready, fr)
				}
			}
		}
	}

	c.JSON(200, gin.H{"projects": projects, "readyProposals": ready, "canDecide": canDecide, "canVerify": canVerify})
}

func (s service) convertProposalToProject(c *gin.Context, a actor) {
	propID := target(c)
	var input struct {
		ContractNumber string `json:"contractNumber"`
		ContractDate   string `json:"contractDate"`
	}
	if propID < 1 || c.ShouldBindJSON(&input) != nil {
		c.Status(400)
		return
	}
	num := strings.TrimSpace(input.ContractNumber)
	dt := strings.TrimSpace(input.ContractDate)
	if num == "" || dt == "" {
		c.JSON(400, gin.H{"error": "validation", "message": "Nomor kontrak dan tanggal kontrak wajib diisi."})
		return
	}
	if _, err := time.Parse("2006-01-02", dt); err != nil {
		c.JSON(400, gin.H{"error": "validation", "message": "Format tanggal kontrak harus YYYY-MM-DD."})
		return
	}

	s.change(c, a, "research.project.convert", func(ctx context.Context, tx *sql.Tx) (int64, error) {
		// Idempotent check
		var existingID int64
		err := tx.QueryRowContext(ctx, "SELECT id FROM research_projects WHERE institution_id=? AND proposal_id=? FOR UPDATE", a.tenant, propID).Scan(&existingID)
		if err == nil {
			return existingID, nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return 0, err
		}

		var decision string
		var approved uint64
		err = tx.QueryRowContext(ctx, "SELECT funding_decision, COALESCE(approved_budget_idr, budget_idr) FROM research_proposals WHERE institution_id=? AND id=? FOR UPDATE",
			a.tenant, propID).Scan(&decision, &approved)
		if err != nil {
			return 0, err
		}
		if decision != "funded" {
			return 0, fmt.Errorf("%w: hanya usulan berstatus Didanai yang dapat dikonversi menjadi kontrak proyek", invalidProposal)
		}
		res, err := tx.ExecContext(ctx, `INSERT INTO research_projects (institution_id, proposal_id, contract_number, contract_date, approved_budget_idr, created_by)
 VALUES (?,?,?,?,?,?)`, a.tenant, propID, num, dt, approved, a.ID)
		if err != nil {
			return 0, err
		}
		return res.LastInsertId()
	})
}

func (s service) amendProjectContract(c *gin.Context, a actor) {
	projID := target(c)
	var input struct {
		Number    string `json:"number"`
		Date      string `json:"date"`
		NewBudget string `json:"newBudget"`
		Reason    string `json:"reason"`
	}
	if projID < 1 || c.ShouldBindJSON(&input) != nil {
		c.Status(400)
		return
	}
	num := strings.TrimSpace(input.Number)
	dt := strings.TrimSpace(input.Date)
	reason := strings.TrimSpace(input.Reason)
	newBud, err := strconv.ParseUint(strings.TrimSpace(input.NewBudget), 10, 64)
	if num == "" || dt == "" || reason == "" || err != nil || newBud == 0 {
		c.JSON(400, gin.H{"error": "validation", "message": "Lengkapi nomor adendum, tanggal, nilai anggaran baru, dan alasan."})
		return
	}
	if _, err := time.Parse("2006-01-02", dt); err != nil {
		c.JSON(400, gin.H{"error": "validation", "message": "Format tanggal adendum harus YYYY-MM-DD."})
		return
	}

	s.change(c, a, "research.project.amend", func(ctx context.Context, tx *sql.Tx) (int64, error) {
		var prevBudget, maxBudget uint64
		err := tx.QueryRowContext(ctx, `SELECT pr.approved_budget_idr, v.budget_idr
 FROM research_projects pr
 JOIN research_proposals p ON p.institution_id=pr.institution_id AND p.id=pr.proposal_id
 JOIN grant_scheme_versions v ON v.institution_id=p.institution_id AND v.id=p.grant_version_id
 WHERE pr.institution_id=? AND pr.id=? FOR UPDATE`, a.tenant, projID).Scan(&prevBudget, &maxBudget)
		if err != nil {
			return 0, err
		}
		if newBud > maxBudget {
			return 0, fmt.Errorf("%w: nilai anggaran amandemen melampaui pagu maksimal skema", invalidProposal)
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO project_amendments (institution_id, project_id, amendment_number, amendment_date, previous_budget_idr, new_budget_idr, reason, created_by)
 VALUES (?,?,?,?,?,?,?,?)`, a.tenant, projID, num, dt, prevBudget, newBud, reason, a.ID); err != nil {
			return 0, err
		}
		if _, err := tx.ExecContext(ctx, "UPDATE research_projects SET approved_budget_idr=? WHERE id=?", newBud, projID); err != nil {
			return 0, err
		}
		return projID, nil
	})
}

func (s service) saveDisbursement(c *gin.Context, a actor) {
	projID := target(c)
	var input struct {
		TermName string `json:"termName"`
		Amount   string `json:"amount"`
		Note     string `json:"note"`
	}
	if projID < 1 || c.ShouldBindJSON(&input) != nil {
		c.Status(400)
		return
	}
	term := strings.TrimSpace(input.TermName)
	amt, err := strconv.ParseUint(strings.TrimSpace(input.Amount), 10, 64)
	if term == "" || err != nil || amt == 0 {
		c.JSON(400, gin.H{"error": "validation", "message": "Nama termin dan nominal rupiah positif wajib diisi."})
		return
	}
	note := strings.TrimSpace(input.Note)

	s.change(c, a, "research.disbursement.create", func(ctx context.Context, tx *sql.Tx) (int64, error) {
		var approved, existingSum uint64
		if err := tx.QueryRowContext(ctx, "SELECT approved_budget_idr FROM research_projects WHERE institution_id=? AND id=? FOR UPDATE", a.tenant, projID).Scan(&approved); err != nil {
			return 0, err
		}
		if err := tx.QueryRowContext(ctx, "SELECT COALESCE(SUM(amount_idr),0) FROM project_disbursements WHERE institution_id=? AND project_id=?", a.tenant, projID).Scan(&existingSum); err != nil {
			return 0, err
		}
		if existingSum+amt > approved {
			return 0, fmt.Errorf("%w: total termin pencairan melebihi anggaran kontrak disetujui", invalidProposal)
		}
		res, err := tx.ExecContext(ctx, `INSERT INTO project_disbursements (institution_id, project_id, term_name, amount_idr, note, updated_by)
 VALUES (?,?,?,?,?,?)`, a.tenant, projID, term, amt, note, a.ID)
		if err != nil {
			return 0, err
		}
		return res.LastInsertId()
	})
}

func (s service) markDisbursementTransferred(c *gin.Context, a actor) {
	disbID := target(c)
	if disbID < 1 {
		c.Status(400)
		return
	}
	transferDate := strings.TrimSpace(c.Request.FormValue("transferDate"))
	refNo := strings.TrimSpace(c.Request.FormValue("referenceNo"))
	note := strings.TrimSpace(c.Request.FormValue("note"))
	if transferDate == "" || refNo == "" {
		c.JSON(400, gin.H{"error": "validation", "message": "Tanggal transfer dan nomor referensi wajib diisi."})
		return
	}
	if _, err := time.Parse("2006-01-02", transferDate); err != nil {
		c.JSON(400, gin.H{"error": "validation", "message": "Format tanggal transfer harus YYYY-MM-DD."})
		return
	}

	var proofMime string
	var proofContent []byte
	if _, _, err := c.Request.FormFile("proof"); err == nil {
		m, b, err := readProofUpload(c, "proof")
		if err != nil {
			c.JSON(400, gin.H{"error": "invalid_file", "message": err.Error()})
			return
		}
		proofMime, proofContent = m, b
	}

	s.change(c, a, "research.disbursement.transfer", func(ctx context.Context, tx *sql.Tx) (int64, error) {
		var curStatus string
		var project, proposal int64
		var amount, approved, transferred uint64
		if err := tx.QueryRowContext(ctx, "SELECT status,project_id,amount_idr FROM project_disbursements WHERE institution_id=? AND id=? FOR UPDATE", a.tenant, disbID).Scan(&curStatus, &project, &amount); err != nil {
			return 0, err
		}
		if curStatus != "transferred" {
			if err := tx.QueryRowContext(ctx, "SELECT proposal_id,approved_budget_idr FROM research_projects WHERE institution_id=? AND id=? FOR UPDATE", a.tenant, project).Scan(&proposal, &approved); err != nil {
				return 0, err
			}
			if err := tx.QueryRowContext(ctx, "SELECT COALESCE(SUM(amount_idr),0) FROM project_disbursements WHERE institution_id=? AND project_id=? AND status='transferred'", a.tenant, project).Scan(&transferred); err != nil {
				return 0, err
			}
			if amount > approved || transferred > approved-amount {
				return 0, fmt.Errorf("%w: total pencairan melebihi anggaran kontrak", invalidProposal)
			}
			firstLimit := approved/4*3 + (approved%4)*3/4
			if transferred+amount > firstLimit {
				var uploaded bool
				if err := tx.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM progress_report_uploads WHERE proposal_id=?)", proposal).Scan(&uploaded); err != nil {
					return 0, err
				}
				if !uploaded {
					return 0, fmt.Errorf("%w: pencairan di atas 75%% terkunci sampai PDF Laporan Kemajuan diunggah", invalidProposal)
				}
			}
		}
		if proofMime != "" {
			_, err := tx.ExecContext(ctx, `UPDATE project_disbursements SET status='transferred', transfer_date=?, reference_no=?, proof_mime=?, proof_content=?, note=?, updated_by=? WHERE id=?`,
				transferDate, refNo, proofMime, proofContent, note, a.ID, disbID)
			return disbID, err
		}
		_, err := tx.ExecContext(ctx, `UPDATE project_disbursements SET status='transferred', transfer_date=?, reference_no=?, note=?, updated_by=? WHERE id=?`,
			transferDate, refNo, note, a.ID, disbID)
		return disbID, err
	})
}

func (s service) downloadDisbursementProof(c *gin.Context, a actor) {
	disbID := target(c)
	if disbID < 1 {
		c.Status(400)
		return
	}
	ctx := c.Request.Context()
	canVerify, canDecide := s.canManageFunding(ctx, a)

	var ownerID int64
	var mimeType string
	var content []byte
	err := s.db.QueryRowContext(ctx, `SELECT p.owner_user_id, d.proof_mime, d.proof_content
 FROM project_disbursements d
 JOIN research_projects pr ON pr.institution_id=d.institution_id AND pr.id=d.project_id
 JOIN research_proposals p ON p.institution_id=pr.institution_id AND p.id=pr.proposal_id
 WHERE d.institution_id=? AND d.id=?`, a.tenant, disbID).Scan(&ownerID, &mimeType, &content)
	if errors.Is(err, sql.ErrNoRows) || len(content) == 0 {
		c.Status(404)
		return
	}
	if err != nil {
		c.Status(503)
		return
	}
	if !canVerify && !canDecide && ownerID != a.ID {
		c.Status(403)
		return
	}
	c.Header("X-Content-Type-Options", "nosniff")
	c.Data(200, mimeType, content)
}

func (s service) exportContractDocx(c *gin.Context, a actor) {
	projID := target(c)
	if projID < 1 {
		c.Status(400)
		return
	}
	ctx := c.Request.Context()
	canVerify, canDecide := s.canManageFunding(ctx, a)

	var ownerID int64
	var instName, title, ownerName, schemeName, contractNo, contractDate, approvedBudget string
	err := s.db.QueryRowContext(ctx, `SELECT p.owner_user_id, i.name, p.title, u.display_name, v.scheme_name,
 pr.contract_number, DATE_FORMAT(pr.contract_date,'%d-%m-%Y'), CAST(pr.approved_budget_idr AS CHAR)
 FROM research_projects pr
 JOIN institutions i ON i.id=pr.institution_id
 JOIN research_proposals p ON p.institution_id=pr.institution_id AND p.id=pr.proposal_id
 JOIN users u ON u.id=p.owner_user_id
 JOIN grant_scheme_versions v ON v.institution_id=p.institution_id AND v.id=p.grant_version_id
 WHERE pr.institution_id=? AND pr.id=?`, a.tenant, projID).Scan(&ownerID, &instName, &title, &ownerName, &schemeName, &contractNo, &contractDate, &approvedBudget)
	if errors.Is(err, sql.ErrNoRows) {
		c.Status(404)
		return
	}
	if err != nil {
		c.Status(503)
		return
	}
	if !canVerify && !canDecide && ownerID != a.ID {
		c.Status(403)
		return
	}

	var body strings.Builder
	body.WriteString(docxParagraph("SURAT PERJANJIAN PELAKSANAAN PENELITIAN", true, 26, "center", 80))
	body.WriteString(docxParagraph("Nomor Kontrak: "+contractNo, true, 22, "center", 240))
	body.WriteString(docxParagraph("Pada tanggal "+contractDate+", "+instName+" memberikan tugas pelaksanaan penelitian internal kepada:", false, 22, "both", 140))

	rows := [][]string{
		{"Ketua Peneliti", ownerName},
		{"Judul Penelitian", title},
		{"Skema Penelitian", schemeName},
		{"Nilai Kontrak Disetujui", formatRupiahID(approvedBudget)},
	}
	body.WriteString(docxTable([]string{"Komponen Kontrak", "Keterangan"}, rows, []int{3000, 6000}))
	body.WriteString(docxParagraph("Ketua Peneliti berkewajiban melaksanakan penelitian sesuai proposal yang disetujui, mengisi catatan harian, serta mengunggah laporan kemajuan dan laporan akhir sesuai jadwal yang ditetapkan.", false, 22, "both", 240))
	signRows := [][]string{
		{"PIHAK PERTAMA\nPejabat LPPM " + instName + "\n\n\n\n(........................................)",
			"PIHAK KEDUA\nKetua Peneliti,\n\n\n\n" + ownerName},
	}
	body.WriteString(docxTable([]string{"Pihak Pertama", "Pihak Kedua"}, signRows, []int{4500, 4500}))

	rawDocx, err := buildDocxBytes(body.String())
	if err != nil {
		c.Status(500)
		return
	}
	filename := safeDocxFilename("Kontrak_Penelitian", projID)
	c.Header("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
	c.Header("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": filename}))
	c.Header("Cache-Control", "private, no-store")
	c.Data(200, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", rawDocx)
}

func (s service) listExternalFundings(c *gin.Context, a actor) {
	ctx := c.Request.Context()
	canVerify, canDecide := s.canManageFunding(ctx, a)
	where := "e.institution_id=?"
	args := []any{a.tenant}
	if !canVerify && !canDecide {
		where += " AND e.owner_user_id=?"
		args = append(args, a.ID)
	}
	rows, err := s.db.QueryContext(ctx, `SELECT e.id, e.owner_user_id, u.display_name, e.title, e.funder_name, e.scheme_name,
 e.fiscal_year, CAST(e.proposed_budget_idr AS CHAR), CAST(e.approved_budget_idr AS CHAR),
 e.external_contract_no, e.status, e.verification_note, LENGTH(COALESCE(e.proof_content,''))>0
 FROM external_fundings e JOIN users u ON u.id=e.owner_user_id
 WHERE `+where+` ORDER BY e.id DESC LIMIT 200`, args...)
	if err != nil {
		c.Status(503)
		return
	}
	defer rows.Close()
	items := []externalFundingView{}
	for rows.Next() {
		var item externalFundingView
		var app sql.NullString
		if err := rows.Scan(&item.ID, &item.OwnerID, &item.Owner, &item.Title, &item.FunderName, &item.SchemeName,
			&item.FiscalYear, &item.ProposedBudget, &app, &item.ExternalContractNo, &item.Status, &item.VerificationNote, &item.HasProof); err != nil {
			c.Status(503)
			return
		}
		if app.Valid {
			v := app.String
			item.ApprovedBudget = &v
		}
		items = append(items, item)
	}
	c.JSON(200, gin.H{"items": items, "canVerify": canVerify})
}

func (s service) saveExternalFunding(c *gin.Context, a actor) {
	var input struct {
		ID                 int64  `json:"id"`
		Title              string `json:"title"`
		FunderName         string `json:"funderName"`
		SchemeName         string `json:"schemeName"`
		FiscalYear         int    `json:"fiscalYear"`
		ProposedBudget     string `json:"proposedBudget"`
		ApprovedBudget     string `json:"approvedBudget"`
		ExternalContractNo string `json:"externalContractNo"`
	}
	if c.ShouldBindJSON(&input) != nil {
		c.Status(400)
		return
	}
	title := strings.TrimSpace(input.Title)
	funder := strings.TrimSpace(input.FunderName)
	scheme := strings.TrimSpace(input.SchemeName)
	propBud, err := strconv.ParseUint(strings.TrimSpace(input.ProposedBudget), 10, 64)
	if title == "" || funder == "" || scheme == "" || input.FiscalYear < 2000 || input.FiscalYear > 2200 || err != nil || propBud == 0 {
		c.JSON(400, gin.H{"error": "validation", "message": "Lengkapi judul, penyandang dana, skema, tahun, dan nominal usulan."})
		return
	}
	var appBud *uint64
	if strings.TrimSpace(input.ApprovedBudget) != "" {
		v, err := strconv.ParseUint(strings.TrimSpace(input.ApprovedBudget), 10, 64)
		if err != nil {
			c.JSON(400, gin.H{"error": "validation", "message": "Anggaran disetujui harus berupa angka bulat."})
			return
		}
		appBud = &v
	}

	s.change(c, a, "research.external.save", func(ctx context.Context, tx *sql.Tx) (int64, error) {
		if input.ID > 0 {
			var owner int64
			if err := tx.QueryRowContext(ctx, "SELECT owner_user_id FROM external_fundings WHERE institution_id=? AND id=? FOR UPDATE", a.tenant, input.ID).Scan(&owner); err != nil {
				return 0, err
			}
			if owner != a.ID {
				return 0, sql.ErrNoRows
			}
			_, err := tx.ExecContext(ctx, `UPDATE external_fundings SET title=?, funder_name=?, scheme_name=?, fiscal_year=?, proposed_budget_idr=?, approved_budget_idr=?, external_contract_no=? WHERE id=?`,
				title, funder, scheme, input.FiscalYear, propBud, appBud, strings.TrimSpace(input.ExternalContractNo), input.ID)
			return input.ID, err
		}
		res, err := tx.ExecContext(ctx, `INSERT INTO external_fundings (institution_id, owner_user_id, title, funder_name, scheme_name, fiscal_year, proposed_budget_idr, approved_budget_idr, external_contract_no)
 VALUES (?,?,?,?,?,?,?,?,?)`, a.tenant, a.ID, title, funder, scheme, input.FiscalYear, propBud, appBud, strings.TrimSpace(input.ExternalContractNo))
		if err != nil {
			return 0, err
		}
		return res.LastInsertId()
	})
}

func (s service) uploadExternalProof(c *gin.Context, a actor) {
	extID := target(c)
	if extID < 1 {
		c.Status(400)
		return
	}
	mimeType, content, err := readProofUpload(c, "proof")
	if err != nil {
		c.JSON(400, gin.H{"error": "invalid_file", "message": err.Error()})
		return
	}
	s.change(c, a, "research.external.proof", func(ctx context.Context, tx *sql.Tx) (int64, error) {
		var owner int64
		if err := tx.QueryRowContext(ctx, "SELECT owner_user_id FROM external_fundings WHERE institution_id=? AND id=? FOR UPDATE", a.tenant, extID).Scan(&owner); err != nil {
			return 0, err
		}
		if owner != a.ID {
			return 0, sql.ErrNoRows
		}
		_, err := tx.ExecContext(ctx, "UPDATE external_fundings SET proof_mime=?, proof_content=? WHERE id=?", mimeType, content, extID)
		return extID, err
	})
}

func (s service) downloadExternalProof(c *gin.Context, a actor) {
	extID := target(c)
	if extID < 1 {
		c.Status(400)
		return
	}
	ctx := c.Request.Context()
	canVerify, canDecide := s.canManageFunding(ctx, a)
	var ownerID int64
	var mimeType string
	var content []byte
	err := s.db.QueryRowContext(ctx, "SELECT owner_user_id, proof_mime, proof_content FROM external_fundings WHERE institution_id=? AND id=?", a.tenant, extID).Scan(&ownerID, &mimeType, &content)
	if errors.Is(err, sql.ErrNoRows) || len(content) == 0 {
		c.Status(404)
		return
	}
	if err != nil {
		c.Status(503)
		return
	}
	if !canVerify && !canDecide && ownerID != a.ID {
		c.Status(403)
		return
	}
	c.Header("X-Content-Type-Options", "nosniff")
	c.Data(200, mimeType, content)
}

func (s service) verifyExternalFunding(c *gin.Context, a actor) {
	extID := target(c)
	var input struct {
		Status string `json:"status"`
		Note   string `json:"note"`
	}
	if extID < 1 || c.ShouldBindJSON(&input) != nil {
		c.Status(400)
		return
	}
	st := strings.TrimSpace(input.Status)
	if st != "verified" && st != "funded" && st != "not_funded" && st != "rejected" {
		c.Status(400)
		return
	}
	s.change(c, a, "research.external.verify", func(ctx context.Context, tx *sql.Tx) (int64, error) {
		res, err := tx.ExecContext(ctx, "UPDATE external_fundings SET status=?, verification_note=? WHERE institution_id=? AND id=?",
			st, strings.TrimSpace(input.Note), a.tenant, extID)
		if err != nil {
			return 0, err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return 0, sql.ErrNoRows
		}
		return extID, nil
	})
}
