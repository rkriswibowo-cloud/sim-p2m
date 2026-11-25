package iam

import (
	"context"
	"database/sql"
	"errors"

	"github.com/gin-gonic/gin"
)

func draftRevision(c *gin.Context) (int64, int, bool) {
	var input struct{ Revision int }
	id := target(c)
	if id < 1 || c.ShouldBindJSON(&input) != nil || input.Revision < 1 {
		c.Status(400)
		return 0, 0, false
	}
	return id, input.Revision, true
}

func (s service) requestVerification(c *gin.Context, a actor) {
	id, revision, ok := draftRevision(c)
	if !ok {
		return
	}
	s.change(c, a, "research.verification.request", func(ctx context.Context, tx *sql.Tx) (int64, error) {
		version, err := lockDraft(ctx, tx, a, id, revision)
		if err != nil {
			return 0, err
		}
		var required bool
		var manual string
		if err := tx.QueryRowContext(ctx, "SELECT active_lecturer,manual_requirements FROM grant_scheme_versions WHERE institution_id=? AND id=?", a.tenant, version).Scan(&required, &manual); err != nil {
			return 0, err
		}
		if !required && manual == "" {
			return 0, invalid
		}
		if _, err := tx.ExecContext(ctx, "UPDATE research_proposals SET verification_requested=TRUE WHERE id=? AND (verified_revision IS NULL OR verified_revision<>revision)", id); err != nil {
			return 0, err
		}
		return id, nil
	})
}

type verificationRequest struct {
	ID             int64  `json:"id"`
	Revision       int    `json:"revision"`
	Title          string `json:"title"`
	Owner          string `json:"owner"`
	Email          string `json:"email"`
	Scheme         string `json:"scheme"`
	Requirement    string `json:"requirement"`
	ActiveLecturer bool   `json:"activeLecturer"`
	Own            bool   `json:"own"`
}

func (s service) verificationQueue(c *gin.Context, a actor) {
	rows, err := s.db.QueryContext(c.Request.Context(), `SELECT p.id,p.revision,p.title,u.display_name,u.email,v.scheme_name,v.manual_requirements,v.active_lecturer,p.owner_user_id=?
 FROM research_proposals p JOIN users u ON u.id=p.owner_user_id
 JOIN grant_scheme_versions v ON v.id=p.grant_version_id
 WHERE p.institution_id=? AND p.status='draft' AND p.verification_requested ORDER BY p.updated_at LIMIT 100`, a.ID, a.tenant)
	if err != nil {
		c.Status(503)
		return
	}
	defer rows.Close()
	result := []verificationRequest{}
	for rows.Next() {
		var item verificationRequest
		if err := rows.Scan(&item.ID, &item.Revision, &item.Title, &item.Owner, &item.Email, &item.Scheme, &item.Requirement, &item.ActiveLecturer, &item.Own); err != nil {
			c.Status(503)
			return
		}
		result = append(result, item)
	}
	if rows.Err() != nil {
		c.Status(503)
		return
	}
	c.JSON(200, result)
}

func (s service) verifyProposal(c *gin.Context, a actor) {
	id, revision, ok := draftRevision(c)
	if !ok {
		return
	}
	s.change(c, a, "research.verification.confirm", func(ctx context.Context, tx *sql.Tx) (int64, error) {
		var owner int64
		var found int
		var status string
		var requested bool
		err := tx.QueryRowContext(ctx, "SELECT owner_user_id,revision,status,verification_requested FROM research_proposals WHERE institution_id=? AND id=? FOR UPDATE", a.tenant, id).Scan(&owner, &found, &status, &requested)
		if err != nil {
			return 0, err
		}
		if owner == a.ID && !s.trial {
			return 0, forbidden
		}
		if found != revision || status != "draft" || !requested {
			return 0, staleProposal
		}
		_, err = tx.ExecContext(ctx, "UPDATE research_proposals SET verified_revision=revision,verification_requested=FALSE WHERE id=?", id)
		return id, err
	})
}

func (s service) refreshProposalGrant(c *gin.Context, a actor) {
	id, revision, ok := draftRevision(c)
	if !ok {
		return
	}
	ctx := c.Request.Context()
	var period, scheme int64
	err := s.db.QueryRowContext(ctx, `SELECT v.period_id,v.scheme_id FROM research_proposals p JOIN grant_scheme_versions v ON v.id=p.grant_version_id
 WHERE p.institution_id=? AND p.owner_user_id=? AND p.id=?`, a.tenant, a.ID, id).Scan(&period, &scheme)
	if errors.Is(err, sql.ErrNoRows) {
		c.Status(404)
		return
	}
	if err != nil {
		c.Status(503)
		return
	}
	s.change(c, a, "research.draft.grant.refresh", func(ctx context.Context, tx *sql.Tx) (int64, error) {
		var open bool
		if err := tx.QueryRowContext(ctx, "SELECT opens_at<=UTC_TIMESTAMP() AND closes_at>UTC_TIMESTAMP() FROM grant_periods WHERE institution_id=? AND id=? FOR UPDATE", a.tenant, period).Scan(&open); err != nil {
			return 0, err
		}
		if !open {
			return 0, unavailableGrant
		}
		old, err := lockDraft(ctx, tx, a, id, revision)
		if err != nil {
			return 0, err
		}
		var latest int64
		if err := tx.QueryRowContext(ctx, "SELECT id FROM grant_scheme_versions WHERE institution_id=? AND period_id=? AND scheme_id=? ORDER BY version_no DESC LIMIT 1", a.tenant, period, scheme).Scan(&latest); err != nil {
			return 0, err
		}
		if latest == old {
			return id, nil
		}
		_, err = tx.ExecContext(ctx, "UPDATE research_proposals SET grant_version_id=?,revision=revision+1,verification_requested=FALSE WHERE id=?", latest, id)
		return id, err
	})
}
