ALTER TABLE `contacts` ADD `kind` text NOT NULL;--> statement-breakpoint
ALTER TABLE `contacts` ADD `position` text;--> statement-breakpoint
ALTER TABLE `contacts` ADD `organization_id` text REFERENCES contacts(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `contacts` ADD `avatar_reference_id` text REFERENCES file_references(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `contacts` ADD `attributes` text;--> statement-breakpoint
CREATE INDEX `contacts_kind_idx` ON `contacts` (`kind`);--> statement-breakpoint
CREATE INDEX `contacts_org_idx` ON `contacts` (`organization_id`);--> statement-breakpoint
ALTER TABLE `contacts` DROP COLUMN `contact_person`;
