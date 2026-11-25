CREATE TABLE project_amendments (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 institution_id BIGINT UNSIGNED NOT NULL,
 project_id BIGINT UNSIGNED NOT NULL,
 amendment_number VARCHAR(120) NOT NULL,
 amendment_date DATE NOT NULL,
 previous_budget_idr BIGINT UNSIGNED NOT NULL DEFAULT 0,
 new_budget_idr BIGINT UNSIGNED NOT NULL DEFAULT 0,
 reason VARCHAR(500) NOT NULL DEFAULT '',
 created_by BIGINT UNSIGNED NOT NULL,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 INDEX ix_amendment_project (institution_id, project_id, id),
 FOREIGN KEY (institution_id, project_id) REFERENCES research_projects(institution_id, id) ON DELETE CASCADE,
 FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

