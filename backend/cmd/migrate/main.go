package main

import (
	"context"
	"log"
	"os"
	"time"

	"simp2m/backend/internal/core/database"
	"simp2m/backend/migrations"
)

func main() {
	dsn := os.Getenv("SIMP2M_MIGRATION_DSN")
	if dsn == "" {
		log.Fatal("SIMP2M_MIGRATION_DSN is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	db, err := database.Open(ctx, dsn)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()
	if err := migrations.Apply(ctx, db); err != nil {
		log.Fatal(err)
	}
	log.Print("SIM-P2M schema is up to date")
}
