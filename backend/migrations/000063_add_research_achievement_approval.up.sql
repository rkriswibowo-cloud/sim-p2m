ALTER TABLE research_achievement_uploads
 ADD COLUMN upload_version CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
 ADD COLUMN approved_at DATETIME(6) NULL;
