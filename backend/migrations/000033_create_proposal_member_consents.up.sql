CREATE TABLE proposal_member_consents (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 institution_id BIGINT UNSIGNED NOT NULL,
 proposal_id BIGINT UNSIGNED NOT NULL,
 lecturer_id BIGINT UNSIGNED NOT NULL,
 status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
 note VARCHAR(500) NOT NULL DEFAULT '',
 snapshot_hash CHAR(64) NOT NULL DEFAULT '',
 responded_at DATETIME(6) NULL,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
 UNIQUE KEY uq_proposal_consent (institution_id, proposal_id, lecturer_id),
 INDEX ix_consent_lecturer (institution_id, lecturer_id, status),
 FOREIGN KEY (proposal_id) REFERENCES research_proposals(id) ON DELETE CASCADE,
 FOREIGN KEY (institution_id, lecturer_id) REFERENCES lecturers(institution_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

