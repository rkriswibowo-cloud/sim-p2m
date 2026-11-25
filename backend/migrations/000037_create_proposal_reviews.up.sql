CREATE TABLE proposal_reviews (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 institution_id BIGINT UNSIGNED NOT NULL,
 assignment_id BIGINT UNSIGNED NOT NULL,
 proposal_id BIGINT UNSIGNED NOT NULL,
 reviewer_id BIGINT UNSIGNED NOT NULL,
 score_relevance DECIMAL(5,2) NOT NULL DEFAULT 0,
 score_method DECIMAL(5,2) NOT NULL DEFAULT 0,
 score_novelty DECIMAL(5,2) NOT NULL DEFAULT 0,
 score_budget DECIMAL(5,2) NOT NULL DEFAULT 0,
 total_score DECIMAL(5,2) NOT NULL DEFAULT 0,
 recommendation ENUM('approve','revise','reject') NOT NULL DEFAULT 'revise',
 public_comment TEXT NOT NULL,
 internal_comment TEXT NOT NULL,
 submitted_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 UNIQUE KEY uq_review_assignment (assignment_id),
 INDEX ix_review_proposal (institution_id, proposal_id),
 FOREIGN KEY (assignment_id) REFERENCES proposal_reviewer_assignments(id) ON DELETE CASCADE,
 FOREIGN KEY (proposal_id) REFERENCES research_proposals(id) ON DELETE CASCADE,
 FOREIGN KEY (institution_id, reviewer_id) REFERENCES reviewers(institution_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

