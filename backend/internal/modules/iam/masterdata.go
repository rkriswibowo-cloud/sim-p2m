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
	position       bool
}

// Only these static identifiers are interpolated into queries.
var datasets = map[string]dataset{
	"faculties":           {table: "faculties"},
	"study-programs":      {table: "study_programs", parent: "faculties", parentRequired: true},
	"units":               {table: "organization_units"},
	"lecturers":           {table: "lecturers", parent: "study_programs", email: true, phone: true},
	"students":            {table: "students", parent: "study_programs", email: true, parentRequired: true},
	"reviewers":           {table: "reviewers", email: true},
	"officials":           {table: "institution_officials", position: true},
	"funding-sources":     {table: "funding_sources"},
	"scheme-groups":       {table: "scheme_groups"},
	"schemes":             {table: "schemes", parent: "scheme_groups", parentRequired: true, program: true},
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
	NUPTK      string `json:"nuptk,omitempty"`
	Jafung     string `json:"jafung,omitempty"`
	Program    string `json:"program,omitempty"`
	Position   string `json:"position,omitempty"`
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
	parentID, parentName, email, phoneCol, programCol, posCol, join := "NULL", "''", "''", "''", "''", "''", ""
	if d.parent != "" {
		parentID, parentName = "m.parent_id", "COALESCE(p.name,'')"
		join = " LEFT JOIN " + d.parent + " p ON p.id=m.parent_id AND p.institution_id=m.institution_id"
	} else if d.position {
		parentID = "m.parent_id"
		parentName = "CASE WHEN m.position='kaprodi' THEN COALESCE(sp.name,'') WHEN m.position='dekan' THEN COALESCE(f.name,'') ELSE '' END"
		join = " LEFT JOIN study_programs sp ON m.position='kaprodi' AND sp.id=m.parent_id AND sp.institution_id=m.institution_id LEFT JOIN faculties f ON m.position='dekan' AND f.id=m.parent_id AND f.institution_id=m.institution_id"
		posCol = "m.position"
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
	nuptkCol, jafungCol := "''", "''"
	if d.table == "lecturers" {
		nuptkCol, jafungCol = "m.nuptk", "m.jafung"
	}
	args := []any{a.tenant, after}
	query := fmt.Sprintf("SELECT m.id,m.code,m.name,m.is_active,%s,%s,%s,%s,%s,%s,%s,%s FROM %s m%s WHERE m.institution_id=? AND m.id>?", parentID, parentName, email, phoneCol, programCol, posCol, nuptkCol, jafungCol, d.table, join)
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
		if err := rows.Scan(&item.ID, &item.Code, &item.Name, &item.Active, &item.ParentID, &item.ParentName, &item.Email, &item.Phone, &item.Program, &item.Position, &item.NUPTK, &item.Jafung); err != nil {
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
		Code, Name, Email, Phone, Program, Position string
		Active                                      *bool
		ParentID                                    *int64
		NUPTK, Jafung                               *string
	}
	if c.ShouldBindJSON(&input) != nil || input.Active == nil {
		c.Status(400)
		return
	}
	input.Code = strings.ToUpper(strings.TrimSpace(input.Code))
	input.Name = strings.TrimSpace(input.Name)
	input.Program = strings.TrimSpace(input.Program)
	input.Position = strings.TrimSpace(input.Position)
	if d.program {
		if input.Program == "" {
			input.Program = "research"
		}
		if input.Program != "research" && input.Program != "community" {
			c.Status(400)
			return
		}
	}
	if d.position {
		if input.Position != "kaprodi" && input.Position != "dekan" && input.Position != "ketua_lppm" && input.Position != "rektor" {
			c.Status(400)
			return
		}
		if input.Position == "ketua_lppm" || input.Position == "rektor" {
			input.ParentID = nil
		}
	}
	if input.Code == "" || input.Name == "" || len(input.Code) > 64 || len(input.Name) > 200 ||
		(d.parentRequired && input.ParentID == nil) || (d.parent == "" && !d.position && input.ParentID != nil) {
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
	isLecturer := d.table == "lecturers"
	if isLecturer {
		if input.NUPTK != nil {
			*input.NUPTK = strings.TrimSpace(*input.NUPTK)
		}
		if (input.NUPTK != nil && len(*input.NUPTK) > 64) || (input.Jafung != nil && !validJafungValues[*input.Jafung]) {
			c.JSON(400, gin.H{"message": "Periksa NUPTK dan pilihan jabatan fungsional."})
			return
		}
	}
	id := target(c)
	if c.Param("target") != "" && id < 1 {
		c.Status(400)
		return
	}
	if isLecturer && id == 0 && *input.Active && input.Email == "" {
		c.JSON(400, gin.H{"message": "Email diperlukan untuk membuat akun dosen aktif."})
		return
	}
	s.change(c, a, "masterdata."+c.Param("kind")+".save", func(ctx context.Context, tx *sql.Tx) (int64, error) {
		if id > 0 {
			var found int64
			if err := tx.QueryRowContext(ctx, "SELECT id FROM "+d.table+" WHERE institution_id=? AND id=? FOR UPDATE", a.tenant, id).Scan(&found); err != nil {
				return 0, err
			}
		}
		if isLecturer && input.Email != "" {
			var duplicate bool
			if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM lecturers
 WHERE institution_id=? AND id<>? AND email=?)`, a.tenant, id, input.Email).Scan(&duplicate); err != nil {
				return 0, err
			}
			if duplicate {
				return 0, fmt.Errorf("%w: Email sudah digunakan oleh dosen lain di institusi ini.", invalidProposal)
			}
		}
		if input.ParentID != nil {
			parentTable := d.parent
			if d.position {
				if input.Position == "kaprodi" {
					parentTable = "study_programs"
				} else if input.Position == "dekan" {
					parentTable = "faculties"
				}
			}
			var found int64
			if err := tx.QueryRowContext(ctx, "SELECT id FROM "+parentTable+" WHERE institution_id=? AND id=?", a.tenant, *input.ParentID).Scan(&found); err != nil {
				if errors.Is(err, sql.ErrNoRows) {
					return 0, invalid
				}
				return 0, err
			}
		}
		fields := []string{"code", "name", "is_active"}
		values := []any{input.Code, input.Name, *input.Active}
		if d.parent != "" || d.position {
			fields = append(fields, "parent_id")
			values = append(values, input.ParentID)
		}
		if d.position {
			fields = append(fields, "position")
			values = append(values, input.Position)
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
		if isLecturer && input.NUPTK != nil {
			fields = append(fields, "nuptk")
			values = append(values, *input.NUPTK)
		}
		if isLecturer && input.Jafung != nil {
			fields = append(fields, "jafung")
			values = append(values, *input.Jafung)
		}
		if id == 0 {
			fields = append(fields, "institution_id")
			values = append(values, a.tenant)
			query := "INSERT INTO " + d.table + " (" + strings.Join(fields, ",") + ") VALUES (" + strings.TrimSuffix(strings.Repeat("?,", len(fields)), ",") + ")"
			result, err := tx.ExecContext(ctx, query, values...)
			if err != nil {
				return 0, err
			}
			id, err = result.LastInsertId()
			if err != nil {
				return 0, err
			}
		} else {
			query := "UPDATE " + d.table + " SET " + strings.Join(fields, "=?,") + "=? WHERE institution_id=? AND id=?"
			if _, err := tx.ExecContext(ctx, query, append(values, a.tenant, id)...); err != nil {
				return 0, err
			}
		}
		if isLecturer {
			err := provisionLecturerAccount(ctx, tx, a.tenant, id)
			if errors.Is(err, duplicateLecturerEmail) {
				return 0, fmt.Errorf("%w: Email sudah digunakan oleh dosen lain di institusi ini.", invalidProposal)
			}
			if err != nil {
				return 0, err
			}
		}
		return id, nil
	})
}
