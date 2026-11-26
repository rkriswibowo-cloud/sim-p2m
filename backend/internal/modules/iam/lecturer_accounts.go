package iam

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/gin-gonic/gin"
	"simp2m/backend/internal/modules/auth"
)

var duplicateLecturerEmail = errors.New("lecturer email is already in use")

// An uninitialized hash never passes password verification. Only the institution
// that created the account may set its initial credential.
func pendingLecturerPassword(tenant int64) string {
	return fmt.Sprintf("lecturer-pending:%d", tenant)
}

func provisionLecturerAccount(ctx context.Context, tx *sql.Tx, tenant, lecturer int64) error {
	var name, email string
	var active bool
	var linked sql.NullInt64
	if err := tx.QueryRowContext(ctx, `SELECT name,COALESCE(email,''),is_active,user_id
 FROM lecturers WHERE institution_id=? AND id=? FOR UPDATE`, tenant, lecturer).Scan(&name, &email, &active, &linked); err != nil {
		return err
	}
	if linked.Valid || !active {
		return nil
	}
	email, valid := auth.NormalizeEmail(email)
	if !valid {
		return nil
	}
	var duplicate bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM lecturers
 WHERE institution_id=? AND id<>? AND email=?)`, tenant, lecturer, email).Scan(&duplicate); err != nil {
		return err
	}
	if duplicate {
		return duplicateLecturerEmail
	}

	// Use the unique email key to serialize concurrent creation across institutions.
	if _, err := tx.ExecContext(ctx, `INSERT INTO users (email,display_name,password_hash)
 VALUES (?,LEFT(?,160),?) ON DUPLICATE KEY UPDATE id=id`, email, name, pendingLecturerPassword(tenant)); err != nil {
		return err
	}
	var userID int64
	if err := tx.QueryRowContext(ctx, "SELECT id FROM users WHERE email=? FOR UPDATE", email).Scan(&userID); err != nil {
		return err
	}
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM lecturers
 WHERE institution_id=? AND user_id=? AND id<>?)`, tenant, userID, lecturer).Scan(&duplicate); err != nil {
		return err
	}
	if duplicate {
		return duplicateLecturerEmail
	}

	result, err := tx.ExecContext(ctx, "INSERT IGNORE INTO memberships (institution_id,user_id) VALUES (?,?)", tenant, userID)
	if err != nil {
		return err
	}
	added, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if added == 1 {
		for _, permission := range []string{grantRead, researchApply, documentsRead, reportsDraft} {
			if _, err := tx.ExecContext(ctx, `INSERT INTO membership_permissions (institution_id,user_id,permission_code)
 VALUES (?,?,?)`, tenant, userID, permission); err != nil {
				return err
			}
		}
	}

	_, err = tx.ExecContext(ctx, "UPDATE lecturers SET user_id=? WHERE id=?", userID, lecturer)
	return err
}

// ProvisionExistingLecturers applies the same account rules to historical master data.
func ProvisionExistingLecturers(ctx context.Context, db *sql.DB) error {
	rows, err := db.QueryContext(ctx, `SELECT institution_id,id FROM lecturers
 WHERE user_id IS NULL AND is_active AND TRIM(COALESCE(email,''))<>'' ORDER BY institution_id,id`)
	if err != nil {
		return err
	}
	type lecturerRef struct{ tenant, id int64 }
	var refs []lecturerRef
	for rows.Next() {
		var ref lecturerRef
		if err := rows.Scan(&ref.tenant, &ref.id); err != nil {
			rows.Close()
			return err
		}
		refs = append(refs, ref)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	for _, ref := range refs {
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		err = provisionLecturerAccount(ctx, tx, ref.tenant, ref.id)
		if err == nil {
			err = tx.Commit()
		} else {
			tx.Rollback()
		}
		if err != nil && !errors.Is(err, duplicateLecturerEmail) {
			return fmt.Errorf("provision account for lecturer %d: %w", ref.id, err)
		}
	}
	return nil
}

func (s service) setLecturerInitialPassword(c *gin.Context, a actor) {
	var input struct {
		Password string `json:"password"`
	}
	id := target(c)
	if id < 1 || c.ShouldBindJSON(&input) != nil || len(input.Password) < 12 || len(input.Password) > 256 {
		c.JSON(400, gin.H{"message": "Kata sandi awal harus terdiri dari 12 hingga 256 byte."})
		return
	}
	ctx := c.Request.Context()
	var userID int64
	err := s.db.QueryRowContext(ctx, `SELECT u.id FROM lecturers l JOIN users u ON u.id=l.user_id
 JOIN memberships m ON m.institution_id=l.institution_id AND m.user_id=u.id
 WHERE l.institution_id=? AND l.id=? AND l.is_active AND m.is_active AND u.is_active AND u.password_hash=?`,
		a.tenant, id, pendingLecturerPassword(a.tenant)).Scan(&userID)
	if errors.Is(err, sql.ErrNoRows) {
		c.JSON(409, gin.H{"message": "Sandi awal hanya dapat dibuat untuk akun baru yang aktif."})
		return
	}
	if err != nil {
		c.Status(503)
		return
	}
	hash, err := auth.HashPassword(input.Password)
	if err != nil {
		c.Status(503)
		return
	}
	s.change(c, a, "lecturer.account.initial-password", func(ctx context.Context, tx *sql.Tx) (int64, error) {
		var currentUserID int64
		err := tx.QueryRowContext(ctx, `SELECT u.id FROM lecturers l JOIN users u ON u.id=l.user_id
 JOIN memberships m ON m.institution_id=l.institution_id AND m.user_id=u.id
 WHERE l.institution_id=? AND l.id=? AND l.is_active AND m.is_active AND u.is_active AND u.password_hash=? FOR UPDATE`,
			a.tenant, id, pendingLecturerPassword(a.tenant)).Scan(&currentUserID)
		if errors.Is(err, sql.ErrNoRows) || (err == nil && currentUserID != userID) {
			return 0, fmt.Errorf("%w: Akun sudah berubah. Muat ulang daftar dosen.", invalidProposal)
		}
		if err != nil {
			return 0, err
		}
		_, err = tx.ExecContext(ctx, "UPDATE users SET password_hash=? WHERE id=?", hash, userID)
		return id, err
	})
}
