package migrations

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
)

//go:embed *.up.sql
var files embed.FS

// Apply runs one DDL statement per file. MariaDB implicitly commits DDL,
// so an interrupted migration stays marked dirty for manual inspection.
func Apply(ctx context.Context, db *sql.DB) error {
	conn, err := db.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()

	var locked int
	if err := conn.QueryRowContext(ctx, "SELECT GET_LOCK(CONCAT('simp2m:', SHA1(DATABASE())), 10)").Scan(&locked); err != nil || locked != 1 {
		return fmt.Errorf("could not acquire migration lock")
	}
	defer conn.ExecContext(context.Background(), "SELECT RELEASE_LOCK(CONCAT('simp2m:', SHA1(DATABASE())))")

	if _, err := conn.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
  filename VARCHAR(160) PRIMARY KEY,
  dirty BOOLEAN NOT NULL,
  applied_at DATETIME(6) NULL
 ) ENGINE=InnoDB`); err != nil {
		return err
	}

	entries, err := files.ReadDir(".")
	if err != nil {
		return err
	}
	for _, entry := range entries {
		name := entry.Name()
		var dirty bool
		err := conn.QueryRowContext(ctx, "SELECT dirty FROM schema_migrations WHERE filename = ?", name).Scan(&dirty)
		switch err {
		case nil:
			if dirty {
				return fmt.Errorf("migration %s is dirty; inspect the schema before repairing", name)
			}
			continue
		case sql.ErrNoRows:
		default:
			return err
		}

		statement, err := files.ReadFile(name)
		if err != nil {
			return err
		}
		if _, err := conn.ExecContext(ctx, "INSERT INTO schema_migrations (filename, dirty) VALUES (?, TRUE)", name); err != nil {
			return err
		}
		if _, err := conn.ExecContext(ctx, string(statement)); err != nil {
			return fmt.Errorf("%s: %w", name, err)
		}
		if _, err := conn.ExecContext(ctx, "UPDATE schema_migrations SET dirty = FALSE, applied_at = UTC_TIMESTAMP(6) WHERE filename = ?", name); err != nil {
			return err
		}
	}
	return nil
}
