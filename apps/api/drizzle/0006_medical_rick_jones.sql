CREATE TABLE `procurement_details` (
	`item_id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`supplier_member_id` text,
	`assignee_member_id` text,
	`item_name` text NOT NULL,
	`quantity` integer,
	`amount` integer,
	`currency` text,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`supplier_member_id`) REFERENCES `project_members`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`assignee_member_id`) REFERENCES `project_members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `procurement_project_idx` ON `procurement_details` (`project_id`);--> statement-breakpoint
ALTER TABLE `issue_details` ADD `project_id` text REFERENCES projects(id);--> statement-breakpoint
ALTER TABLE `issue_details` ADD `assignee_member_id` text REFERENCES project_members(id);--> statement-breakpoint
CREATE INDEX `issue_project_idx` ON `issue_details` (`project_id`);