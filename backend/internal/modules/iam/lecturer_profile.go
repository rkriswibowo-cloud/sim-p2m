package iam

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"
	"simp2m/backend/internal/modules/auth"
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
	case "tenaga_pengajar":
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
		return 0
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
	Linked       bool   `json:"linked"`
	LecturerID   int64  `json:"lecturerId"`
	Code         string `json:"code"`
	Name         string `json:"name"`
	Email        string `json:"email"`
	NUPTK        string `json:"nuptk"`
	Jafung       string `json:"jafung"`
	StudyProgram string `json:"studyProgram"`
	Active       bool   `json:"active"`
}

type lecturerAccountItem struct {
	ID           int64  `json:"id"`
	Code         string `json:"code"`
	Name         string `json:"name"`
	Email        string `json:"email"`
	NUPTK        string `json:"nuptk"`
	Jafung       string `json:"jafung"`
	StudyProgram string `json:"studyProgram"`
	Active       bool   `json:"active"`
	UserID       *int64 `json:"userId"`
	UserEmail    string `json:"userEmail"`
}

func (s service) getMyLecturerProfile(c *gin.Context, a actor) {
	ctx := c.Request.Context()
	var prof myLecturerProfile
	err := s.db.QueryRowContext(ctx, `SELECT l.id, l.code, l.name, COALESCE(l.email,''), l.nuptk, l.jafung, COALESCE(sp.name,'-'), l.is_active
 FROM lecturers l
 LEFT JOIN study_programs sp ON sp.institution_id=l.institution_id AND sp.id=l.parent_id
 WHERE l.institution_id=? AND l.user_id=? LIMIT 1`, a.tenant, a.ID).
		Scan(&prof.LecturerID, &prof.Code, &prof.Name, &prof.Email, &prof.NUPTK, &prof.Jafung, &prof.StudyProgram, &prof.Active)
	if errors.Is(err, sql.ErrNoRows) && strings.TrimSpace(a.Email) != "" {
		// Fallback match by email, and automatically link user_id if unique
		var count int
		_ = s.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM lecturers WHERE institution_id=? AND email=?", a.tenant, a.Email).Scan(&count)
		if count == 1 {
			err = s.db.QueryRowContext(ctx, `SELECT l.id, l.code, l.name, COALESCE(l.email,''), l.nuptk, l.jafung, COALESCE(sp.name,'-'), l.is_active
 FROM lecturers l
 LEFT JOIN study_programs sp ON sp.institution_id=l.institution_id AND sp.id=l.parent_id
 WHERE l.institution_id=? AND l.email=? LIMIT 1`, a.tenant, a.Email).
				Scan(&prof.LecturerID, &prof.Code, &prof.Name, &prof.Email, &prof.NUPTK, &prof.Jafung, &prof.StudyProgram, &prof.Active)
			if err == nil {
				_, _ = s.db.ExecContext(ctx, "UPDATE lecturers SET user_id=? WHERE institution_id=? AND id=? AND user_id IS NULL", a.ID, a.tenant, prof.LecturerID)
			}
		}
	}
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
	}
	if c.ShouldBindJSON(&input) != nil {
		c.Status(400)
		return
	}
	nuptk := strings.TrimSpace(input.NUPTK)
	jafung := strings.TrimSpace(input.Jafung)
	if len(nuptk) > 64 || !validJafungValues[jafung] {
		c.JSON(400, gin.H{"error": "validation", "message": "Periksa isian NUPTK (maks. 64 karakter) dan pilihan Jabatan Fungsional."})
		return
	}

	s.change(c, a, "lecturer.profile.update", func(ctx context.Context, tx *sql.Tx) (int64, error) {
		var lecturerID int64
		err := tx.QueryRowContext(ctx, "SELECT id FROM lecturers WHERE institution_id=? AND user_id=? FOR UPDATE", a.tenant, a.ID).Scan(&lecturerID)
		if errors.Is(err, sql.ErrNoRows) && strings.TrimSpace(a.Email) != "" {
			var count int
			_ = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM lecturers WHERE institution_id=? AND email=?", a.tenant, a.Email).Scan(&count)
			if count == 1 {
				err = tx.QueryRowContext(ctx, "SELECT id FROM lecturers WHERE institution_id=? AND email=? FOR UPDATE", a.tenant, a.Email).Scan(&lecturerID)
			}
		}
		if errors.Is(err, sql.ErrNoRows) {
			return 0, fmt.Errorf("%w: akun Anda belum terhubung dengan data Master Dosen pada institusi ini", invalidProposal)
		}
		if err != nil {
			return 0, err
		}
		if _, err := tx.ExecContext(ctx, "UPDATE lecturers SET user_id=?, nuptk=?, jafung=? WHERE id=?", a.ID, nuptk, jafung, lecturerID); err != nil {
			return 0, err
		}
		return lecturerID, nil
	})
}

func (s service) listLecturersWithAccounts(c *gin.Context, a actor) {
	rows, err := s.db.QueryContext(c.Request.Context(), `SELECT l.id, l.code, l.name, COALESCE(l.email,''), l.nuptk, l.jafung,
 COALESCE(sp.name,'-'), l.is_active, l.user_id, COALESCE(u.email,'')
 FROM lecturers l
 LEFT JOIN study_programs sp ON sp.institution_id=l.institution_id AND sp.id=l.parent_id
 LEFT JOIN users u ON u.id=l.user_id
 WHERE l.institution_id=?
 ORDER BY l.is_active DESC, l.name ASC LIMIT 200`, a.tenant)
	if err != nil {
		c.Status(503)
		return
	}
	defer rows.Close()
	items := []lecturerAccountItem{}
	for rows.Next() {
		var item lecturerAccountItem
		var uid sql.NullInt64
		if err := rows.Scan(&item.ID, &item.Code, &item.Name, &item.Email, &item.NUPTK, &item.Jafung, &item.StudyProgram, &item.Active, &uid, &item.UserEmail); err != nil {
			c.Status(503)
			return
		}
		if uid.Valid {
			v := uid.Int64
			item.UserID = &v
		}
		items = append(items, item)
	}
	c.JSON(200, items)
}

func (s service) linkLecturerAccount(c *gin.Context, a actor) {
	lecturerID := target(c)
	var input struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if lecturerID < 1 || c.ShouldBindJSON(&input) != nil {
		c.Status(400)
		return
	}
	email, ok := auth.NormalizeEmail(input.Email)
	if !ok {
		c.JSON(400, gin.H{"error": "validation", "message": "Format email akun tidak valid."})
		return
	}
	password := input.Password
	var passwordHash string
	if password != "" {
		h, err := auth.HashPassword(password)
		if err != nil {
			c.JSON(400, gin.H{"error": "validation", "message": "Kata sandi akun baru minimal 12 karakter."})
			return
		}
		passwordHash = h
	}

	s.change(c, a, "lecturer.account.link", func(ctx context.Context, tx *sql.Tx) (int64, error) {
		var lName string
		if err := tx.QueryRowContext(ctx, "SELECT name FROM lecturers WHERE institution_id=? AND id=? FOR UPDATE", a.tenant, lecturerID).Scan(&lName); err != nil {
			return 0, err
		}

		var userID int64
		err := tx.QueryRowContext(ctx, "SELECT id FROM users WHERE email=? FOR UPDATE", email).Scan(&userID)
		if errors.Is(err, sql.ErrNoRows) {
			if passwordHash == "" {
				return 0, fmt.Errorf("%w: akun email belum terdaftar; isi kata sandi (minimal 12 karakter) untuk membuat akun dosen baru", invalidProposal)
			}
			res, err := tx.ExecContext(ctx, "INSERT INTO users (email, display_name, password_hash, is_active) VALUES (?,?,?,TRUE)", email, lName, passwordHash)
			if err != nil {
				return 0, err
			}
			userID, err = res.LastInsertId()
			if err != nil {
				return 0, err
			}
		} else if err != nil {
			return 0, err
		}

		// Ensure active membership in institution
		if _, err := tx.ExecContext(ctx, `INSERT INTO memberships (institution_id, user_id, is_active) VALUES (?,?,TRUE)
 ON DUPLICATE KEY UPDATE is_active=TRUE`, a.tenant, userID); err != nil {
			return 0, err
		}

		// Grant default lecturer permissions if user has no explicit permission rows yet in this institution
		var permCount int
		if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM membership_permissions WHERE institution_id=? AND user_id=?", a.tenant, userID).Scan(&permCount); err != nil {
			return 0, err
		}
		if permCount == 0 {
			for _, code := range []string{"", grantRead, researchApply, documentsRead, reportsDraft} {
				if _, err := tx.ExecContext(ctx, "INSERT IGNORE INTO membership_permissions (institution_id, user_id, permission_code) VALUES (?,?,?)", a.tenant, userID, code); err != nil {
					return 0, err
				}
			}
		}

		// Clear any previous link of this user_id on another lecturer row in the same institution, then link
		if _, err := tx.ExecContext(ctx, "UPDATE lecturers SET user_id=NULL WHERE institution_id=? AND user_id=? AND id<>?", a.tenant, userID, lecturerID); err != nil {
			return 0, err
		}
		if _, err := tx.ExecContext(ctx, "UPDATE lecturers SET user_id=?, email=? WHERE institution_id=? AND id=?", userID, email, a.tenant, lecturerID); err != nil {
			return 0, err
		}
		return lecturerID, nil
	})
}

