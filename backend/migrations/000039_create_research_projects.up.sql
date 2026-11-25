CREATE TABLE research_projects (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 institution_id BIGINT UNSIGNED NOT NULL,
 proposal_id BIGINT UNSIGNED NOT NULL,
 contract_number VARCHAR(120) NOT NULL,
 contract_date DATE NOT NULL,
 approved_budget_idr BIGINT UNSIGNED NOT NULL DEFAULT 0,
 status ENUM('active','completed','terminated') NOT NULL DEFAULT 'active',
 created_by BIGINT UNSIGNED NOT NULL,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
 UNIQUE KEY uq_project_proposal (institution_id, proposal_id),
 UNIQUE KEY uq_project_scope (institution_id, id),
 FOREIGN KEY (proposal_id) REFERENCES research_proposals(id),
 FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

