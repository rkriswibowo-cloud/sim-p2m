CREATE TABLE research_achievement_uploads (
 proposal_id BIGINT UNSIGNED NOT NULL,
 slot VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 drive_url VARCHAR(2048) NULL,
 media_type VARCHAR(32) NULL,
 content MEDIUMBLOB NULL,
 PRIMARY KEY (proposal_id, slot),
 FOREIGN KEY (proposal_id) REFERENCES research_proposals(id),
 CHECK (
  (drive_url IS NOT NULL AND media_type IS NULL AND content IS NULL) OR
  (drive_url IS NULL AND media_type IS NOT NULL AND content IS NOT NULL)
 )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
