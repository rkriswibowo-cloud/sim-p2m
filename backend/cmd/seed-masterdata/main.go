package main

import (
	"context"
	"database/sql"
	"log"
	"os"
	"time"

	"simp2m/backend/internal/core/database"
)

func main() {
	dsn := os.Getenv("SIMP2M_SEED_DSN")
	if dsn == "" {
		log.Fatal("SIMP2M_SEED_DSN is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	db, err := database.Open(ctx, dsn)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()
	if err := seed(ctx, db); err != nil {
		log.Fatal(err)
	}
	log.Print("UAM master data seed completed")
}

func seed(ctx context.Context, db *sql.DB) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var tenant int64
	if err := tx.QueryRowContext(ctx, "SELECT id FROM institutions WHERE code='UAM' FOR UPDATE").Scan(&tenant); err != nil {
		return err
	}
	var seeded bool
	if err := tx.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM masterdata_seed_runs WHERE institution_id=? AND seed_code='uam-budget-v1')", tenant).Scan(&seeded); err != nil {
		return err
	}
	if !seeded {
		if _, err := tx.ExecContext(ctx, `INSERT INTO budget_categories(institution_id,code,name)
 VALUES (?,'BAHAN-HABIS-PAKAI','Bahan Habis Pakai'), (?,'PENGGANDAAN','Penggandaan'),
 (?,'PERALATAN-PENUNJANG','Peralatan Penunjang'), (?,'LAIN-LAIN','Lain-lain')
 ON DUPLICATE KEY UPDATE id=id`, tenant, tenant, tenant, tenant); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO masterdata_seed_runs (institution_id,seed_code) VALUES (?,'uam-budget-v1')", tenant); err != nil {
			return err
		}
	}
	if err := tx.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM masterdata_seed_runs WHERE institution_id=? AND seed_code='uam-research-v1')", tenant).Scan(&seeded); err != nil {
		return err
	}
	if seeded {
		return tx.Commit()
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO scheme_groups(institution_id,code,name)
  VALUES (?,'PENELITIAN','Penelitian') ON DUPLICATE KEY UPDATE id=id`, tenant); err != nil {
		return err
	}
	var group int64
	if err := tx.QueryRowContext(ctx, "SELECT id FROM scheme_groups WHERE institution_id=? AND code='PENELITIAN'", tenant).Scan(&group); err != nil {
		return err
	}
	schemes := [][2]string{
		{"PDP", "Penelitian Dosen Pemula"}, {"PDPRA", "Penelitian Dasar Pratama"},
		{"PDU", "Penelitian Dasar Utama"}, {"PT", "Penelitian Terapan"}, {"PU", "Penelitian Unggulan"},
	}
	for _, row := range schemes {
		if _, err := tx.ExecContext(ctx, `INSERT INTO schemes(institution_id,code,name,parent_id) VALUES (?,?,?,?)
   ON DUPLICATE KEY UPDATE id=id`, tenant, row[0], row[1], group); err != nil {
			return err
		}
	}
	fields := [][2]string{
		{"ANALISA-KLINIK", "Pengembangan Analisa Klinik"},
		{"SDA-OBAT", "Pengembangan Sumber Daya Alam sebagai bahan baku obat"},
		{"HEALTHCARE", "Pengembangan Healthcare untuk Penanganan Kesehatan"},
		{"EKONOMI-KREATIF", "Pengembangan Ekonomi Kreatif"},
		{"DIGITALISASI", "Pengembangan Digitalisasi Data Informasi dan Aplikasi"},
	}
	for _, row := range fields {
		if _, err := tx.ExecContext(ctx, `INSERT INTO research_fields(institution_id,code,name) VALUES (?,?,?)
   ON DUPLICATE KEY UPDATE id=id`, tenant, row[0], row[1]); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO masterdata_seed_runs (institution_id,seed_code) VALUES (?,'uam-research-v1')", tenant); err != nil {
		return err
	}
	return tx.Commit()
}
