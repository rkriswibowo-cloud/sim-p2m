ALTER TABLE grant_periods
 ADD COLUMN program ENUM('research','community') NOT NULL DEFAULT 'research',
 DROP INDEX uq_grant_period_code,
 ADD UNIQUE KEY uq_grant_period_program_code (institution_id,program,code);
