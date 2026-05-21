CREATE TABLE `drive_file_shares` (
	`id` text PRIMARY KEY NOT NULL,
	`drive_entry_id` text NOT NULL,
	`token` text NOT NULL,
	`share_type` text DEFAULT 'public_link' NOT NULL,
	`shared_with_user_id` text,
	`permission` text DEFAULT 'view' NOT NULL,
	`password` text,
	`expires_at` text,
	`max_downloads` integer,
	`download_count` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`drive_entry_id`) REFERENCES `drive_entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`shared_with_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `drive_file_shares_token_idx` ON `drive_file_shares` (`token`);--> statement-breakpoint
CREATE INDEX `drive_file_shares_entry_idx` ON `drive_file_shares` (`drive_entry_id`);--> statement-breakpoint
CREATE INDEX `drive_file_shares_created_by_idx` ON `drive_file_shares` (`created_by`);--> statement-breakpoint
CREATE INDEX `drive_file_shares_shared_with_idx` ON `drive_file_shares` (`shared_with_user_id`);--> statement-breakpoint
CREATE INDEX `drive_file_shares_share_type_idx` ON `drive_file_shares` (`share_type`);--> statement-breakpoint
CREATE INDEX `drive_file_shares_active_expires_idx` ON `drive_file_shares` (`is_active`,`expires_at`);--> statement-breakpoint
CREATE TABLE `drive_file_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`drive_entry_id` text NOT NULL,
	`file_reference_id` text NOT NULL,
	`version_no` integer NOT NULL,
	`uploaded_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`drive_entry_id`) REFERENCES `drive_entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_reference_id`) REFERENCES `file_references`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `drive_file_versions_entry_version_idx` ON `drive_file_versions` (`drive_entry_id`,`version_no`);--> statement-breakpoint
CREATE INDEX `drive_file_versions_entry_created_idx` ON `drive_file_versions` (`drive_entry_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `drive_file_versions_file_reference_idx` ON `drive_file_versions` (`file_reference_id`);--> statement-breakpoint
CREATE TABLE `team_directories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `team_directories_created_by_idx` ON `team_directories` (`created_by`);--> statement-breakpoint
CREATE TABLE `team_directory_members` (
	`id` text PRIMARY KEY NOT NULL,
	`directory_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'viewer' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`directory_id`) REFERENCES `team_directories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_directory_members_unique_idx` ON `team_directory_members` (`directory_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `team_directory_members_user_idx` ON `team_directory_members` (`user_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_drive_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_type` text NOT NULL,
	`owner_id` text NOT NULL,
	`parent_entry_id` text DEFAULT '' NOT NULL,
	`entry_type` text NOT NULL,
	`name` text NOT NULL,
	`file_reference_id` text,
	`favorite` text DEFAULT '0' NOT NULL,
	`status` text DEFAULT 'normal' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`file_reference_id`) REFERENCES `file_references`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_drive_entries`("id", "owner_type", "owner_id", "parent_entry_id", "entry_type", "name", "file_reference_id", "favorite", "status", "created_by", "created_at", "updated_at") SELECT "id", "owner_type", "owner_id", "parent_entry_id", "entry_type", "name", "file_reference_id", "favorite", "status", "created_by", "created_at", "updated_at" FROM `drive_entries`;--> statement-breakpoint
DROP TABLE `drive_entries`;--> statement-breakpoint
ALTER TABLE `__new_drive_entries` RENAME TO `drive_entries`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `drive_entries_owner_parent_status_idx` ON `drive_entries` (`owner_type`,`owner_id`,`parent_entry_id`,`status`);--> statement-breakpoint
CREATE INDEX `drive_entries_owner_status_favorite_idx` ON `drive_entries` (`owner_type`,`owner_id`,`status`,`favorite`);--> statement-breakpoint
CREATE INDEX `drive_entries_file_reference_idx` ON `drive_entries` (`file_reference_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `drive_entries_owner_parent_name_status_idx` ON `drive_entries` (`owner_type`,`owner_id`,`parent_entry_id`,`name`,`status`);