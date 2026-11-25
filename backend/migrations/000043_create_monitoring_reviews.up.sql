CREATE TABLE monitoring_reviews (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 institution_id BIGINT UNSIGNED NOT NULL,
 proposal_id BIGINT UNSIGNED NOT NULL,
 reviewer_user_id BIGINT UNSIGNED NOT NULL,
 stage ENUM('progress','final') NOT NULL DEFAULT 'progress',
 score DECIMAL(5,2) NOT NULL DEFAULT 0,
 decision ENUM('accepted','revision_needed') NOT NULL DEFAULT 'accepted',
 notes TEXT NOT NULL,
 corrective_action TEXT NOT NULL,
 follow_up_status ENUM('none','pending','resolved') NOT NULL DEFAULT 'none',
 follow_up_note TEXT NOT NULL,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
 INDEX ix_monev_proposal (institution_id, proposal_id, id),
 FOREIGN KEY (proposal_id) REFERENCES research_proposals(id) ON DELETE CASCADE,
 FOREIGN KEY (reviewer_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

