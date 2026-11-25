CREATE TABLE research_proposal_images (
 proposal_id BIGINT UNSIGNED NOT NULL,
 kind ENUM('roadmap','method') NOT NULL,
 mime VARCHAR(16) NOT NULL,
 content MEDIUMBLOB NOT NULL,
 PRIMARY KEY (proposal_id,kind),
 FOREIGN KEY (proposal_id) REFERENCES research_proposals(id)
) ENGINE=InnoDB;
