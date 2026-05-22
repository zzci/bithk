CREATE TABLE `document_public_links` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`token` text NOT NULL,
	`password` text,
	`expires_at` text,
	`is_active` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_public_links_token_idx` ON `document_public_links` (`token`);--> statement-breakpoint
CREATE INDEX `document_public_links_document_idx` ON `document_public_links` (`document_id`);--> statement-breakpoint
CREATE INDEX `document_public_links_created_by_idx` ON `document_public_links` (`created_by`);--> statement-breakpoint
CREATE INDEX `document_public_links_active_expires_idx` ON `document_public_links` (`is_active`,`expires_at`);