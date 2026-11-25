package iam

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

type memberConsent struct {
	LecturerID  int64      `json:"lecturerId"`
	Name        string     `json:"name"`
	Code        string     `json:"code"`
	Status      string     `json:"status"`
	Note        string     `json:"note"`
	RespondedAt *time.Time `json:"respondedAt"`
}

type invitationItem struct {
	ProposalID     int64      `json:"proposalId"`
	Title          string     `json:"title"`
	Scheme         string     `json:"scheme"`
	Period         string     `json:"period"`
	Owner          string     `json:"owner"`
	ProposalStatus string     `json:"proposalStatus"`
	Expertise      string     `json:"expertise"`
	Hours          int        `json:"hours"`
	Task           string     `json:"task"`
	Status         string     `json:"status"`
	Note           string     `json:"note"`
	RespondedAt    *time.Time `json:"respondedAt"`
}

func memberSnapshotHash(m memberInput) string {
	raw := fmt.Sprintf("%d|%s|%d|%s", m.ID, strings.TrimSpace(m.Expertise), m.Hours, strings.TrimSpace(m.Task))
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

func syncProposalConsents(ctx context.Context, tx *sql.Tx, tenant, proposalID int64, team []memberInput) error {
	desired := make(map[int64]string)
	for _, m := range team {
		if m.ID > 0 {
			desired[m.ID] = memberSnapshotHash(m)
		}
	}

	existing := make(map[int64]string)
	rows, err := tx.QueryContext(ctx, "SELECT lecturer_id, snapshot_hash FROM proposal_member_consents WHERE institution_id=? AND proposal_id=? FOR UPDATE", tenant, proposalID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var lid int64
		var hash string
		if err := rows.Scan(&lid, &hash); err != nil {
			rows.Close()
			return err
		}
		existing[lid] = hash
	}
	if err := rows.Close(); err != nil {
		return err
	}

	for lid := range existing {
		if _, keep := desired[lid]; !keep {
			if _, err := tx.ExecContext(ctx, "DELETE FROM proposal_member_consents WHERE institution_id=? AND proposal_id=? AND lecturer_id=?", tenant, proposalID, lid); err != nil {
				return err
			}
		}
	}

	for lid, hash := range desired {
		oldHash, exists := existing[lid]
		if !exists {
			if _, err := tx.ExecContext(ctx, `INSERT INTO proposal_member_consents (institution_id, proposal_id, lecturer_id, status, snapshot_hash)
 VALUES (?,?,?,'pending',?)`, tenant, proposalID, lid, hash); err != nil {
				return err
			}
		} else if oldHash != hash {
			if _, err := tx.ExecContext(ctx, `UPDATE proposal_member_consents SET status='pending', note='', responded_at=NULL, snapshot_hash=?
 WHERE institution_id=? AND proposal_id=? AND lecturer_id=?`, hash, tenant, proposalID, lid); err != nil {
				return err
			}
		}
	}
	return nil
}

func loadProposalConsents(ctx context.Context, db *sql.DB, tenant, proposalID int64) ([]memberConsent, error) {
	rows, err := db.QueryContext(ctx, `SELECT c.lecturer_id, l.name, l.code, c.status, c.note, c.responded_at
 FROM proposal_member_consents c
 JOIN lecturers l ON l.institution_id=c.institution_id AND l.id=c.lecturer_id
 WHERE c.institution_id=? AND c.proposal_id=?
 ORDER BY l.name`, tenant, proposalID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []memberConsent{}
	for rows.Next() {
		var item memberConsent
		var responded sql.NullTime
		if err := rows.Scan(&item.LecturerID, &item.Name, &item.Code, &item.Status, &item.Note, &responded); err != nil {
			return nil, err
		}
		if responded.Valid {
			t := responded.Time
			item.RespondedAt = &t
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func checkProposalConsentsApproved(ctx context.Context, tx *sql.Tx, tenant, proposalID int64) error {
	var pendingCount, rejectedCount int
	err := tx.QueryRowContext(ctx, `SELECT
 COALESCE(SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END), 0),
 COALESCE(SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END), 0)
 FROM proposal_member_consents WHERE institution_id=? AND proposal_id=?`, tenant, proposalID).Scan(&pendingCount, &rejectedCount)
	if err != nil {
		return err
	}
	if rejectedCount > 0 {
		return fmt.Errorf("%w: terdapat %d anggota dosen yang menolak keanggotaan; perbarui tim terlebih dahulu", invalidProposal, rejectedCount)
	}
	if pendingCount > 0 {
		return fmt.Errorf("%w: %d anggota dosen belum menyetujui keanggotaan melalui akun masing-masing", invalidProposal, pendingCount)
	}
	return nil
}

func (s service) listInvitations(c *gin.Context, a actor) {
	if strings.TrimSpace(a.Email) == "" {
		c.JSON(200, []invitationItem{})
		return
	}
	rows, err := s.db.QueryContext(c.Request.Context(), `SELECT p.id, p.title, v.scheme_name, g.name, u.display_name, p.status,
 p.payload, c.lecturer_id, c.status, c.note, c.responded_at
 FROM proposal_member_consents c
 JOIN lecturers l ON l.institution_id=c.institution_id AND l.id=c.lecturer_id
 JOIN research_proposals p ON p.institution_id=c.institution_id AND p.id=c.proposal_id
 JOIN grant_scheme_versions v ON v.institution_id=p.institution_id AND v.id=p.grant_version_id
 JOIN grant_periods g ON g.institution_id=v.institution_id AND g.id=v.period_id
 JOIN users u ON u.id=p.owner_user_id
 WHERE c.institution_id=? AND (l.user_id=? OR (l.user_id IS NULL AND l.email=?)) AND p.status<>'archived'
 ORDER BY (c.status='pending') DESC, p.updated_at DESC`, a.tenant, a.ID, a.Email)
	if err != nil {
		c.Status(503)
		return
	}
	defer rows.Close()
	items := []invitationItem{}
	for rows.Next() {
		var item invitationItem
		var payload []byte
		var lid int64
		var responded sql.NullTime
		if err := rows.Scan(&item.ProposalID, &item.Title, &item.Scheme, &item.Period, &item.Owner, &item.ProposalStatus, &payload, &lid, &item.Status, &item.Note, &responded); err != nil {
			c.Status(503)
			return
		}
		var data proposalData
		if json.Unmarshal(payload, &data) == nil {
			for _, m := range data.Team {
				if m.ID == lid {
					item.Expertise = m.Expertise
					item.Hours = m.Hours
					item.Task = m.Task
					break
				}
			}
		}
		if responded.Valid {
			t := responded.Time
			item.RespondedAt = &t
		}
		items = append(items, item)
	}
	if rows.Err() != nil {
		c.Status(503)
		return
	}
	c.JSON(200, items)
}

func (s service) respondConsent(c *gin.Context, a actor) {
	id := target(c)
	var input struct {
		Status string `json:"status"`
		Note   string `json:"note"`
	}
	if id < 1 || c.ShouldBindJSON(&input) != nil {
		c.Status(400)
		return
	}
	status := strings.TrimSpace(input.Status)
	if status != "approved" && status != "rejected" {
		c.Status(400)
		return
	}
	note := strings.TrimSpace(input.Note)
	if len(note) > 500 {
		note = note[:500]
	}
	s.change(c, a, "research.team.consent", func(ctx context.Context, tx *sql.Tx) (int64, error) {
		var propStatus string
		err := tx.QueryRowContext(ctx, "SELECT status FROM research_proposals WHERE institution_id=? AND id=? FOR UPDATE", a.tenant, id).Scan(&propStatus)
		if errors.Is(err, sql.ErrNoRows) {
			return 0, sql.ErrNoRows
		}
		if err != nil {
			return 0, err
		}
		if propStatus != "draft" {
			return 0, staleProposal
		}
		if status == "approved" {
			var lecturerID, periodID int64
			if err := tx.QueryRowContext(ctx, `SELECT c.lecturer_id, v.period_id
 FROM proposal_member_consents c
 JOIN lecturers l ON l.institution_id=c.institution_id AND l.id=c.lecturer_id
 JOIN research_proposals p ON p.institution_id=c.institution_id AND p.id=c.proposal_id
 JOIN grant_scheme_versions v ON v.institution_id=p.institution_id AND v.id=p.grant_version_id
 WHERE c.institution_id=? AND c.proposal_id=? AND (l.user_id=? OR (l.user_id IS NULL AND l.email=?)) AND l.is_active`,
				a.tenant, id, a.ID, a.Email).Scan(&lecturerID, &periodID); err == nil {
				count, err := countMemberProposalsInPeriod(ctx, tx, a.tenant, lecturerID, periodID, id)
				if err != nil {
					return 0, err
				}
				if count > 0 {
					return 0, fmt.Errorf("%w: Anda sudah menjadi Anggota pada 1 usulan lain di periode ini", invalidProposal)
				}
			}
		}
		res, err := tx.ExecContext(ctx, `UPDATE proposal_member_consents c
 JOIN lecturers l ON l.institution_id=c.institution_id AND l.id=c.lecturer_id
 SET c.status=?, c.note=?, c.responded_at=UTC_TIMESTAMP(6)
 WHERE c.institution_id=? AND c.proposal_id=? AND (l.user_id=? OR (l.user_id IS NULL AND l.email=?)) AND l.is_active`,
			status, note, a.tenant, id, a.ID, a.Email)
		if err != nil {
			return 0, err
		}
		affected, err := res.RowsAffected()
		if err != nil {
			return 0, err
		}
		if affected == 0 {
			return 0, sql.ErrNoRows
		}
		return id, nil
	})
}

