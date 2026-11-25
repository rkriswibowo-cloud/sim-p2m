CREATE TABLE research_journal_evidence (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 journal_id BIGINT UNSIGNED NOT NULL,
 filename VARCHAR(200) NOT NULL,
 mime VARCHAR(100) NOT NULL,
 content MEDIUMBLOB NOT NULL,
 INDEX ix_journal_evidence (journal_id,id),
 FOREIGN KEY (journal_id) REFERENCES research_journal(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
