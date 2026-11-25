ALTER TABLE sessions
 ADD COLUMN access_token_hash BINARY(32) NULL UNIQUE,
 ADD COLUMN access_expires_at DATETIME(6) NULL,
 ADD COLUMN family_id BINARY(32) NULL,
 ADD INDEX ix_sessions_family (family_id);
