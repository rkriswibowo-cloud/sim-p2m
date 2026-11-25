CREATE TABLE proposal_approvals (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 institution_id BIGINT UNSIGNED NOT NULL,
 proposal_id BIGINT UNSIGNED NOT NULL,
 from_status VARCHAR(32) NOT NULL,
 to_status VARCHAR(32) NOT NULL,
 actor_user_id BIGINT UNSIGNED NOT NULL,
 role_name VARCHAR(64) NOT NULL DEFAULT '',
 note VARCHAR(500) NOT NULL DEFAULT '',
 revision INT UNSIGNED NOT NULL DEFAULT 1,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 INDEX ix_approval_proposal (institution_id, proposal_id, id),
 FOREIGN KEY (proposal_id) REFERENCES research_proposals(id) ON DELETE CASCADE,
 FOREIGN KEY (actor_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

