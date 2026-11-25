CREATE TABLE roles (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 institution_id BIGINT UNSIGNED NOT NULL,
 name VARCHAR(100) NOT NULL,
 is_active BOOLEAN NOT NULL DEFAULT TRUE,
 UNIQUE KEY uq_roles_name (institution_id, name),
 UNIQUE KEY uq_roles_scope (institution_id, id),
 FOREIGN KEY (institution_id) REFERENCES institutions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
