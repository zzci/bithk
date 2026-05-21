CREATE TABLE `drive_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`parent_entry_id` text DEFAULT '' NOT NULL,
	`entry_type` text NOT NULL,
	`name` text NOT NULL,
	`file_reference_id` text,
	`favorite` text DEFAULT '0' NOT NULL,
	`status` text DEFAULT 'normal' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_reference_id`) REFERENCES `file_references`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `drive_entries_owner_parent_status_idx` ON `drive_entries` (`owner_user_id`,`parent_entry_id`,`status`);--> statement-breakpoint
CREATE INDEX `drive_entries_owner_status_favorite_idx` ON `drive_entries` (`owner_user_id`,`status`,`favorite`);--> statement-breakpoint
CREATE INDEX `drive_entries_file_reference_idx` ON `drive_entries` (`file_reference_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `drive_entries_owner_parent_name_status_idx` ON `drive_entries` (`owner_user_id`,`parent_entry_id`,`name`,`status`);