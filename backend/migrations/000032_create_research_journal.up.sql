CREATE TABLE research_journal (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 proposal_id BIGINT UNSIGNED NOT NULL,
 activity_date DATE NOT NULL,
 activity VARCHAR(2000) NOT NULL,
 result VARCHAR(4000) NOT NULL DEFAULT '',
 obstacle VARCHAR(2000) NOT NULL DEFAULT '',
 revision INT UNSIGNED NOT NULL DEFAULT 1,
 is_active BOOLEAN NOT NULL DEFAULT TRUE,
 INDEX ix_research_journal_date (proposal_id,is_active,activity_date,id),
 FOREIGN KEY (proposal_id) REFERENCES research_proposals(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
