package iam

import (
	"context"
	"database/sql"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
)

type journalEntry struct {
	ID       int64  `json:"id"`
	Date     string `json:"date"`
	Activity string `json:"activity"`
	Result   string `json:"result"`
	Obstacle string `json:"obstacle"`
	Revision int    `json:"revision"`
}

func (s service) listJournal(c *gin.Context, a actor) {
	rows, err := s.db.QueryContext(c.Request.Context(), `SELECT j.id, CAST(j.activity_date AS CHAR), j.activity,j.result,j.obstacle,j.revision
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
		if err := rows.Scan(&item.ID, &item.Date, &item.Activity, &item.Result, &item.Obstacle, &item.Revision); err != nil {
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
	var input journalEntry
	if proposalID < 1 || c.ShouldBindJSON(&input) != nil || (!create && (id < 1 || input.Revision < 1)) {
		c.Status(400)
		return
	}
	action := "research.journal.save"
	if remove {
		action = "research.journal.archive"
	} else {
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
		if err := tx.QueryRowContext(ctx, `SELECT id FROM research_proposals
 WHERE id=? AND institution_id=? AND owner_user_id=? AND status='submitted' FOR UPDATE`, proposalID, a.tenant, a.ID).Scan(&parent); err != nil {
			return 0, err
		}
		if create {
			result, err := tx.ExecContext(ctx, "INSERT INTO research_journal (proposal_id,activity_date,activity,result,obstacle) VALUES (?,?,?,?,?)",
				parent, input.Date, input.Activity, input.Result, input.Obstacle)
			if err != nil {
				return 0, err
			}
			return result.LastInsertId()
		}
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
		_, err := tx.ExecContext(ctx, "UPDATE research_journal SET activity_date=?,activity=?,result=?,obstacle=?,revision=revision+1 WHERE id=?",
			input.Date, input.Activity, input.Result, input.Obstacle, id)
		return id, err
	})
}
