ALTER TABLE community_proposals
 ADD COLUMN grant_version_id BIGINT UNSIGNED NULL,
 ADD CONSTRAINT fk_community_grant_version
 FOREIGN KEY (institution_id, grant_version_id) REFERENCES grant_scheme_versions(institution_id, id);
