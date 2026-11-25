CREATE TABLE research_outputs (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 institution_id BIGINT UNSIGNED NOT NULL,
 proposal_id BIGINT UNSIGNED NOT NULL,
 owner_user_id BIGINT UNSIGNED NOT NULL,
 kind VARCHAR(150) NOT NULL,
 title VARCHAR(300) NOT NULL,
 publication_name VARCHAR(250) NOT NULL DEFAULT '',
 identifier VARCHAR(150) NOT NULL DEFAULT '',
 output_year INT UNSIGNED NOT NULL,
 status ENUM('planned','submitted','accepted','published','granted') NOT NULL DEFAULT 'submitted',
 url VARCHAR(500) NOT NULL DEFAULT '',
 proof_mime VARCHAR(64) NOT NULL DEFAULT '',
 proof_content MEDIUMBLOB NULL,
 verified_status ENUM('pending','verified','rejected') NOT NULL DEFAULT 'pending',
 verified_note VARCHAR(500) NOT NULL DEFAULT '',
 verified_by BIGINT UNSIGNED NULL,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
 INDEX ix_outputs_proposal (institution_id, proposal_id, id),
 FOREIGN KEY (proposal_id) REFERENCES research_proposals(id) ON DELETE CASCADE,
 FOREIGN KEY (owner_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

