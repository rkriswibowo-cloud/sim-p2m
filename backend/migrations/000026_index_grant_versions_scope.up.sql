ALTER TABLE grant_scheme_versions ADD UNIQUE KEY uq_grant_version_scope (institution_id,id);
