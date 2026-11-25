CREATE TABLE user_role_assignments (
 institution_id BIGINT UNSIGNED NOT NULL,
 user_id BIGINT UNSIGNED NOT NULL,
 role_id BIGINT UNSIGNED NOT NULL,
 PRIMARY KEY (institution_id, user_id, role_id),
 FOREIGN KEY (institution_id, user_id) REFERENCES memberships(institution_id, user_id),
 FOREIGN KEY (institution_id, role_id) REFERENCES roles(institution_id, id)
) ENGINE=InnoDB;
