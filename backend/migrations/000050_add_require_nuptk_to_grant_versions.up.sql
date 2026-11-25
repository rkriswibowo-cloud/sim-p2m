ALTER TABLE grant_scheme_versions
  ADD COLUMN require_nuptk BOOLEAN NOT NULL DEFAULT FALSE AFTER active_lecturer;

