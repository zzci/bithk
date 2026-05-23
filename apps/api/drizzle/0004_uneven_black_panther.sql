CREATE TABLE `shares` (
	`id` text PRIMARY KEY NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
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
	FOREIGN KEY (`shared_with_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shares_token_idx` ON `shares` (`token`);--> statement-breakpoint
CREATE INDEX `shares_resource_idx` ON `shares` (`resource_type`,`resource_id`);--> statement-breakpoint
CREATE INDEX `shares_created_by_idx` ON `shares` (`created_by`);--> statement-breakpoint
CREATE INDEX `shares_shared_with_idx` ON `shares` (`shared_with_user_id`);--> statement-breakpoint
CREATE INDEX `shares_share_type_idx` ON `shares` (`share_type`);--> statement-breakpoint
CREATE INDEX `shares_active_expires_idx` ON `shares` (`is_active`,`expires_at`);--> statement-breakpoint
DROP TABLE `document_public_links`;--> statement-breakpoint
DROP TABLE `drive_file_shares`;