CREATE TABLE grant_periods (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 institution_id BIGINT UNSIGNED NOT NULL,
 code VARCHAR(64) NOT NULL,
 name VARCHAR(200) NOT NULL,
 proposal_year SMALLINT UNSIGNED NOT NULL,
 project_year SMALLINT UNSIGNED NOT NULL,
 budget_year SMALLINT UNSIGNED NOT NULL,
 opens_at DATETIME NOT NULL,
 closes_at DATETIME NOT NULL,
 UNIQUE KEY uq_grant_period_code (institution_id,code),
 UNIQUE KEY uq_grant_period_scope (institution_id,id),
 FOREIGN KEY (institution_id) REFERENCES institutions(id),
 CHECK (closes_at>opens_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
