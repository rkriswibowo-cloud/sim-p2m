package iam

import (
	"context"
	"database/sql"
	"fmt"
	"mime"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
)

type journalEntry struct {
	ID            int64  `json:"id"`
	Date          string `json:"date"`
	Activity      string `json:"activity"`
	Result        string `json:"result"`
	Obstacle      string `json:"obstacle"`
	Revision      int    `json:"revision"`
	Progress      *int   `json:"progress"`
	FileNumber    string `json:"fileNumber"`
	Category      string `json:"category"`
	Amount        string `json:"amount"`
	EvidenceCount int    `json:"evidenceCount"`
}

func (s service) journalOverview(c *gin.Context, a actor) {
	ctx := c.Request.Context()
	categories, err := s.grantChoices(ctx, a.tenant, "SELECT id,name FROM budget_categories WHERE institution_id=? AND is_active ORDER BY name")
	if err != nil {
		c.Status(503)
		return
	}
	rows, err := s.db.QueryContext(ctx, `SELECT p.id,p.title,v.scheme_name,g.project_year,CAST(COALESCE(pr.approved_budget_idr,p.approved_budget_idr) AS CHAR),g.allow_daily_journal,
 (SELECT COUNT(*) FROM research_journal j WHERE j.proposal_id=p.id AND j.is_active),
 (SELECT j.progress FROM research_journal j WHERE j.proposal_id=p.id AND j.is_active ORDER BY j.id DESC LIMIT 1)
 FROM research_proposals p JOIN grant_scheme_versions v ON v.institution_id=p.institution_id AND v.id=p.grant_version_id
 JOIN grant_periods g ON g.institution_id=v.institution_id AND g.id=v.period_id
 LEFT JOIN research_projects pr ON pr.institution_id=p.institution_id AND pr.proposal_id=p.id
 WHERE p.institution_id=? AND p.owner_user_id=? AND p.status='submitted' ORDER BY g.project_year DESC,p.id DESC`, a.tenant, a.ID)
	if err != nil {
		c.Status(503)
		return
	}
	defer rows.Close()
	type project struct {
		ID       int64   `json:"id"`
		Title    string  `json:"title"`
		Scheme   string  `json:"scheme"`
		Year     int     `json:"year"`
		Budget   *string `json:"budget"`
		Writable bool    `json:"writable"`
		Count    int     `json:"count"`
		Progress *int    `json:"progress"`
	}
	items := []project{}
	for rows.Next() {
		var item project
		if rows.Scan(&item.ID, &item.Title, &item.Scheme, &item.Year, &item.Budget, &item.Writable, &item.Count, &item.Progress) != nil {
			c.Status(503)
			return
		}
		items = append(items, item)
	}
	if rows.Err() != nil {
		c.Status(503)
		return
	}
	c.JSON(200, gin.H{"items": items, "categories": categories})
}

func (s service) downloadJournalEvidence(c *gin.Context, a actor) {
	entry, err := strconv.ParseInt(c.Param("entry"), 10, 64)
	position, posErr := strconv.Atoi(c.Param("position"))
	if err != nil || entry < 1 || posErr != nil || position < 1 || position > 3 {
		c.Status(400)
		return
	}
	var name, media string
	var body []byte
	err = s.db.QueryRowContext(c.Request.Context(), `SELECT e.filename,e.mime,e.content FROM research_journal_evidence e
 JOIN research_journal j ON j.id=e.journal_id JOIN research_proposals p ON p.id=j.proposal_id
 WHERE p.institution_id=? AND p.owner_user_id=? AND p.id=? AND p.status='submitted' AND j.id=? AND j.is_active
 ORDER BY e.id LIMIT 1 OFFSET ?`, a.tenant, a.ID, target(c), entry, position-1).Scan(&name, &media, &body)
	if err == sql.ErrNoRows {
		c.Status(404)
		return
	}
	if err != nil {
		c.Status(503)
		return
	}
	c.Header("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": name}))
	c.Header("X-Content-Type-Options", "nosniff")
	c.Data(200, media, body)
}

func (s service) listJournal(c *gin.Context, a actor) {
	rows, err := s.db.QueryContext(c.Request.Context(), `SELECT j.id, CAST(j.activity_date AS CHAR), j.activity,j.result,j.obstacle,j.revision,
 j.progress,j.file_number,j.cost_category,CAST(j.amount_idr AS CHAR),
 (SELECT COUNT(*) FROM research_journal_evidence e WHERE e.journal_id=j.id)
 FROM research_journal j JOIN research_proposals p ON p.id=j.proposal_id
 WHERE p.institution_id=? AND p.owner_user_id=? AND p.id=? AND p.status='submitted' AND j.is_active
 ORDER BY j.activity_date DESC,j.id DESC`, a.tenant, a.ID, target(c))
	if err != nil {
		c.Status(503)
		return
	}
	defer rows.Close()
	items := []journalEntry{}
	for rows.Next() {
		var item journalEntry
		if err := rows.Scan(&item.ID, &item.Date, &item.Activity, &item.Result, &item.Obstacle, &item.Revision, &item.Progress, &item.FileNumber, &item.Category, &item.Amount, &item.EvidenceCount); err != nil {
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

func (s service) changeJournal(c *gin.Context, a actor) {
	proposalID := target(c)
	id, _ := strconv.ParseInt(c.Param("entry"), 10, 64)
	create, remove := c.Request.Method == "POST", c.Request.Method == "DELETE"
	var input struct {
		journalEntry
		Files []struct {
			Name    string `json:"name"`
			Content []byte `json:"content"`
			media   string
		} `json:"files"`
	}
	var amount uint64
	if proposalID < 1 || c.ShouldBindJSON(&input) != nil || (!create && (id < 1 || input.Revision < 1)) {
		c.Status(400)
		return
	}
	action := "research.journal.save"
	if remove {
		action = "research.journal.archive"
	} else {
		if input.Amount != "" {
			var err error
			amount, err = strconv.ParseUint(input.Amount, 10, 64)
			if err != nil || len(input.Amount) > 15 {
				c.JSON(400, gin.H{"message": "Nominal harus berupa rupiah bulat."})
				return
			}
		}
		if (input.Progress != nil && (*input.Progress < 0 || *input.Progress > 100)) || utf8.RuneCountInString(input.FileNumber) > 100 || utf8.RuneCountInString(input.Category) > 200 ||
			(amount > 0 && input.Category == "") || len(input.Files) > 3 {
			c.JSON(400, gin.H{"message": "Periksa kelompok biaya, nomor berkas, capaian 0–100%, dan maksimal tiga bukti."})
			return
		}
		for i := range input.Files {
			file := &input.Files[i]
			file.media = http.DetectContentType(file.Content)
			if file.Name == "" || utf8.RuneCountInString(file.Name) > 200 || strings.ContainsAny(file.Name, "/\\\r\n\x00") || len(file.Content) > 2<<20 ||
				(file.media != "application/pdf" && file.media != "image/jpeg" && file.media != "image/png") {
				c.JSON(400, gin.H{"message": "Bukti harus berupa PDF, JPG, atau PNG, maksimal 2 MB per berkas."})
				return
			}
		}
		input.Activity = strings.TrimSpace(input.Activity)
		date, err := time.Parse(time.DateOnly, input.Date)
		if err != nil || date.Year() < 1000 || input.Activity == "" || utf8.RuneCountInString(input.Activity) > 2000 ||
			utf8.RuneCountInString(input.Result) > 4000 || utf8.RuneCountInString(input.Obstacle) > 2000 {
			c.JSON(400, gin.H{"message": "Isi tanggal dan uraian kegiatan, lalu periksa panjang isian."})
			return
		}
	}
	s.change(c, a, action, func(ctx context.Context, tx *sql.Tx) (int64, error) {
		var parent int64
		var allowJournal bool
		if err := tx.QueryRowContext(ctx, `SELECT p.id, g.allow_daily_journal
 FROM research_proposals p
 JOIN grant_scheme_versions v ON v.institution_id=p.institution_id AND v.id=p.grant_version_id
 JOIN grant_periods g ON g.institution_id=v.institution_id AND g.id=v.period_id
 WHERE p.id=? AND p.institution_id=? AND p.owner_user_id=? AND p.status='submitted' FOR UPDATE`, proposalID, a.tenant, a.ID).Scan(&parent, &allowJournal); err != nil {
			return 0, err
		}
		if !allowJournal {
			return 0, fmt.Errorf("%w: catatan harian belum diaktifkan oleh Admin LPPM/Superadmin untuk periode ini", invalidProposal)
		}
		if create {
			result, err := tx.ExecContext(ctx, "INSERT INTO research_journal (proposal_id,activity_date,activity,result,obstacle,progress,file_number,cost_category,amount_idr) VALUES (?,?,?,?,?,?,?,?,?)",
				parent, input.Date, input.Activity, input.Result, input.Obstacle, input.Progress, input.FileNumber, input.Category, amount)
			if err != nil {
				return 0, err
			}
			id, err = result.LastInsertId()
			if err != nil {
				return 0, err
			}
		} else {
			var revision int
			if err := tx.QueryRowContext(ctx, "SELECT revision FROM research_journal WHERE proposal_id=? AND id=? AND is_active FOR UPDATE", parent, id).Scan(&revision); err != nil {
				return 0, err
			}
			if revision != input.Revision {
				return 0, staleProposal
			}
			if remove {
				_, err := tx.ExecContext(ctx, "UPDATE research_journal SET is_active=FALSE,revision=revision+1 WHERE id=?", id)
				return id, err
			}
			if _, err := tx.ExecContext(ctx, "UPDATE research_journal SET activity_date=?,activity=?,result=?,obstacle=?,progress=?,file_number=?,cost_category=?,amount_idr=?,revision=revision+1 WHERE id=?",
				input.Date, input.Activity, input.Result, input.Obstacle, input.Progress, input.FileNumber, input.Category, amount, id); err != nil {
				return 0, err
			}
		}
		if len(input.Files) > 0 {
			var existing int
			if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM research_journal_evidence WHERE journal_id=?", id).Scan(&existing); err != nil {
				return 0, err
			}
			if existing+len(input.Files) > 3 {
				return 0, fmt.Errorf("%w: maksimal tiga berkas per catatan", invalidProposal)
			}
			for _, file := range input.Files {
				if _, err := tx.ExecContext(ctx, "INSERT INTO research_journal_evidence (journal_id,filename,mime,content) VALUES (?,?,?,?)", id, file.Name, file.media, file.Content); err != nil {
					return 0, err
				}
			}
		}
		return id, nil
	})
}
