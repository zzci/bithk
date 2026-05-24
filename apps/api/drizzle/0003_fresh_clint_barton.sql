CREATE TABLE `contact_tags` (
	`contact_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`contact_id`, `tag_id`),
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`contact_person` text,
	`phone` text,
	`email` text,
	`address` text,
	`tax_id` text,
	`note` text,
	`status` text DEFAULT 'active' NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`confidential` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `contacts_owner_idx` ON `contacts` (`owner_id`);