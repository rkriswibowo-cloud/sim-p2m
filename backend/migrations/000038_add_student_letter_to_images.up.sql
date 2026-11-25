ALTER TABLE research_proposal_images
 MODIFY COLUMN kind ENUM('roadmap','method','student_letter') NOT NULL,
 MODIFY COLUMN mime VARCHAR(64) NOT NULL;

