PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_relation_tuples` (
	`id` text PRIMARY KEY NOT NULL,
	`namespace` text NOT NULL,
	`object_id` text NOT NULL,
	`relation` text NOT NULL,
	`subject_namespace` text NOT NULL,
	`subject_id` text NOT NULL,
	`subject_relation` text,
	`created_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_relation_tuples`("id", "namespace", "object_id", "relation", "subject_namespace", "subject_id", "subject_relation", "created_by", "created_at") SELECT "id", "namespace", "object_id", "relation", "subject_namespace", "subject_id", "subject_relation", "created_by", "created_at" FROM `relation_tuples`;--> statement-breakpoint
DROP TABLE `relation_tuples`;--> statement-breakpoint
ALTER TABLE `__new_relation_tuples` RENAME TO `relation_tuples`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_tuples_object` ON `relation_tuples` (`namespace`,`object_id`,`relation`);--> statement-breakpoint
CREATE INDEX `idx_tuples_subject` ON `relation_tuples` (`subject_namespace`,`subject_id`,`subject_relation`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tuples_unique` ON `relation_tuples` (`namespace`,`object_id`,`relation`,`subject_namespace`,`subject_id`,`subject_relation`);--> statement-breakpoint
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
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`display_version_id` text,
	FOREIGN KEY (`file_reference_id`) REFERENCES `file_references`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_drive_entries`("id", "owner_type", "owner_id", "parent_entry_id", "entry_type", "name", "file_reference_id", "favorite", "status", "created_by", "created_at", "updated_at", "display_version_id") SELECT "id", "owner_type", "owner_id", "parent_entry_id", "entry_type", "name", "file_reference_id", "favorite", "status", "created_by", "created_at", "updated_at", "display_version_id" FROM `drive_entries`;--> statement-breakpoint
DROP TABLE `drive_entries`;--> statement-breakpoint
ALTER TABLE `__new_drive_entries` RENAME TO `drive_entries`;--> statement-breakpoint
CREATE INDEX `drive_entries_owner_parent_status_idx` ON `drive_entries` (`owner_type`,`owner_id`,`parent_entry_id`,`status`);--> statement-breakpoint
CREATE INDEX `drive_entries_owner_status_favorite_idx` ON `drive_entries` (`owner_type`,`owner_id`,`status`,`favorite`);--> statement-breakpoint
CREATE INDEX `drive_entries_file_reference_idx` ON `drive_entries` (`file_reference_id`);--> statement-breakpoint
CREATE INDEX `drive_entries_created_by_idx` ON `drive_entries` (`created_by`);--> statement-breakpoint
CREATE UNIQUE INDEX `drive_entries_owner_parent_name_status_idx` ON `drive_entries` (`owner_type`,`owner_id`,`parent_entry_id`,`name`,`status`);--> statement-breakpoint
CREATE INDEX `idx_file_refs_created_by` ON `file_references` (`created_by`);--> statement-breakpoint
CREATE INDEX `idx_files_uploaded_by` ON `files` (`uploaded_by`);