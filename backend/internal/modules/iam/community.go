package iam

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
)

const communityDraft = "community.draft"

type communityData struct {
	Partner      string              `json:"partner"`
	Location     string              `json:"location"`
	Need         string              `json:"need"`
	Plan         string              `json:"plan"`
	Outcome      string              `json:"outcome"`
	Budget       string              `json:"budget"`
	Audience     string              `json:"audience"`
	Indicator    string              `json:"indicator"`
	StartsOn     string              `json:"startsOn"`
	EndsOn       string              `json:"endsOn"`
	Introduction string              `json:"introduction"`
	Solution     string              `json:"solution"`
	Technology   string              `json:"technology"`
	References   string              `json:"references"`
	Schedule     []communitySchedule `json:"schedule"`
	Costs        []communityCost     `json:"costs"`
	Targets      []communityTarget   `json:"targets"`
	Team         string              `json:"team"`
	Members      []memberInput       `json:"members"`
	Students     []studentInput      `json:"students"`
	LocationMap  string              `json:"locationMap"`
}

func communityChair(ctx context.Context, db interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, a actor) (grantChoice, error) {
	chair := grantChoice{Name: a.Name}
	err := db.QueryRowContext(ctx, `SELECT id,CONCAT(name,' · ',code) FROM lecturers
 WHERE institution_id=? AND is_active AND (user_id=? OR (user_id IS NULL AND email=?))
 ORDER BY (user_id IS NOT NULL) DESC,id LIMIT 1`, a.tenant, a.ID, a.Email).Scan(&chair.ID, &chair.Name)
	if errors.Is(err, sql.ErrNoRows) {
		return chair, nil
	}
	return chair, err
}

func (s service) communityTeamOptions(c *gin.Context, a actor) {
	ctx := c.Request.Context()
	chair, err := communityChair(ctx, s.db, a)
	if err != nil {
		c.Status(503)
		return
	}
	lecturers, err := s.grantChoices(ctx, a.tenant, "SELECT id,CONCAT(name,' · ',code) FROM lecturers WHERE institution_id=? AND is_active ORDER BY name")
	if err != nil {
		c.Status(503)
		return
	}
	rows, err := s.db.QueryContext(ctx, `SELECT s.id,s.name,p.name FROM students s
 JOIN study_programs p ON p.institution_id=s.institution_id AND p.id=s.parent_id
 WHERE s.institution_id=? AND s.is_active ORDER BY s.name,s.id`, a.tenant)
	if err != nil {
		c.Status(503)
		return
	}
	defer rows.Close()
	type studentChoice struct {
		ID      int64  `json:"id"`
		Name    string `json:"name"`
		Program string `json:"program"`
	}
	students := []studentChoice{}
	for rows.Next() {
		var student studentChoice
		if err := rows.Scan(&student.ID, &student.Name, &student.Program); err != nil {
			c.Status(503)
			return
		}
		students = append(students, student)
	}
	if rows.Err() != nil {
		c.Status(503)
		return
	}
	c.JSON(200, gin.H{"chair": chair, "lecturers": lecturers, "students": students})
}

type communityCost struct {
	Category string `json:"category"`
	Item     string `json:"item"`
	Reason   string `json:"reason"`
	Quantity int    `json:"quantity"`
	Price    string `json:"price"`
}

type communityTarget struct {
	Solution  string `json:"solution"`
	Output    string `json:"output"`
	Indicator string `json:"indicator"`
}

func communityBudget(costs []communityCost) (string, error) {
	var total uint64
	for i, row := range costs {
		price, err := strconv.ParseUint(row.Price, 10, 64)
		category := row.Category == "materials" || row.Category == "copies" || row.Category == "support" || row.Category == "other"
		if err != nil || price == 0 || price > 999999999999999 || !category || row.Quantity < 1 || row.Quantity > 100000 ||
			strings.TrimSpace(row.Item) == "" || strings.TrimSpace(row.Reason) == "" || utf8.RuneCountInString(row.Item) > 300 ||
			utf8.RuneCountInString(row.Reason) > 500 || honorPattern.MatchString(row.Item) || honorPattern.MatchString(row.Reason) ||
			price > (999999999999999-total)/uint64(row.Quantity) {
			return "", fmt.Errorf("Periksa kelompok, kebutuhan, justifikasi, jumlah, dan harga pada baris RAB %d. Honor pelaksana tidak diperbolehkan.", i+1)
		}
		total += price * uint64(row.Quantity)
	}
	return strconv.FormatUint(total, 10), nil
}

type communitySchedule struct {
	Activity string `json:"activity"`
	From     int    `json:"from"`
	To       int    `json:"to"`
}

const selectableCommunityGrant = ` p.program='community' AND s.program='community' AND s.is_active
 AND p.opens_at<=UTC_TIMESTAMP() AND p.closes_at>UTC_TIMESTAMP()
 AND v.version_no=(SELECT MAX(x.version_no) FROM grant_scheme_versions x
 WHERE x.institution_id=v.institution_id AND x.period_id=v.period_id AND x.scheme_id=v.scheme_id)`

const communityGrantJoins = ` FROM grant_scheme_versions v
 JOIN grant_periods p ON p.institution_id=v.institution_id AND p.id=v.period_id
 JOIN schemes s ON s.institution_id=v.institution_id AND s.id=v.scheme_id`

func (s service) communityGrantOptions(c *gin.Context, a actor) {
	rows, err := s.db.QueryContext(c.Request.Context(), `SELECT v.id,v.scheme_name,p.name,p.proposal_year,CAST(v.budget_idr AS CHAR)`+
		communityGrantJoins+` WHERE v.institution_id=? AND`+selectableCommunityGrant+
		` ORDER BY p.proposal_year DESC,p.opens_at DESC,v.scheme_name,v.id DESC`, a.tenant)
	if err != nil {
		c.Status(503)
		return
	}
	defer rows.Close()
	type option struct {
		ID     int64  `json:"id"`
		Scheme string `json:"scheme"`
		Period string `json:"period"`
		Year   int    `json:"year"`
		Budget string `json:"budget"`
	}
	items := []option{}
	for rows.Next() {
		var item option
		if err := rows.Scan(&item.ID, &item.Scheme, &item.Period, &item.Year, &item.Budget); err != nil {
			c.Status(503)
			return
		}
		items = append(items, item)
	}
	if rows.Err() != nil {
		c.Status(503)
		return
	}
	c.JSON(200, items)
}

func (s service) listCommunity(c *gin.Context, a actor) {
	rows, err := s.db.QueryContext(c.Request.Context(), `SELECT d.id,d.title,d.payload,d.revision,d.updated_at,d.grant_version_id,
 COALESCE(v.scheme_name,''),COALESCE(p.name,''),COALESCE(CAST(v.budget_idr AS CHAR),'')
 FROM community_proposals d LEFT JOIN grant_scheme_versions v ON v.institution_id=d.institution_id AND v.id=d.grant_version_id
 LEFT JOIN grant_periods p ON p.institution_id=v.institution_id AND p.id=v.period_id
 WHERE d.institution_id=? AND d.owner_user_id=? AND d.is_active ORDER BY d.updated_at DESC,d.id DESC`, a.tenant, a.ID)
	if err != nil {
		c.Status(503)
		return
	}
	defer rows.Close()
	type draft struct {
		ID             int64         `json:"id"`
		Title          string        `json:"title"`
		Data           communityData `json:"data"`
		Revision       int           `json:"revision"`
		UpdatedAt      time.Time     `json:"updatedAt"`
		GrantVersionID *int64        `json:"grantVersionId"`
		Scheme         string        `json:"scheme"`
		Period         string        `json:"period"`
		GrantBudget    string        `json:"grantBudget"`
	}
	items := []draft{}
	for rows.Next() {
		var item draft
		var raw []byte
		if rows.Scan(&item.ID, &item.Title, &raw, &item.Revision, &item.UpdatedAt, &item.GrantVersionID, &item.Scheme, &item.Period, &item.GrantBudget) != nil || json.Unmarshal(raw, &item.Data) != nil {
			c.Status(503)
			return
		}
		items = append(items, item)
	}
	if rows.Err() != nil {
		c.Status(503)
		return
	}
	c.JSON(200, items)
}

func (s service) saveCommunity(c *gin.Context, a actor) {
	var input struct {
		Title          string        `json:"title"`
		Data           communityData `json:"data"`
		Revision       int           `json:"revision"`
		GrantVersionID *int64        `json:"grantVersionId"`
	}
	id := target(c)
	creating := c.Request.Method == "POST"
	if c.ShouldBindJSON(&input) != nil || (!creating && (id < 1 || input.Revision < 1)) {
		c.Status(400)
		return
	}
	input.Title = strings.TrimSpace(input.Title)
	data := &input.Data
	data.Budget = strings.TrimSpace(data.Budget)
	if len(data.Members) > 3 || len(data.Students) > 50 {
		c.JSON(400, gin.H{"message": "Pilih maksimal 3 anggota dosen dan 50 mahasiswa."})
		return
	}
	if len(data.Costs) > 40 || len(data.Targets) > 30 || utf8.RuneCountInString(data.Team) > 3000 || utf8.RuneCountInString(data.LocationMap) > 2048 {
		c.JSON(400, gin.H{"message": "Periksa panjang identitas tim, tautan peta, jumlah rincian RAB, dan target luaran."})
		return
	}
	if data.Costs != nil {
		total, err := communityBudget(data.Costs)
		if err != nil {
			c.JSON(400, gin.H{"message": err.Error()})
			return
		}
		data.Budget = total
	}
	for i, row := range data.Targets {
		if strings.TrimSpace(row.Solution) == "" || strings.TrimSpace(row.Output) == "" || strings.TrimSpace(row.Indicator) == "" ||
			utf8.RuneCountInString(row.Solution) > 300 || utf8.RuneCountInString(row.Output) > 300 || utf8.RuneCountInString(row.Indicator) > 300 {
			c.JSON(400, gin.H{"message": fmt.Sprintf("Lengkapi solusi, luaran, dan indikator pada baris target %d.", i+1)})
			return
		}
	}
	for _, section := range []struct {
		label, value string
		limit        int
	}{
		{"Pendahuluan", data.Introduction, 1000}, {"Permasalahan prioritas", data.Need, 500},
		{"Solusi", data.Solution, 1500}, {"Metode", data.Plan, 1500}, {"Gambaran IPTEKS", data.Technology, 500},
	} {
		if utf8.RuneCountInString(section.value) > 12000 || len(strings.Fields(section.value)) > section.limit {
			c.JSON(400, gin.H{"message": fmt.Sprintf("%s maksimal %d kata dan 12.000 karakter.", section.label, section.limit)})
			return
		}
	}
	if len(data.Schedule) > 30 || utf8.RuneCountInString(data.References) > 12000 {
		c.JSON(400, gin.H{"message": "Jadwal maksimal 30 kegiatan dan daftar pustaka maksimal 12.000 karakter."})
		return
	}
	for i, row := range data.Schedule {
		if strings.TrimSpace(row.Activity) == "" || utf8.RuneCountInString(row.Activity) > 300 || row.From < 1 || row.To < row.From || row.To > 8 {
			c.JSON(400, gin.H{"message": fmt.Sprintf("Periksa nama kegiatan dan rentang bulan 1 sampai 8 pada baris jadwal %d.", i+1)})
			return
		}
	}
	for _, date := range []string{data.StartsOn, data.EndsOn} {
		if date != "" {
			if _, err := time.Parse(time.DateOnly, date); err != nil {
				c.JSON(400, gin.H{"message": "Gunakan tanggal pelaksanaan yang valid."})
				return
			}
		}
	}
	if data.StartsOn != "" && data.EndsOn != "" && data.EndsOn < data.StartsOn {
		c.JSON(400, gin.H{"message": "Tanggal selesai harus sama dengan atau setelah tanggal mulai."})
		return
	}
	if input.Title == "" || utf8.RuneCountInString(input.Title) > 300 ||
		utf8.RuneCountInString(data.Partner) > 200 || utf8.RuneCountInString(data.Location) > 300 ||
		utf8.RuneCountInString(data.Audience) > 300 || utf8.RuneCountInString(data.Indicator) > 3000 ||
		utf8.RuneCountInString(data.Outcome) > 3000 ||
		(data.Budget != "" && (len(data.Budget) > 15 || strings.Trim(data.Budget, "0123456789") != "")) {
		c.JSON(400, gin.H{"error": "validation", "message": "Periksa judul, panjang isian, dan estimasi anggaran dalam rupiah."})
		return
	}
	raw, err := json.Marshal(input.Data)
	if err != nil {
		c.Status(503)
		return
	}
	s.change(c, a, "community.draft.save", func(ctx context.Context, tx *sql.Tx) (int64, error) {
		var current sql.NullInt64
		if !creating {
			if err := lockCommunity(ctx, tx, a, id, input.Revision); err != nil {
				return 0, err
			}
			if err := tx.QueryRowContext(ctx, "SELECT grant_version_id FROM community_proposals WHERE id=?", id).Scan(&current); err != nil {
				return 0, err
			}
		}
		selected := current
		if input.GrantVersionID != nil {
			selected = sql.NullInt64{Int64: *input.GrantVersionID, Valid: *input.GrantVersionID != 0}
		}
		if !selected.Valid {
			var available bool
			err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1`+communityGrantJoins+
				` WHERE v.institution_id=? AND`+selectableCommunityGrant+`)`, a.tenant).Scan(&available)
			if err != nil {
				return 0, err
			}
			if available {
				return 0, fmt.Errorf("%w: pilih skema untuk usulan Pengabdian", invalidProposal)
			}
		}
		if selected.Valid && selected != current {
			var version int64
			err := tx.QueryRowContext(ctx, `SELECT v.id`+communityGrantJoins+` WHERE v.institution_id=? AND v.id=? AND`+selectableCommunityGrant+
				` LOCK IN SHARE MODE`, a.tenant, selected.Int64).Scan(&version)
			if errors.Is(err, sql.ErrNoRows) {
				return 0, fmt.Errorf("%w: pilih skema dari periode Pengabdian yang masih terbuka", invalidProposal)
			}
			if err != nil {
				return 0, err
			}
		}
		if len(data.Members) > 0 || len(data.Students) > 0 {
			chair, err := communityChair(ctx, tx, a)
			if err != nil {
				return 0, err
			}
			for _, member := range data.Members {
				if member.ID == 0 || member.ID == chair.ID {
					return 0, fmt.Errorf("%w: pilih dosen anggota selain ketua pelaksana", invalidProposal)
				}
			}
			for _, student := range data.Students {
				if student.ID == 0 {
					return 0, fmt.Errorf("%w: pilih mahasiswa untuk setiap baris tim", invalidProposal)
				}
			}
			if err := validateTeamRefs(ctx, tx, a.tenant, proposalData{Team: data.Members, Students: data.Students}); err != nil {
				return 0, err
			}
		}
		if creating {
			result, err := tx.ExecContext(ctx, "INSERT INTO community_proposals (institution_id,owner_user_id,title,payload,grant_version_id) VALUES (?,?,?,?,?)", a.tenant, a.ID, input.Title, string(raw), selected)
			if err != nil {
				return 0, err
			}
			return result.LastInsertId()
		}
		_, err := tx.ExecContext(ctx, "UPDATE community_proposals SET title=?,payload=?,grant_version_id=?,revision=revision+1 WHERE id=?", input.Title, string(raw), selected, id)
		return id, err
	})
}

func lockCommunity(ctx context.Context, tx *sql.Tx, a actor, id int64, revision int) error {
	var current int
	if err := tx.QueryRowContext(ctx, `SELECT revision FROM community_proposals
 WHERE institution_id=? AND owner_user_id=? AND id=? AND is_active FOR UPDATE`, a.tenant, a.ID, id).Scan(&current); err != nil {
		return err
	}
	if current != revision {
		return staleProposal
	}
	return nil
}

func (s service) archiveCommunity(c *gin.Context, a actor) {
	id := target(c)
	var input struct{ Revision int }
	if c.ShouldBindJSON(&input) != nil || id < 1 || input.Revision < 1 {
		c.Status(400)
		return
	}
	s.change(c, a, "community.draft.archive", func(ctx context.Context, tx *sql.Tx) (int64, error) {
		if err := lockCommunity(ctx, tx, a, id, input.Revision); err != nil {
			return 0, err
		}
		_, err := tx.ExecContext(ctx, "UPDATE community_proposals SET is_active=FALSE,revision=revision+1 WHERE id=?", id)
		return id, err
	})
}
