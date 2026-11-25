CREATE TABLE lecturers (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 institution_id BIGINT UNSIGNED NOT NULL,
 code VARCHAR(64) NOT NULL,
 name VARCHAR(200) NOT NULL,
 is_active BOOLEAN NOT NULL DEFAULT TRUE,
 parent_id BIGINT UNSIGNED NULL,
 email VARCHAR(254) NULL,
 UNIQUE KEY uq_lecturers_code (institution_id, code),
 UNIQUE KEY uq_lecturers_scope (institution_id, id),
 FOREIGN KEY (institution_id) REFERENCES institutions(id),
 FOREIGN KEY (institution_id, parent_id) REFERENCES study_programs(institution_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
