CREATE TABLE audit_events (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 institution_id BIGINT UNSIGNED NULL,
 actor_user_id BIGINT UNSIGNED NULL,
 effective_role VARCHAR(64) NULL,
 mode VARCHAR(16) NOT NULL,
 action VARCHAR(64) NOT NULL,
 subject VARCHAR(160) NULL,
 occurred_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 FOREIGN KEY (institution_id) REFERENCES institutions(id),
 FOREIGN KEY (actor_user_id) REFERENCES users(id),
 INDEX ix_audit_institution_time (institution_id, occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
