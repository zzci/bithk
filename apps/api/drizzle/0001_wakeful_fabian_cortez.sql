CREATE TABLE `finance_colleagues` (
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
CREATE UNIQUE INDEX `idx_finance_colleagues_user` ON `finance_colleagues` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_finance_colleagues_status` ON `finance_colleagues` (`status`);