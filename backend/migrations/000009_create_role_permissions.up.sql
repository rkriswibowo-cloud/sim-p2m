CREATE TABLE role_permissions (
 role_id BIGINT UNSIGNED NOT NULL,
 permission_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 PRIMARY KEY (role_id, permission_code),
 FOREIGN KEY (role_id) REFERENCES roles(id)
) ENGINE=InnoDB;
