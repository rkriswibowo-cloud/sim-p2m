CREATE TABLE progress_report_uploads (
 proposal_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
 content MEDIUMBLOB NOT NULL,
 uploaded_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 FOREIGN KEY (proposal_id) REFERENCES research_proposals(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
