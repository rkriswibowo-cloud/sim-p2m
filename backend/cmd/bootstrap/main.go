package main

import (
	"context"
	"log"
	"os"
	"time"

	"simp2m/backend/internal/core/database"
	"simp2m/backend/internal/modules/auth"
)

func main() {
	dsn := os.Getenv("SIMP2M_BOOTSTRAP_DSN")
	if dsn == "" {
		log.Fatal("SIMP2M_BOOTSTRAP_DSN is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	db, err := database.Open(ctx, dsn)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()
	created, err := auth.Bootstrap(ctx, db, os.Getenv("SIMP2M_BOOTSTRAP_EMAIL"), os.Getenv("SIMP2M_BOOTSTRAP_NAME"), os.Getenv("SIMP2M_BOOTSTRAP_PASSWORD"))
	if err != nil {
		log.Printf("Bootstrap failed: %v", err)
		os.Exit(1)
	}
	if created {
		log.Print("Superadmin created")
	} else {
		log.Print("Superadmin already exists; account unchanged")
	}
}
