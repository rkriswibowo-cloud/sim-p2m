CREATE TABLE membership_permissions (
 institution_id BIGINT UNSIGNED NOT NULL,
 user_id BIGINT UNSIGNED NOT NULL,
 permission_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 PRIMARY KEY (institution_id, user_id, permission_code),
 FOREIGN KEY (institution_id, user_id) REFERENCES memberships(institution_id, user_id)
) ENGINE=InnoDB;
