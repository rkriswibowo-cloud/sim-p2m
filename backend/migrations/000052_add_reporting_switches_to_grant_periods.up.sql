ALTER TABLE grant_periods
  ADD COLUMN allow_daily_journal BOOLEAN NOT NULL DEFAULT FALSE AFTER final_report_date,
  ADD COLUMN allow_progress_report BOOLEAN NOT NULL DEFAULT FALSE AFTER allow_daily_journal,
  ADD COLUMN allow_final_report BOOLEAN NOT NULL DEFAULT FALSE AFTER allow_progress_report;

