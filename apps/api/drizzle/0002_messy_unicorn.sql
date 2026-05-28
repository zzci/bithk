ALTER TABLE `procurement_details` ADD `description` text;--> statement-breakpoint
ALTER TABLE `procurement_details` ADD `priority` text DEFAULT 'medium' NOT NULL;--> statement-breakpoint
ALTER TABLE `procurement_details` ADD `due_date` text;