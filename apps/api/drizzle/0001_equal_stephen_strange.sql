PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_project_members` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role_id` text NOT NULL,
	`title` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`role_id`) REFERENCES `project_roles`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_project_members`("id", "project_id", "user_id", "role_id", "title", "created_at", "updated_at") SELECT "id", "project_id", "user_id", "role_id", "title", "created_at", "updated_at" FROM `project_members`;--> statement-breakpoint
DROP TABLE `project_members`;--> statement-breakpoint
ALTER TABLE `__new_project_members` RENAME TO `project_members`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `project_members_project_idx` ON `project_members` (`project_id`);--> statement-breakpoint
CREATE INDEX `project_members_role_idx` ON `project_members` (`role_id`);--> statement-breakpoint
CREATE INDEX `project_members_user_idx` ON `project_members` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_members_project_user_idx` ON `project_members` (`project_id`,`user_id`);--> statement-breakpoint
ALTER TABLE `users` ADD `is_virtual` integer DEFAULT false NOT NULL;