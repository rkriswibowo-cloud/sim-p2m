CREATE TABLE masterdata_seed_runs (
 institution_id BIGINT UNSIGNED NOT NULL,
 seed_code VARCHAR(64) NOT NULL,
 applied_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 PRIMARY KEY (institution_id, seed_code),
 FOREIGN KEY (institution_id) REFERENCES institutions(id)
) ENGINE=InnoDB;
