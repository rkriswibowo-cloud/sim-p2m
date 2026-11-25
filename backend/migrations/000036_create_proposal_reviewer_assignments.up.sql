CREATE TABLE proposal_reviewer_assignments (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 institution_id BIGINT UNSIGNED NOT NULL,
 proposal_id BIGINT UNSIGNED NOT NULL,
 reviewer_id BIGINT UNSIGNED NOT NULL,
 blind_review BOOLEAN NOT NULL DEFAULT FALSE,
 due_date DATE NULL,
 status ENUM('assigned','accepted','declined','completed') NOT NULL DEFAULT 'assigned',
 conflict_note VARCHAR(500) NOT NULL DEFAULT '',
 assigned_by BIGINT UNSIGNED NOT NULL,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
 UNIQUE KEY uq_assignment_proposal_reviewer (institution_id, proposal_id, reviewer_id),
 INDEX ix_assignment_reviewer (institution_id, reviewer_id, status),
 FOREIGN KEY (proposal_id) REFERENCES research_proposals(id) ON DELETE CASCADE,
 FOREIGN KEY (institution_id, reviewer_id) REFERENCES reviewers(institution_id, id),
 FOREIGN KEY (assigned_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

