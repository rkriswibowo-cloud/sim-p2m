CREATE TABLE output_target_years (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 institution_id BIGINT UNSIGNED NOT NULL,
 code VARCHAR(64) NOT NULL,
 name VARCHAR(200) NOT NULL,
 is_active BOOLEAN NOT NULL DEFAULT TRUE,
 UNIQUE KEY uq_output_target_years_code (institution_id, code),
 FOREIGN KEY (institution_id) REFERENCES institutions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

