package iam

import (
	"context"
	"database/sql"
	"errors"
)

type accountAccess struct {
	Roles       []int64
	Permissions *[]string
	FollowRoles bool
}

func assignRoles(ctx context.Context, tx *sql.Tx, tenant, user int64, roles []int64) error {
	seen := map[int64]bool{}
	for _, role := range roles {
		if seen[role] {
			continue
		}
		seen[role] = true
		var found int64
		if err := tx.QueryRowContext(ctx, "SELECT id FROM roles WHERE institution_id=? AND id=?", tenant, role).Scan(&found); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return invalid
			}
			return err
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO user_role_assignments VALUES (?,?,?)", tenant, user, role); err != nil {
			return err
		}
	}
	return nil
}

func (input accountAccess) valid() bool {
	if len(input.Roles) > 64 || (input.FollowRoles && input.Permissions != nil) {
		return false
	}
	if input.Permissions == nil {
		return true
	}
	if len(*input.Permissions) > len(registry) {
		return false
	}
	for _, code := range *input.Permissions {
		valid := false
		for _, known := range registry {
			if code == known {
				valid = true
				break
			}
		}
		if !valid {
			return false
		}
	}
	return true
}

func (input accountAccess) savePermissions(ctx context.Context, tx *sql.Tx, tenant, user int64) error {
	if input.Permissions == nil && !input.FollowRoles {
		return nil
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM membership_permissions WHERE institution_id=? AND user_id=?", tenant, user); err != nil {
		return err
	}
	if input.FollowRoles {
		return nil
	}
	// The empty marker distinguishes explicit no access from following role defaults.
	grants := map[string]bool{"": true}
	for _, code := range *input.Permissions {
		grants[code] = true
	}
	if grants[manage] {
		grants[read] = true
	}
	if grants[masterManage] {
		grants[masterRead] = true
	}
	if grants[grantManage] {
		grants[grantRead] = true
	}
	if grants[researchVerify] {
		grants[researchApply] = true
	}
	for code := range grants {
		if _, err := tx.ExecContext(ctx, "INSERT INTO membership_permissions VALUES (?,?,?)", tenant, user, code); err != nil {
			return err
		}
	}
	return nil
}
