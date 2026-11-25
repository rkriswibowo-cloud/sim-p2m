package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"time"

	"database/sql"
	"simp2m/backend/internal/core/database"
	"simp2m/backend/internal/core/httpapi"
	"simp2m/backend/internal/modules/auth"
	"simp2m/backend/internal/modules/iam"
)

func main() {
	address := os.Getenv("SIMP2M_HTTP_ADDR")
	if address == "" {
		address = "127.0.0.1:8080"
	}

	router := httpapi.NewHandler()
	server := &http.Server{
		Addr:              address,
		Handler:           router,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	if dsn := os.Getenv("SIMP2M_DB_DSN"); dsn != "" {
		connect, cancel := context.WithTimeout(ctx, 5*time.Second)
		pool, err := database.Open(connect, dsn)
		cancel()
		if err != nil {
			log.Fatal(err)
		}
		defer pool.Close()
		origin := os.Getenv("SIMP2M_WEB_ORIGIN")
		if origin == "" {
			origin = "http://localhost:3000"
		}
		webURL, err := url.Parse(origin)
		if err != nil || webURL.Hostname() == "" || origin != webURL.Scheme+"://"+webURL.Host {
			log.Fatal("SIMP2M_WEB_ORIGIN must be an origin without a path")
		}
		host := webURL.Hostname()
		loopback := host == "localhost" || host == "127.0.0.1" || host == "::1"
		if webURL.Scheme != "https" && !(webURL.Scheme == "http" && loopback) {
			log.Fatal("SIMP2M_WEB_ORIGIN requires HTTPS outside loopback")
		}
		auth.Register(router, pool, origin, webURL.Scheme == "https")
		var trial *sql.DB
		if trialDSN := os.Getenv("SIMP2M_TRIAL_DSN"); trialDSN != "" {
			connect, cancel := context.WithTimeout(ctx, 5*time.Second)
			trial, err = database.Open(connect, trialDSN)
			cancel()
			if err != nil {
				log.Fatal("connect to trial database")
			}
			defer trial.Close()
			var liveSchema, trialSchema string
			if pool.QueryRowContext(ctx, "SELECT DATABASE()").Scan(&liveSchema) != nil ||
				trial.QueryRowContext(ctx, "SELECT DATABASE()").Scan(&trialSchema) != nil ||
				liveSchema == trialSchema || !strings.HasSuffix(trialSchema, "_trial") {
				log.Fatal("trial requires a separate database ending in _trial")
			}
		}
		iam.Register(router, pool, trial, origin)
	}
	serverErrors := make(chan error, 1)
	go func() {
		log.Printf("SIM-P2M API listening on %s", address)
		serverErrors <- server.ListenAndServe()
	}()

	select {
	case err := <-serverErrors:
		if !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdown); err != nil {
			log.Fatal(err)
		}
	}
}
