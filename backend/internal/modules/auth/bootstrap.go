package auth

import (
	"context"
	"database/sql"
	"errors"
	"net/mail"
	"strings"
)

func NormalizeEmail(raw string) (string, bool) {
	email := strings.ToLower(strings.TrimSpace(raw))
	address, err := mail.ParseAddress(email)
	return email, err == nil && address.Address == email && len(email) <= 254
}

// Bootstrap provisions the first system administrator once. The UAM row
// serializes concurrent bootstrap attempts.
func Bootstrap(ctx context.Context, db *sql.DB, rawEmail, name, password string) (bool, error) {
	email, valid := NormalizeEmail(rawEmail)
	name = strings.TrimSpace(name)
	if !valid || name == "" || len(name) > 160 {
		return false, errors.New("valid email and display name are required")
	}
	hash, err := HashPassword(password)
	if err != nil {
		return false, err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `INSERT INTO institutions (code, name) VALUES ('UAM', 'Universitas Anwar Medika') ON DUPLICATE KEY UPDATE id = id`); err != nil {
		return false, err
	}
	var institutionID uint64
	if err := tx.QueryRowContext(ctx, "SELECT id FROM institutions WHERE code = 'UAM' AND is_active FOR UPDATE").Scan(&institutionID); err != nil {
		return false, err
	}
	var existing string
	err = tx.QueryRowContext(ctx, `SELECT u.email FROM system_role_assignments r
  JOIN users u ON u.id = r.user_id WHERE r.role_code = 'superadmin' LIMIT 1 FOR UPDATE`).Scan(&existing)
	switch err {
	case nil:
		if existing != email {
			return false, errors.New("a Superadmin already exists")
		}
		return false, nil
	case sql.ErrNoRows:
	default:
		return false, err
	}
	result, err := tx.ExecContext(ctx, "INSERT INTO users (email, display_name, password_hash) VALUES (?, ?, ?)", email, name, hash)
	if err != nil {
		return false, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return false, err
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO memberships (institution_id, user_id) VALUES (?, ?)", institutionID, id); err != nil {
		return false, err
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO system_role_assignments (user_id, role_code) VALUES (?, 'superadmin')", id); err != nil {
		return false, err
	}
	if err := recordEvent(ctx, tx, &id, "auth.bootstrap"); err != nil {
		return false, err
	}
	return true, tx.Commit()
}
