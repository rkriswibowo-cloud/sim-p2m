package iam

import (
	"context"
	"database/sql"
	"net/http"
	"slices"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"simp2m/backend/internal/modules/auth"
)

var registry = []string{read, manage, auditRead, masterRead, masterManage, grantRead, grantManage, researchApply, researchVerify, communityDraft, documentsRead, reportsDraft}

type userRecord struct {
	ID          int64     `json:"id"`
	Name        string    `json:"name"`
	Email       string    `json:"email"`
	Active      bool      `json:"active"`
	Membership  bool      `json:"membership"`
	Roles       []int64   `json:"roles"`
	Superadmin  bool      `json:"superadmin"`
	Permissions *[]string `json:"permissions"`
}
type roleRecord struct {
	ID          int64    `json:"id"`
	Name        string   `json:"name"`
	Active      bool     `json:"active"`
	Permissions []string `json:"permissions"`
}

func (s service) workspace(c *gin.Context, a actor) {
	ctx := c.Request.Context()
	users, err := s.users(ctx, a.tenant)
	if err != nil {
		c.Status(503)
		return
	}
	roles, err := s.roles(ctx, a.tenant)
	if err != nil {
		c.Status(503)
		return
	}
	var role string
	canCreate := a.system() || (a.mode == "production" && s.roleForPermission(ctx, a, manage, &role) == nil)
	c.JSON(200, gin.H{"users": users, "roles": roles, "permissions": registry, "canCreateUser": canCreate})
}

func (s service) users(ctx context.Context, tenant int64) ([]userRecord, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT u.id,u.display_name,u.email,u.is_active,m.is_active,
  EXISTS (SELECT 1 FROM system_role_assignments WHERE user_id=u.id)
  FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.institution_id=? ORDER BY u.id LIMIT 200`, tenant)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []userRecord{}
	positions := map[int64]int{}
	for rows.Next() {
		var u userRecord
		if err := rows.Scan(&u.ID, &u.Name, &u.Email, &u.Active, &u.Membership, &u.Superadmin); err != nil {
			return nil, err
		}
		u.Roles = []int64{}
		positions[u.ID] = len(result)
		result = append(result, u)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	assignments, err := s.db.QueryContext(ctx, "SELECT user_id,role_id FROM user_role_assignments WHERE institution_id=?", tenant)
	if err != nil {
		return nil, err
	}
	defer assignments.Close()
	for assignments.Next() {
		var user, role int64
		if err := assignments.Scan(&user, &role); err != nil {
			return nil, err
		}
		if position, ok := positions[user]; ok {
			result[position].Roles = append(result[position].Roles, role)
		}
	}
	if err := assignments.Err(); err != nil {
		return nil, err
	}
	grants, err := s.db.QueryContext(ctx, "SELECT user_id,permission_code FROM membership_permissions WHERE institution_id=? ORDER BY permission_code", tenant)
	if err != nil {
		return nil, err
	}
	defer grants.Close()
	for grants.Next() {
		var user int64
		var code string
		if err := grants.Scan(&user, &code); err != nil {
			return nil, err
		}
		if position, ok := positions[user]; ok {
			if result[position].Permissions == nil {
				permissions := []string{}
				result[position].Permissions = &permissions
			}
			if code != "" {
				*result[position].Permissions = append(*result[position].Permissions, code)
			}
		}
	}
	return result, grants.Err()
}
func (s service) roles(ctx context.Context, tenant int64) ([]roleRecord, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT r.id,r.name,r.is_active,p.permission_code FROM roles r
 LEFT JOIN role_permissions p ON p.role_id=r.id WHERE r.institution_id=? ORDER BY r.id,p.permission_code`, tenant)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []roleRecord{}
	for rows.Next() {
		var r roleRecord
		var permission sql.NullString
		if err := rows.Scan(&r.ID, &r.Name, &r.Active, &permission); err != nil {
			return nil, err
		}
		if len(result) == 0 || result[len(result)-1].ID != r.ID {
			r.Permissions = []string{}
			result = append(result, r)
		}
		if permission.Valid {
			result[len(result)-1].Permissions = append(result[len(result)-1].Permissions, permission.String)
		}
	}
	return result, rows.Err()
}

func (s service) createUser(c *gin.Context, a actor) {
	var input struct {
		Name, Email, Password string
		accountAccess
	}
	if c.ShouldBindJSON(&input) != nil || !input.accountAccess.valid() {
		c.Status(400)
		return
	}
	if !a.system() && (len(input.Roles) > 0 || input.Permissions != nil) {
		c.Status(403)
		return
	}
	email, ok := auth.NormalizeEmail(input.Email)
	name := strings.TrimSpace(input.Name)
	if !ok || name == "" || len(name) > 160 {
		c.Status(400)
		return
	}
	hash, err := auth.HashPassword(input.Password)
	if err != nil {
		c.Status(400)
		return
	}
	s.change(c, a, "user.create", func(ctx context.Context, tx *sql.Tx) (int64, error) {
		result, err := tx.ExecContext(ctx, "INSERT INTO users (email,display_name,password_hash) VALUES (?,?,?)", email, name, hash)
		if err != nil {
			return 0, err
		}
		id, err := result.LastInsertId()
		if err != nil {
			return 0, err
		}
		if _, err = tx.ExecContext(ctx, "INSERT INTO memberships(institution_id,user_id) VALUES (?,?)", a.tenant, id); err != nil {
			return 0, err
		}
		if err := assignRoles(ctx, tx, a.tenant, id, input.Roles); err != nil {
			return 0, err
		}
		return id, input.accountAccess.savePermissions(ctx, tx, a.tenant, id)
	})
}
func (s service) updateMembership(c *gin.Context, a actor) {
	id := target(c)
	var input struct {
		Active *bool
		accountAccess
	}
	deleting := c.Request.Method == http.MethodDelete
	active := false
	action := "membership.delete"
	if id < 1 || (!deleting && (c.ShouldBindJSON(&input) != nil || input.Active == nil || !input.accountAccess.valid())) {
		c.Status(400)
		return
	}
	if !deleting {
		active, action = *input.Active, "membership.update"
	}
	s.change(c, a, action, func(ctx context.Context, tx *sql.Tx) (int64, error) {
		if err := lockSystemAccounts(ctx, tx); err != nil {
			return 0, err
		}
		var found int64
		if err := tx.QueryRowContext(ctx, "SELECT user_id FROM memberships WHERE institution_id=? AND user_id=? FOR UPDATE", a.tenant, id).Scan(&found); err != nil {
			return 0, err
		}
		var system bool
		if err := tx.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM system_role_assignments WHERE user_id=?)", id).Scan(&system); err != nil {
			return 0, err
		}
		if system && !active {
			return 0, conflict
		}
		if _, err := tx.ExecContext(ctx, "UPDATE memberships SET is_active=? WHERE institution_id=? AND user_id=?", active, a.tenant, id); err != nil {
			return 0, err
		}
		if deleting {
			return id, nil
		}
		if _, err := tx.ExecContext(ctx, "DELETE FROM user_role_assignments WHERE institution_id=? AND user_id=?", a.tenant, id); err != nil {
			return 0, err
		}
		if err := assignRoles(ctx, tx, a.tenant, id, input.Roles); err != nil {
			return 0, err
		}
		return id, input.accountAccess.savePermissions(ctx, tx, a.tenant, id)
	})
}
func (s service) saveRole(c *gin.Context, a actor) {
	var input struct {
		Name        string
		Active      *bool
		Permissions []string
	}
	if c.ShouldBindJSON(&input) != nil || input.Active == nil {
		c.Status(400)
		return
	}
	name := strings.TrimSpace(input.Name)
	if name == "" || len(name) > 64 || len(input.Permissions) > len(registry) {
		c.Status(400)
		return
	}
	seen := map[string]bool{}
	for _, code := range input.Permissions {
		if !slices.Contains(registry, code) {
			c.Status(400)
			return
		}
		seen[code] = true
	}
	if seen[manage] {
		seen[read] = true
	}
	if seen[masterManage] {
		seen[masterRead] = true
	}
	if seen[grantManage] {
		seen[grantRead] = true
	}
	if seen[researchVerify] {
		seen[researchApply] = true
	}
	id := target(c)
	if c.Param("target") != "" && id < 1 {
		c.Status(400)
		return
	}
	s.change(c, a, "role.save", func(ctx context.Context, tx *sql.Tx) (int64, error) {
		if id == 0 {
			result, err := tx.ExecContext(ctx, "INSERT INTO roles (institution_id,name,is_active) VALUES (?,?,?)", a.tenant, name, *input.Active)
			if err != nil {
				return 0, err
			}
			id, err = result.LastInsertId()
			if err != nil {
				return 0, err
			}
		} else {
			var found int64
			if err := tx.QueryRowContext(ctx, "SELECT id FROM roles WHERE id=? AND institution_id=? FOR UPDATE", id, a.tenant).Scan(&found); err != nil {
				return 0, err
			}
			if _, err := tx.ExecContext(ctx, "UPDATE roles SET name=?,is_active=? WHERE id=?", name, *input.Active, id); err != nil {
				return 0, err
			}
			if _, err := tx.ExecContext(ctx, "DELETE FROM role_permissions WHERE role_id=?", id); err != nil {
				return 0, err
			}
		}
		for code := range seen {
			if _, err := tx.ExecContext(ctx, "INSERT INTO role_permissions VALUES (?,?)", id, code); err != nil {
				return 0, err
			}
		}
		return id, nil
	})
}
func (s service) audit(c *gin.Context, a actor) {
	before, _ := strconv.ParseInt(c.Query("before"), 10, 64)
	rows, err := s.db.QueryContext(c.Request.Context(), `SELECT id,COALESCE(actor_user_id,0),COALESCE(effective_role,''),mode,action,
  COALESCE(subject,''),CAST(occurred_at AS CHAR) FROM audit_events
  WHERE (institution_id=? OR (? AND institution_id IS NULL)) AND (?<=0 OR id<?) ORDER BY id DESC LIMIT 50`, a.tenant, a.system(), before, before)
	if err != nil {
		c.Status(503)
		return
	}
	defer rows.Close()
	result := []gin.H{}
	for rows.Next() {
		var id, user int64
		var role, mode, action, subject, when string
		if rows.Scan(&id, &user, &role, &mode, &action, &subject, &when) != nil {
			c.Status(503)
			return
		}
		result = append(result, gin.H{"id": id, "actor": user, "role": role, "mode": mode, "action": action, "subject": subject, "when": when})
	}
	if rows.Err() != nil {
		c.Status(503)
		return
	}
	c.JSON(200, result)
}
