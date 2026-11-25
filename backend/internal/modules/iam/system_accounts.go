package iam

import (
	"context"
	"database/sql"
	"strings"

	"github.com/gin-gonic/gin"
	"simp2m/backend/internal/modules/auth"
)

func lockSystemAccounts(ctx context.Context, tx *sql.Tx) error {
	var guard int64
	return tx.QueryRowContext(ctx, "SELECT id FROM institutions ORDER BY id LIMIT 1 FOR UPDATE").Scan(&guard)
}

func keepSystemAccount(ctx context.Context, tx *sql.Tx, id int64) error {
	var remaining int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM users u JOIN system_role_assignments r ON r.user_id=u.id
  WHERE u.id<>? AND u.is_active`, id).Scan(&remaining); err != nil {
		return err
	}
	if remaining == 0 {
		return conflict
	}
	return nil
}

func (s service) setSystemRole(c *gin.Context, a actor) {
	id := target(c)
	var input struct{ Granted *bool }
	if id < 1 || c.ShouldBindJSON(&input) != nil || input.Granted == nil {
		c.Status(400)
		return
	}
	s.change(c, a, "user.superadmin", func(ctx context.Context, tx *sql.Tx) (int64, error) {
		if err := lockSystemAccounts(ctx, tx); err != nil {
			return 0, err
		}
		var active, granted bool
		if err := tx.QueryRowContext(ctx, `SELECT u.is_active, EXISTS (SELECT 1 FROM system_role_assignments WHERE user_id=u.id)
   FROM users u WHERE u.id=? FOR UPDATE`, id).Scan(&active, &granted); err != nil {
			return 0, err
		}
		if *input.Granted == granted {
			return id, nil
		}
		if !*input.Granted {
			if active {
				if err := keepSystemAccount(ctx, tx, id); err != nil {
					return 0, err
				}
			}
			_, err := tx.ExecContext(ctx, "DELETE FROM system_role_assignments WHERE user_id=? AND role_code='superadmin'", id)
			return id, err
		}
		var eligible bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM memberships m JOIN institutions i ON i.id=m.institution_id
   WHERE m.user_id=? AND m.is_active AND i.is_active)`, id).Scan(&eligible); err != nil {
			return 0, err
		}
		if !active || !eligible {
			return 0, invalid
		}
		_, err := tx.ExecContext(ctx, "INSERT INTO system_role_assignments (user_id,role_code) VALUES (?,'superadmin')", id)
		return id, err
	})
}

func (s service) addMembership(c *gin.Context, a actor) {
	var input struct{ Email string }
	if c.ShouldBindJSON(&input) != nil {
		c.Status(400)
		return
	}
	email, ok := auth.NormalizeEmail(input.Email)
	if !ok {
		c.Status(400)
		return
	}
	s.change(c, a, "membership.add", func(ctx context.Context, tx *sql.Tx) (int64, error) {
		var id int64
		if err := tx.QueryRowContext(ctx, "SELECT id FROM users WHERE email=? FOR UPDATE", email).Scan(&id); err != nil {
			return 0, err
		}
		_, err := tx.ExecContext(ctx, `INSERT INTO memberships (institution_id,user_id) VALUES (?,?)
   ON DUPLICATE KEY UPDATE is_active=TRUE`, a.tenant, id)
		return id, err
	})
}

func (s service) enterTrial(c *gin.Context, a actor) {
	s.change(c, a, "trial.enter", func(context.Context, *sql.Tx) (int64, error) { return a.ID, nil })
}

func (s service) updateProfile(c *gin.Context, a actor) {
	id := target(c)
	var input struct{ Name, Email string }
	if id < 1 || c.ShouldBindJSON(&input) != nil {
		c.Status(400)
		return
	}
	email, ok := auth.NormalizeEmail(input.Email)
	name := strings.TrimSpace(input.Name)
	if !ok || name == "" || len(name) > 160 {
		c.Status(400)
		return
	}
	s.change(c, a, "user.profile", func(ctx context.Context, tx *sql.Tx) (int64, error) {
		var found int64
		if err := tx.QueryRowContext(ctx, "SELECT id FROM users WHERE id=? FOR UPDATE", id).Scan(&found); err != nil {
			return 0, err
		}
		_, err := tx.ExecContext(ctx, "UPDATE users SET display_name=?,email=? WHERE id=?", name, email, id)
		return id, err
	})
}
