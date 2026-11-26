package iam

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"simp2m/backend/internal/modules/auth"
)

const masterRead = "masterdata.read"
const masterManage = "masterdata.manage"

type dataset struct {
	table          string
	parent         string
	email          bool
	phone          bool
	parentRequired bool
	program        bool
}

// Only these static identifiers are interpolated into queries.
var datasets = map[string]dataset{
	"faculties":           {table: "faculties"},
	"study-programs":      {table: "study_programs", parent: "faculties", parentRequired: true},
	"units":               {table: "organization_units"},
	"lecturers":           {table: "lecturers", parent: "study_programs", email: true, phone: true},
	"students":          {table: "students", parent: "study_programs", email: true, parentRequired: true},
	"reviewers":         {table: "reviewers", email: true},
	"funding-sources":   {table: "funding_sources"},
	"scheme-groups":     {table: "scheme_groups"},
	"schemes":           {table: "schemes", parent: "scheme_groups", parentRequired: true, program: true},
	"research-fields":     {table: "research_fields"},
	"budget-categories":   {table: "budget_categories"},
	"output-target-years": {table: "output_target_years"},
}

type masterRecord struct {
	ID         int64  `json:"id"`
	Code       string `json:"code"`
	Name       string `json:"name"`
	Active     bool   `json:"active"`
	ParentID   *int64 `json:"parentId"`
	ParentName string `json:"parentName"`
	Email      string `json:"email"`
	Phone      string `json:"phone,omitempty"`
	Program    string `json:"program,omitempty"`
}

func (s service) listMaster(c *gin.Context, a actor) {
	d, ok := datasets[c.Param("kind")]
	if !ok {
		c.Status(404)
		return
	}
	if len(c.Query("q")) > 200 {
		c.Status(400)
		return
	}
	status := c.Query("status")
	if status != "" && status != "active" && status != "inactive" {
		c.Status(400)
		return
	}
	after := int64(0)
	if raw := c.Query("after"); raw != "" {
		var err error
		after, err = strconv.ParseInt(raw, 10, 64)
		if err != nil || after < 0 {
			c.Status(400)
			return
		}
	}
	parentID, parentName, email, phoneCol, programCol, join := "NULL", "''", "''", "''", "''", ""
	if d.parent != "" {
		parentID, parentName = "m.parent_id", "COALESCE(p.name,'')"
		join = " LEFT JOIN " + d.parent + " p ON p.id=m.parent_id AND p.institution_id=m.institution_id"
	}
	if d.email {
		email = "COALESCE(m.email,'')"
	}
	if d.phone {
		phoneCol = "COALESCE(m.phone,'')"
	}
	if d.program {
		programCol = "m.program"
	}
	args := []any{a.tenant, after}
	query := fmt.Sprintf("SELECT m.id,m.code,m.name,m.is_active,%s,%s,%s,%s,%s FROM %s m%s WHERE m.institution_id=? AND m.id>?", parentID, parentName, email, phoneCol, programCol, d.table, join)
	if status != "" {
		query += " AND m.is_active=?"
		args = append(args, status == "active")
	}
	if q := strings.TrimSpace(c.Query("q")); q != "" {
		query += " AND (LOCATE(?,m.code)>0 OR LOCATE(?,m.name)>0)"
		args = append(args, q, q)
	}
	query += " ORDER BY m.id LIMIT 26"
	rows, err := s.db.QueryContext(c.Request.Context(), query, args...)
	if err != nil {
		c.Status(503)
		return
	}
	defer rows.Close()
	items := []masterRecord{}
	for rows.Next() {
		var item masterRecord
		if err := rows.Scan(&item.ID, &item.Code, &item.Name, &item.Active, &item.ParentID, &item.ParentName, &item.Email, &item.Phone, &item.Program); err != nil {
			c.Status(503)
			return
		}
		items = append(items, item)
	}
	if rows.Err() != nil {
		c.Status(503)
		return
	}
	var next int64
	if len(items) > 25 {
		items = items[:25]
		next = items[24].ID
	}
	c.JSON(200, gin.H{"items": items, "next": next})
}

func (s service) saveMaster(c *gin.Context, a actor) {
	d, ok := datasets[c.Param("kind")]
	if !ok {
		c.Status(404)
		return
	}
	var input struct {
		Code, Name, Email, Phone, Program string
		Active                            *bool
		ParentID                          *int64
	}
	if c.ShouldBindJSON(&input) != nil || input.Active == nil {
		c.Status(400)
		return
	}
	input.Code = strings.ToUpper(strings.TrimSpace(input.Code))
	input.Name = strings.TrimSpace(input.Name)
	input.Program = strings.TrimSpace(input.Program)
	if d.program {
		if input.Program == "" {
			input.Program = "research"
		}
		if input.Program != "research" && input.Program != "community" {
			c.Status(400)
			return
		}
	}
	if input.Code == "" || input.Name == "" || len(input.Code) > 64 || len(input.Name) > 200 ||
		(d.parentRequired && input.ParentID == nil) || (d.parent == "" && input.ParentID != nil) {
		c.Status(400)
		return
	}
	input.Email = strings.TrimSpace(input.Email)
	if input.Email != "" {
		email, valid := auth.NormalizeEmail(input.Email)
		if !d.email || !valid {
			c.Status(400)
			return
		}
		input.Email = email
	}
	id := target(c)
	if c.Param("target") != "" && id < 1 {
		c.Status(400)
		return
	}
	s.change(c, a, "masterdata."+c.Param("kind")+".save", func(ctx context.Context, tx *sql.Tx) (int64, error) {
		if id > 0 {
			var found int64
			if err := tx.QueryRowContext(ctx, "SELECT id FROM "+d.table+" WHERE institution_id=? AND id=? FOR UPDATE", a.tenant, id).Scan(&found); err != nil {
				return 0, err
			}
		}
		if input.ParentID != nil {
			var found int64
			if err := tx.QueryRowContext(ctx, "SELECT id FROM "+d.parent+" WHERE institution_id=? AND id=?", a.tenant, *input.ParentID).Scan(&found); err != nil {
				if errors.Is(err, sql.ErrNoRows) {
					return 0, invalid
				}
				return 0, err
			}
		}
		fields := []string{"code", "name", "is_active"}
		values := []any{input.Code, input.Name, *input.Active}
		if d.parent != "" {
			fields = append(fields, "parent_id")
			values = append(values, input.ParentID)
		}
		if d.email {
			fields = append(fields, "email")
			values = append(values, sql.NullString{String: input.Email, Valid: input.Email != ""})
		}
		if d.phone {
			phone := strings.TrimSpace(input.Phone)
			if len(phone) > 32 {
				phone = phone[:32]
			}
			fields = append(fields, "phone")
			values = append(values, phone)
		}
		if d.program {
			fields = append(fields, "program")
			values = append(values, input.Program)
		}
		if id == 0 {
			fields = append(fields, "institution_id")
			values = append(values, a.tenant)
			query := "INSERT INTO " + d.table + " (" + strings.Join(fields, ",") + ") VALUES (" + strings.TrimSuffix(strings.Repeat("?,", len(fields)), ",") + ")"
			result, err := tx.ExecContext(ctx, query, values...)
			if err != nil {
				return 0, err
			}
			return result.LastInsertId()
		}
		query := "UPDATE " + d.table + " SET " + strings.Join(fields, "=?,") + "=? WHERE institution_id=? AND id=?"
		_, err := tx.ExecContext(ctx, query, append(values, a.tenant, id)...)
		return id, err
	})
}
