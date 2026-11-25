CREATE TABLE community_proposals (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 institution_id BIGINT UNSIGNED NOT NULL,
 owner_user_id BIGINT UNSIGNED NOT NULL,
 title VARCHAR(300) NOT NULL,
 payload JSON NOT NULL,
 revision INT UNSIGNED NOT NULL DEFAULT 1,
 is_active BOOLEAN NOT NULL DEFAULT TRUE,
 updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
 INDEX ix_community_owner (institution_id,owner_user_id,is_active,updated_at,id),
 FOREIGN KEY (institution_id) REFERENCES institutions(id),
 FOREIGN KEY (owner_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
