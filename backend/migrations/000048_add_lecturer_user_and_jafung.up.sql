ALTER TABLE lecturers
 ADD COLUMN user_id BIGINT UNSIGNED NULL,
 ADD COLUMN nuptk VARCHAR(64) NOT NULL DEFAULT '',
 ADD COLUMN jafung ENUM('','tenaga_pengajar','asisten_ahli','lektor','lektor_kepala','guru_besar') NOT NULL DEFAULT '',
 ADD UNIQUE KEY uq_lecturers_user (institution_id, user_id),
 ADD FOREIGN KEY (user_id) REFERENCES users(id);

