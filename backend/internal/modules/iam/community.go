package iam

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
)

const communityDraft = "community.draft"

type communityData struct {
	Partner  string `json:"partner"`
	Location string `json:"location"`
	Need     string `json:"need"`
	Plan     string `json:"plan"`
	Outcome  string `json:"outcome"`
	Budget   string `json:"budget"`
}

func (s service) listCommunity(c *gin.Context, a actor) {
	rows, err := s.db.QueryContext(c.Request.Context(), `SELECT id,title,payload,revision,updated_at FROM community_proposals
 WHERE institution_id=? AND owner_user_id=? AND is_active ORDER BY updated_at DESC,id DESC`, a.tenant, a.ID)
	if err != nil {
		c.Status(503)
		return
	}
	defer rows.Close()
	type draft struct {
		ID        int64         `json:"id"`
		Title     string        `json:"title"`
		Data      communityData `json:"data"`
		Revision  int           `json:"revision"`
		UpdatedAt time.Time     `json:"updatedAt"`
	}
	items := []draft{}
	for rows.Next() {
		var item draft
		var raw []byte
		if rows.Scan(&item.ID, &item.Title, &raw, &item.Revision, &item.UpdatedAt) != nil || json.Unmarshal(raw, &item.Data) != nil {
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

func (s service) saveCommunity(c *gin.Context, a actor) {
	var input struct {
		Title    string        `json:"title"`
		Data     communityData `json:"data"`
		Revision int           `json:"revision"`
	}
	id := target(c)
	creating := c.Request.Method == "POST"
	if c.ShouldBindJSON(&input) != nil || (!creating && (id < 1 || input.Revision < 1)) {
		c.Status(400)
		return
	}
	input.Title = strings.TrimSpace(input.Title)
	data := &input.Data
	data.Budget = strings.TrimSpace(data.Budget)
	if input.Title == "" || utf8.RuneCountInString(input.Title) > 300 ||
		utf8.RuneCountInString(data.Partner) > 200 || utf8.RuneCountInString(data.Location) > 300 ||
		utf8.RuneCountInString(data.Need) > 3000 || utf8.RuneCountInString(data.Plan) > 3000 || utf8.RuneCountInString(data.Outcome) > 3000 ||
		(data.Budget != "" && (len(data.Budget) > 15 || strings.Trim(data.Budget, "0123456789") != "")) {
		c.JSON(400, gin.H{"error": "validation", "message": "Periksa judul, panjang isian, dan estimasi anggaran dalam rupiah."})
		return
	}
	raw, err := json.Marshal(input.Data)
	if err != nil {
		c.Status(503)
		return
	}
	s.change(c, a, "community.draft.save", func(ctx context.Context, tx *sql.Tx) (int64, error) {
		if creating {
			result, err := tx.ExecContext(ctx, "INSERT INTO community_proposals (institution_id,owner_user_id,title,payload) VALUES (?,?,?,?)", a.tenant, a.ID, input.Title, string(raw))
			if err != nil {
				return 0, err
			}
			return result.LastInsertId()
		}
		if err := lockCommunity(ctx, tx, a, id, input.Revision); err != nil {
			return 0, err
		}
		_, err := tx.ExecContext(ctx, "UPDATE community_proposals SET title=?,payload=?,revision=revision+1 WHERE id=?", input.Title, string(raw), id)
		return id, err
	})
}

func lockCommunity(ctx context.Context, tx *sql.Tx, a actor, id int64, revision int) error {
	var current int
	if err := tx.QueryRowContext(ctx, `SELECT revision FROM community_proposals
 WHERE institution_id=? AND owner_user_id=? AND id=? AND is_active FOR UPDATE`, a.tenant, a.ID, id).Scan(&current); err != nil {
		return err
	}
	if current != revision {
		return staleProposal
	}
	return nil
}

func (s service) archiveCommunity(c *gin.Context, a actor) {
	id := target(c)
	var input struct{ Revision int }
	if c.ShouldBindJSON(&input) != nil || id < 1 || input.Revision < 1 {
		c.Status(400)
		return
	}
	s.change(c, a, "community.draft.archive", func(ctx context.Context, tx *sql.Tx) (int64, error) {
		if err := lockCommunity(ctx, tx, a, id, input.Revision); err != nil {
			return 0, err
		}
		_, err := tx.ExecContext(ctx, "UPDATE community_proposals SET is_active=FALSE,revision=revision+1 WHERE id=?", id)
		return id, err
	})
}
