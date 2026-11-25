ALTER TABLE grant_periods
  ADD COLUMN review_start DATE NULL AFTER closes_at,
  ADD COLUMN review_end DATE NULL AFTER review_start,
  ADD COLUMN execution_start DATE NULL AFTER review_end,
  ADD COLUMN progress_report_date DATE NULL AFTER execution_start,
  ADD COLUMN final_report_date DATE NULL AFTER progress_report_date;

