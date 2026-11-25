ALTER TABLE research_proposals
 ADD COLUMN workflow_status ENUM('draft','submitted','admin_revision','admin_verified','under_review','review_revision','review_completed','rejected_admin','withdrawn') NOT NULL DEFAULT 'draft',
 ADD COLUMN funding_decision ENUM('pending','funded','not_funded') NOT NULL DEFAULT 'pending',
 ADD COLUMN approved_budget_idr BIGINT UNSIGNED NULL,
 ADD COLUMN decision_note VARCHAR(500) NOT NULL DEFAULT '',
 ADD COLUMN decided_at DATETIME(6) NULL,
 ADD COLUMN decided_by BIGINT UNSIGNED NULL;

