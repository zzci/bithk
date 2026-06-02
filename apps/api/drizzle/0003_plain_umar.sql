CREATE TABLE `contact_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`code` text,
	`description` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `contacts` ADD `category_id` text REFERENCES contact_categories(id) ON DELETE set null;
