package iam

import (
	"context"
	"database/sql"

	"github.com/gin-gonic/gin"
)

func (s service) deleteMaster(c *gin.Context, a actor) {
	kind := c.Param("kind")
	d, ok := datasets[kind]
	if !ok {
		c.Status(404)
		return
	}
	s.archiveScopedRow(c, a, d.table, "masterdata."+kind+".delete")
}

func (s service) deleteRole(c *gin.Context, a actor) {
	s.archiveScopedRow(c, a, "roles", "role.delete")
}

// table comes from the static dataset registry or the roles handler.
func (s service) archiveScopedRow(c *gin.Context, a actor, table, action string) {
	id := target(c)
	if id < 1 {
		c.Status(400)
		return
	}
	s.change(c, a, action, func(ctx context.Context, tx *sql.Tx) (int64, error) {
		var found int64
		if err := tx.QueryRowContext(ctx, "SELECT id FROM "+table+" WHERE institution_id=? AND id=? FOR UPDATE", a.tenant, id).Scan(&found); err != nil {
			return 0, err
		}
		_, err := tx.ExecContext(ctx, "UPDATE "+table+" SET is_active=FALSE WHERE institution_id=? AND id=?", a.tenant, id)
		return id, err
	})
}
