-- Custom SQL migration file, put your code below! --
-- Backfill drive_entries timestamps written by the old CURRENT_TIMESTAMP
-- default ('YYYY-MM-DD HH:MM:SS', UTC) into the ISO-8601 format every other
-- table uses ('YYYY-MM-DDTHH:MM:SS.SSSZ'). Rows already in ISO form contain
-- no space and are left untouched.
UPDATE `drive_entries` SET `created_at` = strftime('%Y-%m-%dT%H:%M:%fZ', `created_at`) WHERE `created_at` LIKE '% %';--> statement-breakpoint
UPDATE `drive_entries` SET `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', `updated_at`) WHERE `updated_at` LIKE '% %';
