package iam

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"
)

var validJafungValues = map[string]bool{
	"":                true,
	"tenaga_pengajar": true,
	"asisten_ahli":    true,
	"lektor":          true,
	"lektor_kepala":   true,
	"guru_besar":      true,
}

func jafungRank(j string) int {
	switch j {
	case "", "tenaga_pengajar":
		return 1
	case "asisten_ahli":
		return 2
	case "lektor":
		return 3
	case "lektor_kepala":
		return 4
	case "guru_besar":
		return 5
	default:
		return 1
	}
}

func jafungLabel(j string) string {
	switch j {
	case "tenaga_pengajar":
		return "Tenaga Pengajar"
	case "asisten_ahli":
		return "Asisten Ahli"
	case "lektor":
		return "Lektor"
	case "lektor_kepala":
		return "Lektor Kepala"
	case "guru_besar":
		return "Guru Besar"
	default:
		return "Belum diisi"
	}
}

type myLecturerProfile struct {
	Linked        bool   `json:"linked"`
	LecturerID    int64  `json:"lecturerId"`
	Code          string `json:"code"`
	Name          string `json:"name"`
	Email         string `json:"email"`
	Phone         string `json:"phone"`
	NUPTK         string `json:"nuptk"`
	Jafung        string `json:"jafung"`
	StudyProgram  string `json:"studyProgram"`
	Active        bool   `json:"active"`
	ProfileLocked bool   `json:"profileLocked"`
}

type lecturerAccountItem struct {
	NeedsPassword bool   `json:"needsPassword"`
	ID            int64  `json:"id"`
	Code          string `json:"code"`
	Name          string `json:"name"`
	Email         string `json:"email"`
	Phone         string `json:"phone"`
	NUPTK         string `json:"nuptk"`
	Jafung        string `json:"jafung"`
	StudyProgram  string `json:"studyProgram"`
	Active        bool   `json:"active"`
	ProfileLocked bool   `json:"profileLocked"`
	UserID        *int64 `json:"userId"`
	UserEmail     string `json:"userEmail"`
}

func (s service) getMyLecturerProfile(c *gin.Context, a actor) {
	ctx := c.Request.Context()
	var prof myLecturerProfile
	err := s.db.QueryRowContext(ctx, `SELECT l.id, l.code, l.name, COALESCE(l.email,''), COALESCE(l.phone,''), l.nuptk, l.jafung, COALESCE(sp.name,'-'), l.is_active,l.profile_locked
 FROM lecturers l
 LEFT JOIN study_programs sp ON sp.institution_id=l.institution_id AND sp.id=l.parent_id
 WHERE l.institution_id=? AND l.user_id=? LIMIT 1`, a.tenant, a.ID).
		Scan(&prof.LecturerID, &prof.Code, &prof.Name, &prof.Email, &prof.Phone, &prof.NUPTK, &prof.Jafung, &prof.StudyProgram, &prof.Active, &prof.ProfileLocked)
	if errors.Is(err, sql.ErrNoRows) {
		c.JSON(200, myLecturerProfile{Linked: false})
		return
	}
	if err != nil {
		c.Status(503)
		return
	}
	prof.Linked = true
	c.JSON(200, prof)
}

func (s service) updateMyLecturerProfile(c *gin.Context, a actor) {
	var input struct {
		NUPTK  string `json:"nuptk"`
		Jafung string `json:"jafung"`
		Phone  string `json:"phone"`
	}
	if c.ShouldBindJSON(&input) != nil {
		c.Status(400)
		return
	}
	nuptk := strings.TrimSpace(input.NUPTK)
	jafung := strings.TrimSpace(input.Jafung)
	phone := strings.TrimSpace(input.Phone)
	if len(nuptk) > 64 || len(phone) > 32 || !validJafungValues[jafung] {
		c.JSON(400, gin.H{"error": "validation", "message": "Periksa isian NUPTK, Nomor HP, dan pilihan Jabatan Fungsional."})
		return
	}

	s.change(c, a, "lecturer.profile.update", func(ctx context.Context, tx *sql.Tx) (int64, error) {
		var lecturerID int64
		var active, locked bool
		err := tx.QueryRowContext(ctx, "SELECT id,is_active,profile_locked FROM lecturers WHERE institution_id=? AND user_id=? FOR UPDATE", a.tenant, a.ID).Scan(&lecturerID, &active, &locked)
		if err != nil {
			return 0, err
		}
		if !active || locked {
			return 0, fmt.Errorf("%w: Profil tidak bisa diubah. Hubungi admin institusi.", invalidProposal)
		}
		if _, err := tx.ExecContext(ctx, "UPDATE lecturers SET nuptk=?, jafung=?, phone=? WHERE id=?", nuptk, jafung, phone, lecturerID); err != nil {
			return 0, err
		}
		return lecturerID, nil
	})
}

func (s service) listLecturersWithAccounts(c *gin.Context, a actor) {
	rows, err := s.db.QueryContext(c.Request.Context(), `SELECT l.id, l.code, l.name, COALESCE(l.email,''), l.nuptk, l.jafung,
 COALESCE(sp.name,'-'), l.is_active, l.user_id, COALESCE(u.email,''), l.profile_locked, COALESCE(u.password_hash=?,FALSE)
 FROM lecturers l
 LEFT JOIN study_programs sp ON sp.institution_id=l.institution_id AND sp.id=l.parent_id
 LEFT JOIN users u ON u.id=l.user_id
 WHERE l.institution_id=?
 ORDER BY l.is_active DESC, l.name ASC LIMIT 5000`, pendingLecturerPassword(a.tenant), a.tenant)
	if err != nil {
		c.Status(503)
		return
	}
	defer rows.Close()
	items := []lecturerAccountItem{}
	for rows.Next() {
		var item lecturerAccountItem
		var uid sql.NullInt64
		if err := rows.Scan(&item.ID, &item.Code, &item.Name, &item.Email, &item.NUPTK, &item.Jafung, &item.StudyProgram, &item.Active, &uid, &item.UserEmail, &item.ProfileLocked, &item.NeedsPassword); err != nil {
			c.Status(503)
			return
		}
		if uid.Valid {
			v := uid.Int64
			item.UserID = &v
		}
		items = append(items, item)
	}
	if rows.Err() != nil {
		c.Status(503)
		return
	}
	c.JSON(200, items)
}

func (s service) setLecturerProfileLock(c *gin.Context, a actor) {
	var input struct {
		Locked *bool `json:"locked"`
	}
	id := target(c)
	if id < 1 || c.ShouldBindJSON(&input) != nil || input.Locked == nil {
		c.Status(400)
		return
	}
	action := "lecturer.profile.unlock"
	if *input.Locked {
		action = "lecturer.profile.lock"
	}
	s.change(c, a, action, func(ctx context.Context, tx *sql.Tx) (int64, error) {
		var found int64
		if err := tx.QueryRowContext(ctx, "SELECT id FROM lecturers WHERE institution_id=? AND id=? FOR UPDATE", a.tenant, id).Scan(&found); err != nil {
			return 0, err
		}
		_, err := tx.ExecContext(ctx, "UPDATE lecturers SET profile_locked=? WHERE id=?", *input.Locked, id)
		return id, err
	})
}
