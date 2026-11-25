package iam

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
)

const reportsDraft = "reports.draft"

var reportFields = map[string][]string{
	"progress": {"introduction", "method", "progress", "nextPlan", "budgetNotes", "references"},
	"final":    {"abstract", "keywords", "introduction", "literature", "method", "results", "conclusion", "references", "fundUse"},
}

func (s service) listReports(c *gin.Context, a actor) {
	rows, err := s.db.QueryContext(c.Request.Context(), `SELECT p.id,p.title,
 COALESCE(r.kind,''),COALESCE(r.revision,0),COALESCE(r.payload,'{}'),
 JSON_OBJECT('introduction',COALESCE(JSON_UNQUOTE(JSON_EXTRACT(p.payload,'$.introduction')),''),
 'literature',COALESCE(JSON_UNQUOTE(JSON_EXTRACT(p.payload,'$.literature')),''),
 'method',COALESCE(JSON_UNQUOTE(JSON_EXTRACT(p.payload,'$.method')),''),
 'references',COALESCE(JSON_UNQUOTE(JSON_EXTRACT(p.payload,'$.references')),''))
 FROM research_proposals p LEFT JOIN research_reports r ON r.institution_id=p.institution_id AND r.proposal_id=p.id AND r.is_active
 WHERE p.institution_id=? AND p.owner_user_id=? AND p.status='submitted' ORDER BY p.submitted_at DESC,p.id DESC,r.kind`, a.tenant, a.ID)
	if err != nil {
		c.Status(503)
		return
	}
	defer rows.Close()
	type reportRow struct {
		ProposalID int64           `json:"proposalId"`
		Title      string          `json:"title"`
		Kind       string          `json:"kind"`
		Revision   int             `json:"revision"`
		Data       json.RawMessage `json:"data"`
		Source     json.RawMessage `json:"source"`
	}
	items := []reportRow{}
	for rows.Next() {
		var item reportRow
		var data, source []byte
		if err := rows.Scan(&item.ProposalID, &item.Title, &item.Kind, &item.Revision, &data, &source); err != nil {
			c.Status(503)
			return
		}
		item.Data, item.Source = json.RawMessage(data), json.RawMessage(source)
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
		Revision int
		Data     map[string]string
	}
	proposalID, kind := target(c), c.Param("kind")
	fields, valid := reportFields[kind]
	removing := c.Request.Method == "DELETE"
	if !valid || proposalID < 1 || c.ShouldBindJSON(&input) != nil || input.Revision < 0 || (removing && input.Revision == 0) {
		c.Status(400)
		return
	}
	payload := map[string]string{}
	for _, key := range fields {
		value := strings.TrimSpace(input.Data[key])
		if utf8.RuneCountInString(value) > 16000 || (key == "introduction" && len(strings.Fields(value)) > 1000) {
			c.JSON(400, gin.H{"message": "Pendahuluan maksimal 1.000 kata dan setiap bagian maksimal 16.000 karakter."})
			return
		}
		payload[key] = value
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		c.Status(503)
		return
	}
	action := "reports.draft.save"
	if removing {
		action = "reports.draft.archive"
	}
	s.change(c, a, action, func(ctx context.Context, tx *sql.Tx) (int64, error) {
		var parent int64
		err := tx.QueryRowContext(ctx, `SELECT id FROM research_proposals
 WHERE institution_id=? AND owner_user_id=? AND id=? AND status='submitted' FOR UPDATE`, a.tenant, a.ID, proposalID).Scan(&parent)
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
