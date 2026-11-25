package iam

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math/big"
	"regexp"
	"strings"
	"time"
)

type proposalData struct {
	Object       string          `json:"object"`
	Location     string          `json:"location"`
	Starts       string          `json:"starts"`
	Ends         string          `json:"ends"`
	Partner      string          `json:"partner"`
	Contribution string          `json:"contribution"`
	Findings     string          `json:"findings"`
	Journal      string          `json:"journal"`
	Roadmap      string          `json:"roadmap"`
	Summary      string          `json:"summary"`
	Keywords     []string        `json:"keywords"`
	SDGKeywords  string          `json:"sdgKeywords"`
	Introduction string          `json:"introduction"`
	Literature   string          `json:"literature"`
	Method       string          `json:"method"`
	Expected     string          `json:"expected"`
	References   string          `json:"references"`
	Team         []memberInput   `json:"team"`
	Students     []studentInput  `json:"students"`
	Outputs      []outputInput   `json:"outputs"`
	Costs        []costInput     `json:"costs"`
	Schedule     []scheduleInput `json:"schedule"`
}

type memberInput struct {
	ID        int64  `json:"id"`
	Expertise string `json:"expertise"`
	Hours     int    `json:"hours"`
	Task      string `json:"task"`
}
type studentInput struct {
	ID       int64  `json:"id"`
	Activity string `json:"activity"`
	Thesis   string `json:"thesis"`
}
type outputInput struct {
	Kind   string `json:"kind"`
	Status string `json:"status"`
	Year   int    `json:"year"`
}
type costInput struct {
	CategoryID int64  `json:"categoryId"`
	Category   string `json:"category"`
	Item       string `json:"item"`
	Reason     string `json:"reason"`
	Quantity   string `json:"quantity"`
	Unit       string `json:"unit"`
	Price      string `json:"price"`
}

func resolveBudgetCategories(ctx context.Context, tx *sql.Tx, tenant int64, data *proposalData, submitting bool) error {
	for i := range data.Costs {
		cost := &data.Costs[i]
		var row *sql.Row
		if cost.CategoryID == 0 {
			row = tx.QueryRowContext(ctx, "SELECT id,name,is_active FROM budget_categories WHERE institution_id=? AND name=? AND is_active LOCK IN SHARE MODE", tenant, strings.TrimSpace(cost.Category))
		} else {
			row = tx.QueryRowContext(ctx, "SELECT id,name,is_active FROM budget_categories WHERE institution_id=? AND id=? LOCK IN SHARE MODE", tenant, cost.CategoryID)
		}
		var id int64
		var name string
		var active bool
		err := row.Scan(&id, &name, &active)
		if errors.Is(err, sql.ErrNoRows) && cost.CategoryID == 0 && !submitting {
			continue
		}
		if errors.Is(err, sql.ErrNoRows) || (err == nil && submitting && !active) {
			return fmt.Errorf("%w: pilih kategori RAB yang aktif pada baris %d", invalidProposal, i+1)
		}
		if err != nil {
			return err
		}
		cost.CategoryID, cost.Category = id, name
	}
	return nil
}

type scheduleInput struct {
	Name      string `json:"name"`
	Output    string `json:"output"`
	Indicator string `json:"indicator"`
	Person    string `json:"person"`
	From      int    `json:"from"`
	To        int    `json:"to"`
}

var quantityPattern = regexp.MustCompile(`^\d{1,9}(\.\d{1,3})?$`)
var pricePattern = regexp.MustCompile(`^\d{1,18}$`)
var honorPattern = regexp.MustCompile(`(?i)\b(honor|honorarium)\b`)

func (data proposalData) budget() (uint64, error) {
	if len(data.Costs) > 100 || len(data.Team) > 30 || len(data.Students) > 50 || len(data.Schedule) > 60 || len(data.Outputs) > 50 || len(data.Keywords) > 5 {
		return 0, errors.New("Jumlah baris atau kata kunci melebihi batas.")
	}
	total := new(big.Int)
	for i, item := range data.Costs {
		if item.Quantity == "" || item.Price == "" {
			continue
		}
		if !quantityPattern.MatchString(item.Quantity) || !pricePattern.MatchString(item.Price) {
			return 0, fmt.Errorf("RAB baris %d harus memakai kuantitas positif dan harga rupiah bulat; gunakan titik untuk desimal", i+1)
		}
		quantity, _ := new(big.Rat).SetString(item.Quantity)
		if quantity.Sign() <= 0 {
			return 0, fmt.Errorf("kuantitas RAB baris %d harus lebih dari nol", i+1)
		}
		price, _ := new(big.Rat).SetString(item.Price)
		subtotal := quantity.Mul(quantity, price)
		subtotal.Add(subtotal, big.NewRat(1, 2))
		total.Add(total, new(big.Int).Quo(subtotal.Num(), subtotal.Denom()))
	}
	if !total.IsInt64() {
		return 0, errors.New("Total RAB melampaui batas rupiah yang didukung.")
	}
	return total.Uint64(), nil
}

func (data proposalData) validateSubmission(title string, fieldID *int64, grant selectedGrant) error {
	if !filled(title, data.Object, data.Location, data.Findings) || fieldID == nil {
		return errors.New("lengkapi judul, bidang riset, objek, lokasi, dan temuan yang ditargetkan")
	}
	starts, startErr := time.Parse("2006-01-02", data.Starts)
	ends, endErr := time.Parse("2006-01-02", data.Ends)
	if startErr != nil || endErr != nil || ends.Before(starts) || ends.After(starts.AddDate(0, grant.duration, 0)) {
		return fmt.Errorf("tanggal kegiatan harus berurutan dalam durasi skema %d bulan", grant.duration)
	}
	if !filled(data.Roadmap, data.Summary, data.Introduction, data.Literature, data.Method, data.Expected, data.References) {
		return errors.New("lengkapi roadmap, ringkasan, pendahuluan, tinjauan pustaka, metode, hasil diharapkan, dan daftar pustaka")
	}
	if len(strings.Fields(data.Introduction)) > 1000 {
		return errors.New("pendahuluan maksimal 1.000 kata")
	}
	if len(data.Keywords) != 5 || !filled(data.Keywords...) {
		return errors.New("isi lima kata kunci")
	}
	for _, member := range data.Team {
		if member.ID < 1 || member.Hours < 1 || member.Hours > 168 || !filled(member.Expertise, member.Task) {
			return errors.New("lengkapi anggota dosen, keahlian, jam per minggu, dan tugas")
		}
	}
	for _, student := range data.Students {
		if student.ID < 1 || !filled(student.Activity) {
			return errors.New("lengkapi mahasiswa dan bentuk keterlibatannya")
		}
	}
	if len(data.Outputs) == 0 || len(data.Costs) == 0 || len(data.Schedule) == 0 {
		return errors.New("tambahkan target luaran, RAB, dan jadwal kegiatan")
	}
	for _, output := range data.Outputs {
		if !filled(output.Kind, output.Status) || output.Year < starts.Year() || output.Year > 2200 {
			return errors.New("periksa jenis, status, dan tahun target setiap luaran")
		}
	}
	for _, cost := range data.Costs {
		if !filled(cost.Category, cost.Item, cost.Reason, cost.Quantity, cost.Unit, cost.Price) {
			return errors.New("lengkapi kategori, item, justifikasi, kuantitas, satuan, dan harga tiap baris RAB")
		}
		if honorPattern.MatchString(cost.Item) || honorPattern.MatchString(cost.Category) {
			return errors.New("RAB proposal penelitian tidak boleh memuat honor pelaksana")
		}
	}
	for _, step := range data.Schedule {
		if !filled(step.Name, step.Output, step.Indicator, step.Person) || step.From < 1 || step.To < step.From || step.To > grant.duration {
			return fmt.Errorf("isi tahapan, luaran, indikator, penanggung jawab, dan jadwal dalam bulan 1–%d", grant.duration)
		}
	}
	total, err := data.budget()
	if err != nil {
		return err
	}
	if total > grant.budget {
		return errors.New("total RAB melampaui pagu skema")
	}
	return nil
}

func filled(items ...string) bool {
	for _, item := range items {
		if strings.TrimSpace(item) == "" {
			return false
		}
	}
	return true
}

func validateTeamRefs(ctx context.Context, tx *sql.Tx, tenant int64, data proposalData) error {
	seen := map[int64]bool{}
	for _, member := range data.Team {
		if member.ID == 0 {
			continue
		}
		if seen[member.ID] {
			return fmt.Errorf("%w: anggota dosen tercatat lebih dari sekali", invalidProposal)
		}
		seen[member.ID] = true
		if err := validatePerson(ctx, tx, tenant, member.ID, "lecturers"); err != nil {
			return err
		}
	}
	seen = map[int64]bool{}
	for _, student := range data.Students {
		if student.ID == 0 {
			continue
		}
		if seen[student.ID] {
			return fmt.Errorf("%w: mahasiswa tercatat lebih dari sekali", invalidProposal)
		}
		seen[student.ID] = true
		if err := validatePerson(ctx, tx, tenant, student.ID, "students"); err != nil {
			return err
		}
	}
	return nil
}

func validatePerson(ctx context.Context, tx *sql.Tx, tenant, person int64, table string) error {
	var id int64
	err := tx.QueryRowContext(ctx, "SELECT id FROM "+table+" WHERE institution_id=? AND id=? AND is_active", tenant, person).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("%w: anggota tim tidak aktif atau bukan bagian dari institusi", invalidProposal)
	}
	return err
}
