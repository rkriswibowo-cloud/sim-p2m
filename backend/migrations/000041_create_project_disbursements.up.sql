CREATE TABLE project_disbursements (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 institution_id BIGINT UNSIGNED NOT NULL,
 project_id BIGINT UNSIGNED NOT NULL,
 term_name VARCHAR(100) NOT NULL,
 amount_idr BIGINT UNSIGNED NOT NULL DEFAULT 0,
 status ENUM('planned','transferred') NOT NULL DEFAULT 'planned',
 transfer_date DATE NULL,
 reference_no VARCHAR(120) NOT NULL DEFAULT '',
 proof_mime VARCHAR(64) NOT NULL DEFAULT '',
 proof_content MEDIUMBLOB NULL,
 note VARCHAR(500) NOT NULL DEFAULT '',
 updated_by BIGINT UNSIGNED NOT NULL,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
 INDEX ix_disbursement_project (institution_id, project_id, id),
 FOREIGN KEY (institution_id, project_id) REFERENCES research_projects(institution_id, id) ON DELETE CASCADE,
 FOREIGN KEY (updated_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

