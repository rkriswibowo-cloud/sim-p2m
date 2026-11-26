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
	Linked       bool   `json:"linked"`
	LecturerID   int64  `json:"lecturerId"`
	Code         string `json:"code"`
	Name         string `json:"name"`
	Email        string `json:"email"`
	Phone        string `json:"phone"`
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
	Phone        string `json:"phone"`
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
	err := s.db.QueryRowContext(ctx, `SELECT l.id, l.code, l.name, COALESCE(l.email,''), COALESCE(l.phone,''), l.nuptk, l.jafung, COALESCE(sp.name,'-'), l.is_active
 FROM lecturers l
 LEFT JOIN study_programs sp ON sp.institution_id=l.institution_id AND sp.id=l.parent_id
 WHERE l.institution_id=? AND l.user_id=? LIMIT 1`, a.tenant, a.ID).
		Scan(&prof.LecturerID, &prof.Code, &prof.Name, &prof.Email, &prof.Phone, &prof.NUPTK, &prof.Jafung, &prof.StudyProgram, &prof.Active)
	if errors.Is(err, sql.ErrNoRows) && strings.TrimSpace(a.Email) != "" {
		// Fallback match by email, and automatically link user_id if unique
		var count int
		_ = s.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM lecturers WHERE institution_id=? AND email=?", a.tenant, a.Email).Scan(&count)
		if count == 1 {
			err = s.db.QueryRowContext(ctx, `SELECT l.id, l.code, l.name, COALESCE(l.email,''), COALESCE(l.phone,''), l.nuptk, l.jafung, COALESCE(sp.name,'-'), l.is_active
 FROM lecturers l
 LEFT JOIN study_programs sp ON sp.institution_id=l.institution_id AND sp.id=l.parent_id
 WHERE l.institution_id=? AND l.email=? LIMIT 1`, a.tenant, a.Email).
				Scan(&prof.LecturerID, &prof.Code, &prof.Name, &prof.Email, &prof.Phone, &prof.NUPTK, &prof.Jafung, &prof.StudyProgram, &prof.Active)
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
		if _, err := tx.ExecContext(ctx, "UPDATE lecturers SET user_id=?, nuptk=?, jafung=?, phone=? WHERE id=?", a.ID, nuptk, jafung, phone, lecturerID); err != nil {
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
 ORDER BY l.is_active DESC, l.name ASC LIMIT 5000`, a.tenant)
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
		UserID   int64  `json:"userId"`
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if lecturerID < 1 || c.ShouldBindJSON(&input) != nil {
		c.Status(400)
		return
	}
	var email string
	if input.UserID == 0 {
		var ok bool
		email, ok = auth.NormalizeEmail(input.Email)
		if !ok {
			c.JSON(400, gin.H{"error": "validation", "message": "Format email akun tidak valid."})
			return
		}
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
		if input.UserID > 0 {
			err := tx.QueryRowContext(ctx, "SELECT id, email FROM users WHERE id=? AND is_active FOR UPDATE", input.UserID).Scan(&userID, &email)
			if errors.Is(err, sql.ErrNoRows) {
				return 0, fmt.Errorf("%w: user sistem yang dipilih tidak ditemukan atau nonaktif", invalidProposal)
			}
			if err != nil {
				return 0, err
			}
		} else {
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

type systemUserOption struct {
	ID                 int64  `json:"id"`
	Email              string `json:"email"`
	Name               string `json:"name"`
	LinkedLecturerID   *int64 `json:"linkedLecturerId"`
	LinkedLecturerName string `json:"linkedLecturerName"`
}

func (s service) listSystemUserOptions(c *gin.Context, a actor) {
	rows, err := s.db.QueryContext(c.Request.Context(), `SELECT u.id, u.email, u.display_name, l.id, COALESCE(l.name,'')
 FROM users u
 LEFT JOIN lecturers l ON l.institution_id=? AND l.user_id=u.id
 WHERE u.is_active
 ORDER BY u.display_name ASC, u.email ASC
 LIMIT 5000`, a.tenant)
	if err != nil {
		c.Status(503)
		return
	}
	defer rows.Close()
	items := []systemUserOption{}
	for rows.Next() {
		var item systemUserOption
		var lid sql.NullInt64
		if err := rows.Scan(&item.ID, &item.Email, &item.Name, &lid, &item.LinkedLecturerName); err != nil {
			c.Status(503)
			return
		}
		if lid.Valid {
			v := lid.Int64
			item.LinkedLecturerID = &v
		}
		items = append(items, item)
	}
	c.JSON(200, items)
}

func (s service) syncLecturerAccounts(c *gin.Context, a actor) {
	ctx := c.Request.Context()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		c.Status(503)
		return
	}
	defer tx.Rollback()

	var synced int64
	rows, err := tx.QueryContext(ctx, `SELECT l.id, u.id
 FROM lecturers l
 JOIN users u ON LOWER(TRIM(l.email))=LOWER(u.email) AND u.is_active
 WHERE l.institution_id=? AND l.user_id IS NULL AND TRIM(COALESCE(l.email,''))<>''
   AND NOT EXISTS (SELECT 1 FROM lecturers x WHERE x.institution_id=l.institution_id AND x.user_id=u.id)
 FOR UPDATE`, a.tenant)
	if err != nil {
		c.Status(503)
		return
	}
	type pair struct{ lecturerID, userID int64 }
	var pairs []pair
	for rows.Next() {
		var p pair
		if err := rows.Scan(&p.lecturerID, &p.userID); err != nil {
			rows.Close()
			c.Status(503)
			return
		}
		pairs = append(pairs, p)
	}
	if err := rows.Close(); err != nil {
		c.Status(503)
		return
	}
	seenUsers := map[int64]bool{}
	for _, p := range pairs {
		if seenUsers[p.userID] {
			continue
		}
		seenUsers[p.userID] = true
		if _, err := tx.ExecContext(ctx, `INSERT INTO memberships (institution_id, user_id, is_active) VALUES (?,?,TRUE)
 ON DUPLICATE KEY UPDATE is_active=TRUE`, a.tenant, p.userID); err != nil {
			c.Status(503)
			return
		}
		var permCount int
		if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM membership_permissions WHERE institution_id=? AND user_id=?", a.tenant, p.userID).Scan(&permCount); err != nil {
			c.Status(503)
			return
		}
		if permCount == 0 {
			for _, code := range []string{"", grantRead, researchApply, documentsRead, reportsDraft} {
				if _, err := tx.ExecContext(ctx, "INSERT IGNORE INTO membership_permissions (institution_id, user_id, permission_code) VALUES (?,?,?)", a.tenant, p.userID, code); err != nil {
					c.Status(503)
					return
				}
			}
		}
		res, err := tx.ExecContext(ctx, "UPDATE lecturers SET user_id=? WHERE institution_id=? AND id=? AND user_id IS NULL", p.userID, a.tenant, p.lecturerID)
		if err != nil {
			c.Status(503)
			return
		}
		if n, _ := res.RowsAffected(); n > 0 {
			synced += n
		}
	}
	if err := tx.Commit(); err != nil {
		c.Status(503)
		return
	}
	c.JSON(200, gin.H{"synced": synced})
}

