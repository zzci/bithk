CREATE TABLE `project_sections` (
	`project_id` text NOT NULL,
	`key` text NOT NULL,
	`sort_order` integer NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`project_id`, `key`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_sections_key_idx` ON `project_sections` (`key`,`project_id`);--> statement-breakpoint
ALTER TABLE `projects` ADD `parent_id` text REFERENCES projects(id);--> statement-breakpoint
CREATE INDEX `projects_parent_idx` ON `projects` (`parent_id`);