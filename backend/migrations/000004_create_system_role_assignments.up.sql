CREATE TABLE system_role_assignments (
 user_id BIGINT UNSIGNED NOT NULL,
 role_code VARCHAR(32) NOT NULL,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 PRIMARY KEY (user_id, role_code),
 FOREIGN KEY (user_id) REFERENCES users(id),
 CHECK (role_code = 'superadmin')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
