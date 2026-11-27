package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"time"
)

const AccessLifetime = 15 * time.Minute
const RefreshLifetime = 7 * 24 * time.Hour

type Tokens struct {
	Access, Refresh string
	RefreshExpires  time.Time
}

type Identity struct {
	ID            int64  `json:"id"`
	Email         string `json:"email"`
	Name          string `json:"name"`
	Role          string `json:"role"`
	Institution   string `json:"institution"`
	InstitutionID int64  `json:"institutionId"`
	CanAccess     bool   `json:"canAccess"`
	CanMaster     bool   `json:"canMaster"`
	CanGrant      bool   `json:"canGrant"`
	CanResearch   bool   `json:"canResearch"`
	CanCommunity  bool   `json:"canCommunity"`
	CanDocuments  bool   `json:"canDocuments"`
	CanReports    bool   `json:"canReports"`
	CanSelection  bool   `json:"canSelection"`
}

type Store struct{ DB *sql.DB }

func token() (string, [32]byte, error) {
	data := make([]byte, 32)
	if _, err := rand.Read(data); err != nil {
		return "", [32]byte{}, err
	}
	value := base64.RawURLEncoding.EncodeToString(data)
	return value, sha256.Sum256([]byte(value)), nil
}

func newSession(ctx context.Context, tx *sql.Tx, id int64, family []byte, expiry time.Time) (Tokens, error) {
	access, accessHash, err := token()
	if err != nil {
		return Tokens{}, err
	}
	refresh, refreshHash, err := token()
	if err != nil {
		return Tokens{}, err
	}
	if family == nil {
		family = refreshHash[:]
	}
	accessExpiry := time.Now().UTC().Add(AccessLifetime)
	if expiry.Before(accessExpiry) {
		accessExpiry = expiry
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO sessions
  (user_id, refresh_token_hash, expires_at, access_token_hash, access_expires_at, family_id)
  VALUES (?, ?, ?, ?, ?, ?)`, id, refreshHash[:], expiry, accessHash[:], accessExpiry, family)
	return Tokens{Access: access, Refresh: refresh, RefreshExpires: expiry}, err
}

type executor interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

func recordEvent(ctx context.Context, db executor, id *int64, action string) error {
	_, err := db.ExecContext(ctx, `INSERT INTO audit_events
  (actor_user_id, effective_role, mode, action) VALUES (?, (SELECT role_code FROM system_role_assignments WHERE user_id = ?), 'production', ?)`, id, id, action)
	return err
}

func (s Store) Login(ctx context.Context, rawEmail, password string) (Tokens, bool, error) {
	email, valid := NormalizeEmail(rawEmail)
	var id int64
	var hash string
	var err error
	if valid {
		err = s.DB.QueryRowContext(ctx, `SELECT u.id, u.password_hash FROM users u
   WHERE u.email = ? AND u.is_active AND EXISTS (
    SELECT 1 FROM memberships m JOIN institutions i ON i.id = m.institution_id AND i.is_active
    WHERE m.user_id = u.id AND m.is_active
   )`, email).Scan(&id, &hash)
		if err != nil && err != sql.ErrNoRows {
			return Tokens{}, false, err
		}
	}
	if !matchesPassword(hash, password) {
		return Tokens{}, false, recordEvent(ctx, s.DB, nil, "auth.login_failed")
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Tokens{}, false, err
	}
	defer tx.Rollback()
	var active bool
	var currentHash string
	if err := tx.QueryRowContext(ctx, "SELECT is_active, password_hash FROM users WHERE id=? FOR UPDATE", id).Scan(&active, &currentHash); err != nil {
		return Tokens{}, false, err
	}
	if !active || currentHash != hash {
		return Tokens{}, false, nil
	}
	tokens, err := newSession(ctx, tx, id, nil, time.Now().UTC().Add(RefreshLifetime))
	if err != nil {
		return Tokens{}, false, err
	}
	if err := recordEvent(ctx, tx, &id, "auth.login"); err != nil {
		return Tokens{}, false, err
	}
	return tokens, true, tx.Commit()
}

func (s Store) Me(ctx context.Context, access string) (Identity, error) {
	var user Identity
	if len(access) != 43 {
		return user, sql.ErrNoRows
	}
	hash := sha256.Sum256([]byte(access))
	err := s.DB.QueryRowContext(ctx, `SELECT u.id, u.email, u.display_name, COALESCE(r.role_code, 'member'), i.name, i.id
  FROM sessions s JOIN users u ON u.id = s.user_id AND u.is_active
  LEFT JOIN system_role_assignments r ON r.user_id = u.id AND r.role_code = 'superadmin'
  JOIN memberships m ON m.user_id = u.id AND m.is_active
  JOIN institutions i ON i.id = m.institution_id AND i.is_active
  WHERE s.access_token_hash = ? AND s.revoked_at IS NULL AND s.access_expires_at > UTC_TIMESTAMP(6)
  ORDER BY i.id LIMIT 1`, hash[:]).Scan(&user.ID, &user.Email, &user.Name, &user.Role, &user.Institution, &user.InstitutionID)
	if err == nil {
		user.CanAccess = user.Role == "superadmin"
		user.CanMaster = user.CanAccess
		user.CanGrant = user.CanAccess
		user.CanResearch = user.CanAccess
		user.CanCommunity = user.CanAccess
		user.CanDocuments = user.CanAccess
		user.CanReports = user.CanAccess
		user.CanSelection = user.CanAccess
		if !user.CanAccess {
			err = s.DB.QueryRowContext(ctx, `SELECT
			 COALESCE(MAX(p.permission_code IN ('iam.read','iam.manage','audit.read')),FALSE),
			 COALESCE(MAX(p.permission_code IN ('masterdata.read','masterdata.manage')),FALSE),
			 COALESCE(MAX(p.permission_code IN ('grants.read','grants.manage')),FALSE),
			 COALESCE(MAX(p.permission_code='research.apply'),FALSE),
			 COALESCE(MAX(p.permission_code='community.draft'),FALSE),
			 COALESCE(MAX(p.permission_code='documents.read'),FALSE),
			 COALESCE(MAX(p.permission_code='reports.draft'),FALSE),
			 COALESCE(MAX(p.permission_code IN ('research.verify','research.review','research.decide')),FALSE)
			 FROM effective_membership_permissions p
			 WHERE p.user_id=?`, user.ID).Scan(&user.CanAccess, &user.CanMaster, &user.CanGrant, &user.CanResearch, &user.CanCommunity, &user.CanDocuments, &user.CanReports, &user.CanSelection)
		}
	}
	return user, err
}

func (s Store) Rotate(ctx context.Context, refresh string, logout bool) (Tokens, bool, error) {
	if len(refresh) != 43 {
		return Tokens{}, false, nil
	}
	hash := sha256.Sum256([]byte(refresh))
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Tokens{}, false, err
	}
	defer tx.Rollback()
	// Lock the stable user row before acquiring any session locks. This orders
	// concurrent rotations and logout across the whole session family.
	var id int64
	err = tx.QueryRowContext(ctx, "SELECT user_id FROM sessions WHERE refresh_token_hash = ?", hash[:]).Scan(&id)
	if err == sql.ErrNoRows {
		return Tokens{}, false, nil
	}
	if err != nil {
		return Tokens{}, false, err
	}
	var active bool
	if err := tx.QueryRowContext(ctx, "SELECT is_active FROM users WHERE id = ? FOR UPDATE", id).Scan(&active); err != nil {
		return Tokens{}, false, err
	}
	var family []byte
	var expiry time.Time
	var revoked bool
	err = tx.QueryRowContext(ctx, `SELECT family_id, expires_at, revoked_at IS NOT NULL
  FROM sessions WHERE refresh_token_hash = ? FOR UPDATE`, hash[:]).Scan(&family, &expiry, &revoked)
	if err != nil {
		return Tokens{}, false, err
	}
	if len(family) == 0 || !time.Now().Before(expiry) {
		return Tokens{}, false, nil
	}
	if logout || revoked || !active {
		result, err := tx.ExecContext(ctx, "UPDATE sessions SET revoked_at = UTC_TIMESTAMP(6) WHERE family_id = ? AND revoked_at IS NULL", family)
		if err != nil {
			return Tokens{}, false, err
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return Tokens{}, false, err
		}
		if affected > 0 {
			action := "auth.refresh_reuse"
			if logout {
				action = "auth.logout"
			}
			if !active && !logout {
				action = "auth.session_revoked"
			}
			if err := recordEvent(ctx, tx, &id, action); err != nil {
				return Tokens{}, false, err
			}
		}
		return Tokens{}, false, tx.Commit()
	}
	if _, err := tx.ExecContext(ctx, "UPDATE sessions SET revoked_at = UTC_TIMESTAMP(6) WHERE refresh_token_hash = ?", hash[:]); err != nil {
		return Tokens{}, false, err
	}
	tokens, err := newSession(ctx, tx, id, family, expiry)
	if err != nil {
		return Tokens{}, false, err
	}
	if err := recordEvent(ctx, tx, &id, "auth.refresh"); err != nil {
		return Tokens{}, false, err
	}
	return tokens, true, tx.Commit()
}
