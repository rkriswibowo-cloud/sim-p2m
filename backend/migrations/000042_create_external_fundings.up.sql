CREATE TABLE external_fundings (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 institution_id BIGINT UNSIGNED NOT NULL,
 owner_user_id BIGINT UNSIGNED NOT NULL,
 title VARCHAR(300) NOT NULL,
 funder_name VARCHAR(200) NOT NULL,
 scheme_name VARCHAR(200) NOT NULL,
 fiscal_year INT UNSIGNED NOT NULL,
 proposed_budget_idr BIGINT UNSIGNED NOT NULL DEFAULT 0,
 approved_budget_idr BIGINT UNSIGNED NULL,
 external_contract_no VARCHAR(120) NOT NULL DEFAULT '',
 status ENUM('registered','verified','funded','not_funded','rejected') NOT NULL DEFAULT 'registered',
 verification_note VARCHAR(500) NOT NULL DEFAULT '',
 proof_mime VARCHAR(64) NOT NULL DEFAULT '',
 proof_content MEDIUMBLOB NULL,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
 INDEX ix_ext_owner (institution_id, owner_user_id, id),
 FOREIGN KEY (institution_id, owner_user_id) REFERENCES memberships(institution_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

