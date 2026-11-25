ALTER TABLE grant_scheme_versions
 ADD COLUMN min_jafung ENUM('','tenaga_pengajar','asisten_ahli','lektor','lektor_kepala','guru_besar') NOT NULL DEFAULT '';

