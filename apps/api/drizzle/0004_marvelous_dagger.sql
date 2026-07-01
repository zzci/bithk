DROP INDEX `drive_file_versions_entry_version_idx`;--> statement-breakpoint
CREATE INDEX `drive_file_versions_entry_id_idx` ON `drive_file_versions` (`drive_entry_id`,`id`);--> statement-breakpoint
ALTER TABLE `drive_file_versions` DROP COLUMN `version_no`;--> statement-breakpoint
ALTER TABLE `drive_entries` ADD `display_version_id` text;--> statement-breakpoint
ALTER TABLE `drive_entries` DROP COLUMN `current_content_body`;--> statement-breakpoint
ALTER TABLE `drive_entries` DROP COLUMN `edit_lock_id`;--> statement-breakpoint
ALTER TABLE `drive_entries` DROP COLUMN `edit_lock_by`;--> statement-breakpoint
ALTER TABLE `drive_entries` DROP COLUMN `edit_lock_at`;