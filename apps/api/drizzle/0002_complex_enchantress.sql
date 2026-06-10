ALTER TABLE `finance_colleagues` RENAME TO `hr_colleagues`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_hr_colleagues` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`code` text,
	`title` text,
	`department` text,
	`status` text DEFAULT 'active' NOT NULL,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_hr_colleagues`("id", "user_id", "code", "title", "department", "status", "notes", "created_at", "updated_at") SELECT "id", "user_id", "code", "title", "department", "status", "notes", "created_at", "updated_at" FROM `hr_colleagues`;--> statement-breakpoint
DROP TABLE `hr_colleagues`;--> statement-breakpoint
ALTER TABLE `__new_hr_colleagues` RENAME TO `hr_colleagues`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_hr_colleagues_user` ON `hr_colleagues` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_hr_colleagues_status` ON `hr_colleagues` (`status`);